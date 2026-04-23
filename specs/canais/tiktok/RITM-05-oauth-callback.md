# RITM-05 — TikTokShopAdapter: callback, refresh e listar shops

> **Bloqueia:** RITM-07, RITM-09
> **Depende de:** RITM-01 (crypto), RITM-02 (schema), RITM-04 (adapter base)
> **Dependência externa:** ✅ Resolvida via `docs/referencias/tiktok-shop-api.md §2, §3, §4, §7`

---

## Objetivo

Implementar três funções centrais do OAuth:

1. **`trocarCodigoPorTokens(code)`** — recebe o `code` do callback, troca por `access_token` + `refresh_token`
2. **`renovarTokens(refreshToken)`** — renova tokens antes de expirar (chamada pelo Inngest cron)
3. **`listarLojasAutorizadas(accessToken)`** — pega a lista de shops que o access_token autorizou, incluindo `shop_cipher`

Também implementar classe `TikTokShopError` pra tratar erros de forma estruturada.

---

## ⚠️ Pontos-chave da doc oficial

**Validado contra `docs/referencias/tiktok-shop-api.md`:**

1. **`access_token_expire_in` é timestamp Unix ABSOLUTO** (segundos desde 1970), **não** duração em segundos
2. **Default de expiração do access_token: 7 dias** (não 24h)
3. **Refresh retorna NOVO refresh_token** — substituir o antigo
4. **Listar shops EXIGE assinatura HMAC** (RITM-06) — implementar este RITM primeiro pode deixar `listarLojasAutorizadas` quebrado até RITM-06 concluir
5. **Response success: `code === 0`**
6. **Código `105002` = access_token expirado** → disparar refresh
7. **Código `36009004` com "Invalid access_token" = requires reauth** (token malformado, diferente de expirado)

---

## Arquivos a criar/modificar

- `src/lib/canais/tiktok-shop/oauth.ts` — adicionar as 3 funções
- `src/lib/canais/tiktok-shop/schemas.ts` — Zod schemas das respostas
- `src/lib/canais/tiktok-shop/errors.ts` — `TikTokShopError`
- `src/lib/canais/tiktok-shop/http.ts` — wrapper de fetch com log estruturado
- `src/lib/canais/tiktok-shop/adapter.ts` — remover stubs e implementar chamadas reais
- `src/lib/canais/tiktok-shop/oauth.test.ts` — adicionar testes

---

## Especificação

### `schemas.ts`

Baseado na response real documentada em §2, §3, §4:

```typescript
import { z } from 'zod';

/**
 * Response de Get Access Token e Refresh Token.
 * Schemas idênticos — ambos endpoints retornam a mesma estrutura.
 */
export const tokenResponseSchema = z.object({
  code: z.number(),
  message: z.string(),
  data: z.object({
    access_token: z.string(),
    access_token_expire_in: z.number(),    // ⚠️ timestamp Unix ABSOLUTO em segundos
    refresh_token: z.string(),
    refresh_token_expire_in: z.number(),   // ⚠️ timestamp Unix ABSOLUTO em segundos
    open_id: z.string().optional(),
    seller_name: z.string().optional(),
    seller_base_region: z.string().optional(),
    user_type: z.number().optional(),
    granted_scopes: z.array(z.string()).optional(),
  }).nullable(),
  request_id: z.string().optional(),
});

/**
 * Response de Get Authorized Shops.
 * Campo `cipher` é crítico — usado em outras APIs como `shop_cipher`.
 */
export const authorizedShopsResponseSchema = z.object({
  code: z.number(),
  message: z.string(),
  data: z.object({
    shops: z.array(z.object({
      id: z.string(),
      name: z.string(),
      region: z.string(),
      cipher: z.string(),
      code: z.string().optional(),
      seller_type: z.string().optional(),
    })),
  }).nullable(),
  request_id: z.string().optional(),
});
```

### `errors.ts`

Códigos extraídos de `docs/referencias/tiktok-shop-api.md §7`:

```typescript
export class TikTokShopError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly requestId?: string
  ) {
    super(message);
    this.name = 'TikTokShopError';
  }

  /** Access token expirado — resolvido com refresh automático */
  get isTokenExpired(): boolean {
    return this.code === 105002;
  }

  /** Erro transitório — retry com backoff resolve */
  get isRecoverable(): boolean {
    return [
      36009002,  // rate limit
      36009007,  // timeout
      105002,    // token expirado (resolvido com refresh)
    ].includes(this.code);
  }

  /** Erro fatal de autenticação — requer re-autorização do usuário */
  get requiresReauth(): boolean {
    return [
      1010000,   // x-tts-access-token inválido
      36009004,  // access_token/app_key inválido
      105005,    // scope insuficiente
    ].includes(this.code);
  }

  /** Erro irrecuperável — não tentar retry */
  get isFatal(): boolean {
    return [
      36009009,  // invalid path (bug no código)
      36009010,  // invalid method (bug no código)
      36009022,  // invalid format
      36009023,  // invalid content-type
      106001,    // invalid sign (bug na assinatura)
      36009033,  // IP não whitelisted
    ].includes(this.code);
  }
}
```

### `http.ts`

Wrapper de fetch que registra em `log_sincronizacao_canal` e lança `TikTokShopError`.

```typescript
import { db } from '@/lib/db';
import { logSincronizacaoCanal } from '@/lib/db/schema';
import { TikTokShopError } from './errors';

export async function fetchTikTok<T>(args: {
  url: string;
  method: 'GET' | 'POST';
  body?: unknown;
  headers?: Record<string, string>;
  log: {
    canalVendaId: number | null;
    contaId: number | null;
    tipo: 'oauth_callback' | 'refresh_token' | 'list_shops' | 'api_call';
    operacao: string;
  };
}): Promise<T> {
  const inicio = Date.now();
  let statusHttp: number | null = null;
  let respostaJson: unknown = null;

  try {
    const res = await fetch(args.url, {
      method: args.method,
      headers: {
        'Content-Type': 'application/json',
        ...args.headers,
      },
      body: args.body ? JSON.stringify(args.body) : undefined,
    });
    statusHttp = res.status;
    respostaJson = await res.json();

    // Log só se tem contexto de canal (antes do OAuth terminar, pode não ter)
    if (args.log.canalVendaId !== null && args.log.contaId !== null) {
      await db.insert(logSincronizacaoCanal).values({
        canalVendaId: args.log.canalVendaId,
        contaId: args.log.contaId,
        tipo: args.log.tipo,
        operacao: args.log.operacao,
        payloadEnviado: sanitizar(args.body),
        respostaRecebida: sanitizar(respostaJson),
        statusHttp,
        sucesso: res.ok,
        duracaoMs: Date.now() - inicio,
      });
    }

    if (!res.ok) {
      throw new TikTokShopError(statusHttp, `HTTP ${statusHttp}`);
    }

    return respostaJson as T;
  } catch (err) {
    if (err instanceof TikTokShopError) throw err;
    throw new TikTokShopError(0, err instanceof Error ? err.message : String(err));
  }
}

/**
 * Remove campos sensíveis antes de logar.
 * Qualquer alteração aqui precisa passar por code review.
 */
export function sanitizar(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  const CAMPOS_SENSIVEIS = new Set([
    'access_token',
    'refresh_token',
    'app_secret',
    'shop_cipher',
    'cipher',
    'authorization',
    'x-tts-access-token',
  ]);

  if (Array.isArray(obj)) return obj.map(sanitizar);

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (CAMPOS_SENSIVEIS.has(key.toLowerCase())) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = sanitizar(value);
    }
  }
  return result;
}
```

### `oauth.ts` — funções de OAuth

```typescript
import { TIKTOK_CONFIG } from './config';
import { tokenResponseSchema, authorizedShopsResponseSchema } from './schemas';
import { TikTokShopError } from './errors';
import { fetchTikTok } from './http';
import { assinarRequisicao } from './sign';      // RITM-06
import type { LojaAutorizada } from '@/lib/canais/types';

const SUCESSO_CODE = 0;

/**
 * Troca auth_code por access_token + refresh_token.
 * Endpoint: https://auth.tiktok-shops.com/api/v2/token/get
 * Não precisa de assinatura HMAC (é endpoint de autenticação, não de API).
 */
export async function trocarCodigoPorTokens(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  accessTokenExpiraEm: Date;
  refreshTokenExpiraEm: Date;
  sellerName?: string;
  sellerRegion?: string;
  openId?: string;
  grantedScopes?: string[];
}> {
  const url = new URL(TIKTOK_CONFIG.tokenUrl);
  url.searchParams.set('app_key', TIKTOK_CONFIG.appKey);
  url.searchParams.set('app_secret', TIKTOK_CONFIG.appSecret);
  url.searchParams.set('auth_code', code);
  url.searchParams.set('grant_type', 'authorized_code');

  const raw = await fetchTikTok<unknown>({
    url: url.toString(),
    method: 'GET',
    log: {
      canalVendaId: null,
      contaId: null,
      tipo: 'oauth_callback',
      operacao: 'trocarCodigoPorTokens',
    },
  });

  const parsed = tokenResponseSchema.parse(raw);

  if (parsed.code !== SUCESSO_CODE || !parsed.data) {
    throw new TikTokShopError(parsed.code, parsed.message, parsed.request_id);
  }

  // ⚠️ expire_in é timestamp Unix ABSOLUTO em segundos, não duração
  return {
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token,
    accessTokenExpiraEm: new Date(parsed.data.access_token_expire_in * 1000),
    refreshTokenExpiraEm: new Date(parsed.data.refresh_token_expire_in * 1000),
    sellerName: parsed.data.seller_name,
    sellerRegion: parsed.data.seller_base_region,
    openId: parsed.data.open_id,
    grantedScopes: parsed.data.granted_scopes,
  };
}

/**
 * Renova access_token + refresh_token usando refresh_token existente.
 * IMPORTANTE: retorna NOVO refresh_token — substituir o antigo no banco.
 */
export async function renovarTokens(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  accessTokenExpiraEm: Date;
  refreshTokenExpiraEm: Date;
}> {
  const url = new URL(TIKTOK_CONFIG.refreshUrl);
  url.searchParams.set('app_key', TIKTOK_CONFIG.appKey);
  url.searchParams.set('app_secret', TIKTOK_CONFIG.appSecret);
  url.searchParams.set('refresh_token', refreshToken);
  url.searchParams.set('grant_type', 'refresh_token');

  const raw = await fetchTikTok<unknown>({
    url: url.toString(),
    method: 'GET',
    log: {
      canalVendaId: null,
      contaId: null,
      tipo: 'refresh_token',
      operacao: 'renovarTokens',
    },
  });

  const parsed = tokenResponseSchema.parse(raw);

  if (parsed.code !== SUCESSO_CODE || !parsed.data) {
    throw new TikTokShopError(parsed.code, parsed.message, parsed.request_id);
  }

  return {
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token,
    accessTokenExpiraEm: new Date(parsed.data.access_token_expire_in * 1000),
    refreshTokenExpiraEm: new Date(parsed.data.refresh_token_expire_in * 1000),
  };
}

/**
 * Lista shops autorizadas pelo access_token.
 * EXIGE assinatura HMAC (ver RITM-06).
 * Endpoint: GET /authorization/202309/shops
 */
export async function listarLojasAutorizadas(
  accessToken: string
): Promise<LojaAutorizada[]> {
  const path = `/authorization/${TIKTOK_CONFIG.apiVersion}/shops`;
  const timestamp = Math.floor(Date.now() / 1000).toString();

  // Params que entram na assinatura
  const queryParams: Record<string, string> = {
    app_key: TIKTOK_CONFIG.appKey,
    timestamp,
  };

  // Gerar assinatura (RITM-06)
  const sign = assinarRequisicao({
    appSecret: TIKTOK_CONFIG.appSecret,
    path,
    queryParams,
    // Sem body neste endpoint (GET)
  });

  // Construir URL com sign incluso
  const url = new URL(path, TIKTOK_CONFIG.apiBaseUrl);
  url.searchParams.set('app_key', TIKTOK_CONFIG.appKey);
  url.searchParams.set('timestamp', timestamp);
  url.searchParams.set('sign', sign);

  const raw = await fetchTikTok<unknown>({
    url: url.toString(),
    method: 'GET',
    headers: {
      'x-tts-access-token': accessToken,
      'Content-Type': 'application/json',
    },
    log: {
      canalVendaId: null,
      contaId: null,
      tipo: 'list_shops',
      operacao: 'listarLojasAutorizadas',
    },
  });

  const parsed = authorizedShopsResponseSchema.parse(raw);

  if (parsed.code !== SUCESSO_CODE || !parsed.data) {
    throw new TikTokShopError(parsed.code, parsed.message, parsed.request_id);
  }

  return parsed.data.shops.map((s) => ({
    idExterno: s.id,
    nome: s.name,
    regiao: s.region,
    metadados: {
      cipher: s.cipher,
      code: s.code,
      seller_type: s.seller_type,
    },
  }));
}
```

### `adapter.ts` — remover stubs

Substituir os `throw new Error('Not implemented...')` de `trocarCodigoPorTokens`, `renovarTokens` e `listarLojasAutorizadas` pelas chamadas às funções criadas acima.

---

## Testes obrigatórios

Em `src/lib/canais/tiktok-shop/oauth.test.ts`:

### Tests com mock do fetch

1. ✅ `trocarCodigoPorTokens` com resposta válida (`code: 0`) retorna tokens com `expiraEm` como `Date` calculado a partir do timestamp Unix
2. ✅ `trocarCodigoPorTokens` com `access_token_expire_in: 1660556783` retorna `accessTokenExpiraEm.getTime() === 1660556783000`
3. ✅ `trocarCodigoPorTokens` com `code: 105002` lança `TikTokShopError` com `isTokenExpired === true`
4. ✅ `trocarCodigoPorTokens` com `code: 105005` lança `TikTokShopError` com `requiresReauth === true`
5. ✅ `trocarCodigoPorTokens` com resposta malformada (sem `data`) lança erro Zod
6. ✅ `renovarTokens` retorna tokens com strings **diferentes** do input
7. ✅ `listarLojasAutorizadas` gera URL com `sign`, `app_key`, `timestamp` na query
8. ✅ `listarLojasAutorizadas` inclui header `x-tts-access-token` no request
9. ✅ `listarLojasAutorizadas` retorna array com `metadados.cipher` preenchido

### Teste de sanitização

10. ✅ `sanitizar({ access_token: 'x', foo: 'y' })` retorna `{ access_token: '[REDACTED]', foo: 'y' }`
11. ✅ `sanitizar` funciona recursivamente em objetos aninhados
12. ✅ `sanitizar({ shop_cipher: 'abc' })` redacta `shop_cipher`
13. ✅ `sanitizar` é case-insensitive (redacta `Authorization` também)

### Tests de TikTokShopError

14. ✅ `new TikTokShopError(105002).isTokenExpired === true`
15. ✅ `new TikTokShopError(1010000).requiresReauth === true`
16. ✅ `new TikTokShopError(36009002).isRecoverable === true`
17. ✅ `new TikTokShopError(106001).isFatal === true`

---

## Critérios de aceitação

- [ ] Todos os 17 testes passam com mocks
- [ ] Sanitização nunca deixa vazar `access_token`, `refresh_token`, `app_secret`, `shop_cipher`
- [ ] Schemas Zod correspondem à resposta real documentada em §2, §3, §4
- [ ] `accessTokenExpiraEm` e `refreshTokenExpiraEm` são tratados como timestamps Unix **absolutos**
- [ ] Códigos em `TikTokShopError` correspondem aos documentados em §7

---

## Teste manual (depois de RITM-06 e RITM-07)

Ponta a ponta só dá pra testar quando RITM-06 (assinatura) + RITM-07 (route handlers) estiverem prontos. Mas dá pra validar parcialmente:

```typescript
// scripts/test-oauth.ts (não commitar)
import { trocarCodigoPorTokens } from '@/lib/canais/tiktok-shop/oauth';

const code = 'TTP_<code-copiado-manualmente-depois-de-autorizar>';
const tokens = await trocarCodigoPorTokens(code);
console.log('Tokens recebidos:', {
  hasAccessToken: Boolean(tokens.accessToken),
  accessTokenExpiraEm: tokens.accessTokenExpiraEm.toISOString(),
  refreshTokenExpiraEm: tokens.refreshTokenExpiraEm.toISOString(),
  diasAteExpirar: Math.floor(
    (tokens.accessTokenExpiraEm.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  ),
  sellerName: tokens.sellerName,
  sellerRegion: tokens.sellerRegion,
});
// Esperado: ~7 dias de validade no access token
```

---

## Dependências resolvidas

✅ Formato exato da resposta de troca de code (`docs/referencias/tiktok-shop-api.md §2`)
✅ Formato exato da resposta de refresh (§3) — retorna novo refresh_token
✅ Endpoint e formato da listagem de shops (§4) — exige HMAC
✅ Códigos de erro relevantes (§7) — mapeados em `TikTokShopError`

## Dependência pendente

⚠️ RITM-06 (assinatura HMAC) precisa estar implementado antes que `listarLojasAutorizadas` funcione. Se implementar este RITM primeiro, deixar `listarLojasAutorizadas` pra finalizar quando RITM-06 concluir.
