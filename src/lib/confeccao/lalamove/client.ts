// RITM-25 — client HTTP da API v3 da Lalamove.
//
// Centraliza:
//   - Assinatura HMAC-SHA256 (algoritmo em docs/referencias/lalamove-api.md §2)
//   - Headers obrigatórios (Authorization, Accept, Content-Type, Market)
//   - Timeout 10s + retry único pra 5xx/erros de rede
//   - Parsing do envelope { errors, meta.requestId }
//
// Body de POST/PATCH é serializado **uma vez** e usado tanto pra assinar
// quanto pra enviar — não re-stringify. Re-serialização reordenaria chaves
// e quebraria a assinatura.

import { createHmac } from "node:crypto";
import { getLalamoveConfig, type LalamoveConfig } from "./config";

export interface LalamoveResponse<T> {
  data: T;
  meta: { requestId: string };
}

export class LalamoveApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly errorId: string | null,
    public readonly requestId: string | null,
    public readonly errors: Array<{ id: string; message: string }>,
    message: string,
  ) {
    super(message);
    this.name = "LalamoveApiError";
  }
}

export class LalamoveConfigError extends Error {
  constructor() {
    super("Lalamove API desabilitada: config ausente ou LALAMOVE_FEATURE_FLAG != true");
    this.name = "LalamoveConfigError";
  }
}

interface RequestArgs {
  method: "GET" | "POST" | "DELETE" | "PATCH";
  path: string;
  body?: unknown;
}

const TIMEOUT_MS = 10_000;

export async function lalamoveRequest<T>(
  args: RequestArgs,
  configOverride?: LalamoveConfig,
): Promise<LalamoveResponse<T>> {
  const config = configOverride ?? getLalamoveConfig();
  if (!config) throw new LalamoveConfigError();

  const bodyString =
    args.body === undefined || args.method === "GET" || args.method === "DELETE"
      ? ""
      : JSON.stringify(args.body);

  const timestamp = Date.now().toString();
  const signature = signRequest({
    apiSecret: config.apiSecret,
    timestamp,
    method: args.method,
    path: args.path,
    body: bodyString,
  });

  const url = `${config.host}${args.path}`;
  const headers: Record<string, string> = {
    Authorization: `hmac ${config.apiKey}:${timestamp}:${signature}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    Market: config.market,
  };

  return doFetchWithRetry<T>({ url, method: args.method, headers, bodyString });
}

// Algoritmo da assinatura — exportado pra unit test.
export function signRequest(args: {
  apiSecret: string;
  timestamp: string;
  method: string;
  path: string;
  body: string;
}): string {
  // RAW_SIGNATURE = TIMESTAMP + "\r\n" + METHOD + "\r\n" + PATH + "\r\n" + CUSTOM_HEADERS + "\r\n" + BODY
  // CUSTOM_HEADERS sempre vazio pra nosso uso → dois \r\n consecutivos entre PATH e BODY.
  const raw = `${args.timestamp}\r\n${args.method}\r\n${args.path}\r\n\r\n${args.body}`;
  return createHmac("sha256", args.apiSecret).update(raw).digest("hex");
}

async function doFetchWithRetry<T>(args: {
  url: string;
  method: string;
  headers: Record<string, string>;
  bodyString: string;
}): Promise<LalamoveResponse<T>> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      const res = await fetch(args.url, {
        method: args.method,
        headers: args.headers,
        body:
          args.bodyString && (args.method === "POST" || args.method === "PATCH")
            ? args.bodyString
            : undefined,
        signal: ctrl.signal,
      }).finally(() => clearTimeout(timer));

      const text = await res.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        // resposta não-JSON da API — provavelmente 5xx HTML do gateway
      }

      if (!res.ok) {
        const env = parsed as
          | {
              errors?: Array<{ id: string; message: string }>;
              meta?: { requestId?: string };
            }
          | null;
        const errors = env?.errors ?? [];
        const requestId = env?.meta?.requestId ?? null;
        const first = errors[0] ?? null;

        // Retry só pra 5xx / network. 4xx é erro do cliente — não retry.
        if (res.status >= 500 && attempt === 0) {
          await sleep(1000);
          continue;
        }

        throw new LalamoveApiError(
          res.status,
          first?.id ?? null,
          requestId,
          errors,
          first
            ? `Lalamove ${res.status} ${first.id}: ${first.message} (requestId=${requestId ?? "?"})`
            : `Lalamove ${res.status} (requestId=${requestId ?? "?"})`,
        );
      }

      return parsed as LalamoveResponse<T>;
    } catch (err) {
      lastErr = err;
      // Network/abort/timeout → retry 1×
      if (
        err instanceof LalamoveApiError === false &&
        attempt === 0
      ) {
        await sleep(1000);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
