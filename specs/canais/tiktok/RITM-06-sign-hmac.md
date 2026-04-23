# RITM-06 — Assinatura HMAC de requisição

> **Bloqueia:** `listarLojasAutorizadas` (RITM-05) e qualquer chamada subsequente à API TikTok
> **Depende de:** nada de outros RITMs
> **Dependência externa:** ✅ Resolvida — algoritmo + vetor de teste oficial em `docs/referencias/tiktok-shop-api.md §5`

---

## Objetivo

Implementar função pura que gera a assinatura HMAC-SHA256 exigida pela maioria dos endpoints da API TikTok Shop. Sem essa função correta, **nenhuma chamada à API funciona**.

**Boa notícia:** a doc oficial fornece o algoritmo passo-a-passo, implementação de referência em Node.js/TypeScript, e um vetor de teste oficial. Este RITM essencialmente porta o código da doc e valida contra o vetor.

---

## Algoritmo (confirmado via doc oficial §5)

1. Filtrar query params: **remover `sign` e `access_token`**
2. Ordenar chaves alfabeticamente (case-sensitive)
3. Concatenar no formato `{key}{value}` **sem separador**: `app_key123456timestamp1234567890`
4. **Prepender o path** (sem domain, sem query string): `/authorization/202309/shops` + string do passo 3
5. **Se Content-Type != `multipart/form-data`** e tem body: **appendar** `JSON.stringify(body)` ao final
6. **Envelope com app_secret**: `app_secret + string_atual + app_secret`
7. HMAC-SHA256(key=app_secret, msg=envelope), output em hex lowercase

---

## Vetor de teste oficial 🔴 USAR NOS TESTES

Extraído de `docs/referencias/tiktok-shop-api.md §5`:

```
INPUT:
  app_key:    29a39d
  app_secret: e59af819cc
  timestamp:  1623812664
  path:       /authorization/202309/shops
  body:       (nenhum)

EXPECTED OUTPUT:
  b596b73e0cc6de07ac26f036364178ab16b0a907af13d43f0a0cd2345f582dc8
```

Intermediários esperados:
- Passo 3: `app_key29a39dtimestamp1623812664`
- Passo 4: `/authorization/202309/shopsapp_key29a39dtimestamp1623812664`
- Passo 6: `e59af819cc/authorization/202309/shopsapp_key29a39dtimestamp1623812664e59af819cc`
- HMAC: `b596b73e0cc6de07ac26f036364178ab16b0a907af13d43f0a0cd2345f582dc8`

Este vetor de teste **deve virar um teste unitário** — é a garantia definitiva de que a implementação está correta.

---

## Arquivos a criar

- `src/lib/canais/tiktok-shop/sign.ts`
- `src/lib/canais/tiktok-shop/sign.test.ts`

---

## Implementação de referência

Portada do código TypeScript oficial da doc, com tipagem e ergonomia melhoradas:

```typescript
// src/lib/canais/tiktok-shop/sign.ts
import { createHmac } from 'node:crypto';

export interface SignInput {
  /** App secret do Partner Center */
  appSecret: string;
  /** Path do endpoint (sem domain, sem query). Ex: "/authorization/202309/shops" */
  path: string;
  /** Query params que irão NA URL (função filtra sign/access_token) */
  queryParams: Record<string, string>;
  /** Body da requisição, se houver. Será JSON.stringify aqui. */
  body?: Record<string, unknown>;
  /** Content-Type do request. Se multipart/form-data, body NÃO entra na assinatura. */
  contentType?: string;
}

const EXCLUDE_FROM_SIGN = new Set(['sign', 'access_token']);

/**
 * Gera assinatura HMAC-SHA256 para requisições à API TikTok Shop.
 * Algoritmo validado contra docs/referencias/tiktok-shop-api.md §5.
 *
 * Vetor de teste oficial:
 *   Input: app_secret=e59af819cc, path=/authorization/202309/shops,
 *          params={app_key:"29a39d", timestamp:"1623812664"}, sem body
 *   Output: b596b73e0cc6de07ac26f036364178ab16b0a907af13d43f0a0cd2345f582dc8
 */
export function assinarRequisicao(input: SignInput): string {
  if (!input.appSecret) {
    throw new Error('appSecret vazio ao gerar assinatura');
  }
  if (!input.path || !input.path.startsWith('/')) {
    throw new Error(`path inválido: "${input.path}" — deve começar com "/"`);
  }

  // Step 1 & 2: filtrar, ordenar, concatenar
  const sortedKeys = Object.keys(input.queryParams)
    .filter((k) => !EXCLUDE_FROM_SIGN.has(k))
    .sort();

  const paramsStr = sortedKeys
    .map((k) => `${k}${input.queryParams[k]}`)
    .join('');

  // Step 3: prepend path
  let signString = `${input.path}${paramsStr}`;

  // Step 4: append body se não é multipart
  const isMultipart = input.contentType === 'multipart/form-data';
  if (!isMultipart && input.body && Object.keys(input.body).length > 0) {
    signString += JSON.stringify(input.body);
  }

  // Step 5: envelope
  signString = `${input.appSecret}${signString}${input.appSecret}`;

  // Step 6: HMAC-SHA256
  return createHmac('sha256', input.appSecret)
    .update(signString)
    .digest('hex');
}
```

---

## Testes obrigatórios

### Teste com vetor oficial 🔴 CRÍTICO

```typescript
// src/lib/canais/tiktok-shop/sign.test.ts
import { describe, it, expect } from 'vitest';
import { assinarRequisicao } from './sign';

describe('assinarRequisicao', () => {
  it('gera o hash oficial do vetor de teste da doc TikTok', () => {
    // Vetor de docs/referencias/tiktok-shop-api.md §5
    const input = {
      appSecret: 'e59af819cc',
      path: '/authorization/202309/shops',
      queryParams: {
        app_key: '29a39d',
        timestamp: '1623812664',
      },
    };
    expect(assinarRequisicao(input)).toBe(
      'b596b73e0cc6de07ac26f036364178ab16b0a907af13d43f0a0cd2345f582dc8'
    );
  });
```

### Tests estruturais

```typescript
  it('é determinística — mesma entrada sempre gera mesma saída', () => {
    const input = {
      appSecret: 'secret',
      path: '/test',
      queryParams: { a: '1', b: '2' },
    };
    expect(assinarRequisicao(input)).toBe(assinarRequisicao(input));
  });

  it('ordena params alfabeticamente — ordem de entrada não afeta resultado', () => {
    const sig1 = assinarRequisicao({
      appSecret: 'secret',
      path: '/test',
      queryParams: { b: '2', a: '1' },
    });
    const sig2 = assinarRequisicao({
      appSecret: 'secret',
      path: '/test',
      queryParams: { a: '1', b: '2' },
    });
    expect(sig1).toBe(sig2);
  });

  it('exclui sign e access_token da assinatura', () => {
    const sig1 = assinarRequisicao({
      appSecret: 'secret',
      path: '/test',
      queryParams: { a: '1' },
    });
    const sig2 = assinarRequisicao({
      appSecret: 'secret',
      path: '/test',
      queryParams: { a: '1', sign: 'xxx', access_token: 'yyy' },
    });
    expect(sig1).toBe(sig2);
  });

  it('mudar 1 char em param muda a assinatura', () => {
    const sig1 = assinarRequisicao({
      appSecret: 'secret',
      path: '/test',
      queryParams: { a: '1' },
    });
    const sig2 = assinarRequisicao({
      appSecret: 'secret',
      path: '/test',
      queryParams: { a: '2' },
    });
    expect(sig1).not.toBe(sig2);
  });

  it('mudar app_secret muda a assinatura', () => {
    const base = {
      path: '/test',
      queryParams: { a: '1' },
    };
    expect(assinarRequisicao({ ...base, appSecret: 'secret1' }))
      .not.toBe(assinarRequisicao({ ...base, appSecret: 'secret2' }));
  });

  it('appenda body JSON quando content-type não é multipart', () => {
    const base = {
      appSecret: 'secret',
      path: '/test',
      queryParams: { a: '1' },
    };
    const semBody = assinarRequisicao(base);
    const comBody = assinarRequisicao({
      ...base,
      body: { foo: 'bar' },
    });
    expect(semBody).not.toBe(comBody);
  });

  it('IGNORA body quando content-type é multipart/form-data', () => {
    const base = {
      appSecret: 'secret',
      path: '/test',
      queryParams: { a: '1' },
      body: { foo: 'bar' },
    };
    const multipart = assinarRequisicao({
      ...base,
      contentType: 'multipart/form-data',
    });
    const semBody = assinarRequisicao({
      appSecret: 'secret',
      path: '/test',
      queryParams: { a: '1' },
    });
    expect(multipart).toBe(semBody);
  });

  it('body vazio {} não entra na assinatura', () => {
    const base = {
      appSecret: 'secret',
      path: '/test',
      queryParams: { a: '1' },
    };
    const semBody = assinarRequisicao(base);
    const bodyVazio = assinarRequisicao({ ...base, body: {} });
    expect(semBody).toBe(bodyVazio);
  });

  it('lança erro se appSecret vazio', () => {
    expect(() => assinarRequisicao({
      appSecret: '',
      path: '/test',
      queryParams: {},
    })).toThrow(/appSecret vazio/);
  });

  it('lança erro se path não começa com /', () => {
    expect(() => assinarRequisicao({
      appSecret: 'secret',
      path: 'authorization/202309/shops',
      queryParams: {},
    })).toThrow(/path inválido/);
  });
});
```

---

## Critérios de aceitação

- [ ] Função é pura (sem side effects, sem env access, sem fetch)
- [ ] **Vetor de teste oficial passa** — gera `b596b73e0cc6de07ac26f036364178ab16b0a907af13d43f0a0cd2345f582dc8`
- [ ] Todos os 11 testes passam
- [ ] Usa apenas `node:crypto` (sem libs externas)
- [ ] Integração real: chamada a `listarLojasAutorizadas` via sandbox do TikTok retorna sucesso (validação end-to-end com RITM-05)

---

## Plano B se a integração real falhar

Se após implementar e o vetor de teste unitário passar, mas a chamada real ao TikTok retornar `106001 "Invalid signature"`:

1. **Comparar byte-a-byte** com o que o API Testing Tool do Partner Center gera — o Tool mostra a assinatura dele
2. **Logar a string final** (step 5) e comparar com a da doc — espaços, encoding, aspas podem afetar
3. **Checar encoding do body** — `JSON.stringify` gera `{"key":"value"}` sem espaço, mas API pode exigir diferente
4. **Checar valores com caracteres especiais** (unicode, espaços) — podem precisar URL encoding antes de entrar na string
5. **Checar timestamp** — tem que estar em segundos (10 dígitos), não milissegundos, e dentro da janela 5min+30s

---

## Nota sobre body com caracteres especiais

O exemplo da doc para o endpoint "Update Shop Webhook" mostra body sendo appendado **literalmente**:

```
/event/202309/webhooksapp_key68xu9ks5p4i8shop_cipherROW_xkMbgAAAeVAQra0eZWebFQq5aIKtimestamp1696909648{"address":"https://partner.tiktokshop.com", "event_type": "PACKAGE_UPDATE"}
```

Note o espaço após a vírgula e as aspas duplas. Nossa `JSON.stringify` não adiciona esses espaços. **Se o TikTok for estrito quanto a isso, vamos precisar ajustar** — mas o código oficial em Node.js da doc usa `JSON.stringify(body)` normal, então assume-se que está ok. Validar via integração real.

---

## Dependências resolvidas

✅ Algoritmo passo-a-passo documentado
✅ Implementação Node.js/TypeScript de referência copiada da doc oficial
✅ Vetor de teste oficial com input + hash esperado
✅ Códigos de erro mapeados (`106001 = invalid sign`, `36009004 = invalid timestamp`)
✅ Janela de validação de timestamp documentada (5min antes até 30s depois)
