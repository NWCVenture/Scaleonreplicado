// Services adicionais de transição de status (selecionável pelo usuário).
//
// Complementa transicao-subtask.ts (iniciar/concluir) cobrindo as
// transições "manuais" que não dependem de validação heavy:
//
//   * → cancelada              (cancelar, requer justificativa)
//   em_andamento → pendente    (voltar pra pendente / desfazer iniciar)
//   cancelada → pendente       (descancelar, requer justificativa, admin)
//
// Conclusão (em_andamento → concluida) continua em /concluir (validação
// pesada de payload + sync Compra→Corte fica lá).
// Reabertura (concluida → em_andamento) continua em /reabrir (admin +
// justificativa).
//
// Cada transição cria uma nota de auditoria com metadata acao + valores.

import { and, eq } from "drizzle-orm";
import { generateId } from "@/lib/utils";
import { db } from "@/lib/db";
import { confeccaoNota, confeccaoSubtask, user } from "@/lib/db/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type SubtaskStatus = "bloqueada" | "pendente" | "em_andamento" | "concluida" | "cancelada";

export class TransicionarSubtaskError extends Error {
  constructor(
    public readonly code:
      | "subtask_nao_encontrada"
      | "transicao_invalida"
      | "justificativa_obrigatoria",
    message: string,
  ) {
    super(message);
    this.name = "TransicionarSubtaskError";
  }
}

interface InputBase {
  contaId: string;
  subtaskId: string;
  usuarioId: string;
  justificativa: string;
}

/**
 * Move subtask pra `cancelada` a partir de qualquer status não-bloqueada.
 * Não altera as outras subtasks da OP (a próxima já desbloqueada continua).
 * Exige justificativa (≥ 5 chars).
 */
export async function cancelarSubtask(
  tx: Tx,
  input: InputBase,
): Promise<{ id: string; status: "cancelada"; valorAntigo: SubtaskStatus }> {
  if (input.justificativa.trim().length < 5) {
    throw new TransicionarSubtaskError(
      "justificativa_obrigatoria",
      "Justificativa precisa ter pelo menos 5 caracteres",
    );
  }
  const [st] = await tx
    .select()
    .from(confeccaoSubtask)
    .where(
      and(
        eq(confeccaoSubtask.id, input.subtaskId),
        eq(confeccaoSubtask.contaId, input.contaId),
      ),
    );
  if (!st) {
    throw new TransicionarSubtaskError(
      "subtask_nao_encontrada",
      "Subtask não encontrada na conta atual",
    );
  }
  const valorAntigo = st.status as SubtaskStatus;
  if (valorAntigo === "cancelada") {
    throw new TransicionarSubtaskError(
      "transicao_invalida",
      "Subtask já está cancelada",
    );
  }
  if (valorAntigo === "bloqueada") {
    throw new TransicionarSubtaskError(
      "transicao_invalida",
      "Não é possível cancelar subtask bloqueada — espere a anterior concluir",
    );
  }

  const agora = new Date();
  const [updated] = await tx
    .update(confeccaoSubtask)
    .set({ status: "cancelada", updatedAt: agora })
    .where(eq(confeccaoSubtask.id, st.id))
    .returning({ id: confeccaoSubtask.id, status: confeccaoSubtask.status });

  const [editor] = await tx
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, input.usuarioId));

  await tx.insert(confeccaoNota).values({
    id: generateId(),
    contaId: input.contaId,
    subtaskId: st.id,
    autorId: null,
    conteudo: `Subtask cancelada por ${editor?.name ?? "Sistema"}. Justificativa: ${input.justificativa.trim()}`,
    isAuditoria: true,
    isInterna: true,
    metadata: {
      acao: "cancelar_subtask",
      valorAntigo,
      valorNovo: "cancelada",
      justificativa: input.justificativa.trim(),
      editorId: input.usuarioId,
    },
  });

  return { id: updated.id, status: "cancelada", valorAntigo };
}

/**
 * Move subtask de `em_andamento` → `pendente`. Limpa `iniciadaEm`.
 * Útil pra desfazer um "Iniciar" feito por engano.
 */
export async function voltarParaPendente(
  tx: Tx,
  input: Omit<InputBase, "justificativa"> & { justificativa?: string },
): Promise<{ id: string; status: "pendente" }> {
  const [st] = await tx
    .select()
    .from(confeccaoSubtask)
    .where(
      and(
        eq(confeccaoSubtask.id, input.subtaskId),
        eq(confeccaoSubtask.contaId, input.contaId),
      ),
    );
  if (!st) {
    throw new TransicionarSubtaskError(
      "subtask_nao_encontrada",
      "Subtask não encontrada na conta atual",
    );
  }
  if (st.status !== "em_andamento") {
    throw new TransicionarSubtaskError(
      "transicao_invalida",
      `Subtask está em "${st.status}" — só pode voltar pra "pendente" a partir de "em_andamento"`,
    );
  }

  const agora = new Date();
  const [updated] = await tx
    .update(confeccaoSubtask)
    .set({ status: "pendente", iniciadaEm: null, updatedAt: agora })
    .where(eq(confeccaoSubtask.id, st.id))
    .returning({ id: confeccaoSubtask.id, status: confeccaoSubtask.status });

  const [editor] = await tx
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, input.usuarioId));

  const justif = input.justificativa?.trim();
  await tx.insert(confeccaoNota).values({
    id: generateId(),
    contaId: input.contaId,
    subtaskId: st.id,
    autorId: null,
    conteudo: justif
      ? `Subtask voltou pra "pendente" (${editor?.name ?? "Sistema"}). Justificativa: ${justif}`
      : `Subtask voltou pra "pendente" (${editor?.name ?? "Sistema"})`,
    isAuditoria: true,
    isInterna: true,
    metadata: {
      acao: "voltar_pendente",
      valorAntigo: "em_andamento",
      valorNovo: "pendente",
      justificativa: justif ?? null,
      editorId: input.usuarioId,
    },
  });

  return { id: updated.id, status: "pendente" };
}

/**
 * Move subtask `cancelada` → `pendente`. Exige justificativa.
 * Caller é responsável por checar se usuário tem permissão (admin).
 */
export async function descancelarSubtask(
  tx: Tx,
  input: InputBase,
): Promise<{ id: string; status: "pendente" }> {
  if (input.justificativa.trim().length < 5) {
    throw new TransicionarSubtaskError(
      "justificativa_obrigatoria",
      "Justificativa precisa ter pelo menos 5 caracteres",
    );
  }
  const [st] = await tx
    .select()
    .from(confeccaoSubtask)
    .where(
      and(
        eq(confeccaoSubtask.id, input.subtaskId),
        eq(confeccaoSubtask.contaId, input.contaId),
      ),
    );
  if (!st) {
    throw new TransicionarSubtaskError(
      "subtask_nao_encontrada",
      "Subtask não encontrada na conta atual",
    );
  }
  if (st.status !== "cancelada") {
    throw new TransicionarSubtaskError(
      "transicao_invalida",
      `Subtask está em "${st.status}" — só pode descancelar a partir de "cancelada"`,
    );
  }

  const agora = new Date();
  const [updated] = await tx
    .update(confeccaoSubtask)
    .set({ status: "pendente", updatedAt: agora })
    .where(eq(confeccaoSubtask.id, st.id))
    .returning({ id: confeccaoSubtask.id, status: confeccaoSubtask.status });

  const [editor] = await tx
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, input.usuarioId));

  await tx.insert(confeccaoNota).values({
    id: generateId(),
    contaId: input.contaId,
    subtaskId: st.id,
    autorId: null,
    conteudo: `Subtask descancelada por ${editor?.name ?? "Admin"}. Justificativa: ${input.justificativa.trim()}`,
    isAuditoria: true,
    isInterna: true,
    metadata: {
      acao: "descancelar_subtask",
      valorAntigo: "cancelada",
      valorNovo: "pendente",
      justificativa: input.justificativa.trim(),
      editorId: input.usuarioId,
    },
  });

  return { id: updated.id, status: "pendente" };
}
