// RITM-25 — cache em memória das cidades + serviceTypes do GET /v3/cities.
//
// TTL 24h. Em Fluid Compute, o pool de instâncias reusa o cache entre
// requests, hit rate fica alto. Sem cron, sem tabela nova — simplicidade
// pra fase 8A.

import { lalamoveRequest } from "./client";

export interface LalamoveCity {
  locode: string;
  name: string;
  services: Array<{
    key: string;
    description: string;
    specialRequests: Array<{ name: string; description: string }>;
  }>;
}

interface CacheEntry {
  cities: LalamoveCity[];
  fetchedAt: number;
}

const TTL_MS = 24 * 60 * 60 * 1000; // 24h

let cache: CacheEntry | null = null;

export async function getCitiesCache(opts?: {
  force?: boolean;
}): Promise<{ cities: LalamoveCity[]; fetchedAt: Date }> {
  const now = Date.now();
  if (!opts?.force && cache && now - cache.fetchedAt < TTL_MS) {
    return { cities: cache.cities, fetchedAt: new Date(cache.fetchedAt) };
  }

  const res = await lalamoveRequest<LalamoveCity[]>({
    method: "GET",
    path: "/v3/cities",
  });

  cache = { cities: res.data, fetchedAt: now };
  return { cities: res.data, fetchedAt: new Date(now) };
}

// Utilitário pra UI: dado uma cidade (ou todas), retorna os serviceTypes
// disponíveis. Se city não for passada, agrega chaves únicas de todas
// as cidades.
export async function listarServiceTypes(args?: {
  cityLocode?: string;
}): Promise<Array<{ key: string; description: string; cities: string[] }>> {
  const { cities } = await getCitiesCache();
  const agg = new Map<
    string,
    { description: string; cities: Set<string> }
  >();
  for (const city of cities) {
    if (args?.cityLocode && city.locode !== args.cityLocode) continue;
    for (const svc of city.services) {
      const entry = agg.get(svc.key) ?? {
        description: svc.description,
        cities: new Set<string>(),
      };
      entry.cities.add(city.locode);
      agg.set(svc.key, entry);
    }
  }
  return Array.from(agg.entries()).map(([key, v]) => ({
    key,
    description: v.description,
    cities: Array.from(v.cities).sort(),
  }));
}

export function validateServiceType(args: {
  cityLocode: string;
  serviceType: string;
  cities: LalamoveCity[];
}): { valid: boolean; available: string[] } {
  const city = args.cities.find((c) => c.locode === args.cityLocode);
  if (!city) return { valid: false, available: [] };
  const available = city.services.map((s) => s.key);
  return { valid: available.includes(args.serviceType), available };
}

// Test helper — limpa o cache. Não exportado em produção.
export function _resetCacheForTests(): void {
  cache = null;
}
