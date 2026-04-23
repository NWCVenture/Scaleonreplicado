import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { estante, estanteFardo, estanteMovimentacao } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { generateId } from "@/lib/utils";
import { withContaAtiva } from "@/lib/tenancy";

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
});

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

      const [{ count: totalAntes }] = await tx
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(estanteFardo)
        .where(
          and(
            eq(estanteFardo.contaId, contaId),
            eq(estanteFardo.estanteId, id)
          )
        );

      const newFardos = data.fardos.map((f) => ({
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

      const [{ count: totalDepois }] = await tx
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(estanteFardo)
        .where(
          and(
            eq(estanteFardo.contaId, contaId),
            eq(estanteFardo.estanteId, id)
          )
        );

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

      const isSingle = data.fardos.length === 1;

      await tx.insert(estanteMovimentacao).values({
        id: generateId(),
        estanteId: id,
        estanteNome: found.nome,
        tipo: isSingle ? "ENTRADA" : "IMPORTACAO",
        fardoSku: isSingle ? data.fardos[0].sku : null,
        fardoLote: isSingle ? data.fardos[0].lote : null,
        fardoQuantidade: isSingle ? data.fardos[0].quantidade : null,
        totalAntes,
        totalDepois,
        totalPecas,
        usuarioId: session.user.id,
        contaId,
      });

      return { added: data.fardos.length };
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
