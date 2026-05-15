// Service `montarAlertasAtraso` — RITM-22.
//
// Função pura: recebe estado atual (OPs em andamento, subtasks OPSEW,
// oficinas no payload, log de alertas já enviados) + filtros temporais
// e retorna a lista de alertas pendentes pra envio.
//
// Mesma estratégia das RITMs 20/21: cálculo isolado da query layer pra
// permitir testes determinísticos.

import type { OficinaCostura } from "./schemas/payloads/costura";

export type TipoAlerta = "vencendo_24h" | "vencido";

export interface OpRaw {
  id: string;
  numero: string;
  status: "em_andamento" | "concluida" | "cancelada";
}

export interface SubtaskCosturaRaw {
  id: string;
  ordemProducaoId: string;
  atribuidoAId: string | null;
  payload: Record<string, unknown>;
}

export interface OficinaRaw {
  id: string;
  nome: string;
}

export interface UsuarioRaw {
  id: string;
  name: string;
  email: string;
}

export interface LogExistenteRaw {
  subtaskId: string;
  oficinaId: string;
  tipoAlerta: TipoAlerta;
  // ISO 00:00:00Z do dia. Comparação por string.
  dataReferenciaISO: string;
}

export interface AlertasAtrasoInput {
  agora: Date;
  ops: OpRaw[];
  subtasksCostura: SubtaskCosturaRaw[];
  oficinas: OficinaRaw[];
  // Usuários que podem ser destinatários (atribuídos + admins).
  // Caller só carrega o conjunto que precisa — chave é id.
  usuarios: UsuarioRaw[];
  // IDs de usuários com papel admin/owner ativo na conta.
  adminsIds: string[];
  logExistente: LogExistenteRaw[];
}

export interface AlertaPendente {
  opId: string;
  opNumero: string;
  subtaskId: string;
  oficinaId: string;
  oficinaNome: string;
  tipoAlerta: TipoAlerta;
  prazoProducaoISO: string;
  dataReferenciaISO: string;
  destinatarios: UsuarioRaw[];
  // Dias de atraso (positivo se vencido, 0 se no momento, negativo se ainda no
  // futuro). Útil pro template do email.
  diasAtraso: number;
}

const VINTE_E_QUATRO_HORAS_MS = 24 * 60 * 60 * 1000;
const UM_DIA_MS = 24 * 60 * 60 * 1000;

/** Trunca para 00:00:00.000 UTC do mesmo dia da data passada. */
function diaUTC(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0),
  );
}

/** Extrai oficinas da subtask de Costura. */
function extrairOficinasCostura(
  payload: Record<string, unknown>,
): OficinaCostura[] {
  return (payload?.oficinas as OficinaCostura[] | undefined) ?? [];
}

export function montarAlertasAtraso(
  input: AlertasAtrasoInput,
): AlertaPendente[] {
  const {
    agora,
    ops,
    subtasksCostura,
    oficinas,
    usuarios,
    adminsIds,
    logExistente,
  } = input;

  // Lookup helpers.
  const usuarioById = new Map(usuarios.map((u) => [u.id, u]));
  const oficinaById = new Map(oficinas.map((o) => [o.id, o]));
  const opById = new Map(ops.map((o) => [o.id, o]));

  // Set de chaves do log do dia atual pra filtragem rápida.
  const dataRefHoje = diaUTC(agora).toISOString();
  const logKeys = new Set<string>();
  for (const l of logExistente) {
    if (l.dataReferenciaISO === dataRefHoje) {
      logKeys.add(`${l.subtaskId}|${l.oficinaId}|${l.tipoAlerta}`);
    }
  }

  // Carrega admins e remove vazios.
  const admins: UsuarioRaw[] = [];
  for (const id of adminsIds) {
    const u = usuarioById.get(id);
    if (u && u.email) admins.push(u);
  }

  const alertas: AlertaPendente[] = [];

  for (const st of subtasksCostura) {
    const op = opById.get(st.ordemProducaoId);
    if (!op) continue;
    if (op.status !== "em_andamento") continue;

    const atribuido = st.atribuidoAId
      ? usuarioById.get(st.atribuidoAId)
      : null;

    for (const oficina of extrairOficinasCostura(st.payload)) {
      if (!oficina.prazoProducao) continue;
      if (oficina.statusInterno === "finalizada") continue;

      const prazo = new Date(oficina.prazoProducao);
      if (Number.isNaN(prazo.getTime())) continue;

      const diff = prazo.getTime() - agora.getTime();

      // Determina tipo de alerta:
      //  - diff > 24h            → ainda longe, ignora
      //  - 0 < diff <= 24h       → vencendo_24h
      //  - diff <= 0             → vencido (re-emitido diariamente)
      let tipo: TipoAlerta | null = null;
      if (diff > 0 && diff <= VINTE_E_QUATRO_HORAS_MS) {
        tipo = "vencendo_24h";
      } else if (diff <= 0) {
        tipo = "vencido";
      }
      if (!tipo) continue;

      // Idempotência: já enviou hoje?
      const key = `${st.id}|${oficina.oficinaId}|${tipo}`;
      if (logKeys.has(key)) continue;

      // Destinatários por tipo.
      // - vencendo_24h: só o atribuído da Costura
      // - vencido: atribuído + todos admins/owners ativos (dedup)
      const destinatariosSet = new Map<string, UsuarioRaw>();
      if (atribuido && atribuido.email) {
        destinatariosSet.set(atribuido.id, atribuido);
      }
      if (tipo === "vencido") {
        for (const a of admins) destinatariosSet.set(a.id, a);
      }
      const destinatarios = Array.from(destinatariosSet.values());
      if (destinatarios.length === 0) continue;

      const oficinaInfo = oficinaById.get(oficina.oficinaId);

      const diasAtraso = Math.floor(-diff / UM_DIA_MS);

      alertas.push({
        opId: op.id,
        opNumero: op.numero,
        subtaskId: st.id,
        oficinaId: oficina.oficinaId,
        oficinaNome: oficinaInfo?.nome ?? oficina.oficinaId,
        tipoAlerta: tipo,
        prazoProducaoISO: prazo.toISOString(),
        dataReferenciaISO: dataRefHoje,
        destinatarios,
        diasAtraso,
      });
    }
  }

  // Saída ordenada determinística: por opNumero → oficinaId → tipo.
  // Facilita asserts em testes e leitura de logs.
  alertas.sort((a, b) => {
    if (a.opNumero !== b.opNumero) return a.opNumero.localeCompare(b.opNumero);
    if (a.oficinaId !== b.oficinaId)
      return a.oficinaId.localeCompare(b.oficinaId);
    return a.tipoAlerta.localeCompare(b.tipoAlerta);
  });

  return alertas;
}
