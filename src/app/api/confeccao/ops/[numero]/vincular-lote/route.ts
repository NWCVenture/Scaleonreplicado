// POST /api/confeccao/ops/[numero]/vincular-lote
//
// Faz upsert em `lote_cadastrado` com FK pra OP. Idempotente: chamado
// no momento que o operador seleciona uma OP no autocomplete do
// cadastro de fardos (RITM-24).

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { withContaAtiva } from "@/lib/tenancy";
import { confeccaoOrdemProducao } from "@/lib/db/schema";
import { vincularLoteAOP } from "@/lib/confeccao/lote-op";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return (
    msg.includes("conta ativa") ||
    msg.includes("Sessão") ||
    msg.includes("Nenhuma")
  );
}

export async function POST(
  _request: NextRequest,
  ctx: { params: Promise<{ numero: string }> },
) {
  try {
    const { numero } = await ctx.params;

    const result = await withContaAtiva(async (tx, contaId) => {
      const [op] = await tx
        .select({
          id: confeccaoOrdemProducao.id,
          numero: confeccaoOrdemProducao.numero,
        })
        .from(confeccaoOrdemProducao)
        .where(eq(confeccaoOrdemProducao.numero, numero))
        .limit(1);

      if (!op) return { notFound: true as const };

      const vinculo = await vincularLoteAOP(tx, {
        contaId,
        opId: op.id,
        opNumero: op.numero,
      });

      return { notFound: false as const, op, vinculo };
    });

    if (result.notFound) {
      return NextResponse.json({ error: "OP não encontrada" }, { status: 404 });
    }

    return NextResponse.json(
      {
        lote: {
          id: result.vinculo.loteId,
          nome: result.op.numero,
          ordemProducaoId: result.op.id,
        },
        criado: result.vinculo.criado,
      },
      { status: result.vinculo.criado ? 201 : 200 },
    );
  } catch (err) {
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    console.error("Erro ao vincular lote à OP:", err);
    return NextResponse.json(
      { error: "Erro ao vincular lote" },
      { status: 500 },
    );
  }
}
