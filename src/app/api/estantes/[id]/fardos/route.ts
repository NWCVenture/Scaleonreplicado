import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { estante, estanteFardo, estanteMovimentacao } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { generateId } from "@/lib/utils";
import { withContaAtiva } from "@/lib/tenancy";
import { parseQRCode } from "@/lib/estante-utils";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return msg.includes("conta ativa") || msg.includes("Sessão");
}

const addFardoSchema = z.object({
  fardos: z
    .array(
      z.object({
        qrCode: z.string().min(1),
        sku: z.string().min(1),
        lote: z.string().min(1),
        quantidade: z.number().int().positive(),
      })
    )
    .min(1),
  // origem="importacao" mantém o comportamento antigo (1 linha IMPORTACAO
  // de resumo no histórico). O fluxo normal de inclusão envia "manual"
  // (padrão), que loga 1 ENTRADA por fardo pra auditoria detalhada.
  origem: z.enum(["manual", "importacao"]).optional().default("manual"),
});

type SkippedFardo = {
  qrCode: string;
  sku: string;
  lote: string;
  motivo: "duplicado-mesma-estante" | "ja-existe-outra-estante";
  estanteNome?: string;
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
    const data = addFardoSchema.parse(body);

    const result = await withContaAtiva(async (tx, contaId) => {
      const [found] = await tx
        .select({ nome: estante.nome })
        .from(estante)
        .where(and(eq(estante.contaId, contaId), eq(estante.id, id)));

      if (!found) {
        return null;
      }

      // ── Validação anti-duplicata ───────────────────────────────────
      // Pra cada fardo recebido, extrai uuid e codigoFardo do payload do QR.
      // Em seguida, busca em todas as estantes da conta (incluindo a atual)
      // qualquer fardo cujo qr_code carregue o mesmo uuid OU o mesmo
      // codigoFardo. Quando há colisão, o fardo é descartado e reportado em
      // `skipped` com o motivo + nome da estante onde já está.
      const candidates = data.fardos.map((f) => ({
        ...f,
        parsed: parseQRCode(f.qrCode),
      }));

      const existentes = await tx
        .select({
          id: estanteFardo.id,
          estanteId: estanteFardo.estanteId,
          estanteNome: estante.nome,
          qrCode: estanteFardo.qrCode,
        })
        .from(estanteFardo)
        .innerJoin(estante, eq(estante.id, estanteFardo.estanteId))
        .where(eq(estanteFardo.contaId, contaId));

      const existentesIndex = existentes.map((e) => ({
        estanteId: e.estanteId,
        estanteNome: e.estanteNome,
        parsed: parseQRCode(e.qrCode),
        qrCode: e.qrCode,
      }));

      const skipped: SkippedFardo[] = [];
      const aInserir: typeof data.fardos = [];
      // Detecta duplicatas dentro do próprio batch (mesmo uuid/codigoFardo
      // chegando duas vezes no mesmo POST).
      const uuidsBatch = new Set<string>();
      const codigosBatch = new Set<string>();

      for (const cand of candidates) {
        const parsedUuid = cand.parsed?.uuid;
        const parsedCodigo = cand.parsed?.codigoFardo;

        let conflitoEstante: { estanteId: string; estanteNome: string } | null =
          null;
        if (parsedUuid) {
          const hit = existentesIndex.find(
            (e) => e.parsed?.uuid === parsedUuid
          );
          if (hit) {
            conflitoEstante = {
              estanteId: hit.estanteId,
              estanteNome: hit.estanteNome,
            };
          }
        }
        if (!conflitoEstante && parsedCodigo) {
          const hit = existentesIndex.find(
            (e) => e.parsed?.codigoFardo === parsedCodigo
          );
          if (hit) {
            conflitoEstante = {
              estanteId: hit.estanteId,
              estanteNome: hit.estanteNome,
            };
          }
        }

        if (conflitoEstante) {
          skipped.push({
            qrCode: cand.qrCode,
            sku: cand.sku,
            lote: cand.lote,
            motivo:
              conflitoEstante.estanteId === id
                ? "duplicado-mesma-estante"
                : "ja-existe-outra-estante",
            estanteNome: conflitoEstante.estanteNome,
          });
          continue;
        }

        if (parsedUuid && uuidsBatch.has(parsedUuid)) {
          skipped.push({
            qrCode: cand.qrCode,
            sku: cand.sku,
            lote: cand.lote,
            motivo: "duplicado-mesma-estante",
          });
          continue;
        }
        if (parsedCodigo && codigosBatch.has(parsedCodigo)) {
          skipped.push({
            qrCode: cand.qrCode,
            sku: cand.sku,
            lote: cand.lote,
            motivo: "duplicado-mesma-estante",
          });
          continue;
        }

        if (parsedUuid) uuidsBatch.add(parsedUuid);
        if (parsedCodigo) codigosBatch.add(parsedCodigo);
        aInserir.push({
          qrCode: cand.qrCode,
          sku: cand.sku,
          lote: cand.lote,
          quantidade: cand.quantidade,
        });
      }

      if (aInserir.length === 0) {
        return { added: 0, skipped };
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

      const newFardos = aInserir.map((f) => ({
        id: generateId(),
        estanteId: id,
        qrCode: f.qrCode,
        sku: f.sku,
        lote: f.lote,
        quantidade: f.quantidade,
        adicionadoPor: session.user.id,
        contaId,
      }));

      await tx.insert(estanteFardo).values(newFardos);

      if (data.origem === "importacao") {
        // Mantém o comportamento legado da Importar Balanço: 1 linha
        // IMPORTACAO resumo (sem fardoSku/Lote/Quantidade individuais).
        const [{ total: totalPecas }] = await tx
          .select({
            total: sql<number>`coalesce(cast(sum(${estanteFardo.quantidade}) as int), 0)`,
          })
          .from(estanteFardo)
          .where(
            and(
              eq(estanteFardo.contaId, contaId),
              eq(estanteFardo.estanteId, id)
            )
          );
        await tx.insert(estanteMovimentacao).values({
          id: generateId(),
          estanteId: id,
          estanteNome: found.nome,
          tipo: "IMPORTACAO",
          fardoSku: null,
          fardoLote: null,
          fardoQuantidade: null,
          totalAntes,
          totalDepois: totalAntes + aInserir.length,
          totalPecas,
          usuarioId: session.user.id,
          contaId,
        });
      } else {
        // Fluxo manual (bipagem com revisão): 1 ENTRADA por fardo.
        // total_antes/total_depois são incrementais conforme cada fardo entra.
        const movs = newFardos.map((f, idx) => ({
          id: generateId(),
          estanteId: id,
          estanteNome: found.nome,
          tipo: "ENTRADA" as const,
          fardoSku: f.sku,
          fardoLote: f.lote,
          fardoQuantidade: f.quantidade,
          totalAntes: totalAntes + idx,
          totalDepois: totalAntes + idx + 1,
          totalPecas: null,
          usuarioId: session.user.id,
          contaId,
        }));
        await tx.insert(estanteMovimentacao).values(movs);
      }

      return { added: aInserir.length, skipped };
    });

    if (!result) {
      return NextResponse.json(
        { error: "Estante nao encontrada" },
        { status: 404 }
      );
    }

    return NextResponse.json(result, { status: 201 });
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

    console.error("Error adding fardos:", error);
    return NextResponse.json(
      { error: "Erro ao adicionar fardos" },
      { status: 500 }
    );
  }
}
