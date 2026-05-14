// Service `cancelarOP` — RITM-18.
//
// Cancela uma OP em qualquer status, com dupla autorização obrigatória
// quando a OP já estava com status `concluida`. Cancelamento é definitivo:
// transação `cancelada` → outros estados não é permitida.

import { and, eq } from "drizzle-orm";
import { generateId } from "@/lib/utils";
import { db } from "@/lib/db";
import {
  confeccaoNota,
  confeccaoOrdemProducao,
  user,
  usuarioConta,
} from "@/lib/db/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class CancelarOPError extends Error {
  constructor(
    public readonly code:
      | "op_nao_encontrada"
      | "ja_cancelada"
      | "requer_autorizacao_dupla"
      | "autorizador_invalido",
    message: string,
  ) {
    super(message);
    this.name = "CancelarOPError";
  }
}

export interface CancelarOPInput {
  contaId: string;
  opNumero: string;
  canceladaPorId: string;
  justificativa: string;
  /** Obrigatório se a OP estava `concluida`. Não pode ser igual a `canceladaPorId`. */
  autorizadoPorId?: string;
}

export interface CancelarOPResult {
  op: {
    id: string;
    numero: string;
    statusAnterior: "em_andamento" | "concluida";
  };
  canceladaPorNome: string;
  autorizadoPorNome: string | null;
}

export async function cancelarOP(
  tx: Tx,
  input: CancelarOPInput,
): Promise<CancelarOPResult> {
  const [op] = await tx
    .select()
    .from(confeccaoOrdemProducao)
    .where(
      and(
        eq(confeccaoOrdemProducao.numero, input.opNumero),
        eq(confeccaoOrdemProducao.contaId, input.contaId),
      ),
    );
  if (!op) {
    throw new CancelarOPError(
      "op_nao_encontrada",
      "OP não encontrada na conta atual",
    );
  }
  if (op.status === "cancelada") {
    throw new CancelarOPError(
      "ja_cancelada",
      "Esta OP já foi cancelada — operação irreversível",
    );
  }

  const statusAnterior = op.status as "em_andamento" | "concluida";

  // Dupla autorização obrigatória quando OP já estava fechada
  if (statusAnterior === "concluida") {
    if (!input.autorizadoPorId) {
      throw new CancelarOPError(
        "requer_autorizacao_dupla",
        "Cancelar uma OP concluída exige autorização de outro admin (campo 'autorizadoPorId')",
      );
    }
    if (input.autorizadoPorId === input.canceladaPorId) {
      throw new CancelarOPError(
        "autorizador_invalido",
        "O autorizador precisa ser um admin diferente de quem está cancelando",
      );
    }
    // Valida que o autorizador é admin/owner ativo da conta
    const [vinculo] = await tx
      .select({
        ativo: usuarioConta.ativo,
        papel: usuarioConta.papel,
      })
      .from(usuarioConta)
      .where(
        and(
          eq(usuarioConta.usuarioId, input.autorizadoPorId),
          eq(usuarioConta.contaId, input.contaId),
        ),
      );
    if (
      !vinculo ||
      !vinculo.ativo ||
      (vinculo.papel !== "admin" && vinculo.papel !== "owner")
    ) {
      throw new CancelarOPError(
        "autorizador_invalido",
        "Autorizador precisa ser admin ou owner ativo na conta",
      );
    }
  }

  const agora = new Date();
  await tx
    .update(confeccaoOrdemProducao)
    .set({
      status: "cancelada",
      canceladaEm: agora,
      canceladaPorId: input.canceladaPorId,
      cancelamentoAutorizadoPorId: input.autorizadoPorId ?? null,
      cancelamentoJustificativa: input.justificativa,
      updatedAt: agora,
    })
    .where(eq(confeccaoOrdemProducao.id, op.id));

  const [canceladaPor] = await tx
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, input.canceladaPorId));
  let autorizadoPorNome: string | null = null;
  if (input.autorizadoPorId) {
    const [a] = await tx
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, input.autorizadoPorId));
    autorizadoPorNome = a?.name ?? null;
  }

  const conteudoNota =
    statusAnterior === "concluida"
      ? `OP cancelada por ${canceladaPor?.name ?? "Sistema"} com autorização de ${autorizadoPorNome ?? "?"}. Justificativa: ${input.justificativa}`
      : `OP cancelada por ${canceladaPor?.name ?? "Sistema"}. Justificativa: ${input.justificativa}`;

  await tx.insert(confeccaoNota).values({
    id: generateId(),
    contaId: input.contaId,
    ordemProducaoId: op.id,
    autorId: null,
    conteudo: conteudoNota,
    isAuditoria: true,
    isInterna: true,
    metadata: {
      acao: "cancelar_op",
      statusAnterior,
      canceladaPorId: input.canceladaPorId,
      autorizadoPorId: input.autorizadoPorId ?? null,
      justificativa: input.justificativa,
    },
  });

  return {
    op: {
      id: op.id,
      numero: op.numero,
      statusAnterior,
    },
    canceladaPorNome: canceladaPor?.name ?? "Sistema",
    autorizadoPorNome,
  };
}
