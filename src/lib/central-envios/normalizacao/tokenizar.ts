// Tokenização do texto pré-processado. Split por whitespace,
// filtrando vazios. Mantém ordem original.
//
// Não detecta tipo de token aqui — `parsear-sku.ts` faz a
// categorização contra o ContextoCadastro.

export function tokenizar(texto: string): string[] {
  if (texto === "") return [];
  return texto.split(/\s+/).filter((t) => t !== "");
}

/** Retorna `true` se o token é um inteiro positivo. */
export function ehNumeroPositivo(token: string): boolean {
  if (!/^\d+$/.test(token)) return false;
  const n = Number(token);
  return Number.isFinite(n) && n > 0;
}
