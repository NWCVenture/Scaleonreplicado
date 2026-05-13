// Services genéricos de transição de status das subtasks (RITM-08+).
//
// Encadeamento bloqueante:
//   bloqueada → (anterior conclui) → pendente → (iniciar) → em_andamento → (concluir) → concluida
//
// `concluirSubtask` destrava a próxima subtask do fluxo (ordemSequencial+1)
// alterando-a de `bloqueada` → `pendente` E cria nota de auditoria.
//
// Caso especial — Conferência (OPCONF) destrava parcialmente via retiradas
// parciais da Costura (RITM-12); essa lógica não vive aqui.

import { and, asc, eq } from "drizzle-orm";
import { generateId } from "@/lib/utils";
import { db } from "@/lib/db";
import {
  confeccaoNota,
  confeccaoOrdemProducao,
  confeccaoSubtask,
  user,
} from "@/lib/db/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class TransicaoSubtaskError extends Error {
  constructor(
    public readonly code:
      | "subtask_nao_encontrada"
      | "status_invalido"
      | "anterior_nao_concluida"
      | "payload_incompleto",
    message: string,
  ) {
    super(message);
    this.name = "TransicaoSubtaskError";
  }
}

/**
 * Move subtask de `pendente` → `em_andamento`. Cria nota de auditoria.
 */
export async function iniciarSubtask(
  tx: Tx,
  input: { contaId: string; subtaskId: string; usuarioId: string },
): Promise<{ id: string; status: "em_andamento"; iniciadaEm: Date }> {
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
    throw new TransicaoSubtaskError(
      "subtask_nao_encontrada",
      "Subtask não encontrada na conta atual",
    );
  }
  if (st.status !== "pendente") {
    throw new TransicaoSubtaskError(
      "status_invalido",
      `Subtask está em status "${st.status}"; só pode iniciar a partir de "pendente"`,
    );
  }

  const agora = new Date();
  const [updated] = await tx
    .update(confeccaoSubtask)
    .set({ status: "em_andamento", iniciadaEm: agora, updatedAt: agora })
    .where(eq(confeccaoSubtask.id, st.id))
    .returning({
      id: confeccaoSubtask.id,
      status: confeccaoSubtask.status,
      iniciadaEm: confeccaoSubtask.iniciadaEm,
    });

  const [editor] = await tx
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, input.usuarioId));

  await tx.insert(confeccaoNota).values({
    id: generateId(),
    contaId: input.contaId,
    subtaskId: st.id,
    autorId: null,
    conteudo: `Subtask iniciada por ${editor?.name ?? "Sistema"}`,
    isAuditoria: true,
    isInterna: true,
    metadata: {
      campo: "status",
      valorAntigo: "pendente",
      valorNovo: "em_andamento",
    },
  });

  return {
    id: updated.id,
    status: "em_andamento" as const,
    iniciadaEm: updated.iniciadaEm!,
  };
}

/**
 * Move subtask de `em_andamento` → `concluida`. Destrava a próxima subtask
 * do fluxo (ordemSequencial+1) movendo de `bloqueada` → `pendente`.
 *
 * O caller é responsável por validar o payload específico da subtask antes
 * de chamar este service.
 */
export async function concluirSubtask(
  tx: Tx,
  input: {
    contaId: string;
    subtaskId: string;
    usuarioId: string;
  },
): Promise<{
  id: string;
  status: "concluida";
  proximaDesbloqueada: { id: string; numero: string } | null;
}> {
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
    throw new TransicaoSubtaskError(
      "subtask_nao_encontrada",
      "Subtask não encontrada na conta atual",
    );
  }
  if (st.status !== "em_andamento") {
    throw new TransicaoSubtaskError(
      "status_invalido",
      `Subtask está em status "${st.status}"; só pode concluir a partir de "em_andamento"`,
    );
  }

  const agora = new Date();
  const [updated] = await tx
    .update(confeccaoSubtask)
    .set({ status: "concluida", concluidaEm: agora, updatedAt: agora })
    .where(eq(confeccaoSubtask.id, st.id))
    .returning({
      id: confeccaoSubtask.id,
      status: confeccaoSubtask.status,
    });

  // Destrava a próxima subtask do fluxo (mesma OP, ordemSequencial+1)
  const proximas = await tx
    .select()
    .from(confeccaoSubtask)
    .where(eq(confeccaoSubtask.ordemProducaoId, st.ordemProducaoId))
    .orderBy(asc(confeccaoSubtask.ordemSequencial));
  const proxima = proximas.find(
    (p) => p.ordemSequencial === st.ordemSequencial + 1,
  );

  let proximaDesbloqueada: { id: string; numero: string } | null = null;
  if (proxima && proxima.status === "bloqueada") {
    const [pUpdated] = await tx
      .update(confeccaoSubtask)
      .set({ status: "pendente", updatedAt: agora })
      .where(eq(confeccaoSubtask.id, proxima.id))
      .returning({
        id: confeccaoSubtask.id,
        numero: confeccaoSubtask.numero,
      });
    proximaDesbloqueada = { id: pUpdated.id, numero: pUpdated.numero };
  }

  // Se todas as subtasks da OP estão concluídas, marca OP como concluída
  const todasConcluidas =
    proximas.length > 0 &&
    proximas.every(
      (p) => p.id === st.id || p.status === "concluida",
    );
  if (todasConcluidas) {
    await tx
      .update(confeccaoOrdemProducao)
      .set({ status: "concluida", concluidaEm: agora, updatedAt: agora })
      .where(eq(confeccaoOrdemProducao.id, st.ordemProducaoId));
  }

  const [editor] = await tx
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, input.usuarioId));

  await tx.insert(confeccaoNota).values({
    id: generateId(),
    contaId: input.contaId,
    subtaskId: st.id,
    autorId: null,
    conteudo: proximaDesbloqueada
      ? `Subtask concluída por ${editor?.name ?? "Sistema"}. Próxima desbloqueada: ${proximaDesbloqueada.numero}.`
      : `Subtask concluída por ${editor?.name ?? "Sistema"}.${todasConcluidas ? " OP marcada como concluída." : ""}`,
    isAuditoria: true,
    isInterna: true,
    metadata: {
      campo: "status",
      valorAntigo: "em_andamento",
      valorNovo: "concluida",
      proximaDesbloqueadaId: proximaDesbloqueada?.id ?? null,
      opConcluida: todasConcluidas,
    },
  });

  return {
    id: updated.id,
    status: "concluida" as const,
    proximaDesbloqueada,
  };
}
