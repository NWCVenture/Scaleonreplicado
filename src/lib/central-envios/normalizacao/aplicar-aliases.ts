// Pré-processamento de texto antes da tokenização.
//
// Etapas:
//   1. Trim + uppercase
//   2. Aplica aliases globais (cor + tamanho) como text replace com
//      word-boundary
//
// Aliases por modelo são aplicados depois — token-a-token, na função
// `resolverTokenPorModelo` em `parsear-sku.ts`. Isso é necessário
// porque a aplicação por-modelo só faz sentido depois de identificar
// o modelo.

import type { ContextoCadastro } from "./types";

/** Trim + uppercase. Estável; usar antes de aplicar aliases. */
export function normalizarCaixa(input: string): string {
  return input.trim().toUpperCase();
}

/**
 * Aplica aliases globais ao texto. Replace com word-boundary pra evitar
 * pegar substring acidental (ex.: alias curto `XY → XYLONG` não deve
 * casar dentro de `XYTEC`).
 *
 * Ordem de aplicação: cor primeiro, tamanho depois. Não há regras
 * conhecidas que dependam da ordem; documentado pra previsibilidade.
 */
export function aplicarAliasesGlobais(
  texto: string,
  ctx: ContextoCadastro,
): string {
  let saida = texto;
  for (const [alias, real] of ctx.aliasesGlobais.cor) {
    saida = substituirComBoundary(saida, alias, real);
  }
  for (const [alias, real] of ctx.aliasesGlobais.tamanho) {
    saida = substituirComBoundary(saida, alias, real);
  }
  return saida;
}

/** Replace global com word-boundary. Escapa caracteres regex no alias. */
function substituirComBoundary(
  texto: string,
  alias: string,
  real: string,
): string {
  const escapado = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // \b funciona pra alfanuméricos; basta pra nossos aliases (códigos
  // sem hífen exótico).
  const re = new RegExp(`\\b${escapado}\\b`, "g");
  return texto.replace(re, real);
}

/**
 * Composição completa: uppercase + trim + aliases globais.
 * Atalho usado pelo parser.
 */
export function preprocessar(input: string, ctx: ContextoCadastro): string {
  return aplicarAliasesGlobais(normalizarCaixa(input), ctx);
}
