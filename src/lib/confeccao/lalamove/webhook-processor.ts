// RITM-27 — processador de eventos do webhook da Lalamove.
//
// Idempotente: chamadas repetidas pro mesmo evento não duplicam efeitos.
// Pode ser invocado tanto pelo `after()` do endpoint do webhook quanto pelo
// cron de polling fallback (que processa eventos que ficaram processado=false).

import { and, eq, sql } from "drizzle-orm";
import { generateId } from "@/lib/utils";
import { db } from "@/lib/db";
import {
  confeccaoLalamove,
  confeccaoLalamoveWebhookEvent,
  confeccaoNota,
  confeccaoSubtask,
  type confeccaoLalamoveWebhookEventoEnum,
} from "@/lib/db/schema";
import {
  mapearStatusApi,
  deveSetarDataColeta,
  deveSetarDataEntrega,
  type LalamoveStatusInterno,
} from "./status-map";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type WebhookEventoTipo =
  (typeof confeccaoLalamoveWebhookEventoEnum.enumValues)[number];

export interface ProcessarResult {
  status: "ok" | "lalamove_nao_encontrado" | "duplicado" | "noop" | "erro";
  detalhes?: string;
  statusAnterior?: LalamoveStatusInterno;
  statusNovo?: LalamoveStatusInterno;
}

interface WebhookPayloadData {
  orderId?: string;
  status?: string; // status API (ASSIGNING_DRIVER, etc.)
  timestamp?: string;
  driverId?: string;
  driverName?: string;
  driverPhone?: string;
  driverPlateNumber?: string;
}
interface WebhookPayload {
  event?: string;
  data?: WebhookPayloadData;
}

export async function processarWebhookEvent(
  tx: Tx,
  args: { eventoId: string },
): Promise<ProcessarResult> {
  // 1. SELECT FOR UPDATE SKIP LOCKED — cron concorrente seguro
  const [evento] = await tx
    .select()
    .from(confeccaoLalamoveWebhookEvent)
    .where(eq(confeccaoLalamoveWebhookEvent.id, args.eventoId))
    .for("update", { skipLocked: true })
    .limit(1);

  if (!evento) {
    return { status: "noop", detalhes: "evento não encontrado ou bloqueado por outro worker" };
  }

  if (evento.processado) {
    return { status: "duplicado", detalhes: "já processado" };
  }

  const payload = evento.payload as WebhookPayload;
  const payloadData = payload?.data ?? {};

  // 2. Resolve lalamoveId se ainda NULL
  let lalamoveId = evento.lalamoveId;
  if (!lalamoveId) {
    const [lm] = await tx
      .select({ id: confeccaoLalamove.id, contaId: confeccaoLalamove.contaId })
      .from(confeccaoLalamove)
      .where(eq(confeccaoLalamove.orderIdApi, evento.orderIdApi))
      .limit(1);
    if (lm) {
      lalamoveId = lm.id;
      await tx
        .update(confeccaoLalamoveWebhookEvent)
        .set({ lalamoveId: lm.id, contaId: lm.contaId })
        .where(eq(confeccaoLalamoveWebhookEvent.id, evento.id));
    }
  }

  if (!lalamoveId) {
    // Lalamove inexistente — marca processado com erro pra não tentar de novo.
    await tx
      .update(confeccaoLalamoveWebhookEvent)
      .set({
        processado: true,
        processadoEm: new Date(),
        erroProcessamento: "lalamove_nao_encontrado",
      })
      .where(eq(confeccaoLalamoveWebhookEvent.id, evento.id));
    return {
      status: "lalamove_nao_encontrado",
      detalhes: `orderId=${evento.orderIdApi} não tem lalamove correspondente`,
    };
  }

  // 3. Checa duplicação (mesma chave evento+order+timestamp já processado).
  // Timestamp vem do payload.data.timestamp da Lalamove (não do recebido_em).
  const tsPayload = payloadData.timestamp ?? null;
  if (tsPayload) {
    const duplicado = await tx
      .select({ id: confeccaoLalamoveWebhookEvent.id })
      .from(confeccaoLalamoveWebhookEvent)
      .where(
        and(
          eq(confeccaoLalamoveWebhookEvent.orderIdApi, evento.orderIdApi),
          eq(confeccaoLalamoveWebhookEvent.evento, evento.evento),
          eq(confeccaoLalamoveWebhookEvent.processado, true),
          sql`${confeccaoLalamoveWebhookEvent.payload}->'data'->>'timestamp' = ${tsPayload}`,
        ),
      )
      .limit(1);
    if (duplicado.length > 0) {
      await tx
        .update(confeccaoLalamoveWebhookEvent)
        .set({ processado: true, processadoEm: new Date() })
        .where(eq(confeccaoLalamoveWebhookEvent.id, evento.id));
      return { status: "duplicado", detalhes: "outro evento idêntico já processado" };
    }
  }

  // 4. Aplica mudanças no lalamove
  const [lalamove] = await tx
    .select()
    .from(confeccaoLalamove)
    .where(eq(confeccaoLalamove.id, lalamoveId))
    .for("update")
    .limit(1);
  if (!lalamove) {
    // Race: outra tx deletou o lalamove. Trata como não encontrado.
    await tx
      .update(confeccaoLalamoveWebhookEvent)
      .set({
        processado: true,
        processadoEm: new Date(),
        erroProcessamento: "lalamove_deletado",
      })
      .where(eq(confeccaoLalamoveWebhookEvent.id, evento.id));
    return { status: "lalamove_nao_encontrado" };
  }

  const statusAnterior = lalamove.status as LalamoveStatusInterno;
  let statusNovo: LalamoveStatusInterno = statusAnterior;
  const updateSet: Record<string, unknown> = { updatedAt: new Date() };

  switch (evento.evento as WebhookEventoTipo) {
    case "ORDER_STATUS_CHANGED": {
      const novo = payloadData.status
        ? mapearStatusApi(payloadData.status)
        : null;
      if (!novo) {
        // Status desconhecido — só registra como processado, sem mudança.
        break;
      }
      statusNovo = novo;
      updateSet.status = novo;
      if (deveSetarDataColeta(novo) && !lalamove.dataColeta) {
        updateSet.dataColeta = new Date();
      }
      if (deveSetarDataEntrega(novo) && !lalamove.dataEntrega) {
        updateSet.dataEntrega = new Date();
      }
      break;
    }
    case "DRIVER_ASSIGNED": {
      if (payloadData.driverId) updateSet.driverIdApi = payloadData.driverId;
      if (payloadData.driverName) updateSet.driverNome = payloadData.driverName;
      if (payloadData.driverPhone)
        updateSet.driverTelefone = payloadData.driverPhone;
      if (payloadData.driverPlateNumber)
        updateSet.driverPlaca = payloadData.driverPlateNumber;
      // Se estava em procurando_motorista, avança pra motorista_designado.
      if (statusAnterior === "procurando_motorista") {
        statusNovo = "motorista_designado";
        updateSet.status = statusNovo;
      }
      break;
    }
    case "OUTROS":
    default: {
      // Sem mudança no lalamove; só registra processado.
      break;
    }
  }

  // Só faz UPDATE se houve alguma mudança além do updatedAt
  const realmenteMudou = Object.keys(updateSet).length > 1;
  if (realmenteMudou) {
    await tx
      .update(confeccaoLalamove)
      .set(updateSet)
      .where(eq(confeccaoLalamove.id, lalamoveId));
  }

  // 5. Nota de auditoria — só quando houve mudança relevante
  const mudouStatus = statusNovo !== statusAnterior;
  if ((mudouStatus || evento.evento === "DRIVER_ASSIGNED") && lalamove.subtaskId) {
    const [subtask] = await tx
      .select({ ordemProducaoId: confeccaoSubtask.ordemProducaoId })
      .from(confeccaoSubtask)
      .where(eq(confeccaoSubtask.id, lalamove.subtaskId))
      .limit(1);
    if (subtask) {
      const conteudo = mudouStatus
        ? `Webhook Lalamove: status ${statusAnterior} → ${statusNovo} (orderId=${evento.orderIdApi}, evento=${evento.evento})`
        : `Webhook Lalamove: ${evento.evento} (driver=${payloadData.driverName ?? "?"})`;
      await tx.insert(confeccaoNota).values({
        id: generateId(),
        contaId: lalamove.contaId,
        ordemProducaoId: subtask.ordemProducaoId,
        subtaskId: lalamove.subtaskId,
        autorId: null, // sistema
        conteudo,
        isAuditoria: true,
        isInterna: true,
        metadata: {
          tipo: "lalamove_webhook",
          eventoId: evento.id,
          evento: evento.evento,
          statusAnterior,
          statusNovo,
          orderIdApi: evento.orderIdApi,
        },
      });
    }
  }

  // 6. Marca processado
  await tx
    .update(confeccaoLalamoveWebhookEvent)
    .set({ processado: true, processadoEm: new Date() })
    .where(eq(confeccaoLalamoveWebhookEvent.id, evento.id));

  return {
    status: "ok",
    statusAnterior,
    statusNovo,
  };
}
