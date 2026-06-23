// GET /api/confeccao/ops/[numero]/saldos
//
// Retorna saldos consolidados da OP (compra, corte, costura) calculados
// on-demand a partir dos payloads + retiradas. Sem materialização — pra
// MVP é suficiente, dado que cada OP tem ~6 subtasks e ≤ 5 oficinas.

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { withContaAtiva } from "@/lib/tenancy";
import {
  confeccaoOrdemProducao,
  confeccaoRetirada,
  confeccaoSubconferencia,
  confeccaoSubtask,
} from "@/lib/db/schema";
import { calcularSaldosOP } from "@/lib/confeccao/saldos";
import type { SubtaskCompraPayload } from "@/lib/confeccao/schemas/payloads/compra";
import type { SubtaskCortePayload } from "@/lib/confeccao/schemas/payloads/corte";
import type { SubtaskCosturaPayload } from "@/lib/confeccao/schemas/payloads/costura";

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
    const result = await withContaAtiva(async (tx, contaId) => {
      const [op] = await tx
        .select({ id: confeccaoOrdemProducao.id })
        .from(confeccaoOrdemProducao)
        .where(
          and(
            eq(confeccaoOrdemProducao.numero, numero),
            eq(confeccaoOrdemProducao.contaId, contaId),
          ),
        );
      if (!op) return null;

      const subtasks = await tx
        .select({
          prefixo: confeccaoSubtask.prefixo,
          payload: confeccaoSubtask.payload,
          id: confeccaoSubtask.id,
        })
        .from(confeccaoSubtask)
        .where(eq(confeccaoSubtask.ordemProducaoId, op.id))
        .orderBy(asc(confeccaoSubtask.ordemSequencial));

      const compra = subtasks.find((s) => s.prefixo === "OPBUY")?.payload as
        | SubtaskCompraPayload
        | undefined;
      const corte = subtasks.find((s) => s.prefixo === "OPCOR")?.payload as
        | SubtaskCortePayload
        | undefined;
      const costura = subtasks.find((s) => s.prefixo === "OPSEW")?.payload as
        | SubtaskCosturaPayload
        | undefined;
      const subtaskCostura = subtasks.find((s) => s.prefixo === "OPSEW");

      const retiradas = subtaskCostura
        ? await tx
            .select({
              oficinaId: confeccaoRetirada.oficinaId,
              pecasPorTamanhoCor: confeccaoRetirada.pecasPorTamanhoCor,
              canceladaEm: confeccaoRetirada.canceladaEm,
              pecasRecebidasSubconf: confeccaoSubconferencia.pecasRecebidas,
            })
            .from(confeccaoRetirada)
            .leftJoin(
              confeccaoSubconferencia,
              eq(confeccaoSubconferencia.retiradaId, confeccaoRetirada.id),
            )
            .where(eq(confeccaoRetirada.subtaskCosturaId, subtaskCostura.id))
        : [];

      return calcularSaldosOP({
        compra,
        corte,
        costura,
        retiradas: retiradas.map((r) => ({
          oficinaId: r.oficinaId,
          pecasPorTamanhoCor: r.pecasPorTamanhoCor as Record<
            string,
            Record<string, number>
          >,
          pecasRecebidasSubconf: r.pecasRecebidasSubconf as Record<
            string,
            Record<string, number>
          > | null,
          canceladaEm: r.canceladaEm,
        })),
      });
    });

    if (!result) {
      return NextResponse.json({ error: "OP não encontrada" }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (err) {
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    console.error("Erro ao calcular saldos:", err);
    return NextResponse.json(
      { error: "Erro ao calcular saldos" },
      { status: 500 },
    );
  }
}
