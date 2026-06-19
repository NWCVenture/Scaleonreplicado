// Service `criarOP` — cria uma OP + 5/6 subtasks + nota de auditoria em
// uma única transação atômica (RITM-06).
//
// Encadeamento bloqueante: primeira subtask (OPBUY) entra como `pendente`,
// as demais como `bloqueada`. Subtasks compartilham o sequencial da OP-mãe.
//
// Ordem das subtasks:
//   semVies: OPBUY → OPRIS → OPCOR → OPSEW → OPCONF (5)
//   comVies: OPBUY → OPRIS → OPCOR → OPVIE → OPSEW → OPCONF (6)

import { and, eq } from "drizzle-orm";
import { generateId } from "@/lib/utils";
import { db } from "@/lib/db";
import {
  confeccaoNota,
  confeccaoOrdemProducao,
  confeccaoProduto,
  confeccaoSubtask,
  user,
  usuarioConta,
  type ConfeccaoSubtaskPrefixo,
} from "@/lib/db/schema";
import {
  gerarIdInternoSubtask,
  gerarNumeroOP,
  gerarNumeroSubtaskVisivel,
} from "@/lib/confeccao/numeracao";
import type { CriarOPInput } from "@/lib/confeccao/schemas/op";

const ORDEM_COM_VIES: ConfeccaoSubtaskPrefixo[] = [
  "OPBUY",
  "OPRIS",
  "OPCOR",
  "OPVIE",
  "OPSEW",
  "OPCONF",
];

const ORDEM_SEM_VIES: ConfeccaoSubtaskPrefixo[] = [
  "OPBUY",
  "OPRIS",
  "OPCOR",
  "OPSEW",
  "OPCONF",
];

export class CriarOPError extends Error {
  constructor(
    public readonly code:
      | "produto_nao_encontrado"
      | "atribuido_invalido"
      | "atribuido_inativo",
    message: string,
  ) {
    super(message);
    this.name = "CriarOPError";
  }
}

export interface CriarOPResult {
  op: {
    id: string;
    numero: string;
    sequencial: number;
  };
  subtasks: Array<{
    id: string;
    numero: string;
    idInterno: string;
    prefixo: ConfeccaoSubtaskPrefixo;
    status: "em_andamento" | "bloqueada";
  }>;
  atribuidoNome: string | null;
  criadoPorNome: string | null;
}

/**
 * Cria OP + subtasks + nota em uma transação. RLS já isola por conta_id
 * (caller responsável por chamar dentro de withConta/withContaAtiva).
 *
 * Observação: `tx` é o tipo aceito pelo drizzle.transaction callback.
 */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function criarOP(
  tx: Tx,
  input: {
    contaId: string;
    criadaPorId: string;
    data: CriarOPInput;
  },
): Promise<CriarOPResult> {
  const { contaId, criadaPorId, data } = input;

  // 1. Valida produto pertence à conta
  const [produto] = await tx
    .select({ id: confeccaoProduto.id, ativo: confeccaoProduto.ativo })
    .from(confeccaoProduto)
    .where(
      and(
        eq(confeccaoProduto.id, data.produtoId),
        eq(confeccaoProduto.contaId, contaId),
      ),
    );
  if (!produto) {
    throw new CriarOPError(
      "produto_nao_encontrado",
      "Produto não encontrado na conta atual",
    );
  }

  // 2. Valida atribuído é membro ativo da conta
  const [vinculo] = await tx
    .select({
      usuarioId: usuarioConta.usuarioId,
      ativo: usuarioConta.ativo,
      nome: user.name,
    })
    .from(usuarioConta)
    .innerJoin(user, eq(user.id, usuarioConta.usuarioId))
    .where(
      and(
        eq(usuarioConta.usuarioId, data.atribuidoAId),
        eq(usuarioConta.contaId, contaId),
      ),
    );
  if (!vinculo) {
    throw new CriarOPError(
      "atribuido_invalido",
      "Atribuído não pertence à conta atual",
    );
  }
  if (!vinculo.ativo) {
    throw new CriarOPError(
      "atribuido_inativo",
      "Atribuído não está mais ativo na conta",
    );
  }

  // 3. Reserva número da OP via sequence (atomic)
  const { numero, sequencial, mes, ano } = await gerarNumeroOP(tx);

  // 4. INSERT da OP
  const opId = generateId();
  const [op] = await tx
    .insert(confeccaoOrdemProducao)
    .values({
      id: opId,
      contaId,
      numero,
      sequencialGlobal: sequencial,
      produtoId: data.produtoId,
      temVies: data.temVies,
      criadaPorId,
      atribuidoAId: data.atribuidoAId,
      observacoes: data.observacoes ?? null,
    })
    .returning();

  // 5. Subtasks na ordem certa.
  // OPBUY (idx 0) já nasce em em_andamento — não precisa "Iniciar"
  // (RITM-29 descontinua pré/pós). As demais ficam bloqueadas até a
  // anterior ser concluída.
  const ordem = data.temVies ? ORDEM_COM_VIES : ORDEM_SEM_VIES;
  const subtasksInsert = ordem.map((prefixo, idx) => {
    const statusInicial: "em_andamento" | "bloqueada" =
      idx === 0 ? "em_andamento" : "bloqueada";
    return {
      id: generateId(),
      contaId,
      ordemProducaoId: opId,
      numero: gerarNumeroSubtaskVisivel(prefixo, sequencial),
      idInterno: gerarIdInternoSubtask(prefixo, mes, ano, sequencial),
      prefixo,
      ordemSequencial: idx + 1,
      status: statusInicial,
      iniciadaEm: idx === 0 ? new Date() : null,
      payload: {} as Record<string, unknown>,
    };
  });

  const subtasks = await tx
    .insert(confeccaoSubtask)
    .values(subtasksInsert)
    .returning({
      id: confeccaoSubtask.id,
      numero: confeccaoSubtask.numero,
      idInterno: confeccaoSubtask.idInterno,
      prefixo: confeccaoSubtask.prefixo,
      status: confeccaoSubtask.status,
    });

  // 6. Nome do criador (pra mensagem da nota de auditoria)
  const [criador] = await tx
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, criadaPorId));

  const criadorNome = criador?.name ?? "Sistema";
  const atribuidoNome = vinculo.nome ?? "(sem nome)";

  await tx.insert(confeccaoNota).values({
    id: generateId(),
    contaId,
    ordemProducaoId: opId,
    autorId: null,
    conteudo: `OP criada por ${criadorNome}. Atribuída a ${atribuidoNome}.${
      data.temVies ? " Com Viés." : ""
    }`,
    isAuditoria: true,
    isInterna: true,
    metadata: {
      criadaPorId,
      atribuidoAId: data.atribuidoAId,
      temVies: data.temVies,
      produtoId: data.produtoId,
    },
  });

  return {
    op: { id: op.id, numero: op.numero, sequencial: op.sequencialGlobal },
    subtasks: subtasks.map((s) => ({
      id: s.id,
      numero: s.numero,
      idInterno: s.idInterno,
      prefixo: s.prefixo,
      status: s.status as "em_andamento" | "bloqueada",
    })),
    atribuidoNome,
    criadoPorNome: criadorNome,
  };
}
