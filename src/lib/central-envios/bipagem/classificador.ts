// Classificador puro de bipagem (RITM-16).
//
// Função pura, sem I/O, determinística. Reaproveita extração e detecção
// de carrier do módulo Coletas (mesmo regex pra ML/Shopee/TikTok já
// estável há tempos).
//
// Precedência no modo normal:
//   DUPLICADO > CANCELADO > FORA_LOTE > OK
//   DESCONHECIDA é avaliada antes (falta de ID extraível).
//
// Modo rastreador é independente: só checa se o ID está em
// `pendentesLocalizar`. Sem precedência com modo normal.

import { detectCarrier, extractShippingIds } from "@/lib/coletas-utils";
import type {
  ContextoClassificacao,
  ResultadoClassificacao,
  ResultadoRastreador,
} from "./types";

/**
 * Classifica um bipe no modo normal de bipagem.
 *
 * Devolve LISTA porque um texto pode conter múltiplos IDs (raríssimo —
 * mas etiquetas duplas existem). Caller itera e decide o que fazer com
 * cada (modal cancelado bloqueia no primeiro `bloqueante: true`).
 *
 * @param codigoBipado Texto cru direto do scanner (ou textarea).
 * @param ctx Contexto montado pelo caller a partir do estado da sessão.
 */
export function classificarBipe(
  codigoBipado: string,
  ctx: ContextoClassificacao,
): ResultadoClassificacao[] {
  const ids = extractShippingIds(codigoBipado);
  if (ids.length === 0) {
    return [
      {
        categoria: "DESCONHECIDA",
        codigoBipado,
        trackingId: null,
        orderId: null,
        pedido: null,
        transportadora: "DESCONHECIDA",
        bloqueante: false,
      },
    ];
  }
  return ids.map((id) => classificarUmId(id, codigoBipado, ctx));
}

function classificarUmId(
  trackingId: string,
  codigoBipado: string,
  ctx: ContextoClassificacao,
): ResultadoClassificacao {
  const transportadora = detectCarrier(trackingId, ctx.patternsCarrier);
  const pedido = ctx.indexPorTracking.get(trackingId) ?? null;

  // Precedência 1: DUPLICADO. Mesmo se o pedido agora aparece cancelado,
  // o operador já lidou com esse tracking antes — não reabrir modal.
  if (ctx.jaBipadosNaSessao.has(trackingId)) {
    return {
      categoria: "DUPLICADO",
      codigoBipado,
      trackingId,
      orderId: pedido?.orderId ?? null,
      pedido,
      transportadora,
      bloqueante: false,
    };
  }

  // Precedência 2: FORA_LOTE quando não há pedido no índice. Mesmo se
  // a categoria correta no futuro for OK, hoje (com esse snapshot) é
  // avulso. Operador resolve com re-upload do CSV.
  if (!pedido) {
    return {
      categoria: "FORA_LOTE",
      codigoBipado,
      trackingId,
      orderId: null,
      pedido: null,
      transportadora,
      bloqueante: false,
    };
  }

  // Precedência 3: CANCELADO — abre modal bloqueante.
  if (ctx.trackingsCancelados.has(trackingId)) {
    return {
      categoria: "CANCELADO",
      codigoBipado,
      trackingId,
      orderId: pedido.orderId,
      pedido,
      transportadora,
      bloqueante: true,
    };
  }

  // Resto: OK.
  return {
    categoria: "OK",
    codigoBipado,
    trackingId,
    orderId: pedido.orderId,
    pedido,
    transportadora,
    bloqueante: false,
  };
}

/**
 * Classifica um bipe no modo Rastreador de Cancelados.
 *
 * Só dois resultados: o ID está na lista de cancelados a localizar
 * (LOCALIZADOR_ACHADO — alerta forte e remove da lista) ou não está
 * (LOCALIZADOR_LIVRE — pacote pode seguir). Modo rastreador não bipa
 * pra "preparado": é só pra achar pacote físico na pilha.
 *
 * @param pendentesLocalizar Subconjunto de `trackingsCancelados` que
 *   ainda não foi encontrado pelo operador. Caller atualiza após cada
 *   LOCALIZADOR_ACHADO bem-sucedido.
 */
export function classificarBipeRastreador(
  codigoBipado: string,
  ctx: ContextoClassificacao,
  pendentesLocalizar: Set<string>,
): ResultadoRastreador[] {
  const ids = extractShippingIds(codigoBipado);
  if (ids.length === 0) {
    return [
      {
        categoria: "LOCALIZADOR_LIVRE",
        codigoBipado,
        trackingId: null,
        pedido: null,
        transportadora: "DESCONHECIDA",
      },
    ];
  }
  return ids.map((trackingId) => {
    const transportadora = detectCarrier(trackingId, ctx.patternsCarrier);
    const pedido = ctx.indexPorTracking.get(trackingId) ?? null;
    const categoria = pendentesLocalizar.has(trackingId)
      ? "LOCALIZADOR_ACHADO"
      : "LOCALIZADOR_LIVRE";
    return {
      categoria,
      codigoBipado,
      trackingId,
      pedido,
      transportadora,
    };
  });
}
