import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { estante, estanteFardo, estanteMovimentacao } from "@/lib/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { generateId } from "@/lib/utils";
import { withContaAtiva } from "@/lib/tenancy";
import { parseQRCode } from "@/lib/estante-utils";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return msg.includes("conta ativa") || msg.includes("Sessão");
}

// Aceita identificação por QR bruto (preferido — backend faz o match) ou pelo
// id direto da linha em estante_fardo. O match server-side replica a prioridade
// usada na retirada unitária: UUID > codigoFardo > SKU+LOTE.
const bulkDeleteSchema = z.object({
  fardos: z
    .array(
      z.object({
        qrCode: z.string().min(1).optional(),
        fardoId: z.string().min(1).optional(),
      })
    )
    .min(1),
});

type NaoEncontrado = {
  qrCode?: string;
  fardoId?: string;
  motivo: "nao-encontrado";
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const data = bulkDeleteSchema.parse(body);

    const result = await withContaAtiva(async (tx, contaId) => {
      const [parentEstante] = await tx
        .select({ nome: estante.nome })
        .from(estante)
        .where(and(eq(estante.contaId, contaId), eq(estante.id, id)));

      if (!parentEstante) {
        return null;
      }

      // Carrega todos os fardos da estante atual pra fazer o matching em memória.
      // (Ainda escopado por estanteId — não vai buscar fora dela.)
      const fardosNaEstante = await tx
        .select()
        .from(estanteFardo)
        .where(
          and(
            eq(estanteFardo.contaId, contaId),
            eq(estanteFardo.estanteId, id)
          )
        );

      const norm = (s: string) => s.toUpperCase().replace(/\s+/g, " ").trim();
      const aDeletar: typeof fardosNaEstante = [];
      const naoEncontrados: NaoEncontrado[] = [];
      const jaMarcados = new Set<string>(); // dedup quando bipam o mesmo fardo duas vezes

      for (const req of data.fardos) {
        if (req.fardoId) {
          const hit = fardosNaEstante.find((f) => f.id === req.fardoId);
          if (hit && !jaMarcados.has(hit.id)) {
            aDeletar.push(hit);
            jaMarcados.add(hit.id);
          } else if (!hit) {
            naoEncontrados.push({ fardoId: req.fardoId, motivo: "nao-encontrado" });
          }
          continue;
        }

        if (!req.qrCode) continue;
        const parsed = parseQRCode(req.qrCode);
        if (!parsed) {
          naoEncontrados.push({ qrCode: req.qrCode, motivo: "nao-encontrado" });
          continue;
        }

        let hit: typeof fardosNaEstante[number] | undefined;
        if (parsed.uuid) {
          hit = fardosNaEstante.find(
            (f) =>
              !jaMarcados.has(f.id) && parseQRCode(f.qrCode)?.uuid === parsed.uuid
          );
        }
        if (!hit && parsed.codigoFardo) {
          hit = fardosNaEstante.find(
            (f) =>
              !jaMarcados.has(f.id) &&
              parseQRCode(f.qrCode)?.codigoFardo === parsed.codigoFardo
          );
        }
        if (!hit) {
          hit = fardosNaEstante.find(
            (f) =>
              !jaMarcados.has(f.id) &&
              norm(f.sku) === norm(parsed.sku) &&
              norm(f.lote) === norm(parsed.lote)
          );
        }

        if (hit) {
          aDeletar.push(hit);
          jaMarcados.add(hit.id);
        } else {
          naoEncontrados.push({ qrCode: req.qrCode, motivo: "nao-encontrado" });
        }
      }

      if (aDeletar.length === 0) {
        return { removed: 0, naoEncontrados };
      }

      const [{ count: totalAntes }] = await tx
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(estanteFardo)
        .where(
          and(
            eq(estanteFardo.contaId, contaId),
            eq(estanteFardo.estanteId, id)
          )
        );

      const idsADeletar = aDeletar.map((f) => f.id);
      await tx
        .delete(estanteFardo)
        .where(
          and(
            eq(estanteFardo.contaId, contaId),
            eq(estanteFardo.estanteId, id),
            inArray(estanteFardo.id, idsADeletar)
          )
        );

      // Loga 1 SAIDA por fardo (auditoria detalhada),
      // total_antes/total_depois decrescem conforme cada fardo sai.
      const movs = aDeletar.map((f, idx) => ({
        id: generateId(),
        estanteId: id,
        estanteNome: parentEstante.nome,
        tipo: "SAIDA" as const,
        fardoSku: f.sku,
        fardoLote: f.lote,
        fardoQuantidade: f.quantidade,
        totalAntes: totalAntes - idx,
        totalDepois: totalAntes - idx - 1,
        totalPecas: null,
        usuarioId: session.user.id,
        contaId,
      }));
      await tx.insert(estanteMovimentacao).values(movs);

      return { removed: aDeletar.length, naoEncontrados };
    });

    if (!result) {
      return NextResponse.json(
        { error: "Estante nao encontrada" },
        { status: 404 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Dados invalidos", details: error.issues },
        { status: 400 }
      );
    }
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }
    console.error("Error bulk-deleting fardos:", error);
    return NextResponse.json(
      { error: "Erro ao remover fardos" },
      { status: 500 }
    );
  }
}
