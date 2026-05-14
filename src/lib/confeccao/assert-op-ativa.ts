// Guard de mutação pra OPs canceladas (RITM-18).
//
// Lança `OpCanceladaError` se a OP da subtask/ordem informada estiver
// com status `cancelada`. Caller (endpoint) traduz pra resposta HTTP 409
// com `code: "op_cancelada"`.

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { confeccaoOrdemProducao, confeccaoSubtask } from "@/lib/db/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class OpCanceladaError extends Error {
  constructor(message = "OP cancelada — mutações bloqueadas") {
    super(message);
    this.name = "OpCanceladaError";
  }
}

/**
 * Valida que a OP (direto pelo id) não está cancelada.
 */
export async function assertOpAtivaById(
  tx: Tx,
  contaId: string,
  ordemProducaoId: string,
): Promise<void> {
  const [op] = await tx
    .select({ status: confeccaoOrdemProducao.status })
    .from(confeccaoOrdemProducao)
    .where(
      and(
        eq(confeccaoOrdemProducao.id, ordemProducaoId),
        eq(confeccaoOrdemProducao.contaId, contaId),
      ),
    );
  if (op?.status === "cancelada") {
    throw new OpCanceladaError();
  }
}

/**
 * Valida via subtaskId — faz join com OP. Conveniência pra endpoints
 * que recebem subtaskId no path.
 */
export async function assertOpAtivaBySubtask(
  tx: Tx,
  contaId: string,
  subtaskId: string,
): Promise<void> {
  const [row] = await tx
    .select({ status: confeccaoOrdemProducao.status })
    .from(confeccaoSubtask)
    .innerJoin(
      confeccaoOrdemProducao,
      eq(confeccaoOrdemProducao.id, confeccaoSubtask.ordemProducaoId),
    )
    .where(
      and(
        eq(confeccaoSubtask.id, subtaskId),
        eq(confeccaoSubtask.contaId, contaId),
      ),
    );
  if (row?.status === "cancelada") {
    throw new OpCanceladaError();
  }
}
