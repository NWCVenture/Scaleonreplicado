// Builder do ContextoClassificacao (RITM-17).
//
// Responsabilidades:
//   - derivar indexPorTracking a partir de `sessao.dados`
//   - derivar trackingsCancelados a partir do mesmo (filtrando orderStatus)
//   - buscar jaBipadosNaSessao via SELECT na tabela
//   - buscar patternsCarrier da config da conta
//
// Não chama o classificador — só prepara o input.

import { and, eq, inArray, isNotNull } from "drizzle-orm";
import {
  centralEnviosBipagemPacote,
  transportadoraPadrao,
} from "@/lib/db/schema";
import type { CentralEnviosBipagemCategoria } from "@/lib/db/schema";
import type { CarrierPattern } from "@/types/coletas";
import type { PedidoEnriquecido } from "@/lib/central-envios/sessao/types";
import type { ContextoClassificacao } from "./types";

type Tx = Parameters<
  Parameters<typeof import("@/lib/db").db.transaction>[0]
>[0];

// orderStatus / camposExtras que disparam "tracking cancelado".
// v1 hardcoded — futuro: vira config de conta (RITM-10).
export const ORDER_STATUS_CANCELADOS: ReadonlySet<string> = new Set([
  "Cancelado",
  "Cancelled",
  "Em devolução",
  "Reembolsado",
]);

/**
 * Decide se um pedido está em estado cancelado a partir do snapshot
 * atual de `camposExtras` (o composer atualiza esse campo em re-upload
 * — RITM-15b).
 */
export function pedidoEstaCancelado(pedido: PedidoEnriquecido): boolean {
  const status = pedido.camposExtras.orderStatus ?? "";
  return ORDER_STATUS_CANCELADOS.has(status);
}

// Categorias que contam como "tracking já bipado" pra dedup intra-sessão.
// FORA_LOTE / DESCONHECIDA / LOCALIZADOR_LIVRE não contam — operador
// pode tentar de novo se foi erro de scan.
const CATEGORIAS_QUE_OCUPAM: CentralEnviosBipagemCategoria[] = [
  "OK",
  "CANCELADO_RETIRADO",
  "CANCELADO_ENVIADO_MESMO_ASSIM",
  "LOCALIZADOR_ACHADO",
];

/**
 * Monta o ContextoClassificacao pra um POST de bipagem.
 *
 * Espera ser chamado dentro de `withConta`/`withContaAtiva` (RLS já setado).
 */
export async function montarContextoClassificacao(args: {
  tx: Tx;
  contaId: string;
  sessaoId: string;
  dados: PedidoEnriquecido[];
}): Promise<ContextoClassificacao> {
  const { tx, contaId, sessaoId, dados } = args;

  const indexPorTracking = new Map<string, PedidoEnriquecido>();
  const trackingsCancelados = new Set<string>();
  for (const p of dados) {
    if (!p.trackingId) continue;
    indexPorTracking.set(p.trackingId, p);
    if (pedidoEstaCancelado(p)) trackingsCancelados.add(p.trackingId);
  }

  // jaBipadosNaSessao: query indexada por (sessao_id, categoria).
  const bipados = await tx
    .select({ trackingId: centralEnviosBipagemPacote.trackingId })
    .from(centralEnviosBipagemPacote)
    .where(
      and(
        eq(centralEnviosBipagemPacote.sessaoId, sessaoId),
        isNotNull(centralEnviosBipagemPacote.trackingId),
        inArray(centralEnviosBipagemPacote.categoria, CATEGORIAS_QUE_OCUPAM),
      ),
    );
  const jaBipadosNaSessao = new Set<string>();
  for (const row of bipados) {
    if (row.trackingId) jaBipadosNaSessao.add(row.trackingId);
  }

  // patternsCarrier: config da conta. Query simples — quantidade
  // pequena (1-2 dezenas).
  const carriers = await tx
    .select()
    .from(transportadoraPadrao)
    .where(eq(transportadoraPadrao.contaId, contaId));
  const patternsCarrier: CarrierPattern[] = carriers.map((c) => ({
    id: c.id,
    transportadora: c.transportadora,
    prefixos: c.prefixos ?? [],
  }));

  return {
    indexPorTracking,
    trackingsCancelados,
    jaBipadosNaSessao,
    patternsCarrier,
  };
}
