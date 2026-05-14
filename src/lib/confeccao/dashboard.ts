// Service `montarDashboard` — RITM-20.
//
// Função pura: recebe dados crus já lidos do banco + filtros e retorna
// o agregado pra UI. Separar da query layer mantém testável.

import type { OficinaCostura } from "./schemas/payloads/costura";

export type SubtaskPrefixoUI =
  | "OPBUY"
  | "OPRIS"
  | "OPCOR"
  | "OPVIE"
  | "OPSEW"
  | "OPCONF";

export type SubtaskStatus =
  | "bloqueada"
  | "pendente"
  | "em_andamento"
  | "concluida"
  | "cancelada";

export type OPStatus = "em_andamento" | "concluida" | "cancelada";

export interface OPRaw {
  id: string;
  numero: string;
  status: OPStatus;
  produtoId: string;
  produtoNome: string;
  atribuidoNome: string | null;
  createdAt: Date;
  updatedAt: Date;
  concluidaEm: Date | null;
  subtasksTotal: number;
  subtasksConcluidas: number;
}

export interface SubtaskRaw {
  id: string;
  ordemProducaoId: string;
  prefixo: SubtaskPrefixoUI;
  status: SubtaskStatus;
  ordemSequencial: number;
  payload: Record<string, unknown>;
}

export interface LalamoveRaw {
  id: string;
  status: string;
  ordemProducaoNumero: string;
  conteudoDescricao: string | null;
  valor: number | null;
  dataSolicitacao: Date;
  origemLat: number | null;
  origemLng: number | null;
  destinoLat: number | null;
  destinoLng: number | null;
  lastDriverLat: number | null;
  lastDriverLng: number | null;
  canceladaEm: Date | null;
}

export interface SubconferenciaRaw {
  id: string;
  numero: string;
  ordemProducaoNumero: string;
  status: "em_andamento" | "concluida";
  divergenciaConfirmada: boolean;
  oficinaResponsavelDivergenciaNome: string | null;
}

export interface DashboardInput {
  agora: Date;
  periodoDe?: Date | null;
  periodoAte?: Date | null;
  produtoIdFiltro?: string | null;
  fornecedorIdFiltro?: string | null;
  ops: OPRaw[];
  subtasks: SubtaskRaw[];
  lalamoves: LalamoveRaw[];
  subconferencias: SubconferenciaRaw[];
}

export interface DashboardOutput {
  kpis: {
    opsAbertas: number;
    opsEmAtraso: number;
    opsConcluidasMes: number;
  };
  opsPorEtapa: Array<{
    prefixo: SubtaskPrefixoUI;
    label: string;
    total: number;
  }>;
  lalamovesAtivos: Array<{
    id: string;
    status: string;
    ordemProducaoNumero: string;
    conteudoDescricao: string | null;
    lat: number;
    lng: number;
    fonte: "driver" | "origem" | "destino";
  }>;
  opsAtivas: Array<{
    id: string;
    numero: string;
    produtoNome: string;
    atribuidoNome: string | null;
    percentual: number;
    updatedAt: string;
  }>;
  alertas: {
    lalamoveTempoAlto: Array<{
      id: string;
      ordemProducaoNumero: string;
      conteudoDescricao: string | null;
      minutosAguardando: number;
    }>;
    oficinasEmAtraso: Array<{
      opNumero: string;
      prefixo: SubtaskPrefixoUI;
      oficinaId: string;
      prazoProducao: string;
      diasAtraso: number;
    }>;
    conferenciasDivergentes: Array<{
      id: string;
      numero: string;
      opNumero: string;
      oficinaResponsavelNome: string | null;
    }>;
  };
}

const LABEL_PREFIXO: Record<SubtaskPrefixoUI, string> = {
  OPBUY: "Compra",
  OPRIS: "Risco",
  OPCOR: "Corte",
  OPVIE: "Viés",
  OPSEW: "Costura",
  OPCONF: "Conferência",
};

const ETAPAS: SubtaskPrefixoUI[] = [
  "OPBUY",
  "OPRIS",
  "OPCOR",
  "OPVIE",
  "OPSEW",
  "OPCONF",
];

const LALAMOVE_TEMPO_ALTO_MIN = 30;

const STATUS_LALAMOVE_ATIVO = new Set([
  "procurando_motorista",
  "motorista_designado",
  "a_caminho_coleta",
  "coletado",
]);

interface PrazoOficina {
  opId: string;
  opNumero: string;
  prefixo: SubtaskPrefixoUI;
  oficinaId: string;
  prazo: Date | null;
  finalizada: boolean;
}

function extrairOficinasCostura(
  payload: Record<string, unknown>,
): OficinaCostura[] {
  return (payload?.oficinas as OficinaCostura[] | undefined) ?? [];
}

/**
 * Extrai fornecedores citados nos payloads de uma OP (de todas as subtasks).
 * Usado pra filtrar por fornecedorId.
 */
function fornecedoresDaOp(subtasks: SubtaskRaw[]): Set<string> {
  const set = new Set<string>();
  for (const st of subtasks) {
    const p = st.payload as Record<string, unknown>;
    if (st.prefixo === "OPBUY") {
      const pre = p?.pre as { fornecedorId?: string; destinatarioCorteId?: string } | undefined;
      if (pre?.fornecedorId) set.add(pre.fornecedorId);
      if (pre?.destinatarioCorteId) set.add(pre.destinatarioCorteId);
    } else if (st.prefixo === "OPRIS") {
      const fid = p?.fornecedorRiscoId as string | undefined;
      if (fid) set.add(fid);
    } else if (st.prefixo === "OPCOR" || st.prefixo === "OPSEW") {
      const oficinas =
        (p?.oficinas as Array<{ oficinaId: string }> | undefined) ?? [];
      for (const o of oficinas) {
        if (o.oficinaId) set.add(o.oficinaId);
      }
    } else if (st.prefixo === "OPVIE") {
      const fid = p?.fornecedorViesId as string | undefined;
      if (fid) set.add(fid);
    }
  }
  return set;
}

export function montarDashboard(input: DashboardInput): DashboardOutput {
  const subtasksPorOp = new Map<string, SubtaskRaw[]>();
  for (const st of input.subtasks) {
    const arr = subtasksPorOp.get(st.ordemProducaoId) ?? [];
    arr.push(st);
    subtasksPorOp.set(st.ordemProducaoId, arr);
  }
  for (const arr of subtasksPorOp.values()) {
    arr.sort((a, b) => a.ordemSequencial - b.ordemSequencial);
  }

  // === Filtra OPs por produto/fornecedor ===
  const opsFiltradas = input.ops.filter((op) => {
    if (input.produtoIdFiltro && op.produtoId !== input.produtoIdFiltro) {
      return false;
    }
    if (input.fornecedorIdFiltro) {
      const sts = subtasksPorOp.get(op.id) ?? [];
      const forns = fornecedoresDaOp(sts);
      if (!forns.has(input.fornecedorIdFiltro)) return false;
    }
    return true;
  });

  // === OPs em andamento (subconjunto pra cálculos) ===
  const opsAndamento = opsFiltradas.filter((o) => o.status === "em_andamento");

  // === KPI: opsAbertas ===
  const opsAbertas = opsAndamento.length;

  // === Prazos vencidos por oficina (Corte + Costura) ===
  const agora = input.agora;
  const prazosVencidos: PrazoOficina[] = [];
  for (const op of opsAndamento) {
    const sts = subtasksPorOp.get(op.id) ?? [];
    for (const st of sts) {
      if (st.prefixo !== "OPSEW") continue;
      const oficinas = extrairOficinasCostura(st.payload);
      for (const o of oficinas) {
        if (!o.prazoProducao) continue;
        const prazo = new Date(o.prazoProducao);
        if (prazo < agora && o.statusInterno !== "finalizada") {
          prazosVencidos.push({
            opId: op.id,
            opNumero: op.numero,
            prefixo: "OPSEW",
            oficinaId: o.oficinaId,
            prazo,
            finalizada: false,
          });
        }
      }
    }
  }
  const opsComAtraso = new Set(prazosVencidos.map((p) => p.opId));
  const opsEmAtraso = opsComAtraso.size;

  // === KPI: opsConcluidasMes (respeitando período se informado) ===
  const periodoDe =
    input.periodoDe ??
    new Date(agora.getFullYear(), agora.getMonth(), 1, 0, 0, 0);
  const periodoAte =
    input.periodoAte ??
    new Date(agora.getFullYear(), agora.getMonth() + 1, 1, 0, 0, 0);

  const opsConcluidasMes = opsFiltradas.filter((o) => {
    if (o.status !== "concluida") return false;
    if (!o.concluidaEm) return false;
    return o.concluidaEm >= periodoDe && o.concluidaEm < periodoAte;
  }).length;

  // === OPs por etapa (em andamento, agrupado pela subtask ativa) ===
  const contagem = new Map<SubtaskPrefixoUI, number>();
  for (const p of ETAPAS) contagem.set(p, 0);
  for (const op of opsAndamento) {
    const sts = subtasksPorOp.get(op.id) ?? [];
    const ativa = sts.find(
      (s) => s.status === "em_andamento" || s.status === "pendente",
    );
    if (ativa) {
      contagem.set(ativa.prefixo, (contagem.get(ativa.prefixo) ?? 0) + 1);
    }
  }
  const opsPorEtapa = ETAPAS.map((prefixo) => ({
    prefixo,
    label: LABEL_PREFIXO[prefixo],
    total: contagem.get(prefixo) ?? 0,
  }));

  // === Lalamoves ativos (mapa) — só de OPs filtradas ===
  // Mapa precisa que ordemProducaoNumero esteja em opsFiltradas
  const opNumerosFiltradas = new Set(
    opsFiltradas.map((o) => o.numero),
  );
  const lalamovesAtivos: DashboardOutput["lalamovesAtivos"] = [];
  for (const l of input.lalamoves) {
    if (l.canceladaEm) continue;
    if (!STATUS_LALAMOVE_ATIVO.has(l.status)) continue;
    if (!opNumerosFiltradas.has(l.ordemProducaoNumero)) continue;
    let lat: number | null = null;
    let lng: number | null = null;
    let fonte: "driver" | "origem" | "destino" = "origem";
    if (l.lastDriverLat !== null && l.lastDriverLng !== null) {
      lat = l.lastDriverLat;
      lng = l.lastDriverLng;
      fonte = "driver";
    } else if (l.origemLat !== null && l.origemLng !== null) {
      lat = l.origemLat;
      lng = l.origemLng;
      fonte = "origem";
    } else if (l.destinoLat !== null && l.destinoLng !== null) {
      lat = l.destinoLat;
      lng = l.destinoLng;
      fonte = "destino";
    }
    if (lat === null || lng === null) continue;
    lalamovesAtivos.push({
      id: l.id,
      status: l.status,
      ordemProducaoNumero: l.ordemProducaoNumero,
      conteudoDescricao: l.conteudoDescricao,
      lat,
      lng,
      fonte,
    });
  }

  // === Lista resumida (top 10 mais recentes em andamento) ===
  const opsAtivas = [...opsAndamento]
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, 10)
    .map((o) => ({
      id: o.id,
      numero: o.numero,
      produtoNome: o.produtoNome,
      atribuidoNome: o.atribuidoNome,
      percentual:
        o.subtasksTotal > 0
          ? Math.round((o.subtasksConcluidas / o.subtasksTotal) * 100)
          : 0,
      updatedAt: o.updatedAt.toISOString(),
    }));

  // === Alertas: Lalamove tempo alto ===
  const lalamoveTempoAlto: DashboardOutput["alertas"]["lalamoveTempoAlto"] = [];
  for (const l of input.lalamoves) {
    if (l.canceladaEm) continue;
    if (l.status !== "procurando_motorista") continue;
    if (!opNumerosFiltradas.has(l.ordemProducaoNumero)) continue;
    const minutos = Math.floor(
      (agora.getTime() - l.dataSolicitacao.getTime()) / 60000,
    );
    if (minutos < LALAMOVE_TEMPO_ALTO_MIN) continue;
    lalamoveTempoAlto.push({
      id: l.id,
      ordemProducaoNumero: l.ordemProducaoNumero,
      conteudoDescricao: l.conteudoDescricao,
      minutosAguardando: minutos,
    });
  }

  // === Alertas: oficinas em atraso ===
  const oficinasEmAtraso: DashboardOutput["alertas"]["oficinasEmAtraso"] =
    prazosVencidos.map((p) => ({
      opNumero: p.opNumero,
      prefixo: p.prefixo,
      oficinaId: p.oficinaId,
      prazoProducao: (p.prazo as Date).toISOString(),
      diasAtraso: Math.floor(
        (agora.getTime() - (p.prazo as Date).getTime()) / (1000 * 60 * 60 * 24),
      ),
    }));

  // === Alertas: conferências divergentes ===
  const conferenciasDivergentes: DashboardOutput["alertas"]["conferenciasDivergentes"] =
    input.subconferencias
      .filter(
        (sc) =>
          sc.divergenciaConfirmada &&
          sc.status !== "concluida" &&
          opNumerosFiltradas.has(sc.ordemProducaoNumero),
      )
      .map((sc) => ({
        id: sc.id,
        numero: sc.numero,
        opNumero: sc.ordemProducaoNumero,
        oficinaResponsavelNome: sc.oficinaResponsavelDivergenciaNome,
      }));

  return {
    kpis: { opsAbertas, opsEmAtraso, opsConcluidasMes },
    opsPorEtapa,
    lalamovesAtivos,
    opsAtivas,
    alertas: {
      lalamoveTempoAlto,
      oficinasEmAtraso,
      conferenciasDivergentes,
    },
  };
}
