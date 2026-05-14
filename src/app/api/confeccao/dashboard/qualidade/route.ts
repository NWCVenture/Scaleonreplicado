// GET /api/confeccao/dashboard/qualidade — RITM-21
//
// Agrega métricas de qualidade por oficina (% aprovação, tempo médio,
// pontualidade, divergências confirmadas) + top defeitos + detalhe
// cronológico. Admin/owner only.
//
// Query params:
//   de=ISO, ate=ISO  → default últimos 30 dias
//   produtoId=str
//   oficinaId=str

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdminAtivo, withContaAtiva } from "@/lib/tenancy";
import {
  confeccaoFornecedor,
  confeccaoOrdemProducao,
  confeccaoRetirada,
  confeccaoSubconferencia,
  confeccaoSubtask,
} from "@/lib/db/schema";
import {
  montarDashboardQualidade,
  type OficinaQualidadeRaw,
  type RetiradaQualidadeRaw,
  type SubconferenciaQualidadeRaw,
  type SubtaskCosturaQualidadeRaw,
  type TipoDefeito,
} from "@/lib/confeccao/dashboard-qualidade";

const QuerySchema = z.object({
  de: z.string().datetime().optional(),
  ate: z.string().datetime().optional(),
  produtoId: z.string().min(1).optional(),
  oficinaId: z.string().min(1).optional(),
});

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return (
    msg.includes("conta ativa") ||
    msg.includes("Sessão") ||
    msg.includes("Nenhuma")
  );
}

const TRINTA_DIAS_MS = 30 * 24 * 60 * 60 * 1000;

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
      oficinaId: sp.get("oficinaId") ?? undefined,
    });

    const agora = new Date();
    const periodoDe = parsed.de
      ? new Date(parsed.de)
      : new Date(agora.getTime() - TRINTA_DIAS_MS);
    const periodoAte = parsed.ate ? new Date(parsed.ate) : agora;

    const data = await withContaAtiva(async (tx, contaId) => {
      // Subconferências (todos os campos relevantes pra qualidade).
      const scRows = await tx
        .select({
          id: confeccaoSubconferencia.id,
          numero: confeccaoSubconferencia.numero,
          retiradaId: confeccaoSubconferencia.retiradaId,
          subtaskConferenciaId: confeccaoSubconferencia.subtaskConferenciaId,
          status: confeccaoSubconferencia.status,
          aprovadas: confeccaoSubconferencia.aprovadas,
          reprovadas: confeccaoSubconferencia.reprovadas,
          tiposDefeito: confeccaoSubconferencia.tiposDefeito,
          divergenciaConfirmada: confeccaoSubconferencia.divergenciaConfirmada,
          oficinaResponsavelDivergenciaId:
            confeccaoSubconferencia.oficinaResponsavelDivergenciaId,
          concluidaEm: confeccaoSubconferencia.concluidaEm,
          dataInspecao: confeccaoSubconferencia.dataInspecao,
        })
        .from(confeccaoSubconferencia)
        .where(eq(confeccaoSubconferencia.contaId, contaId));

      // Retiradas (precisa do JOIN com subconferência via retiradaId).
      const retRows = await tx
        .select({
          id: confeccaoRetirada.id,
          subtaskCosturaId: confeccaoRetirada.subtaskCosturaId,
          oficinaId: confeccaoRetirada.oficinaId,
          tipo: confeccaoRetirada.tipo,
          dataRetirada: confeccaoRetirada.dataRetirada,
          canceladaEm: confeccaoRetirada.canceladaEm,
        })
        .from(confeccaoRetirada)
        .where(eq(confeccaoRetirada.contaId, contaId));

      // Subtasks de Costura (pra extrair iniciadaEm e prazoProducao).
      const stRows = await tx
        .select({
          id: confeccaoSubtask.id,
          ordemProducaoId: confeccaoSubtask.ordemProducaoId,
          prefixo: confeccaoSubtask.prefixo,
          iniciadaEm: confeccaoSubtask.iniciadaEm,
          payload: confeccaoSubtask.payload,
        })
        .from(confeccaoSubtask)
        .where(eq(confeccaoSubtask.contaId, contaId));

      // OPs (pra mapear opNumero/produtoId via subtask → OP).
      const opRows = await tx
        .select({
          id: confeccaoOrdemProducao.id,
          numero: confeccaoOrdemProducao.numero,
          produtoId: confeccaoOrdemProducao.produtoId,
        })
        .from(confeccaoOrdemProducao)
        .where(eq(confeccaoOrdemProducao.contaId, contaId));

      // Oficinas (só categoria costura — fornecedores entram aqui também).
      const ofRows = await tx
        .select({
          id: confeccaoFornecedor.id,
          nome: confeccaoFornecedor.nome,
        })
        .from(confeccaoFornecedor)
        .where(eq(confeccaoFornecedor.contaId, contaId));

      // ── Indexes pra montar inputs do service ─────────────────────
      const stCosturaById = new Map<
        string,
        SubtaskCosturaQualidadeRaw & { ordemProducaoId: string }
      >();
      const subtaskCosturas: SubtaskCosturaQualidadeRaw[] = [];
      for (const s of stRows) {
        if (s.prefixo !== "OPSEW") continue;
        const item = {
          id: s.id,
          ordemProducaoId: s.ordemProducaoId,
          iniciadaEm: s.iniciadaEm,
          payload: s.payload as Record<string, unknown>,
        };
        stCosturaById.set(s.id, item);
        subtaskCosturas.push({
          id: item.id,
          iniciadaEm: item.iniciadaEm,
          payload: item.payload,
        });
      }

      // Subtasks de Conferência → pra resolver subconferência → opId.
      const opByConfSubtaskId = new Map<string, string>();
      for (const s of stRows) {
        if (s.prefixo !== "OPCONF") continue;
        opByConfSubtaskId.set(s.id, s.ordemProducaoId);
      }
      const opById = new Map(opRows.map((o) => [o.id, o]));
      const retById = new Map(retRows.map((r) => [r.id, r]));

      const subconferencias: SubconferenciaQualidadeRaw[] = scRows
        .map((sc): SubconferenciaQualidadeRaw | null => {
          const opId = opByConfSubtaskId.get(sc.subtaskConferenciaId);
          if (!opId) return null;
          const op = opById.get(opId);
          if (!op) return null;
          // Retirada pode não existir (FK garante mas defensivo).
          if (!retById.has(sc.retiradaId)) return null;
          return {
            id: sc.id,
            numero: sc.numero,
            retiradaId: sc.retiradaId,
            opNumero: op.numero,
            produtoId: op.produtoId,
            status: sc.status as SubconferenciaQualidadeRaw["status"],
            aprovadas: sc.aprovadas as SubconferenciaQualidadeRaw["aprovadas"],
            reprovadas:
              sc.reprovadas as SubconferenciaQualidadeRaw["reprovadas"],
            tiposDefeito: (sc.tiposDefeito as TipoDefeito[] | null) ?? null,
            divergenciaConfirmada: sc.divergenciaConfirmada,
            oficinaResponsavelDivergenciaId:
              sc.oficinaResponsavelDivergenciaId,
            concluidaEm: sc.concluidaEm,
            dataInspecao: sc.dataInspecao,
          };
        })
        .filter((x): x is SubconferenciaQualidadeRaw => x !== null);

      const retiradas: RetiradaQualidadeRaw[] = retRows.map((r) => ({
        id: r.id,
        subtaskCosturaId: r.subtaskCosturaId,
        oficinaId: r.oficinaId,
        tipo: r.tipo as RetiradaQualidadeRaw["tipo"],
        dataRetirada: r.dataRetirada,
        canceladaEm: r.canceladaEm,
      }));

      const oficinas: OficinaQualidadeRaw[] = ofRows.map((o) => ({
        id: o.id,
        nome: o.nome,
      }));

      return { subconferencias, retiradas, subtaskCosturas, oficinas };
    });

    const out = montarDashboardQualidade({
      periodoDe,
      periodoAte,
      produtoIdFiltro: parsed.produtoId ?? null,
      oficinaIdFiltro: parsed.oficinaId ?? null,
      subconferencias: data.subconferencias,
      retiradas: data.retiradas,
      subtasksCostura: data.subtaskCosturas,
      oficinas: data.oficinas,
    });

    return NextResponse.json({
      ...out,
      periodo: {
        de: periodoDe.toISOString(),
        ate: periodoAte.toISOString(),
      },
    });
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
    console.error("Erro no dashboard de qualidade:", err);
    return NextResponse.json(
      { error: "Erro ao montar dashboard de qualidade" },
      { status: 500 },
    );
  }
}
