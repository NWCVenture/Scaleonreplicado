# RITM-03 — OAuth State (cookie HMAC assinado)

> **Bloqueia:** RITM-07
> **Depende de:** nada
> **Dependência externa:** nenhuma (não precisa da doc TikTok)

---

## Objetivo

Em OAuth, precisamos passar um `state` no redirect pra TikTok. Quando o usuário volta no callback, validamos esse state pra:

1. Prevenir CSRF (atacante não pode forjar callback válido)
2. Recuperar contexto (qual `conta_id`, `cnpj_id` e `usuario_id` iniciaram o fluxo)

Como rodamos em serverless (Vercel Fluid Compute) com instâncias efêmeras, **não** dá pra guardar state em memória. Guardamos num cookie HttpOnly assinado com HMAC.

---

## Arquivos a criar

- `src/lib/oauth-state.ts`
- `src/lib/oauth-state.test.ts`
- `.env.example` — adicionar `OAUTH_STATE_SECRET`

---

## Especificação

### Secret
- Env var: `OAUTH_STATE_SECRET`
- Formato: base64 de 32 bytes
- Gerar com: `openssl rand -base64 32`
- **Diferente** de `ENCRYPTION_MASTER_KEY` — funções separadas, chaves separadas

### Estrutura do state

```typescript
interface OAuthStatePayload {
  contaId: number;
  cnpjId: number;
  usuarioId: string;
  plataforma: 'tiktok_shop' | 'shopee' | 'mercado_livre';
  nonce: string;   // 16 bytes base64url
  exp: number;     // unix timestamp (segundos), TTL 10 min
}
```

### Formato serializado

`base64url(JSON.stringify(payload)) + "." + base64url(HMAC-SHA256(secret, body))`

### API

```typescript
export function createState(params: {
  contaId: number;
  cnpjId: number;
  usuarioId: string;
  plataforma: 'tiktok_shop' | 'shopee' | 'mercado_livre';
}): string;

export function verifyState(state: string): OAuthStatePayload;
```

### Comportamento

- `createState` gera nonce aleatório e exp automaticamente (TTL 10 min)
- `verifyState` rejeita: state malformado, assinatura inválida, expirado
- Comparação de assinatura usa `timingSafeEqual` (prevenir timing attack)

---

## Implementação de referência

```typescript
// src/lib/oauth-state.ts
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const TTL_SEGUNDOS = 600; // 10 min

export type Plataforma = 'tiktok_shop' | 'shopee' | 'mercado_livre';

export interface OAuthStatePayload {
  contaId: number;
  cnpjId: number;
  usuarioId: string;
  plataforma: Plataforma;
  nonce: string;
  exp: number;
}

function getSecret(): Buffer {
  const b64 = process.env.OAUTH_STATE_SECRET;
  if (!b64) throw new Error('OAUTH_STATE_SECRET não configurada');
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) {
    throw new Error('OAUTH_STATE_SECRET deve ter 32 bytes (base64)');
  }
  return key;
}

function b64urlEncode(buf: Buffer | string): string {
  return (Buffer.isBuffer(buf) ? buf : Buffer.from(buf))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlDecode(s: string): Buffer {
  const normalized = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + pad, 'base64');
}

export function createState(params: {
  contaId: number;
  cnpjId: number;
  usuarioId: string;
  plataforma: Plataforma;
}): string {
  const payload: OAuthStatePayload = {
    ...params,
    nonce: b64urlEncode(randomBytes(16)),
    exp: Math.floor(Date.now() / 1000) + TTL_SEGUNDOS,
  };
  const body = b64urlEncode(JSON.stringify(payload));
  const sig = b64urlEncode(createHmac('sha256', getSecret()).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyState(state: string): OAuthStatePayload {
  const parts = state.split('.');
  if (parts.length !== 2) {
    throw new Error('State malformado');
  }
  const [body, sig] = parts;

  const expectedSig = b64urlEncode(
    createHmac('sha256', getSecret()).update(body).digest()
  );

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    throw new Error('State com assinatura inválida');
  }

  const payload = JSON.parse(b64urlDecode(body).toString('utf8')) as OAuthStatePayload;

  if (payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('State expirado');
  }

  return payload;
}
```

---

## Testes obrigatórios

Em `src/lib/oauth-state.test.ts`:

1. ✅ Round-trip: `verifyState(createState(x))` retorna payload com os mesmos campos + nonce + exp
2. ✅ Dois `createState` idênticos geram strings diferentes (nonce aleatório)
3. ✅ `verifyState` rejeita string sem ponto ("abc")
4. ✅ `verifyState` rejeita assinatura adulterada (trocar 1 char na parte após o ponto)
5. ✅ `verifyState` rejeita body adulterado (trocar 1 char antes do ponto)
6. ✅ `verifyState` rejeita state expirado (mockar Date.now pra retornar futuro)
7. ✅ Falha clara se `OAUTH_STATE_SECRET` ausente

---

## Critérios de aceitação

- [ ] Todos os 7 testes passam
- [ ] `OAUTH_STATE_SECRET` documentada no `.env.example`
- [ ] Usa `timingSafeEqual` em comparações de assinatura
- [ ] TTL de 10 min aplicado
- [ ] TypeScript strict sem warnings
- [ ] Função não loga o state (pra não vazar em logs)

---

## Nota de uso

Nos route handlers (RITM-07), o state vai no **query string** do redirect pro TikTok (`?state=...`) e volta no callback (`&state=...`). Não precisa realmente de cookie separado — o próprio parâmetro de URL já serve como "cookie round-trip" porque o conteúdo é autenticado por HMAC.

Originalmente eu tinha sugerido cookie, mas URL param funciona igualmente bem e é mais simples. Decisão: **usar query param** na URL de auth e callback (padrão OAuth).
