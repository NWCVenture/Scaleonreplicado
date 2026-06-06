// Tipos públicos do cálculo de prazo.
//
// Convenção: datas civis em formato 'YYYY-MM-DD' (sem hora) referem-se
// a America/Sao_Paulo (UTC-3 fixo). ISO UTC só pra timestamps (entrada).

import type { PlataformaCanal } from "@/lib/db/schema";

export type StatusPrazo = "CALCULADO" | "HOJE" | "SEM_DATA";

export type OrigemPrazo =
  | "campo_explicito"
  | "dias_uteis_pos_venda"
  | "fallback_hoje";

export type EstrategiaPrazo =
  | "DIAS_UTEIS_POS_VENDA"
  | "CAMPO_EXPLICITO"
  | "HIBRIDO";

export type EntradaCalculoPrazo = {
  plataforma: PlataformaCanal;
  canalVendaId: string | null;
  criadoEmIso: string | null;
  // Mapa key→value pra CAMPO_EXPLICITO. Key tipicamente vem de
  // regra.campoPrazo (ex.: 'Estado'); value é o texto raw do pedido.
  camposExtras: Record<string, string | null>;
};

export type ResultadoCalculoPrazo = {
  status: StatusPrazo;
  prazoIso: string | null; // 'YYYY-MM-DD' (data civil SP)
  origem: OrigemPrazo | null;
  detalhes: string;
};

export type RegraPrazoSnapshot = {
  id: string;
  plataforma: PlataformaCanal;
  canalVendaId: string | null;
  estrategia: EstrategiaPrazo;
  diasUteis: number | null;
  campoPrazo: string | null;
  regexPrazo: string | null;
  fallbackHoje: boolean;
  ativo: boolean;
};

export type ContextoPrazo = {
  regrasPorCanal: Map<string, RegraPrazoSnapshot>;
  regrasDefaultPorPlataforma: Map<PlataformaCanal, RegraPrazoSnapshot>;
  feriadosSet: Set<string>;
  hojeIso: string;
};

export function chaveRegraCanal(
  plataforma: PlataformaCanal,
  canalVendaId: string,
): string {
  return `${plataforma}::${canalVendaId}`;
}
