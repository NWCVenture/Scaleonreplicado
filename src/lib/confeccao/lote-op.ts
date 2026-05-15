// RITM-24 — vincular um lote (tabela `lote_cadastrado`, compartilhada com
// Estante Virtual / Cadastro) a uma OP do módulo Confecção.
//
// Comportamento: upsert por `(conta_id, nome)`. Se o lote já existe sem
// FK, atualiza pra apontar pra OP. Se já existe com FK diferente,
// sobrescreve (caso de correção manual). Idempotente.

import { and, eq } from "drizzle-orm";
import { generateId } from "@/lib/utils";
import { db } from "@/lib/db";
import { loteCadastrado } from "@/lib/db/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type VincularLoteResult = {
  loteId: string;
  criado: boolean;
};

export async function vincularLoteAOP(
  tx: Tx,
  args: { contaId: string; opId: string; opNumero: string },
): Promise<VincularLoteResult> {
  const { contaId, opId, opNumero } = args;

  // Procura lote existente pelo nome dentro da conta.
  const existente = await tx
    .select({
      id: loteCadastrado.id,
      ordemProducaoId: loteCadastrado.ordemProducaoId,
    })
    .from(loteCadastrado)
    .where(
      and(
        eq(loteCadastrado.contaId, contaId),
        eq(loteCadastrado.nome, opNumero),
      ),
    )
    .limit(1);

  if (existente.length > 0) {
    const lote = existente[0];
    // Já vinculado à OP correta: noop.
    if (lote.ordemProducaoId === opId) {
      return { loteId: lote.id, criado: false };
    }
    // FK ausente ou apontando pra outra OP — atualiza.
    await tx
      .update(loteCadastrado)
      .set({ ordemProducaoId: opId })
      .where(eq(loteCadastrado.id, lote.id));
    return { loteId: lote.id, criado: false };
  }

  // Não existe — cria.
  const id = generateId();
  await tx.insert(loteCadastrado).values({
    id,
    contaId,
    nome: opNumero,
    ordemProducaoId: opId,
  });
  return { loteId: id, criado: true };
}
