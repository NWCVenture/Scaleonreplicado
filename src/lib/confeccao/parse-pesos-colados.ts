// Parser de coluna de pesos copiada do Excel (RITM-30).
//
// Extraído de subtask-compra.tsx pra ficar testável sem montar o
// componente. A UI re-exporta `parsePesosColados` daqui.

/**
 * Split por `\r\n`, `\n` ou `\t`. Trim cada token, ignora vazios.
 * Converte com `Number(tok.replace(",", "."))` — aceita vírgula
 * brasileira. Filtra NaN, negativos e não-finitos.
 *
 * Devolve array (pode ter length 0). Caller decide o que fazer
 * com length === 1 (UI: deixa o paste default acontecer).
 */
export function parsePesosColados(texto: string): number[] {
  if (!texto) return [];
  return texto
    .split(/[\r\n\t]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => Number(t.replace(",", ".")))
    .filter((n) => Number.isFinite(n) && n >= 0);
}
