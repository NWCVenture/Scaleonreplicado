// Parser de "peso" ou "peso \t folhas" copiado do Excel (RITM-34).
//
// Suporta:
//  - 1 coluna: cada linha vira { peso, folhas: null }
//  - 2 colunas (peso \t folhas): cada linha vira { peso, folhas }
//  - Mistura: linhas com tab → 2 colunas, sem tab → folhas: null

export interface ColadoRolo {
  peso: number;
  folhas: number | null;
}

/**
 * Split por `\r\n` ou `\n`. Cada linha split por `\t`. Trim + parse pt-BR
 * (vírgula → ponto). Filtra linhas vazias e linhas com peso inválido
 * (NaN, ≤0). Folhas inválido (NaN, <0) vira null.
 */
export function parsePesoFolhasColados(texto: string): ColadoRolo[] {
  if (!texto) return [];
  return texto
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => {
      const cols = l.split(/\t+/).map((c) => c.trim());
      const peso = Number((cols[0] ?? "").replace(",", "."));
      let folhas: number | null = null;
      if (cols[1]) {
        const f = Number(cols[1].replace(",", "."));
        if (Number.isFinite(f) && f >= 0) folhas = Math.floor(f);
      }
      return { peso, folhas };
    })
    .filter((r) => Number.isFinite(r.peso) && r.peso > 0);
}
