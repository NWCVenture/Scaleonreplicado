// GET /api/confeccao/subtasks/[id]/subconferencias
//
// Lista subconferências de uma subtask OPCONF, com contexto da retirada
// (pra calcular esperado vs recebido na contagem oculta).

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { withContaAtiva } from "@/lib/tenancy";
import {
  confeccaoFornecedor,
  confeccaoRetirada,
  confeccaoSubconferencia,
} from "@/lib/db/schema";

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
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const items = await withContaAtiva(async (tx, contaId) =>
      tx
        .select({
          id: confeccaoSubconferencia.id,
          numero: confeccaoSubconferencia.numero,
          status: confeccaoSubconferencia.status,
          retiradaId: confeccaoSubconferencia.retiradaId,
          retiradaNumero: confeccaoRetirada.numero,
          retiradaTipo: confeccaoRetirada.tipo,
          retiradaData: confeccaoRetirada.dataRetirada,
          retiradaPecasPorTamanhoCor: confeccaoRetirada.pecasPorTamanhoCor,
          oficinaId: confeccaoRetirada.oficinaId,
          oficinaNome: confeccaoFornecedor.nome,
          pecasRecebidas: confeccaoSubconferencia.pecasRecebidas,
          divergenciaConfirmada: confeccaoSubconferencia.divergenciaConfirmada,
          oficinaResponsavelDivergenciaId:
            confeccaoSubconferencia.oficinaResponsavelDivergenciaId,
          quantidadeRevelada: confeccaoSubconferencia.quantidadeRevelada,
          responsavelInspecaoId:
            confeccaoSubconferencia.responsavelInspecaoId,
          aprovadas: confeccaoSubconferencia.aprovadas,
          reprovadas: confeccaoSubconferencia.reprovadas,
          tiposDefeito: confeccaoSubconferencia.tiposDefeito,
          dataInspecao: confeccaoSubconferencia.dataInspecao,
          destinoReprovadas: confeccaoSubconferencia.destinoReprovadas,
          localizacaoArmazem: confeccaoSubconferencia.localizacaoArmazem,
          concluidaEm: confeccaoSubconferencia.concluidaEm,
          createdAt: confeccaoSubconferencia.createdAt,
        })
        .from(confeccaoSubconferencia)
        .innerJoin(
          confeccaoRetirada,
          eq(confeccaoRetirada.id, confeccaoSubconferencia.retiradaId),
        )
        .innerJoin(
          confeccaoFornecedor,
          eq(confeccaoFornecedor.id, confeccaoRetirada.oficinaId),
        )
        .where(
          and(
            eq(confeccaoSubconferencia.subtaskConferenciaId, id),
            eq(confeccaoSubconferencia.contaId, contaId),
          ),
        )
        .orderBy(asc(confeccaoSubconferencia.createdAt)),
    );
    return NextResponse.json({ items });
  } catch (err) {
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Erro ao listar subconferências" },
      { status: 500 },
    );
  }
}
