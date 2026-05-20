// RITM-26 — services pra criar e cancelar pedidos via API Lalamove.
//
// criarOrderLalamove: chama POST /v3/orders com cotação válida + contatos.
// Se a cotação expirou (>5min), re-cota silenciosamente reaproveitando o
// mesmo lalamove + serviceType, e usa a nova quotationId.
//
// cancelarOrderLalamove: chama DELETE /v3/orders/{id}. Idempotente — chamar
// duas vezes não erra. Marca o lalamove interno como `cancelado` mesmo se
// a API Lalamove falhar (consistência local prevalece).

import { and, desc, eq } from "drizzle-orm";
import { generateId } from "@/lib/utils";
import { db } from "@/lib/db";
import {
  confeccaoLalamove,
  confeccaoLalamoveCotacao,
  confeccaoNota,
  confeccaoSubtask,
} from "@/lib/db/schema";
import { lalamoveFlagHabilitada } from "./config";
import {
  lalamoveRequest,
  LalamoveApiError,
  type LalamoveResponse,
} from "./client";
import { cotarLalamove, CotacaoError } from "./cotacao";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class CriarOrderError extends Error {
  constructor(
    public readonly code:
      | "feature_flag_off"
      | "lalamove_nao_encontrado"
      | "lalamove_estado_invalido"
      | "cotacao_ausente"
      | "contato_incompleto"
      | "api_erro",
    message: string,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CriarOrderError";
  }
}

export interface ContatoInput {
  nome: string;
  telefoneE164: string;
}

export interface CriarOrderInput {
  contaId: string;
  lalamoveId: string;
  criadaPorId: string;
  // Se passados, sobrescrevem o que está no lalamove. Caso contrário, usa
  // os campos contato_*_nome / contato_*_telefone do registro.
  contatoOrigem?: ContatoInput;
  contatoDestino?: ContatoInput;
  remarksDestino?: string;
  metadata?: Record<string, string>;
  httpRequest?: typeof lalamoveRequest;
}

export interface CriarOrderResult {
  orderIdApi: string;
  shareLink: string | null;
  status: string;
  priceBreakdown: Record<string, unknown> | null;
  novaCotacao?: { quotationIdApi: string; valorCotado: number };
}

interface OrderApiPayload {
  orderId: string;
  quotationId: string;
  status: string;
  shareLink?: string;
  priceBreakdown?: Record<string, unknown>;
  stops?: Array<{ stopId: string }>;
}

// Status de cotação que ainda permitem virar pedido. Cotações já consumidas
// não devem ser reaproveitadas.
const COTACAO_REAPROVEITAVEL = new Set(["valida", "expirada"]);

const E164_RE = /^\+\d{10,15}$/;

export async function criarOrderLalamove(
  tx: Tx,
  args: CriarOrderInput,
): Promise<CriarOrderResult> {
  if (!lalamoveFlagHabilitada()) {
    throw new CriarOrderError(
      "feature_flag_off",
      "Lalamove API desabilitada: LALAMOVE_FEATURE_FLAG=false ou env ausente",
    );
  }

  // 1. Lock no lalamove
  const [lalamove] = await tx
    .select()
    .from(confeccaoLalamove)
    .where(eq(confeccaoLalamove.id, args.lalamoveId))
    .for("update")
    .limit(1);

  if (!lalamove || lalamove.contaId !== args.contaId) {
    throw new CriarOrderError(
      "lalamove_nao_encontrado",
      "Lalamove não encontrado pra esta conta",
    );
  }
  if (lalamove.status !== "cotado") {
    throw new CriarOrderError(
      "lalamove_estado_invalido",
      `Lalamove em status '${lalamove.status}' — só permite criar pedido a partir de 'cotado'`,
    );
  }
  if (!lalamove.quotationIdApi) {
    throw new CriarOrderError(
      "cotacao_ausente",
      "Lalamove sem quotationIdApi — recote antes de criar pedido",
    );
  }

  // 2. Resolve contatos (override > registro)
  const contatoOrigem: ContatoInput = {
    nome: args.contatoOrigem?.nome ?? lalamove.contatoOrigemNome ?? "",
    telefoneE164:
      args.contatoOrigem?.telefoneE164 ?? lalamove.contatoOrigemTelefone ?? "",
  };
  const contatoDestino: ContatoInput = {
    nome: args.contatoDestino?.nome ?? lalamove.contatoDestinoNome ?? "",
    telefoneE164:
      args.contatoDestino?.telefoneE164 ??
      lalamove.contatoDestinoTelefone ??
      "",
  };

  validarContato(contatoOrigem, "origem");
  validarContato(contatoDestino, "destino");

  // 3. Recupera cotação correspondente; re-cota se expirou
  let [cotacao] = await tx
    .select()
    .from(confeccaoLalamoveCotacao)
    .where(
      and(
        eq(confeccaoLalamoveCotacao.lalamoveId, args.lalamoveId),
        eq(confeccaoLalamoveCotacao.quotationIdApi, lalamove.quotationIdApi),
      ),
    )
    .limit(1);

  if (!cotacao) {
    throw new CriarOrderError(
      "cotacao_ausente",
      "Registro de cotação não encontrado — re-cote antes",
    );
  }

  let novaCotacao: CriarOrderResult["novaCotacao"] | undefined;
  const agora = new Date();
  const expirou = cotacao.expiraEm.getTime() <= agora.getTime();
  if (expirou || !COTACAO_REAPROVEITAVEL.has(cotacao.status)) {
    // Marca a cotação anterior como expirada (se ainda não estava).
    if (cotacao.status === "valida") {
      await tx
        .update(confeccaoLalamoveCotacao)
        .set({ status: "expirada" })
        .where(eq(confeccaoLalamoveCotacao.id, cotacao.id));
    }

    // Re-cota silenciosamente reaproveitando serviceType + lalamove.
    if (!lalamove.serviceType) {
      throw new CriarOrderError(
        "cotacao_ausente",
        "Lalamove sem serviceType — recote manualmente antes",
      );
    }
    try {
      const nova = await cotarLalamove(tx, {
        contaId: args.contaId,
        lalamoveId: args.lalamoveId,
        criadaPorId: args.criadaPorId,
        serviceType: lalamove.serviceType,
        httpRequest: args.httpRequest,
      });
      novaCotacao = {
        quotationIdApi: nova.quotationIdApi,
        valorCotado: nova.valorCotado,
      };
    } catch (err) {
      if (err instanceof CotacaoError) {
        throw new CriarOrderError(
          "api_erro",
          `Falha ao re-cotar antes de criar pedido: ${err.message}`,
          { recotacaoError: err.code },
        );
      }
      throw err;
    }

    // Pega a cotação recém-criada
    [cotacao] = await tx
      .select()
      .from(confeccaoLalamoveCotacao)
      .where(
        eq(confeccaoLalamoveCotacao.quotationIdApi, novaCotacao!.quotationIdApi),
      )
      .limit(1);
  }

  // 4. Monta payload e chama POST /v3/orders
  const stops = cotacao.stopsApi as Array<{ stopId: string }>;
  if (!Array.isArray(stops) || stops.length < 2) {
    throw new CriarOrderError(
      "cotacao_ausente",
      "Cotação não tem stops suficientes — re-cote",
    );
  }
  const payload = {
    data: {
      quotationId: cotacao.quotationIdApi,
      sender: {
        stopId: stops[0].stopId,
        name: contatoOrigem.nome,
        phone: contatoOrigem.telefoneE164,
      },
      recipients: [
        {
          stopId: stops[1].stopId,
          name: contatoDestino.nome,
          phone: contatoDestino.telefoneE164,
          ...(args.remarksDestino ? { remarks: args.remarksDestino } : {}),
        },
      ],
      isPODEnabled: false,
      isRecipientSMSEnabled: true,
      ...(args.metadata ? { metadata: args.metadata } : {}),
    },
  };

  const httpRequest = args.httpRequest ?? lalamoveRequest;
  let response: LalamoveResponse<OrderApiPayload>;
  try {
    response = await httpRequest<OrderApiPayload>({
      method: "POST",
      path: "/v3/orders",
      body: payload,
    });
  } catch (err) {
    if (err instanceof LalamoveApiError) {
      throw new CriarOrderError(
        "api_erro",
        `Lalamove API retornou erro ${err.status}: ${err.message}`,
        { status: err.status, errorId: err.errorId, requestId: err.requestId },
      );
    }
    throw err;
  }

  // 5. Persiste no lalamove + atualiza cotação
  const shareLink = response.data.shareLink ?? null;
  const priceBreakdown =
    response.data.priceBreakdown ??
    (cotacao.responsePayload as Record<string, unknown> | null);

  await tx
    .update(confeccaoLalamove)
    .set({
      status: "procurando_motorista",
      orderIdApi: response.data.orderId,
      shareLink,
      priceBreakdown: priceBreakdown as Record<string, unknown>,
      contatoOrigemNome: contatoOrigem.nome,
      contatoOrigemTelefone: contatoOrigem.telefoneE164,
      contatoDestinoNome: contatoDestino.nome,
      contatoDestinoTelefone: contatoDestino.telefoneE164,
      remarksDestino: args.remarksDestino ?? lalamove.remarksDestino,
      updatedAt: new Date(),
    })
    .where(eq(confeccaoLalamove.id, args.lalamoveId));

  await tx
    .update(confeccaoLalamoveCotacao)
    .set({ status: "convertida_em_pedido" })
    .where(eq(confeccaoLalamoveCotacao.id, cotacao.id));

  // 6. Nota de auditoria
  if (lalamove.subtaskId) {
    const [subtask] = await tx
      .select({ ordemProducaoId: confeccaoSubtask.ordemProducaoId })
      .from(confeccaoSubtask)
      .where(eq(confeccaoSubtask.id, lalamove.subtaskId))
      .limit(1);

    if (subtask) {
      await tx.insert(confeccaoNota).values({
        id: generateId(),
        contaId: args.contaId,
        ordemProducaoId: subtask.ordemProducaoId,
        subtaskId: lalamove.subtaskId,
        autorId: args.criadaPorId,
        conteudo:
          `Pedido Lalamove criado via API: orderId=${response.data.orderId} • ` +
          `quotationId=${cotacao.quotationIdApi} • requestId=${response.meta.requestId}` +
          (novaCotacao
            ? ` • cotação re-emitida silenciosamente (R$ ${novaCotacao.valorCotado.toFixed(2)})`
            : ""),
        isAuditoria: true,
        isInterna: true,
        metadata: {
          tipo: "lalamove_order_criado",
          lalamoveId: args.lalamoveId,
          orderIdApi: response.data.orderId,
          quotationIdApi: cotacao.quotationIdApi,
          requestId: response.meta.requestId,
          recotacao: Boolean(novaCotacao),
        },
      });
    }
  }

  return {
    orderIdApi: response.data.orderId,
    shareLink,
    status: response.data.status,
    priceBreakdown,
    novaCotacao,
  };
}

function validarContato(c: ContatoInput, qual: "origem" | "destino"): void {
  if (!c.nome || c.nome.trim().length === 0) {
    throw new CriarOrderError(
      "contato_incompleto",
      `Contato de ${qual}: nome é obrigatório`,
    );
  }
  if (!c.telefoneE164 || !E164_RE.test(c.telefoneE164)) {
    throw new CriarOrderError(
      "contato_incompleto",
      `Contato de ${qual}: telefone precisa estar em formato E.164 (ex: +5511999999999)`,
    );
  }
}

// ──────────────────────────────────────────────────────────────────────────

export class CancelarOrderError extends Error {
  constructor(
    public readonly code:
      | "feature_flag_off"
      | "lalamove_nao_encontrado",
    message: string,
  ) {
    super(message);
    this.name = "CancelarOrderError";
  }
}

export interface CancelarOrderInput {
  contaId: string;
  lalamoveId: string;
  canceladaPorId: string | null; // null = automático/cascata
  motivo: string;
  httpRequest?: typeof lalamoveRequest;
}

export interface CancelarOrderResult {
  cancelado: boolean;
  motivo: "api_ok" | "api_falhou" | "sem_order_id" | "status_nao_cancelavel";
  requestIdApi?: string | null;
}

const STATUS_API_CANCELAVEL = new Set([
  "cotado",
  "procurando_motorista",
  "motorista_designado",
  "a_caminho_coleta",
]);

export async function cancelarOrderLalamove(
  tx: Tx,
  args: CancelarOrderInput,
): Promise<CancelarOrderResult> {
  if (!lalamoveFlagHabilitada()) {
    throw new CancelarOrderError(
      "feature_flag_off",
      "Lalamove API desabilitada",
    );
  }

  const [lalamove] = await tx
    .select()
    .from(confeccaoLalamove)
    .where(eq(confeccaoLalamove.id, args.lalamoveId))
    .for("update")
    .limit(1);

  if (!lalamove || lalamove.contaId !== args.contaId) {
    throw new CancelarOrderError(
      "lalamove_nao_encontrado",
      "Lalamove não encontrado",
    );
  }

  if (!lalamove.orderIdApi) {
    return { cancelado: false, motivo: "sem_order_id" };
  }
  if (!STATUS_API_CANCELAVEL.has(lalamove.status)) {
    return { cancelado: false, motivo: "status_nao_cancelavel" };
  }

  // Chama DELETE — sucesso E erros 404 contam como ok (idempotência).
  const httpRequest = args.httpRequest ?? lalamoveRequest;
  let requestIdApi: string | null = null;
  let apiOk = true;
  let apiErrorMsg: string | null = null;
  try {
    const res = await httpRequest<unknown>({
      method: "DELETE",
      path: `/v3/orders/${lalamove.orderIdApi}`,
    });
    requestIdApi = res.meta?.requestId ?? null;
  } catch (err) {
    if (err instanceof LalamoveApiError) {
      requestIdApi = err.requestId;
      if (err.status === 404) {
        // Idempotente — pedido já cancelado/purgado.
        apiOk = true;
      } else {
        apiOk = false;
        apiErrorMsg = err.message;
      }
    } else {
      apiOk = false;
      apiErrorMsg = err instanceof Error ? err.message : String(err);
    }
  }

  // Marca interno como cancelado MESMO em falha de API.
  const agora = new Date();
  await tx
    .update(confeccaoLalamove)
    .set({
      status: "cancelado",
      canceladaEm: agora,
      canceladaPorId: args.canceladaPorId,
      cancelamentoMotivo: args.motivo,
      updatedAt: agora,
    })
    .where(eq(confeccaoLalamove.id, args.lalamoveId));

  // Auditoria
  if (lalamove.subtaskId) {
    const [subtask] = await tx
      .select({ ordemProducaoId: confeccaoSubtask.ordemProducaoId })
      .from(confeccaoSubtask)
      .where(eq(confeccaoSubtask.id, lalamove.subtaskId))
      .limit(1);
    if (subtask) {
      const conteudo = apiOk
        ? `Pedido Lalamove cancelado via API: orderId=${lalamove.orderIdApi} • requestId=${requestIdApi ?? "?"} • motivo: ${args.motivo}`
        : `Pedido Lalamove cancelado internamente, mas falha na API: orderId=${lalamove.orderIdApi} • requestId=${requestIdApi ?? "?"} • erro: ${apiErrorMsg} • motivo: ${args.motivo}`;
      await tx.insert(confeccaoNota).values({
        id: generateId(),
        contaId: args.contaId,
        ordemProducaoId: subtask.ordemProducaoId,
        subtaskId: lalamove.subtaskId,
        autorId: args.canceladaPorId,
        conteudo,
        isAuditoria: true,
        isInterna: true,
        metadata: {
          tipo: "lalamove_order_cancelado",
          lalamoveId: args.lalamoveId,
          orderIdApi: lalamove.orderIdApi,
          apiOk,
          requestId: requestIdApi,
          motivo: args.motivo,
        },
      });
    }
  }

  // Re-busca o mais recente pra retornar — útil pra UI
  void desc; // silence

  return {
    cancelado: true,
    motivo: apiOk ? "api_ok" : "api_falhou",
    requestIdApi,
  };
}
