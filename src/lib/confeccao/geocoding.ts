// Helper de geocoding pra fornecedores do módulo Confecção (RITM-05).
//
// Usa Nominatim (OpenStreetMap, grátis). Rate limit oficial: 1 req/s.
// Implementação serializa chamadas via mutex global em memória.
// Pra escalar: trocar por OpenCage/Mapbox/Google quando o volume justificar.
//
// SEMPRE chamado server-side (rotas API). Nunca exposto pro browser.

export interface GeocodingInput {
  rua: string;
  numero: string;
  bairro: string;
  cidade: string;
  estado: string;
  cep: string;
}

export interface GeocodingResult {
  latitude: string;
  longitude: string;
  precisao: "exato" | "aproximado" | "cidade";
  fonte: "nominatim";
}

// Mutex serializing — Nominatim exige 1 req/s entre chamadas
let ultimaChamadaMs = 0;
const INTERVALO_MIN_MS = 1000;

async function respeitarRateLimit(): Promise<void> {
  const agora = Date.now();
  const decorrido = agora - ultimaChamadaMs;
  if (decorrido < INTERVALO_MIN_MS) {
    await new Promise((r) => setTimeout(r, INTERVALO_MIN_MS - decorrido));
  }
  ultimaChamadaMs = Date.now();
}

function montarQueryNominatim(input: GeocodingInput): string {
  // Nominatim aceita campos estruturados via query params dedicados
  const params = new URLSearchParams({
    street: `${input.numero} ${input.rua}`,
    city: input.cidade,
    state: input.estado,
    postalcode: input.cep.replace("-", ""),
    country: "Brasil",
    format: "jsonv2",
    limit: "1",
    addressdetails: "1",
  });
  return params.toString();
}

interface NominatimResponse {
  lat: string;
  lon: string;
  importance?: number;
  category?: string;
  addresstype?: string;
}

/**
 * Geocodifica um endereço via Nominatim. Retorna null se falhar (não-bloqueante).
 *
 * Respeita rate limit de 1 req/s globalmente (mutex em memória).
 *
 * Considerações:
 *  - Nominatim exige User-Agent identificável (User-Agent default do fetch
 *    é rejeitado). Usamos string com o nome do ERP.
 *  - Resultados pra BR são de qualidade variável; o campo `precisao`
 *    indica granularidade pra UI exibir aviso.
 */
export async function geocodificarEndereco(
  input: GeocodingInput,
): Promise<GeocodingResult | null> {
  await respeitarRateLimit();

  const url = `https://nominatim.openstreetmap.org/search?${montarQueryNominatim(input)}`;
  try {
    const res = await fetch(url, {
      headers: {
        // Política do Nominatim — identificação obrigatória
        "User-Agent": "NWC-ERP-Confeccao/1.0 (gabriel@nwc.example)",
        Accept: "application/json",
      },
      // Sem cache HTTP no servidor — controle ficaria mais previsível na app
      cache: "no-store",
    });

    if (!res.ok) return null;
    const arr = (await res.json()) as NominatimResponse[];
    if (!Array.isArray(arr) || arr.length === 0) return null;

    const [first] = arr;
    if (!first?.lat || !first?.lon) return null;

    // Classificação de precisão baseada no addresstype retornado.
    // "house" / "building" → exato; "road" → aproximado; resto → cidade
    let precisao: GeocodingResult["precisao"] = "cidade";
    const t = first.addresstype ?? "";
    if (["house", "building"].includes(t)) precisao = "exato";
    else if (["road", "street", "residential"].includes(t)) precisao = "aproximado";

    return {
      latitude: first.lat,
      longitude: first.lon,
      precisao,
      fonte: "nominatim",
    };
  } catch {
    // Falhas de rede são tratadas como "não conseguiu geocodificar" —
    // não propaga erro pra não bloquear o fluxo de criação do fornecedor
    return null;
  }
}

/**
 * Reset do mutex (apenas para testes — não usar em produção).
 */
export function _resetGeocodingRateLimit(): void {
  ultimaChamadaMs = 0;
}
