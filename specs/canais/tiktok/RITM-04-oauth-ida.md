# RITM-04 — TikTokShopAdapter: URL de autorização (OAuth ida)

> **Bloqueia:** RITM-05, RITM-07
> **Depende de:** nada de outros RITMs
> **Dependência externa:** ✅ Resolvida via `docs/referencias/tiktok-shop-api.md §1`

---

## Objetivo

Criar função que monta a URL pra onde o usuário é redirecionado ao clicar "Conectar loja TikTok". Primeira etapa do fluxo OAuth.

Também criar os arquivos base do adapter (`config.ts`, `adapter.ts`, `oauth.ts`, `schemas.ts`) com esqueleto, mesmo que nem todos sejam preenchidos neste RITM.

---

## ⚠️ Informações importantes da doc oficial

**A URL de autorização do TikTok usa `service_id`, não `app_key`.** Esta é uma **diferença crítica** vs. a maioria dos fluxos OAuth convencionais.

- Para ROW (Brasil): `https://services.tiktokshop.com/open/authorize?service_id=7431458374265161478`
- O `service_id` é **fixo por mercado**, não é específico do nosso app
- Isso significa que, após o clique do usuário, o TikTok identifica nosso app via `redirect_uri` cadastrado no Partner Center (não via app_key na URL)

Ver `docs/referencias/tiktok-shop-api.md §1` pra detalhes completos.

---

## Arquivos a criar

- `src/lib/canais/types.ts` — interface `ICanalAdapter` + tipos comuns
- `src/lib/canais/tiktok-shop/config.ts` — URLs e constantes
- `src/lib/canais/tiktok-shop/adapter.ts` — classe `TikTokShopAdapter` (esqueleto)
- `src/lib/canais/tiktok-shop/oauth.ts` — função `gerarUrlAutorizacao`
- `src/lib/canais/tiktok-shop/oauth.test.ts` — testes da função

---

## Especificação

### `src/lib/canais/types.ts`

Copiar a interface `ICanalAdapter` documentada em `docs/arquitetura/modulo-canais.md §4`.

Neste RITM, só implementar `gerarUrlAutorizacao`. Outros métodos (`trocarCodigoPorTokens`, `renovarTokens`, etc) ficam como stubs que lançam `Error('Not implemented yet - RITM-XX')`.

### `src/lib/canais/tiktok-shop/config.ts`

```typescript
/**
 * Configuração do adapter TikTok Shop.
 * URLs e service_id validados contra docs/referencias/tiktok-shop-api.md (versão 202407).
 */
export const TIKTOK_CONFIG = {
  // Versão dos endpoints de autorização (v202407 é a doc, mas os endpoints ainda usam 202309)
  apiVersion: process.env.TIKTOK_SHOP_API_VERSION ?? '202309',

  // Credenciais do Custom App no Partner Center
  appKey: process.env.TIKTOK_SHOP_APP_KEY ?? '',
  appSecret: process.env.TIKTOK_SHOP_APP_SECRET ?? '',
  webhookKey: process.env.TIKTOK_SHOP_WEBHOOK_KEY ?? '',
  region: process.env.TIKTOK_SHOP_REGION ?? 'BR',

  // URL de autorização + service_id FIXO por mercado (ver §1 da referência)
  authUrl: 'https://services.tiktokshop.com/open/authorize',
  serviceIdROW: '7431458374265161478',   // BR e demais mercados (não-US)
  serviceIdUS: '7369437808455026474',    // US — para referência futura

  // URLs de token (ver §2 e §3)
  tokenUrl: 'https://auth.tiktok-shops.com/api/v2/token/get',
  refreshUrl: 'https://auth.tiktok-shops.com/api/v2/token/refresh',

  // Base de API (para endpoints assinados, ver §4)
  apiBaseUrl: 'https://open-api.tiktokglobalshop.com',
} as const;

export function getServiceId(region: string): string {
  return region === 'US' ? TIKTOK_CONFIG.serviceIdUS : TIKTOK_CONFIG.serviceIdROW;
}

export function getRedirectUri(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) throw new Error('NEXT_PUBLIC_APP_URL não configurada');
  return `${appUrl}/api/canais/tiktok/callback`;
}
```

### `src/lib/canais/tiktok-shop/oauth.ts`

```typescript
import { TIKTOK_CONFIG, getServiceId } from './config';

export function gerarUrlAutorizacao(params: {
  state: string;
  redirectUri: string;
}): string {
  const serviceId = getServiceId(TIKTOK_CONFIG.region);

  const url = new URL(TIKTOK_CONFIG.authUrl);
  url.searchParams.set('service_id', serviceId);
  url.searchParams.set('state', params.state);

  // NOTA: redirect_uri é validado contra o URL cadastrado no Partner Center.
  // Não é passado na query string — o TikTok usa o URL configurado no app.
  // Mantemos o parâmetro aqui por segurança caso o TikTok aceite override.
  url.searchParams.set('redirect_uri', params.redirectUri);

  return url.toString();
}
```

### ⚠️ Nota sobre `redirect_uri`

A doc (§1) mostra o exemplo `{redirect_url}?code=...&state=...` mas **não explicita se o `redirect_uri` é passado na query de autorização ou se vem do Partner Center**. Padrão OAuth 2.0 canônico é passar — vamos passar. Se der erro no teste manual, remover o parâmetro e confiar no registrado no Partner Center.

### `src/lib/canais/tiktok-shop/adapter.ts`

```typescript
import type { ICanalAdapter, Plataforma } from '@/lib/canais/types';
import { gerarUrlAutorizacao } from './oauth';

export class TikTokShopAdapter implements ICanalAdapter {
  readonly plataforma: Plataforma = 'tiktok_shop';

  gerarUrlAutorizacao(params: { state: string; redirectUri: string }): string {
    return gerarUrlAutorizacao(params);
  }

  async trocarCodigoPorTokens(): Promise<never> {
    throw new Error('Not implemented yet — RITM-05');
  }
  async renovarTokens(): Promise<never> {
    throw new Error('Not implemented yet — RITM-05');
  }
  async listarLojasAutorizadas(): Promise<never> {
    throw new Error('Not implemented yet — RITM-05');
  }
  async publicarEstoque(): Promise<never> {
    throw new Error('Not implemented yet — REQ-MKT-003');
  }
  async listarPedidos(): Promise<never> {
    throw new Error('Not implemented yet — REQ-MKT-002');
  }
  validarAssinaturaWebhook(): never {
    throw new Error('Not implemented yet — RITM-10');
  }
}
```

---

## Testes obrigatórios

Em `src/lib/canais/tiktok-shop/oauth.test.ts`:

1. ✅ URL gerada começa com `https://services.tiktokshop.com/open/authorize`
2. ✅ URL tem query param `service_id=7431458374265161478` (para região BR)
3. ✅ URL tem query param `state` igual ao passado
4. ✅ URL tem query param `redirect_uri` igual ao passado
5. ✅ URL **NÃO** tem `app_key` na query string (diferença importante vs. OAuth tradicional)
6. ✅ Com `TIKTOK_SHOP_REGION=US`, URL tem `service_id=7369437808455026474`

Mock do `process.env` via `vi.stubEnv()` (Vitest) ou equivalente.

---

## Critérios de aceitação

- [ ] Todos os 6 testes passam
- [ ] `ICanalAdapter` definida em `src/lib/canais/types.ts`
- [ ] `TikTokShopAdapter` implementa `gerarUrlAutorizacao`, resto é stub
- [ ] URL gerada, ao ser aberta no browser (teste manual), leva à tela de login/consentimento do TikTok Shop (não "app not found")

---

## Teste manual

1. Exportar URL gerada:
   ```bash
   npm run dev
   # Em outro terminal, via túnel:
   curl -I "https://<seu-tunel>/api/canais/tiktok/conectar?cnpjId=1"
   # Deve retornar 302 com Location: https://services.tiktokshop.com/open/authorize?service_id=...
   ```

2. Copiar o Location e abrir no browser → deve aparecer tela do TikTok Shop pedindo login + consentimento
3. Se aparecer "invalid service_id" → checar que `service_id` está correto para região
4. Se aparecer "redirect_uri mismatch" → confirmar que o URL está registrado no Partner Center exatamente igual (trailing slash importa)

---

## Dependências resolvidas

✅ URL oficial validada em `docs/referencias/tiktok-shop-api.md §1`
✅ `service_id` confirmado: `7431458374265161478` para BR/ROW
✅ Comportamento do callback documentado (`?code=X&state=Y` ou `?code=null&error=auth_denied`)
✅ Restrições do auth_code documentadas (30min TTL, single-use)
