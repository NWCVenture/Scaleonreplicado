// Constrói a forma canônica de um SkuParsed.
//
// A canonical é usada por RITM-05 pra lookup em sku_kit_regra
// (composições nominais cadastradas). Convenções:
//   - tudo UPPERCASE
//   - separador único = espaço
//   - cores ordenadas alfabeticamente em KIT_CORES_LISTADAS e
//     KIT_DISTRIBUICAO
//   - tamanho ao final (mesmo quando 'UNICO')

import type { SkuParsed, SkuKind, ParCorQtd } from "./types";

export function construirCanonical(
  kind: SkuKind,
  modeloCodigo: string,
  cores: ParCorQtd[],
  tamanho: string,
  qtdKit: number,
): string {
  switch (kind) {
    case "AVULSO": {
      // 1 cor + 1 tamanho. cores sempre tem len=1 aqui.
      const cor = cores[0]?.cor ?? "";
      return [modeloCodigo, cor, tamanho].filter((x) => x !== "").join(" ");
    }
    case "KIT_COR_UNICA": {
      const cor = cores[0]?.cor ?? "";
      return `KIT ${qtdKit} ${modeloCodigo} ${cor} ${tamanho}`;
    }
    case "KIT_CORES_LISTADAS": {
      const lista = [...cores].sort((a, b) => a.cor.localeCompare(b.cor));
      return `KIT ${qtdKit} ${modeloCodigo} ${lista.map((c) => c.cor).join(" ")} ${tamanho}`;
    }
    case "KIT_DISTRIBUICAO": {
      const lista = [...cores].sort((a, b) => a.cor.localeCompare(b.cor));
      const partes = lista.map((c) => `${c.qtd} ${c.cor}`);
      return `KIT ${qtdKit} ${modeloCodigo} ${partes.join(" ")} ${tamanho}`;
    }
    case "MIX": {
      return `MIX ${qtdKit} ${modeloCodigo} ${tamanho}`;
    }
  }
}

export function recanonical(parsed: SkuParsed): string {
  return construirCanonical(
    parsed.kind,
    parsed.modeloCodigo,
    parsed.cores,
    parsed.tamanho,
    parsed.qtdKit,
  );
}
