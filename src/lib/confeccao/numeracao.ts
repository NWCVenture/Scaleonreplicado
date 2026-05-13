// Helper de numeração do Módulo Confecção (RITM-02).
//
// Formatos:
//   OP visível:           OPMMAANNNN          (ex: OP05260001)
//   Subtask visível:      [PREFIXO]NNNN       (ex: OPBUY0001)
//   Subtask ID interno:   [PREFIXO]-MMAA-NNNN (ex: OPBUY-0526-0001)
//
// Sequencial é global (compartilhado entre todas as contas), contínuo de
// 0000 a 9999, reseta após 9999 via CYCLE da sequence Postgres
// `confeccao_op_sequencial` (criada em 0024_sad_nekra.sql). Subtasks
// herdam o sequencial da OP-mãe.

import { sql } from "drizzle-orm";
import type { db } from "../db";
import type { ConfeccaoSubtaskPrefixo } from "../db/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface NumeroOPGerado {
  numero: string; // ex: "OP05260001"
  sequencial: number; // 0-9999
  mes: string; // "01"-"12"
  ano: string; // "00"-"99"
}

/**
 * Reserva o próximo sequencial e devolve componentes da numeração da OP.
 *
 * Deve ser chamado dentro da MESMA transação que insere a OP — não pra
 * "rollback do sequencial" (sequence não faz rollback de nextval), mas
 * pra garantir que o número reservado seja gravado num registro real.
 *
 * Race condition: tranquila. `nextval()` é atomic; cada chamada concorrente
 * recebe um valor único. O risco de skip (gap) existe se a transação dá
 * rollback após nextval — aceitável; gaps no sequencial não quebram nada.
 */
export async function gerarNumeroOP(tx: Tx): Promise<NumeroOPGerado> {
  const result = await tx.execute<{ seq: number }>(
    sql`SELECT (MOD(nextval('confeccao_op_sequencial')::bigint, 10000))::int AS seq`,
  );
  const seq = Number(result[0]?.seq);
  if (!Number.isInteger(seq) || seq < 0 || seq > 9999) {
    throw new Error(
      `gerarNumeroOP: sequencial inválido recebido da sequence (${seq})`,
    );
  }

  const agora = new Date();
  const mes = String(agora.getUTCMonth() + 1).padStart(2, "0");
  const ano = String(agora.getUTCFullYear() % 100).padStart(2, "0");
  const nnnn = String(seq).padStart(4, "0");

  return {
    numero: `OP${mes}${ano}${nnnn}`,
    sequencial: seq,
    mes,
    ano,
  };
}

/**
 * Gera ID interno único de subtask: `[PREFIXO]-MMAA-NNNN`.
 * Usado em `confeccao_subtask.id_interno` (UNIQUE), garante unicidade
 * mesmo se o sequencial bater entre meses diferentes.
 */
export function gerarIdInternoSubtask(
  prefixo: ConfeccaoSubtaskPrefixo,
  mes: string,
  ano: string,
  sequencial: number,
): string {
  return `${prefixo}-${mes}${ano}-${String(sequencial).padStart(4, "0")}`;
}

/**
 * Gera número visível de subtask: `[PREFIXO]NNNN`.
 * Mostrado na UI; subtasks de uma mesma OP compartilham o sequencial dela.
 */
export function gerarNumeroSubtaskVisivel(
  prefixo: ConfeccaoSubtaskPrefixo,
  sequencial: number,
): string {
  return `${prefixo}${String(sequencial).padStart(4, "0")}`;
}
