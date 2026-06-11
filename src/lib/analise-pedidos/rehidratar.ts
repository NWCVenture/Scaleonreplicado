// Rehidrata payload do analise_pedidos_import (singleton por conta) de volta pro
// formato in-memory que `agrupar()` e os consumidores esperam. As linhas em
// JSONB têm `dataPedido` como ISO string — aqui voltam a Date.

import type { LinhaPedido } from "./parser";

export function rehidratarLinhas(raw: unknown[]): LinhaPedido[] {
  const linhas: LinhaPedido[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const dataStr = r.dataPedido;
    const data =
      dataStr instanceof Date
        ? dataStr
        : typeof dataStr === "string"
          ? new Date(dataStr)
          : null;
    if (!data || isNaN(data.getTime())) continue;
    linhas.push({
      numeroPedido: String(r.numeroPedido ?? ""),
      plataforma: (r.plataforma as string | null) ?? null,
      loja: (r.loja as string | null) ?? null,
      estado: String(r.estado ?? ""),
      dataPedido: data,
      sku: String(r.sku ?? ""),
      nomeAnuncio: String(r.nomeAnuncio ?? ""),
      variacaoOriginal: String(r.variacaoOriginal ?? ""),
      tamanho: (r.tamanho as string | null) ?? null,
      cores: Array.isArray(r.cores)
        ? (r.cores as { nome: string; qtd: number }[])
        : [],
      qtdProduto: Number(r.qtdProduto ?? 1),
      precoProduto: (r.precoProduto as number | null) ?? null,
    });
  }
  return linhas;
}
