// GET /api/confeccao/ops/[numero]/fardos — fardos da Estante Virtual
// vinculados a uma OP do módulo Confecção (RITM-24).
//
// Cobre dois cenários de vínculo:
//   1. FK explícita: `lote_cadastrado.ordem_producao_id = op.id`
//   2. Match por nome: `estante_fardo.lote = op.numero` (lotes digitados
//      manualmente antes da integração ou sem passar pelo autocomplete)
//
// Retorna os fardos uma única vez mesmo quando os dois critérios batem.

import { NextRequest, NextResponse } from "next/server";
import { desc, eq, or, sql } from "drizzle-orm";
import { withContaAtiva } from "@/lib/tenancy";
import {
  confeccaoOrdemProducao,
  estante,
  estanteFardo,
  loteCadastrado,
} from "@/lib/db/schema";

const LIMIT = 1000;

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return (
    msg.includes("conta ativa") ||
    msg.includes("Sessão") ||
    msg.includes("Nenhuma")
  );
}

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ numero: string }> },
) {
  try {
    const { numero } = await ctx.params;

    // contaId não é consultado explicitamente: o RLS de `confeccaoOrdemProducao`
    // e `estanteFardo` já garante o filtro pela conta ativa via `withContaAtiva`.
    const result = await withContaAtiva(async (tx) => {
      const [op] = await tx
        .select({
          id: confeccaoOrdemProducao.id,
          numero: confeccaoOrdemProducao.numero,
          status: confeccaoOrdemProducao.status,
        })
        .from(confeccaoOrdemProducao)
        .where(eq(confeccaoOrdemProducao.numero, numero))
        .limit(1);

      if (!op) {
        return { notFound: true as const };
      }

      // União: nome bate OU FK no lote_cadastrado bate.
      const fardos = await tx
        .select({
          id: estanteFardo.id,
          qrCode: estanteFardo.qrCode,
          sku: estanteFardo.sku,
          lote: estanteFardo.lote,
          quantidade: estanteFardo.quantidade,
          createdAt: estanteFardo.createdAt,
          estanteId: estanteFardo.estanteId,
          estanteNome: estante.nome,
        })
        .from(estanteFardo)
        .innerJoin(estante, eq(estante.id, estanteFardo.estanteId))
        .where(
          or(
            eq(estanteFardo.lote, op.numero),
            sql`${estanteFardo.lote} IN (
              SELECT ${loteCadastrado.nome}
              FROM ${loteCadastrado}
              WHERE ${loteCadastrado.ordemProducaoId} = ${op.id}
            )`,
          ),
        )
        .orderBy(desc(estanteFardo.createdAt))
        .limit(LIMIT);

      const totalPecas = fardos.reduce((acc, f) => acc + f.quantidade, 0);

      return {
        notFound: false as const,
        op: { id: op.id, numero: op.numero, status: op.status },
        fardos,
        totalFardos: fardos.length,
        totalPecas,
      };
    });

    if (result.notFound) {
      return NextResponse.json({ error: "OP não encontrada" }, { status: 404 });
    }

    return NextResponse.json({
      op: result.op,
      fardos: result.fardos,
      totalFardos: result.totalFardos,
      totalPecas: result.totalPecas,
    });
  } catch (err) {
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    console.error("Erro ao listar fardos da OP:", err);
    return NextResponse.json(
      { error: "Erro ao listar fardos" },
      { status: 500 },
    );
  }
}
