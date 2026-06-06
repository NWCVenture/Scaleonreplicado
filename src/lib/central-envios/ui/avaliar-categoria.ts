// Avaliação client-side de categoria_sku contra um pedido.
//
// Função pura. As regras dentro da categoria são OR (qualquer match
// satisfaz). Regex inválida → false + console.warn (sem derrubar UI).

import type {
  CategoriaSkuClient,
  PedidoEnriquecido,
} from "@/types/central-envios";

export function avaliarCategoria(
  pedido: PedidoEnriquecido,
  categoria: CategoriaSkuClient,
): boolean {
  for (const regra of categoria.regras) {
    if (regra.tipo === "regex") {
      try {
        const re = new RegExp(regra.pattern, regra.flags ?? "i");
        if (re.test(pedido.skuRaw)) return true;
      } catch (err) {
        console.warn(
          `categoria ${categoria.nome}: regex inválida '${regra.pattern}'`,
          err,
        );
      }
    } else if (regra.tipo === "composicao") {
      if (pedido.parsed.kind !== "OK") continue;
      if (pedido.parsed.modeloCodigo !== regra.modeloCodigo) continue;
      const q = pedido.parsed.qtdKit;
      if (regra.qtdMin != null && q < regra.qtdMin) continue;
      if (regra.qtdMax != null && q > regra.qtdMax) continue;
      return true;
    }
    // 'tag' não suportado em V1 (skuCatalogo não tem coluna tags ainda).
  }
  return false;
}

/** Status derivado do prazo para UI (vermelho/laranja/verde/cinza). */
export function deriveStatusPrazo(
  prazoIso: string | null,
  hojeIso: string,
): "ATRASADO" | "HOJE" | "NO_PRAZO" | "SEM_DATA" {
  if (!prazoIso) return "SEM_DATA";
  if (prazoIso === hojeIso) return "HOJE";
  if (prazoIso < hojeIso) return "ATRASADO";
  return "NO_PRAZO";
}
