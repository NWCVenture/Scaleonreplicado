// RITM-25 — config da integração Lalamove API.
//
// Lê envs no boot. Se faltar qualquer obrigatória OU LALAMOVE_FEATURE_FLAG
// não for "true", retorna `null` → UI esconde botões, endpoints retornam 503.

export interface LalamoveConfig {
  host: string;
  market: string;
  apiKey: string;
  apiSecret: string;
}

const REQUIRED_ENVS = [
  "LALAMOVE_API_HOST",
  "LALAMOVE_API_KEY",
  "LALAMOVE_API_SECRET",
  "LALAMOVE_MARKET",
] as const;

export function getLalamoveConfig(): LalamoveConfig | null {
  if (process.env.LALAMOVE_FEATURE_FLAG !== "true") {
    return null;
  }
  for (const k of REQUIRED_ENVS) {
    if (!process.env[k]) return null;
  }
  return {
    host: process.env.LALAMOVE_API_HOST!,
    market: process.env.LALAMOVE_MARKET!,
    apiKey: process.env.LALAMOVE_API_KEY!,
    apiSecret: process.env.LALAMOVE_API_SECRET!,
  };
}

export function lalamoveFlagHabilitada(): boolean {
  return getLalamoveConfig() !== null;
}
