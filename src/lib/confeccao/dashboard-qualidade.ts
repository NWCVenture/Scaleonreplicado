// Service `montarDashboardQualidade` — RITM-21.
//
// Função pura: recebe dados crus já lidos do banco + filtros e retorna
// o agregado pra UI do Dashboard de Qualidade por Oficina.
//
// Mesma estratégia do dashboard.ts (RITM-20): manter as queries fora
// daqui pra que o cálculo seja 100% testável sem mockar banco.

import type { OficinaCostura } from "./schemas/payloads/costura";

export type TipoDefeito =
  | "rebarba"
  | "costura_desalinhada"
  | "costura_incompleta"
  | "gola"
  | "mancha"
  | "tecido"
  | "furo"
  | "outros";

export const TIPOS_DEFEITO: TipoDefeito[] = [
  "rebarba",
  "costura_desalinhada",
  "costura_incompleta",
  "gola",
  "mancha",
  "tecido",
  "furo",
  "outros",
];

// Inputs crus. Cada interface descreve o que o route handler precisa
// carregar do banco antes de invocar o service.

export interface SubconferenciaQualidadeRaw {
  id: string;
  numero: string;
  retiradaId: string;
  opNumero: string;
  produtoId: string;
  status: "em_andamento" | "concluida";
  aprovadas: Record<string, Record<string, number>> | null;
  reprovadas: Record<string, Record<string, number>> | null;
  tiposDefeito: TipoDefeito[] | null;
  divergenciaConfirmada: boolean;
  oficinaResponsavelDivergenciaId: string | null;
  concluidaEm: Date | null;
  dataInspecao: Date | null;
}

export interface RetiradaQualidadeRaw {
  id: string;
  subtaskCosturaId: string;
  oficinaId: string;
  tipo: "parcial" | "final";
  dataRetirada: Date;
  canceladaEm: Date | null;
}

export interface SubtaskCosturaQualidadeRaw {
  id: string;
  iniciadaEm: Date | null;
  payload: Record<string, unknown>;
}

export interface OficinaQualidadeRaw {
  id: string;
  nome: string;
}

export interface DashboardQualidadeInput {
  periodoDe: Date;
  periodoAte: Date;
  produtoIdFiltro?: string | null;
  oficinaIdFiltro?: string | null;
  subconferencias: SubconferenciaQualidadeRaw[];
  retiradas: RetiradaQualidadeRaw[];
  subtasksCostura: SubtaskCosturaQualidadeRaw[];
  oficinas: OficinaQualidadeRaw[];
}

export interface RankingOficinaItem {
  oficinaId: string;
  oficinaNome: string;
  pecasAvaliadas: number;
  aprovacao: number; // 0..1
  tempoMedioDias: number | null;
  pontualidade: number | null; // 0..1
  divergenciasConfirmadas: number;
}

export interface TopDefeitoItem {
  tipo: TipoDefeito;
  contagem: number;
  percentual: number; // 0..1 sobre total de marcações
}

export interface DetalheSubconferenciaItem {
  subconferenciaId: string;
  subconferenciaNumero: string;
  opNumero: string;
  dataInspecao: string | null; // ISO
  aprovadas: number;
  reprovadas: number;
  tiposDefeito: TipoDefeito[];
}

export interface DashboardQualidadeOutput {
  kpis: {
    oficinasAvaliadas: number;
    aprovacaoMedia: number;
    pontualidadeMedia: number;
  };
  ranking: RankingOficinaItem[];
  topDefeitos: TopDefeitoItem[];
  detalhePorOficina: Record<string, DetalheSubconferenciaItem[]>;
}

const DETALHE_LIMITE = 50;

/** Achata um JSONB `{ tam: { cor: qtd } }` somando todos os valores. */
function somaFlat(
  matriz: Record<string, Record<string, number>> | null | undefined,
): number {
  if (!matriz) return 0;
  let total = 0;
  for (const linha of Object.values(matriz)) {
    for (const v of Object.values(linha ?? {})) {
      total += Number(v) || 0;
    }
  }
  return total;
}

/** Subconferência "válida" pra cálculo de qualidade. */
function subconferenciaValida(sc: SubconferenciaQualidadeRaw): boolean {
  return sc.status === "concluida" && sc.aprovadas !== null && sc.reprovadas !== null;
}

/** Extrai o prazo de produção da oficina dentro do payload de Costura. */
function prazoDaOficina(
  payload: Record<string, unknown>,
  oficinaId: string,
): Date | null {
  const oficinas = (payload?.oficinas as OficinaCostura[] | undefined) ?? [];
  const o = oficinas.find((x) => x.oficinaId === oficinaId);
  if (!o?.prazoProducao) return null;
  return new Date(o.prazoProducao);
}

export function montarDashboardQualidade(
  input: DashboardQualidadeInput,
): DashboardQualidadeOutput {
  const {
    periodoDe,
    periodoAte,
    produtoIdFiltro,
    oficinaIdFiltro,
    subconferencias,
    retiradas,
    subtasksCostura,
    oficinas,
  } = input;

  // Indexa pra lookup O(1).
  const retiradaById = new Map(retiradas.map((r) => [r.id, r]));
  const subtaskCosturaById = new Map(
    subtasksCostura.map((s) => [s.id, s]),
  );
  const oficinaById = new Map(oficinas.map((o) => [o.id, o]));

  // === Filtra subconferências: período (concluidaEm) + produto + status válido ===
  const scsNoEscopo = subconferencias.filter((sc) => {
    if (!subconferenciaValida(sc)) return false;
    if (!sc.concluidaEm) return false;
    if (sc.concluidaEm < periodoDe || sc.concluidaEm > periodoAte) return false;
    if (produtoIdFiltro && sc.produtoId !== produtoIdFiltro) return false;
    return true;
  });

  // Cada subconferência → 1 retirada → 1 oficina.
  // Quando a retirada foi cancelada, descarta a subconferência.
  // Quando o oficinaIdFiltro está setado, filtra por ele.
  type ScWithCtx = SubconferenciaQualidadeRaw & {
    oficinaId: string;
    retirada: RetiradaQualidadeRaw;
    subtaskCostura: SubtaskCosturaQualidadeRaw | undefined;
  };

  const scsComCtx: ScWithCtx[] = [];
  for (const sc of scsNoEscopo) {
    const ret = retiradaById.get(sc.retiradaId);
    if (!ret) continue;
    if (ret.canceladaEm) continue;
    if (oficinaIdFiltro && ret.oficinaId !== oficinaIdFiltro) continue;
    scsComCtx.push({
      ...sc,
      oficinaId: ret.oficinaId,
      retirada: ret,
      subtaskCostura: subtaskCosturaById.get(ret.subtaskCosturaId),
    });
  }

  // === Ranking agregado por oficina ===
  type AggOficina = {
    pecasAprovadas: number;
    pecasReprovadas: number;
    temposDias: number[]; // só retiradas tipo=final
    pontualidadeHits: number;
    pontualidadeDenom: number;
    divergenciasConfirmadas: number;
  };

  const agg = new Map<string, AggOficina>();
  function getAgg(id: string): AggOficina {
    let a = agg.get(id);
    if (!a) {
      a = {
        pecasAprovadas: 0,
        pecasReprovadas: 0,
        temposDias: [],
        pontualidadeHits: 0,
        pontualidadeDenom: 0,
        divergenciasConfirmadas: 0,
      };
      agg.set(id, a);
    }
    return a;
  }

  // 1. Aprovação + tempo + pontualidade vêm da subconferência+retirada.
  for (const sc of scsComCtx) {
    const a = getAgg(sc.oficinaId);
    a.pecasAprovadas += somaFlat(sc.aprovadas);
    a.pecasReprovadas += somaFlat(sc.reprovadas);

    if (sc.retirada.tipo === "final") {
      const subtask = sc.subtaskCostura;
      const iniciada = subtask?.iniciadaEm;
      if (iniciada) {
        const diasMs = sc.retirada.dataRetirada.getTime() - iniciada.getTime();
        const dias = diasMs / (1000 * 60 * 60 * 24);
        if (Number.isFinite(dias)) a.temposDias.push(dias);
      }

      if (subtask) {
        const prazo = prazoDaOficina(subtask.payload, sc.oficinaId);
        if (prazo) {
          a.pontualidadeDenom += 1;
          if (sc.retirada.dataRetirada <= prazo) a.pontualidadeHits += 1;
        }
      }
    }
  }

  // 2. Divergências: contabilizadas na oficina responsável (não na oficina
  //    da retirada). Reaproveita o filtro de período já aplicado.
  for (const sc of scsComCtx) {
    if (!sc.divergenciaConfirmada) continue;
    const responsavelId = sc.oficinaResponsavelDivergenciaId;
    if (!responsavelId) continue;
    // Se há filtro de oficina, só conta divergências cuja responsável também
    // passa no filtro.
    if (oficinaIdFiltro && responsavelId !== oficinaIdFiltro) continue;
    getAgg(responsavelId).divergenciasConfirmadas += 1;
  }

  const ranking: RankingOficinaItem[] = [];
  for (const [oficinaId, a] of agg.entries()) {
    const oficina = oficinaById.get(oficinaId);
    if (!oficina) continue;
    const pecasAvaliadas = a.pecasAprovadas + a.pecasReprovadas;
    const aprovacao = pecasAvaliadas > 0 ? a.pecasAprovadas / pecasAvaliadas : 0;
    const tempoMedioDias =
      a.temposDias.length > 0
        ? a.temposDias.reduce((s, x) => s + x, 0) / a.temposDias.length
        : null;
    const pontualidade =
      a.pontualidadeDenom > 0 ? a.pontualidadeHits / a.pontualidadeDenom : null;
    ranking.push({
      oficinaId,
      oficinaNome: oficina.nome,
      pecasAvaliadas,
      aprovacao,
      tempoMedioDias,
      pontualidade,
      divergenciasConfirmadas: a.divergenciasConfirmadas,
    });
  }

  // Default sort: % aprovação desc; tie-break por peças avaliadas desc.
  ranking.sort((x, y) => {
    if (y.aprovacao !== x.aprovacao) return y.aprovacao - x.aprovacao;
    return y.pecasAvaliadas - x.pecasAvaliadas;
  });

  // === KPIs ===
  const oficinasAvaliadas = ranking.length;
  const totalAprovadas = ranking.reduce(
    (s, r) => s + r.pecasAvaliadas * r.aprovacao,
    0,
  );
  const totalAvaliadas = ranking.reduce((s, r) => s + r.pecasAvaliadas, 0);
  const aprovacaoMedia = totalAvaliadas > 0 ? totalAprovadas / totalAvaliadas : 0;

  // Média ponderada de pontualidade pelo denominador de cada oficina.
  let pontHits = 0;
  let pontDen = 0;
  for (const sc of scsComCtx) {
    if (sc.retirada.tipo !== "final") continue;
    const subtask = sc.subtaskCostura;
    if (!subtask) continue;
    const prazo = prazoDaOficina(subtask.payload, sc.oficinaId);
    if (!prazo) continue;
    pontDen += 1;
    if (sc.retirada.dataRetirada <= prazo) pontHits += 1;
  }
  const pontualidadeMedia = pontDen > 0 ? pontHits / pontDen : 0;

  // === Top defeitos ===
  const defeitosContagem = new Map<TipoDefeito, number>();
  for (const sc of scsComCtx) {
    for (const tipo of sc.tiposDefeito ?? []) {
      defeitosContagem.set(tipo, (defeitosContagem.get(tipo) ?? 0) + 1);
    }
  }
  const totalDefeitos = Array.from(defeitosContagem.values()).reduce(
    (s, x) => s + x,
    0,
  );
  const topDefeitos: TopDefeitoItem[] = Array.from(defeitosContagem.entries())
    .map(([tipo, contagem]) => ({
      tipo,
      contagem,
      percentual: totalDefeitos > 0 ? contagem / totalDefeitos : 0,
    }))
    .sort((a, b) => b.contagem - a.contagem);

  // === Detalhe por oficina (últimas 50 subconferências cronológicas) ===
  const detalhePorOficina: Record<string, DetalheSubconferenciaItem[]> = {};
  // Agrupa
  const tmp = new Map<string, ScWithCtx[]>();
  for (const sc of scsComCtx) {
    const arr = tmp.get(sc.oficinaId) ?? [];
    arr.push(sc);
    tmp.set(sc.oficinaId, arr);
  }
  for (const [oficinaId, arr] of tmp.entries()) {
    arr.sort((a, b) => {
      const at = a.concluidaEm?.getTime() ?? 0;
      const bt = b.concluidaEm?.getTime() ?? 0;
      return bt - at;
    });
    detalhePorOficina[oficinaId] = arr.slice(0, DETALHE_LIMITE).map((sc) => ({
      subconferenciaId: sc.id,
      subconferenciaNumero: sc.numero,
      opNumero: sc.opNumero,
      dataInspecao: sc.dataInspecao ? sc.dataInspecao.toISOString() : null,
      aprovadas: somaFlat(sc.aprovadas),
      reprovadas: somaFlat(sc.reprovadas),
      tiposDefeito: sc.tiposDefeito ?? [],
    }));
  }

  return {
    kpis: {
      oficinasAvaliadas,
      aprovacaoMedia,
      pontualidadeMedia,
    },
    ranking,
    topDefeitos,
    detalhePorOficina,
  };
}
