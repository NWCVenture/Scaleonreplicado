// Tipos do classificador de bipagem da Central de Envios (RITM-16).
//
// Categorias persistem em `central_envios_bipagem_pacote.categoria`
// (enum criado no RITM-15). Aqui são strings literais — o caller (RITM-17)
// converte pra `CentralEnviosBipagemCategoria` no momento do INSERT.
//
// O classificador é PURO — nenhum I/O acontece aqui. Contexto vem
// pré-construído pelo caller a partir do estado da sessão.

import type { TransportadoraLabel } from "@/lib/db/schema";
import type { CarrierPattern } from "@/types/coletas";
import type { PedidoEnriquecido } from "@/lib/central-envios/sessao/types";

export type CategoriaBipe =
  | "OK"
  | "DUPLICADO"
  | "CANCELADO"
  | "FORA_LOTE"
  | "DESCONHECIDA";

export type CategoriaRastreador = "LOCALIZADOR_ACHADO" | "LOCALIZADOR_LIVRE";

export type ContextoClassificacao = {
  // Lookup tracking → pedido. Caller monta a partir de `sessao.dados`
  // filtrando entradas com `trackingId != null`.
  indexPorTracking: Map<string, PedidoEnriquecido>;
  // Subconjunto de trackings cujo pedido está em estado cancelado.
  // Caller decide o critério (orderStatus contém "Cancelado", "Em
  // devolução", "Reembolsado" — ver RITM-17 para a regra final).
  trackingsCancelados: Set<string>;
  // Trackings já bipados com categoria OK ou CANCELADO_* nessa sessão.
  // Caller atualiza após cada INSERT bem-sucedido. NÃO inclui
  // FORA_LOTE/DESCONHECIDA (esses podem ser bipados novamente sem
  // virar DUPLICADO — provavelmente foi erro de scan).
  jaBipadosNaSessao: Set<string>;
  // Padrões de prefixo de transportadora — ver `detectCarrier`.
  patternsCarrier: CarrierPattern[];
};

export type ResultadoClassificacao = {
  categoria: CategoriaBipe;
  // Texto cru bipado (antes da extração). Persistido em
  // `central_envios_bipagem_pacote.codigo_bipado` para auditoria.
  codigoBipado: string;
  // ID extraído pelo regex. null quando categoria=DESCONHECIDA.
  trackingId: string | null;
  // ID do pedido pareado (se houver match no índice).
  orderId: string | null;
  // Pedido completo pra UI mostrar contexto (cliente, SKU etc).
  // null em FORA_LOTE/DESCONHECIDA/DUPLICADO sem match.
  pedido: PedidoEnriquecido | null;
  // Carrier identificada pelo prefixo (independente da categoria).
  transportadora: TransportadoraLabel;
  // true apenas em CANCELADO — caller deve parar e mostrar modal.
  bloqueante: boolean;
};

export type ResultadoRastreador = {
  categoria: CategoriaRastreador;
  codigoBipado: string;
  trackingId: string | null;
  pedido: PedidoEnriquecido | null;
  transportadora: TransportadoraLabel;
};
