// Services pra retiradas de peças da Costura (RITM-12).
//
// criarRetirada:
//   1. Numera OPXXXXXXXX-RET-NN sequencial por (subtask Costura × oficina)
//   2. INSERT em confeccao_retirada
//   3. INSERT em confeccao_subconferencia (linkada à retirada e à subtask OPCONF)
//   4. Desbloqueia OPCONF se ainda estava bloqueada/pendente
//   5. Atualiza statusInterno da oficina no payload da Costura
//   6. Cria nota de auditoria
//
// cancelarRetirada:
//   Só permitido se a subconferência ainda está em_andamento (não começou
//   contagem). Reverte tudo: deleta subconferência, deleta retirada,
//   atualiza statusInterno da oficina, cria nota.

import { and, asc, eq } from "drizzle-orm";
import { generateId } from "@/lib/utils";
import { db } from "@/lib/db";
import {
  confeccaoNota,
  confeccaoOrdemProducao,
  confeccaoRetirada,
  confeccaoSubconferencia,
  confeccaoSubtask,
  user,
  type ConfeccaoRetiradaTipo,
} from "@/lib/db/schema";
import type {
  OficinaCostura,
  SubtaskCosturaPayload,
  StatusInternoOficina,
} from "@/lib/confeccao/schemas/payloads/costura";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class RetiradaError extends Error {
  constructor(
    public readonly code:
      | "subtask_invalida"
      | "oficina_nao_encontrada"
      | "retirada_nao_encontrada"
      | "subconferencia_em_andamento"
      | "subtask_conferencia_nao_existe",
    message: string,
  ) {
    super(message);
    this.name = "RetiradaError";
  }
}

export interface CriarRetiradaInput {
  contaId: string;
  subtaskCosturaId: string;
  oficinaId: string;
  tipo: ConfeccaoRetiradaTipo;
  pecasPorTamanhoCor: Record<string, Record<string, number>>;
  dataRetirada: Date;
  usuarioId: string;
}

/**
 * Gera próximo número de retirada pra (subtask × oficina).
 * Formato: OP<numero>-RET-NN, contagem inclui retiradas canceladas (não
 * reseta sequencial — preserva auditoria visual).
 */
async function gerarNumeroRetirada(
  tx: Tx,
  subtaskCosturaId: string,
  oficinaId: string,
  opNumero: string,
): Promise<string> {
  const existentes = await tx
    .select({ id: confeccaoRetirada.id })
    .from(confeccaoRetirada)
    .where(
      and(
        eq(confeccaoRetirada.subtaskCosturaId, subtaskCosturaId),
        eq(confeccaoRetirada.oficinaId, oficinaId),
      ),
    );
  const proximo = existentes.length + 1;
  const nn = String(proximo).padStart(2, "0");
  return `${opNumero}-RET-${nn}`;
}

export async function criarRetirada(
  tx: Tx,
  input: CriarRetiradaInput,
): Promise<{
  retirada: { id: string; numero: string; tipo: ConfeccaoRetiradaTipo };
  subconferencia: { id: string; numero: string };
  opConfDesbloqueada: boolean;
}> {
  // 1. Lê subtask Costura
  const [stCostura] = await tx
    .select()
    .from(confeccaoSubtask)
    .where(
      and(
        eq(confeccaoSubtask.id, input.subtaskCosturaId),
        eq(confeccaoSubtask.contaId, input.contaId),
        eq(confeccaoSubtask.prefixo, "OPSEW"),
      ),
    );
  if (!stCostura) {
    throw new RetiradaError(
      "subtask_invalida",
      "Subtask de costura não encontrada",
    );
  }
  const payload = (stCostura.payload ?? {}) as SubtaskCosturaPayload;
  const oficinas = payload.oficinas ?? [];
  const idxOficina = oficinas.findIndex(
    (o) => o.oficinaId === input.oficinaId,
  );
  if (idxOficina < 0) {
    throw new RetiradaError(
      "oficina_nao_encontrada",
      "Oficina não consta no payload da subtask de costura",
    );
  }

  // 2. Lê OP pra ter o numero
  const [op] = await tx
    .select({ id: confeccaoOrdemProducao.id, numero: confeccaoOrdemProducao.numero })
    .from(confeccaoOrdemProducao)
    .where(eq(confeccaoOrdemProducao.id, stCostura.ordemProducaoId));
  if (!op) {
    throw new RetiradaError("subtask_invalida", "OP não encontrada");
  }

  // 3. Localiza subtask Conferência (OPCONF) da mesma OP
  const [stConf] = await tx
    .select()
    .from(confeccaoSubtask)
    .where(
      and(
        eq(confeccaoSubtask.ordemProducaoId, stCostura.ordemProducaoId),
        eq(confeccaoSubtask.prefixo, "OPCONF"),
      ),
    );
  if (!stConf) {
    throw new RetiradaError(
      "subtask_conferencia_nao_existe",
      "Subtask Conferência da OP não foi encontrada — não pode criar retirada",
    );
  }

  // 4. Numera retirada e INSERT
  const numeroRetirada = await gerarNumeroRetirada(
    tx,
    input.subtaskCosturaId,
    input.oficinaId,
    op.numero,
  );
  const retiradaId = generateId();
  await tx.insert(confeccaoRetirada).values({
    id: retiradaId,
    contaId: input.contaId,
    subtaskCosturaId: input.subtaskCosturaId,
    oficinaId: input.oficinaId,
    numero: numeroRetirada,
    tipo: input.tipo,
    pecasPorTamanhoCor: input.pecasPorTamanhoCor,
    dataRetirada: input.dataRetirada,
  });

  // 5. INSERT subconferência (linkada à retirada e à subtask Conferência)
  const subconferenciaId = generateId();
  // Numero da subconferência: OPXXXXXXXX-CONF-RETNN (mesmo NN da retirada)
  const nn = numeroRetirada.split("-").pop() ?? "01";
  const numeroSubconf = `${op.numero}-CONF-RET${nn}`;
  await tx.insert(confeccaoSubconferencia).values({
    id: subconferenciaId,
    contaId: input.contaId,
    subtaskConferenciaId: stConf.id,
    retiradaId,
    numero: numeroSubconf,
    status: "em_andamento",
  });

  // 6. Desbloqueia subtask Conferência se estava bloqueada
  let opConfDesbloqueada = false;
  if (stConf.status === "bloqueada" || stConf.status === "pendente") {
    await tx
      .update(confeccaoSubtask)
      .set({
        status: "em_andamento",
        iniciadaEm: stConf.iniciadaEm ?? new Date(),
        updatedAt: new Date(),
      })
      .where(eq(confeccaoSubtask.id, stConf.id));
    opConfDesbloqueada = true;
  }

  // 7. Atualiza statusInterno da oficina no payload da Costura
  const novoStatusOficina: StatusInternoOficina =
    input.tipo === "final" ? "finalizada" : "retirada_parcial";
  const oficinasAtualizadas: OficinaCostura[] = oficinas.map((o, i) =>
    i === idxOficina ? { ...o, statusInterno: novoStatusOficina } : o,
  );
  await tx
    .update(confeccaoSubtask)
    .set({
      payload: { oficinas: oficinasAtualizadas } as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .where(eq(confeccaoSubtask.id, input.subtaskCosturaId));

  // 8. Nota de auditoria
  const [editor] = await tx
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, input.usuarioId));
  await tx.insert(confeccaoNota).values({
    id: generateId(),
    contaId: input.contaId,
    subtaskId: input.subtaskCosturaId,
    autorId: null,
    conteudo: `Retirada ${input.tipo} ${numeroRetirada} criada por ${editor?.name ?? "Sistema"}. Subconferência ${numeroSubconf} aberta.${opConfDesbloqueada ? " Subtask Conferência desbloqueada." : ""}`,
    isAuditoria: true,
    isInterna: true,
    metadata: {
      acao: "criar_retirada",
      retiradaId,
      subconferenciaId,
      tipo: input.tipo,
      opConfDesbloqueada,
    },
  });

  return {
    retirada: { id: retiradaId, numero: numeroRetirada, tipo: input.tipo },
    subconferencia: { id: subconferenciaId, numero: numeroSubconf },
    opConfDesbloqueada,
  };
}

/**
 * Cancela retirada. Permitido SOMENTE se a subconferência associada ainda
 * está com status `em_andamento` (não houve contagem). Reverte o
 * statusInterno da oficina pra "em_producao" (assumindo que cancelar
 * uma retirada parcial volta pra produção; retirada final cancelada
 * volta pra "em_producao" também).
 */
export async function cancelarRetirada(
  tx: Tx,
  input: {
    contaId: string;
    retiradaId: string;
    usuarioId: string;
  },
): Promise<void> {
  const [retirada] = await tx
    .select()
    .from(confeccaoRetirada)
    .where(
      and(
        eq(confeccaoRetirada.id, input.retiradaId),
        eq(confeccaoRetirada.contaId, input.contaId),
      ),
    );
  if (!retirada) {
    throw new RetiradaError(
      "retirada_nao_encontrada",
      "Retirada não encontrada",
    );
  }

  // Subconferência vinculada
  const [subconf] = await tx
    .select()
    .from(confeccaoSubconferencia)
    .where(eq(confeccaoSubconferencia.retiradaId, retirada.id));
  if (subconf) {
    const jaIniciouContagem =
      subconf.pecasRecebidas !== null ||
      subconf.quantidadeRevelada ||
      subconf.status === "concluida";
    if (jaIniciouContagem) {
      throw new RetiradaError(
        "subconferencia_em_andamento",
        "Subconferência já começou — não pode cancelar a retirada",
      );
    }
    await tx
      .delete(confeccaoSubconferencia)
      .where(eq(confeccaoSubconferencia.id, subconf.id));
  }

  // Reverte statusInterno da oficina
  const [stCostura] = await tx
    .select()
    .from(confeccaoSubtask)
    .where(eq(confeccaoSubtask.id, retirada.subtaskCosturaId));
  if (stCostura) {
    const payload = (stCostura.payload ?? {}) as SubtaskCosturaPayload;
    const oficinas = payload.oficinas ?? [];
    const idx = oficinas.findIndex((o) => o.oficinaId === retirada.oficinaId);
    if (idx >= 0) {
      // Verifica se ainda há retiradas restantes pra esta oficina
      const outras = await tx
        .select({ tipo: confeccaoRetirada.tipo })
        .from(confeccaoRetirada)
        .where(
          and(
            eq(confeccaoRetirada.subtaskCosturaId, retirada.subtaskCosturaId),
            eq(confeccaoRetirada.oficinaId, retirada.oficinaId),
          ),
        )
        .orderBy(asc(confeccaoRetirada.createdAt));
      // Filtra fora a que está sendo cancelada
      const restantes = outras.filter((_, i) => i !== outras.length - 1);
      const novoStatus: StatusInternoOficina =
        restantes.length === 0
          ? "em_producao"
          : restantes.some((r) => r.tipo === "final")
            ? "finalizada"
            : "retirada_parcial";
      const atualizadas = oficinas.map((o, i) =>
        i === idx ? { ...o, statusInterno: novoStatus } : o,
      );
      await tx
        .update(confeccaoSubtask)
        .set({
          payload: { oficinas: atualizadas } as Record<string, unknown>,
          updatedAt: new Date(),
        })
        .where(eq(confeccaoSubtask.id, stCostura.id));
    }
  }

  // Marca retirada como cancelada (mantém histórico)
  await tx
    .update(confeccaoRetirada)
    .set({
      canceladaEm: new Date(),
      canceladaPorId: input.usuarioId,
    })
    .where(eq(confeccaoRetirada.id, retirada.id));

  // Auditoria
  const [editor] = await tx
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, input.usuarioId));
  await tx.insert(confeccaoNota).values({
    id: generateId(),
    contaId: input.contaId,
    subtaskId: retirada.subtaskCosturaId,
    autorId: null,
    conteudo: `Retirada ${retirada.numero} cancelada por ${editor?.name ?? "Sistema"}. Subconferência removida.`,
    isAuditoria: true,
    isInterna: true,
    metadata: {
      acao: "cancelar_retirada",
      retiradaId: retirada.id,
    },
  });
}
