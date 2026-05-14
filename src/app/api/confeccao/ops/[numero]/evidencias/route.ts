// GET /api/confeccao/ops/[numero]/evidencias — RITM-19
//
// Agrega custos, anexos e lalamoves da OP em um payload único pra a aba
// Evidências de Pagamento. Read-only — não muta estado.

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import { withContaAtiva } from "@/lib/tenancy";
import {
  confeccaoAnexo,
  confeccaoLalamove,
  confeccaoOrdemProducao,
  confeccaoProduto,
  confeccaoRetirada,
  confeccaoSubconferencia,
  confeccaoSubtask,
} from "@/lib/db/schema";
import { calcularCustosOP } from "@/lib/confeccao/custos";
import type { SubtaskCompraPayload } from "@/lib/confeccao/schemas/payloads/compra";
import type { SubtaskCortePayload } from "@/lib/confeccao/schemas/payloads/corte";
import type { SubtaskCosturaPayload } from "@/lib/confeccao/schemas/payloads/costura";
import type { SubtaskRiscoPayload } from "@/lib/confeccao/schemas/payloads/risco";
import type { SubtaskViesPayload } from "@/lib/confeccao/schemas/payloads/vies";

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
      // OP + produto
      const [op] = await tx
        .select({
          id: confeccaoOrdemProducao.id,
          numero: confeccaoOrdemProducao.numero,
          status: confeccaoOrdemProducao.status,
          temVies: confeccaoOrdemProducao.temVies,
          produtoNome: confeccaoProduto.nome,
        })
        .from(confeccaoOrdemProducao)
        .innerJoin(
          confeccaoProduto,
          eq(confeccaoProduto.id, confeccaoOrdemProducao.produtoId),
        )
        .where(
          and(
            eq(confeccaoOrdemProducao.numero, numero),
            eq(confeccaoOrdemProducao.contaId, contaId),
          ),
        );
      if (!op) return { notFound: true as const };

      // Subtasks da OP
      const subtasks = await tx
        .select({
          id: confeccaoSubtask.id,
          numero: confeccaoSubtask.numero,
          prefixo: confeccaoSubtask.prefixo,
          status: confeccaoSubtask.status,
          payload: confeccaoSubtask.payload,
        })
        .from(confeccaoSubtask)
        .where(eq(confeccaoSubtask.ordemProducaoId, op.id))
        .orderBy(asc(confeccaoSubtask.ordemSequencial));
      const subtaskIds = subtasks.map((s) => s.id);
      const byPrefixo = new Map(subtasks.map((s) => [s.prefixo, s.payload]));

      const compra = byPrefixo.get("OPBUY") as SubtaskCompraPayload | undefined;
      const risco = byPrefixo.get("OPRIS") as SubtaskRiscoPayload | undefined;
      const corte = byPrefixo.get("OPCOR") as SubtaskCortePayload | undefined;
      const vies = byPrefixo.get("OPVIE") as SubtaskViesPayload | undefined;
      const costura = byPrefixo.get("OPSEW") as SubtaskCosturaPayload | undefined;

      // Retiradas da Costura — pra resolver Lalamoves vinculados via retirada
      const retiradas =
        subtaskIds.length > 0
          ? await tx
              .select({
                id: confeccaoRetirada.id,
                subtaskCosturaId: confeccaoRetirada.subtaskCosturaId,
              })
              .from(confeccaoRetirada)
              .where(inArray(confeccaoRetirada.subtaskCosturaId, subtaskIds))
          : [];
      const retiradaIds = retiradas.map((r) => r.id);

      // Lalamoves vinculados via subtaskId OR retiradaId
      const lalamoveConditions = [];
      if (subtaskIds.length > 0) {
        lalamoveConditions.push(
          inArray(confeccaoLalamove.subtaskId, subtaskIds),
        );
      }
      if (retiradaIds.length > 0) {
        lalamoveConditions.push(
          inArray(confeccaoLalamove.retiradaId, retiradaIds),
        );
      }
      const lalamoves =
        lalamoveConditions.length > 0
          ? await tx
              .select({
                id: confeccaoLalamove.id,
                tipo: confeccaoLalamove.tipo,
                status: confeccaoLalamove.status,
                origemSolicitacao: confeccaoLalamove.origemSolicitacao,
                valor: confeccaoLalamove.valor,
                moeda: confeccaoLalamove.moeda,
                conteudoDescricao: confeccaoLalamove.conteudoDescricao,
                quantidadePecas: confeccaoLalamove.quantidadePecas,
                origemEndereco: confeccaoLalamove.origemEndereco,
                destinoEndereco: confeccaoLalamove.destinoEndereco,
                dataSolicitacao: confeccaoLalamove.dataSolicitacao,
                dataColeta: confeccaoLalamove.dataColeta,
                dataEntrega: confeccaoLalamove.dataEntrega,
                canceladaEm: confeccaoLalamove.canceladaEm,
                subtaskId: confeccaoLalamove.subtaskId,
                retiradaId: confeccaoLalamove.retiradaId,
              })
              .from(confeccaoLalamove)
              .where(
                and(
                  eq(confeccaoLalamove.contaId, contaId),
                  or(...lalamoveConditions),
                ),
              )
              .orderBy(asc(confeccaoLalamove.dataSolicitacao))
          : [];

      // Anexos vinculados à OP ou às subtasks (excluindo Lalamoves —
      // exibidos junto do bloco de Lalamoves se quiser; aqui só os
      // anexos diretos pra evitar duplicação)
      const anexoConditions = [eq(confeccaoAnexo.ordemProducaoId, op.id)];
      if (subtaskIds.length > 0) {
        anexoConditions.push(inArray(confeccaoAnexo.subtaskId, subtaskIds));
      }
      const anexosRaw = await tx
        .select({
          id: confeccaoAnexo.id,
          categoria: confeccaoAnexo.categoria,
          nomeArquivo: confeccaoAnexo.nomeArquivo,
          tipoMime: confeccaoAnexo.tipoMime,
          tamanhoBytes: confeccaoAnexo.tamanhoBytes,
          blobUrl: confeccaoAnexo.blobUrl,
          createdAt: confeccaoAnexo.createdAt,
          subtaskId: confeccaoAnexo.subtaskId,
          ordemProducaoId: confeccaoAnexo.ordemProducaoId,
        })
        .from(confeccaoAnexo)
        .where(
          and(
            eq(confeccaoAnexo.contaId, contaId),
            or(...anexoConditions),
          ),
        )
        .orderBy(asc(confeccaoAnexo.createdAt));

      // Anexa subtaskNumero por lookup local
      const subtaskNumeroById = new Map(subtasks.map((s) => [s.id, s.numero]));
      const anexos = anexosRaw.map((a) => ({
        ...a,
        subtaskNumero: a.subtaskId
          ? (subtaskNumeroById.get(a.subtaskId) ?? null)
          : null,
      }));

      // Agrupa anexos por categoria
      const porCategoria = new Map<string, typeof anexos>();
      for (const a of anexos) {
        const arr = porCategoria.get(a.categoria) ?? [];
        arr.push(a);
        porCategoria.set(a.categoria, arr);
      }
      const anexosAgrupados = Array.from(porCategoria.entries())
        .map(([categoria, items]) => ({ categoria, items }))
        .sort((a, b) => a.categoria.localeCompare(b.categoria));

      // Subconferências da Conferência (pra pecasAprovadas)
      const stConf = subtasks.find((s) => s.prefixo === "OPCONF");
      const subconferencias = stConf
        ? await tx
            .select({
              id: confeccaoSubconferencia.id,
              status: confeccaoSubconferencia.status,
              aprovadas: confeccaoSubconferencia.aprovadas,
            })
            .from(confeccaoSubconferencia)
            .where(eq(confeccaoSubconferencia.subtaskConferenciaId, stConf.id))
        : [];

      // === Cálculo de custos ===
      const custos = calcularCustosOP({
        temVies: op.temVies,
        compra: compra ?? null,
        risco: risco ?? null,
        corte: corte ?? null,
        vies: vies ?? null,
        costura: costura ?? null,
        lalamoves: lalamoves.map((l) => ({
          tipo: l.tipo as "principal" | "outros",
          valor: l.valor,
          canceladaEm: l.canceladaEm,
        })),
        subconferencias: subconferencias.map((sc) => ({
          status: sc.status as "em_andamento" | "concluida",
          aprovadas: sc.aprovadas as Record<
            string,
            Record<string, number>
          > | null,
        })),
      });

      // Separa lalamoves principais/outros pra UI
      const lalamoveItems = lalamoves.map((l) => ({
        id: l.id,
        tipo: l.tipo,
        status: l.status,
        origemSolicitacao: l.origemSolicitacao,
        valor: l.valor,
        moeda: l.moeda,
        conteudoDescricao: l.conteudoDescricao,
        quantidadePecas: l.quantidadePecas,
        origemEndereco: l.origemEndereco,
        destinoEndereco: l.destinoEndereco,
        dataSolicitacao: l.dataSolicitacao,
        dataColeta: l.dataColeta,
        dataEntrega: l.dataEntrega,
        canceladaEm: l.canceladaEm,
        subtaskId: l.subtaskId,
        retiradaId: l.retiradaId,
        subtaskNumero: l.subtaskId
          ? (subtaskNumeroById.get(l.subtaskId) ?? null)
          : null,
      }));

      return {
        ok: true as const,
        op: {
          id: op.id,
          numero: op.numero,
          status: op.status,
          produtoNome: op.produtoNome,
          temVies: op.temVies,
        },
        custos,
        anexos: anexosAgrupados,
        lalamoves: {
          principais: lalamoveItems.filter((l) => l.tipo === "principal"),
          outros: lalamoveItems.filter((l) => l.tipo === "outros"),
        },
      };
    });

    if ("notFound" in result) {
      return NextResponse.json(
        { error: "OP não encontrada" },
        { status: 404 },
      );
    }
    return NextResponse.json({
      op: result.op,
      custos: result.custos,
      anexos: result.anexos,
      lalamoves: result.lalamoves,
    });
  } catch (err) {
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    console.error("Erro ao montar evidências:", err);
    return NextResponse.json(
      { error: "Erro ao montar evidências" },
      { status: 500 },
    );
  }
}
