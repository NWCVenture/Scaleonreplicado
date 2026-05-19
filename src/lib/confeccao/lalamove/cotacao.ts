// RITM-25 — service `cotarLalamove`: cota um envio via POST /v3/quotations,
// grava a cotação no banco, atualiza o lalamove pra status='cotado' e
// registra nota de auditoria com o requestId.
//
// Operador ainda cria o pedido manualmente na app oficial — esta RITM
// é só "estimativa assistida". Conversão pra order via API é RITM-26.

import { eq } from "drizzle-orm";
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
import { getCitiesCache, validateServiceType } from "./cities";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const COTACAO_TTL_MIN = 5;

export class CotacaoError extends Error {
  constructor(
    public readonly code:
      | "feature_flag_off"
      | "lalamove_nao_encontrado"
      | "lalamove_estado_invalido"
      | "endereco_sem_coordenadas"
      | "service_type_invalido"
      | "api_erro",
    message: string,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CotacaoError";
  }
}

export interface CotarInput {
  contaId: string;
  lalamoveId: string;
  criadaPorId: string;
  serviceType: string;
  cityLocode?: string; // pra validar serviceType contra /v3/cities; opcional
  language?: string; // default pt_BR
  item?: {
    quantity?: string;
    weight?: "LESS_THAN_3_KG" | "3_KG_TO_10_KG" | "MORE_THAN_10_KG";
    categories?: string[];
  };
  // Injetável pra testes:
  httpRequest?: typeof lalamoveRequest;
}

export interface CotarResult {
  cotacaoId: string;
  quotationIdApi: string;
  valorCotado: number;
  moeda: string;
  expiraEm: Date;
  distanciaMetros: number | null;
}

// Estados em que cotar/re-cotar faz sentido. Demais bloqueiam.
const ESTADOS_VALIDOS_PRA_COTAR = new Set([
  "rascunho",
  "cotado",
  "expirado",
  "rejeitado",
]);

// Estrutura da resposta de POST /v3/quotations (campos consumidos).
interface QuotationApiPayload {
  quotationId: string;
  expiresAt: string;
  serviceType: string;
  language: string;
  specialRequests?: string[];
  stops: Array<{
    stopId: string;
    coordinates: { lat: string; lng: string };
    address: string;
  }>;
  priceBreakdown: {
    total: string;
    currency: string;
  };
  distance?: { value: string; unit: string };
}

export async function cotarLalamove(
  tx: Tx,
  args: CotarInput,
): Promise<CotarResult> {
  if (!lalamoveFlagHabilitada()) {
    throw new CotacaoError(
      "feature_flag_off",
      "Lalamove API desabilitada: LALAMOVE_FEATURE_FLAG=false ou env ausente",
    );
  }

  // 1. Carrega lalamove com lock pra evitar cotações concorrentes do mesmo
  //    operador clicando rápido. RLS já filtra por contaId.
  const [lalamove] = await tx
    .select()
    .from(confeccaoLalamove)
    .where(eq(confeccaoLalamove.id, args.lalamoveId))
    .for("update")
    .limit(1);

  if (!lalamove || lalamove.contaId !== args.contaId) {
    throw new CotacaoError(
      "lalamove_nao_encontrado",
      "Lalamove não encontrado pra esta conta",
    );
  }

  if (!ESTADOS_VALIDOS_PRA_COTAR.has(lalamove.status)) {
    throw new CotacaoError(
      "lalamove_estado_invalido",
      `Lalamove em status '${lalamove.status}' — só permite cotar quando ` +
        `rascunho, cotado, expirado ou rejeitado`,
    );
  }

  if (!lalamove.origemLat || !lalamove.origemLng) {
    throw new CotacaoError(
      "endereco_sem_coordenadas",
      "Origem sem latitude/longitude — preencher cadastro do fornecedor primeiro",
    );
  }
  if (!lalamove.destinoLat || !lalamove.destinoLng) {
    throw new CotacaoError(
      "endereco_sem_coordenadas",
      "Destino sem latitude/longitude — preencher cadastro do fornecedor primeiro",
    );
  }

  // 2. Valida serviceType contra cache de cidades (best-effort: se a API
  //    de cidades falhar, segue tentando — a Lalamove devolve 400 com
  //    `ERR_INVALID_FIELD` se for inválido mesmo).
  if (args.cityLocode) {
    try {
      const { cities } = await getCitiesCache();
      const check = validateServiceType({
        cityLocode: args.cityLocode,
        serviceType: args.serviceType,
        cities,
      });
      if (!check.valid) {
        throw new CotacaoError(
          "service_type_invalido",
          `serviceType '${args.serviceType}' não disponível em ${args.cityLocode}. ` +
            `Disponíveis: ${check.available.join(", ") || "(nenhum)"}`,
        );
      }
    } catch (err) {
      if (err instanceof CotacaoError) throw err;
      // erro de rede no cities — não bloqueia, deixa a Lalamove decidir.
    }
  }

  // 3. Monta payload e chama a API.
  const enderecoOrigemTexto = enderecoToText(lalamove.origemEndereco);
  const enderecoDestinoTexto = enderecoToText(lalamove.destinoEndereco);
  const payload = {
    data: {
      serviceType: args.serviceType,
      specialRequests: [],
      language: args.language ?? "pt_BR",
      stops: [
        {
          coordinates: { lat: lalamove.origemLat, lng: lalamove.origemLng },
          address: enderecoOrigemTexto,
        },
        {
          coordinates: { lat: lalamove.destinoLat, lng: lalamove.destinoLng },
          address: enderecoDestinoTexto,
        },
      ],
      item: {
        quantity: args.item?.quantity ?? "1",
        weight: args.item?.weight ?? "LESS_THAN_3_KG",
        categories: args.item?.categories ?? ["GENERAL_CARGO"],
      },
      isRouteOptimized: false,
    },
  };

  const httpRequest = args.httpRequest ?? lalamoveRequest;
  let response: LalamoveResponse<QuotationApiPayload>;
  try {
    response = await httpRequest<QuotationApiPayload>({
      method: "POST",
      path: "/v3/quotations",
      body: payload,
    });
  } catch (err) {
    if (err instanceof LalamoveApiError) {
      throw new CotacaoError(
        "api_erro",
        `Lalamove API retornou erro ${err.status}: ${err.message}`,
        { status: err.status, errorId: err.errorId, requestId: err.requestId },
      );
    }
    throw err;
  }

  // 4. Persiste cotação + atualiza lalamove + nota de auditoria.
  const cotacaoId = generateId();
  const valorCotado = Number(response.data.priceBreakdown.total);
  const moeda = response.data.priceBreakdown.currency;
  const expiraEm = new Date(Date.now() + COTACAO_TTL_MIN * 60 * 1000);
  const distanciaMetros = response.data.distance
    ? Number(response.data.distance.value)
    : null;

  await tx.insert(confeccaoLalamoveCotacao).values({
    id: cotacaoId,
    contaId: args.contaId,
    lalamoveId: args.lalamoveId,
    quotationIdApi: response.data.quotationId,
    status: "valida",
    valorCotado,
    moeda,
    distanciaMetros,
    serviceType: response.data.serviceType,
    stopsApi: response.data.stops as unknown as Array<
      Record<string, unknown>
    >,
    requestPayload: payload as unknown as Record<string, unknown>,
    responsePayload: response as unknown as Record<string, unknown>,
    expiraEm,
    criadaPorId: args.criadaPorId,
  });

  await tx
    .update(confeccaoLalamove)
    .set({
      status: "cotado",
      origemSolicitacao: "api",
      serviceType: response.data.serviceType,
      quotationIdApi: response.data.quotationId,
      distanciaMetros,
      priceBreakdown: response.data.priceBreakdown as unknown as Record<
        string,
        unknown
      >,
      valor: valorCotado,
      moeda,
      updatedAt: new Date(),
    })
    .where(eq(confeccaoLalamove.id, args.lalamoveId));

  // Nota de auditoria — anexa à subtask se houver, senão à OP da retirada
  // (futuramente). Por simplicidade, registra apenas quando há subtaskId.
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
          `Cotação Lalamove criada via API: ` +
          `R$ ${valorCotado.toFixed(2)} • ${response.data.serviceType} • ` +
          `quotationId=${response.data.quotationId} • ` +
          `requestId=${response.meta.requestId}`,
        isAuditoria: true,
        isInterna: true,
        metadata: {
          tipo: "lalamove_cotacao_criada",
          lalamoveId: args.lalamoveId,
          quotationIdApi: response.data.quotationId,
          valorCotado,
          requestId: response.meta.requestId,
        },
      });
    }
  }

  return {
    cotacaoId,
    quotationIdApi: response.data.quotationId,
    valorCotado,
    moeda,
    expiraEm,
    distanciaMetros,
  };
}

function enderecoToText(endereco: Record<string, string | null>): string {
  // Formato simples — vai pro driver, então humano-legível.
  // Campos esperados (RITM-03): rua, numero, bairro, cep, cidade, estado,
  // complemento (opcional). Fallback robusto se algum estiver ausente.
  const partes = [
    endereco.rua,
    endereco.numero ? `, ${endereco.numero}` : null,
    endereco.complemento ? ` - ${endereco.complemento}` : null,
    endereco.bairro ? ` - ${endereco.bairro}` : null,
    endereco.cidade ? `, ${endereco.cidade}` : null,
    endereco.estado ? `/${endereco.estado}` : null,
    endereco.cep ? `, ${endereco.cep}` : null,
  ];
  const texto = partes.filter(Boolean).join("");
  return texto || "Endereço não cadastrado";
}
