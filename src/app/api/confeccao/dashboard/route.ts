// GET /api/confeccao/dashboard — RITM-20
//
// Agrega KPIs, gráfico por etapa, lalamoves ativos, lista resumida e
// alertas em uma única request. Admin/owner only.
//
// Query params:
//   de=ISO, ate=ISO, produtoId=str, fornecedorId=str

import { NextRequest, NextResponse } from "next/server";
import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdminAtivo, withContaAtiva } from "@/lib/tenancy";
import {
  confeccaoFornecedor,
  confeccaoLalamove,
  confeccaoOrdemProducao,
  confeccaoProduto,
  confeccaoRetirada,
  confeccaoSubconferencia,
  confeccaoSubtask,
  user,
} from "@/lib/db/schema";
import {
  montarDashboard,
  type LalamoveRaw,
  type OPRaw,
  type SubconferenciaRaw,
  type SubtaskPrefixoUI,
  type SubtaskRaw,
  type SubtaskStatus,
} from "@/lib/confeccao/dashboard";

const QuerySchema = z.object({
  de: z.string().datetime().optional(),
  ate: z.string().datetime().optional(),
  produtoId: z.string().min(1).optional(),
  fornecedorId: z.string().min(1).optional(),
});

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return (
    msg.includes("conta ativa") ||
    msg.includes("Sessão") ||
    msg.includes("Nenhuma")
  );
}

export async function GET(request: NextRequest) {
  try {
    await requireAdminAtivo();
  } catch {
    return NextResponse.json(
      { error: "Acesso negado — requer admin" },
      { status: 403 },
    );
  }

  try {
    const sp = request.nextUrl.searchParams;
    const parsed = QuerySchema.parse({
      de: sp.get("de") ?? undefined,
      ate: sp.get("ate") ?? undefined,
      produtoId: sp.get("produtoId") ?? undefined,
      fornecedorId: sp.get("fornecedorId") ?? undefined,
    });

    const data = await withContaAtiva(async (tx, contaId) => {
      // OPs (com produto + atribuído + progresso agregado)
      const opsRows = await tx
        .select({
          id: confeccaoOrdemProducao.id,
          numero: confeccaoOrdemProducao.numero,
          status: confeccaoOrdemProducao.status,
          produtoId: confeccaoOrdemProducao.produtoId,
          produtoNome: confeccaoProduto.nome,
          atribuidoNome: user.name,
          createdAt: confeccaoOrdemProducao.createdAt,
          updatedAt: confeccaoOrdemProducao.updatedAt,
          concluidaEm: confeccaoOrdemProducao.concluidaEm,
        })
        .from(confeccaoOrdemProducao)
        .innerJoin(
          confeccaoProduto,
          eq(confeccaoProduto.id, confeccaoOrdemProducao.produtoId),
        )
        .innerJoin(user, eq(user.id, confeccaoOrdemProducao.atribuidoAId))
        .where(eq(confeccaoOrdemProducao.contaId, contaId))
        .orderBy(desc(confeccaoOrdemProducao.updatedAt));

      // Subtasks de todas as OPs (precisa pra cálculo de etapa atual e
      // prazos vencidos)
      const subtasksRows = await tx
        .select({
          id: confeccaoSubtask.id,
          ordemProducaoId: confeccaoSubtask.ordemProducaoId,
          prefixo: confeccaoSubtask.prefixo,
          status: confeccaoSubtask.status,
          ordemSequencial: confeccaoSubtask.ordemSequencial,
          payload: confeccaoSubtask.payload,
        })
        .from(confeccaoSubtask)
        .where(eq(confeccaoSubtask.contaId, contaId))
        .orderBy(asc(confeccaoSubtask.ordemSequencial));

      // Calcula totais de subtasks por OP
      const subtasksTotal = new Map<string, number>();
      const subtasksConcluidas = new Map<string, number>();
      for (const s of subtasksRows) {
        subtasksTotal.set(
          s.ordemProducaoId,
          (subtasksTotal.get(s.ordemProducaoId) ?? 0) + 1,
        );
        if (s.status === "concluida") {
          subtasksConcluidas.set(
            s.ordemProducaoId,
            (subtasksConcluidas.get(s.ordemProducaoId) ?? 0) + 1,
          );
        }
      }

      // Lalamoves (todos da conta — filtra ativos no service)
      const lalamovesRows = await tx
        .select({
          id: confeccaoLalamove.id,
          status: confeccaoLalamove.status,
          subtaskId: confeccaoLalamove.subtaskId,
          retiradaId: confeccaoLalamove.retiradaId,
          conteudoDescricao: confeccaoLalamove.conteudoDescricao,
          valor: confeccaoLalamove.valor,
          dataSolicitacao: confeccaoLalamove.dataSolicitacao,
          origemLat: confeccaoLalamove.origemLat,
          origemLng: confeccaoLalamove.origemLng,
          destinoLat: confeccaoLalamove.destinoLat,
          destinoLng: confeccaoLalamove.destinoLng,
          lastDriverLat: confeccaoLalamove.lastDriverLat,
          lastDriverLng: confeccaoLalamove.lastDriverLng,
          canceladaEm: confeccaoLalamove.canceladaEm,
        })
        .from(confeccaoLalamove)
        .where(eq(confeccaoLalamove.contaId, contaId));

      // Retiradas pra resolver Lalamoves vinculados via retirada → subtask → OP
      const retiradasRows = await tx
        .select({
          id: confeccaoRetirada.id,
          subtaskCosturaId: confeccaoRetirada.subtaskCosturaId,
        })
        .from(confeccaoRetirada)
        .where(eq(confeccaoRetirada.contaId, contaId));
      const subtaskIdByRetirada = new Map(
        retiradasRows.map((r) => [r.id, r.subtaskCosturaId]),
      );
      const opIdBySubtask = new Map(
        subtasksRows.map((s) => [s.id, s.ordemProducaoId]),
      );
      const opNumeroById = new Map(opsRows.map((o) => [o.id, o.numero]));

      // Subconferências (pra alerta de divergência)
      const subconferenciasRows = await tx
        .select({
          id: confeccaoSubconferencia.id,
          numero: confeccaoSubconferencia.numero,
          subtaskConferenciaId: confeccaoSubconferencia.subtaskConferenciaId,
          status: confeccaoSubconferencia.status,
          divergenciaConfirmada: confeccaoSubconferencia.divergenciaConfirmada,
          oficinaResponsavelDivergenciaId:
            confeccaoSubconferencia.oficinaResponsavelDivergenciaId,
        })
        .from(confeccaoSubconferencia)
        .where(eq(confeccaoSubconferencia.contaId, contaId));

      // Carrega nomes dos fornecedores responsáveis por divergência
      const fornNomeById = new Map<string, string>();
      const fornIds = subconferenciasRows
        .map((s) => s.oficinaResponsavelDivergenciaId)
        .filter((f): f is string => Boolean(f));
      if (fornIds.length > 0) {
        const fornRows = await tx
          .select({ id: confeccaoFornecedor.id, nome: confeccaoFornecedor.nome })
          .from(confeccaoFornecedor)
          .where(eq(confeccaoFornecedor.contaId, contaId));
        for (const f of fornRows) fornNomeById.set(f.id, f.nome);
      }

      // === Monta payloads do service ===
      const ops: OPRaw[] = opsRows.map((o) => ({
        id: o.id,
        numero: o.numero,
        status: o.status as OPRaw["status"],
        produtoId: o.produtoId,
        produtoNome: o.produtoNome,
        atribuidoNome: o.atribuidoNome,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
        concluidaEm: o.concluidaEm,
        subtasksTotal: subtasksTotal.get(o.id) ?? 0,
        subtasksConcluidas: subtasksConcluidas.get(o.id) ?? 0,
      }));

      const subtasks: SubtaskRaw[] = subtasksRows.map((s) => ({
        id: s.id,
        ordemProducaoId: s.ordemProducaoId,
        prefixo: s.prefixo as SubtaskPrefixoUI,
        status: s.status as SubtaskStatus,
        ordemSequencial: s.ordemSequencial,
        payload: s.payload as Record<string, unknown>,
      }));

      const lalamoves: LalamoveRaw[] = lalamovesRows
        .map((l): LalamoveRaw | null => {
          let opId: string | undefined;
          if (l.subtaskId) {
            opId = opIdBySubtask.get(l.subtaskId);
          } else if (l.retiradaId) {
            const stId = subtaskIdByRetirada.get(l.retiradaId);
            if (stId) opId = opIdBySubtask.get(stId);
          }
          if (!opId) return null;
          const numero = opNumeroById.get(opId);
          if (!numero) return null;
          return {
            id: l.id,
            status: l.status,
            ordemProducaoNumero: numero,
            conteudoDescricao: l.conteudoDescricao,
            valor: l.valor,
            dataSolicitacao: l.dataSolicitacao,
            origemLat: l.origemLat !== null ? Number(l.origemLat) : null,
            origemLng: l.origemLng !== null ? Number(l.origemLng) : null,
            destinoLat: l.destinoLat !== null ? Number(l.destinoLat) : null,
            destinoLng: l.destinoLng !== null ? Number(l.destinoLng) : null,
            lastDriverLat:
              l.lastDriverLat !== null ? Number(l.lastDriverLat) : null,
            lastDriverLng:
              l.lastDriverLng !== null ? Number(l.lastDriverLng) : null,
            canceladaEm: l.canceladaEm,
          };
        })
        .filter((x): x is LalamoveRaw => x !== null);

      const subconferencias: SubconferenciaRaw[] = subconferenciasRows
        .map((sc): SubconferenciaRaw | null => {
          const stOpId = opIdBySubtask.get(sc.subtaskConferenciaId);
          if (!stOpId) return null;
          const numeroOp = opNumeroById.get(stOpId);
          if (!numeroOp) return null;
          return {
            id: sc.id,
            numero: sc.numero,
            ordemProducaoNumero: numeroOp,
            status: sc.status as SubconferenciaRaw["status"],
            divergenciaConfirmada: sc.divergenciaConfirmada,
            oficinaResponsavelDivergenciaNome:
              sc.oficinaResponsavelDivergenciaId
                ? (fornNomeById.get(sc.oficinaResponsavelDivergenciaId) ?? null)
                : null,
          };
        })
        .filter((x): x is SubconferenciaRaw => x !== null);

      return { ops, subtasks, lalamoves, subconferencias };
    });

    const out = montarDashboard({
      agora: new Date(),
      periodoDe: parsed.de ? new Date(parsed.de) : null,
      periodoAte: parsed.ate ? new Date(parsed.ate) : null,
      produtoIdFiltro: parsed.produtoId ?? null,
      fornecedorIdFiltro: parsed.fornecedorId ?? null,
      ops: data.ops,
      subtasks: data.subtasks,
      lalamoves: data.lalamoves,
      subconferencias: data.subconferencias,
    });

    return NextResponse.json(out);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Parâmetros inválidos", details: err.issues },
        { status: 400 },
      );
    }
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    console.error("Erro no dashboard:", err);
    return NextResponse.json(
      { error: "Erro ao montar dashboard" },
      { status: 500 },
    );
  }
}
