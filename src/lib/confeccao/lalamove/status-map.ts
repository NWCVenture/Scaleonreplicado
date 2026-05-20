// RITM-27 — mapeamento API Lalamove → status interno do módulo Confecção.
// Referência: arquitetura §14.5.

import type { confeccaoLalamoveStatusEnum } from "@/lib/db/schema";

export type LalamoveStatusInterno =
  (typeof confeccaoLalamoveStatusEnum.enumValues)[number];

// Map oficial. Status que não aparecem como chave aqui caem em
// `mapearStatusApi` retornando null → processador trata como noop.
const API_TO_INTERNO: Record<string, LalamoveStatusInterno> = {
  ASSIGNING_DRIVER: "procurando_motorista",
  ON_GOING: "motorista_designado",
  PICKED_UP: "coletado",
  COMPLETED: "entregue",
  CANCELED: "cancelado",
  REJECTED: "rejeitado",
  EXPIRED: "expirado",
};

export function mapearStatusApi(
  statusApi: string,
): LalamoveStatusInterno | null {
  return API_TO_INTERNO[statusApi] ?? null;
}

// Helpers pra preencher timestamps no UPDATE do lalamove
export function deveSetarDataColeta(novo: LalamoveStatusInterno): boolean {
  return novo === "coletado";
}
export function deveSetarDataEntrega(novo: LalamoveStatusInterno): boolean {
  return novo === "entregue";
}

// Indica se o status interno é "ativo" (lalamove em andamento) — usado
// pelo polling fallback pra filtrar quais re-sincronizar.
const STATUS_ATIVOS = new Set<LalamoveStatusInterno>([
  "procurando_motorista",
  "motorista_designado",
  "a_caminho_coleta",
  "coletado",
]);

export function statusAtivo(s: LalamoveStatusInterno): boolean {
  return STATUS_ATIVOS.has(s);
}
