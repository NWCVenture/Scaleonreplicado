# RITM-07 — Route Handlers: /conectar e /callback

> **Bloqueia:** RITM-08
> **Depende de:** RITM-02 (schema), RITM-03 (oauth-state), RITM-04 (oauth-ida), RITM-05 (oauth-callback)
> **Dependência externa:** nenhuma nova (a doc já foi lida nos anteriores)

---

## Objetivo

Criar os dois endpoints HTTP que completam o fluxo OAuth:

1. `GET /api/canais/tiktok/conectar?cnpjId=X` — inicia fluxo, redireciona pro TikTok
2. `GET /api/canais/tiktok/callback?code=Y&state=Z` — recebe callback, persiste canal + credenciais

Também criar `GET /api/canais` pra listar canais da conta ativa (usado pela UI do RITM-08).

---

## Arquivos a criar

- `src/app/api/canais/route.ts`
- `src/app/api/canais/tiktok/conectar/route.ts`
- `src/app/api/canais/tiktok/callback/route.ts`

---

## Especificação

### `GET /api/canais/tiktok/conectar?cnpjId=X`

Inicia o fluxo OAuth. Validações:
- Usuário autenticado (Better-Auth `getSession`)
- `cnpjId` passado como query param (validar com Zod)
- `cnpjId` pertence à `conta_ativa_id` do usuário (query `SELECT 1 FROM cnpjs WHERE id = cnpjId AND conta_id = contaAtivaId`)

Se validações passam: gera state via `createState()`, monta URL via `gerarUrlAutorizacao()`, retorna redirect 302.

```typescript
// src/app/api/canais/tiktok/conectar/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { cnpjs } from '@/lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { createState } from '@/lib/oauth-state';
import { gerarUrlAutorizacao } from '@/lib/canais/tiktok-shop/oauth';
import { getRedirectUri } from '@/lib/canais/tiktok-shop/config';

const querySchema = z.object({
  cnpjId: z.coerce.number().int().positive(),
});

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  const contaId = session.user.contaAtivaId;
  if (!contaId) {
    return NextResponse.redirect(new URL('/integracoes?error=no_active_account', req.url));
  }

  const params = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!params.success) {
    return NextResponse.json({ error: 'cnpjId inválido' }, { status: 400 });
  }

  // Validar que cnpjId pertence à conta ativa
  await db.execute(sql`SELECT set_config('app.conta_id', ${contaId.toString()}, true)`);
  const [cnpj] = await db
    .select()
    .from(cnpjs)
    .where(and(eq(cnpjs.id, params.data.cnpjId), eq(cnpjs.contaId, contaId)))
    .limit(1);

  if (!cnpj) {
    return NextResponse.json({ error: 'CNPJ não encontrado ou não pertence à conta' }, { status: 404 });
  }

  const state = createState({
    contaId,
    cnpjId: params.data.cnpjId,
    usuarioId: session.user.id,
    plataforma: 'tiktok_shop',
  });

  const url = gerarUrlAutorizacao({ state, redirectUri: getRedirectUri() });
  return NextResponse.redirect(url);
}
```

### `GET /api/canais/tiktok/callback?code=X&state=Y`

Recebe o callback do TikTok. Fluxo:

1. Validar que `code` e `state` chegaram
2. Validar state via `verifyState()` (se inválido → redirect com erro)
3. Trocar code por tokens via `trocarCodigoPorTokens()`
4. Listar shops autorizados via `listarLojasAutorizadas()`
5. Se 0 shops → erro
6. Se 1 shop → persiste automaticamente
7. Se múltiplos shops → **nesta REQ, persiste o primeiro e registra aviso** (tratamento de múltiplos shops fica pra melhoria futura; Custom App com Seller Whitelist específica geralmente retorna 1 shop)
8. Transação: cria `canais_venda` + `credenciais_oauth_tiktok` com tokens criptografados

```typescript
// src/app/api/canais/tiktok/callback/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { canaisVenda, credenciaisOauthTiktok } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { verifyState } from '@/lib/oauth-state';
import {
  trocarCodigoPorTokens,
  listarLojasAutorizadas,
} from '@/lib/canais/tiktok-shop/oauth';
import { encrypt } from '@/lib/crypto';

const querySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

// Escopos solicitados no Custom App — ajustar conforme o que foi aprovado
const ESCOPOS_PADRAO = [
  'product.list.read',
  'product.list.write',
  'product.stock.read',
  'product.stock.write',
  'order.list.read',
  'order.list.write',
  'fulfillment.write',
  'finance.read',
  'authorization.read',
];

function redirectErro(req: NextRequest, codigo: string): NextResponse {
  const url = new URL('/integracoes', req.url);
  url.searchParams.set('error', codigo);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  const params = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!params.success) {
    return redirectErro(req, 'invalid_callback');
  }

  let stateData;
  try {
    stateData = verifyState(params.data.state);
  } catch {
    return redirectErro(req, 'invalid_state');
  }

  try {
    const tokens = await trocarCodigoPorTokens(params.data.code);
    const shops = await listarLojasAutorizadas(tokens.accessToken);

    if (shops.length === 0) {
      return redirectErro(req, 'no_shops');
    }

    // Múltiplos shops: pega o primeiro. TODO: tela de seleção em melhoria futura.
    const shop = shops[0];
    const cipher = shop.metadados.cipher as string;

    await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('app.conta_id', ${stateData.contaId.toString()}, true)`
      );

      const [canal] = await tx
        .insert(canaisVenda)
        .values({
          contaId: stateData.contaId,
          cnpjId: stateData.cnpjId,
          plataforma: 'tiktok_shop',
          identificadorLoja: shop.idExterno,
          nomeExibicao: shop.nome,
          emissorNota: 'proprio',
          ativo: true,
        })
        .returning();

      await tx.insert(credenciaisOauthTiktok).values({
        canalVendaId: canal.id,
        contaId: stateData.contaId,
        shopId: shop.idExterno,
        shopCipher: cipher,
        accessTokenCriptografado: encrypt(tokens.accessToken),
        accessTokenExpiraEm: tokens.accessTokenExpiraEm,
        refreshTokenCriptografado: encrypt(tokens.refreshToken),
        refreshTokenExpiraEm: tokens.refreshTokenExpiraEm,
        escoposAutorizados: ESCOPOS_PADRAO,
        sellerName: tokens.sellerName ?? null,
      });
    });

    const sucessoUrl = new URL('/integracoes', req.url);
    sucessoUrl.searchParams.set('success', '1');
    return NextResponse.redirect(sucessoUrl);
  } catch (err) {
    console.error('[TikTok OAuth callback] erro:', err);
    return redirectErro(req, 'internal');
  }
}
```

### `GET /api/canais`

Lista canais da conta ativa. Usado pela UI.

```typescript
// src/app/api/canais/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { canaisVenda, credenciaisOauthTiktok } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user) {
    return NextResponse.json({ error: 'não autenticado' }, { status: 401 });
  }

  const contaId = session.user.contaAtivaId;
  if (!contaId) {
    return NextResponse.json({ canais: [] });
  }

  await db.execute(sql`SELECT set_config('app.conta_id', ${contaId.toString()}, true)`);

  const canais = await db
    .select({
      id: canaisVenda.id,
      plataforma: canaisVenda.plataforma,
      nomeExibicao: canaisVenda.nomeExibicao,
      identificadorLoja: canaisVenda.identificadorLoja,
      ativo: canaisVenda.ativo,
      ultimaSyncEm: canaisVenda.ultimaSyncEm,
      cnpjId: canaisVenda.cnpjId,
      // Dados de token (não o token em si)
      accessTokenExpiraEm: credenciaisOauthTiktok.accessTokenExpiraEm,
      statusRenovacao: credenciaisOauthTiktok.statusRenovacao,
    })
    .from(canaisVenda)
    .leftJoin(
      credenciaisOauthTiktok,
      eq(credenciaisOauthTiktok.canalVendaId, canaisVenda.id)
    );

  return NextResponse.json({ canais });
}
```

⚠️ **Nota:** esse endpoint só retorna TikTok agora. Quando Shopee/ML entrarem, adicionar joins condicionais pra cada tipo de credencial.

---

## Testes obrigatórios

### `/conectar`

1. ✅ Sem sessão → redireciona pra `/login`
2. ✅ Sem `cnpjId` → 400
3. ✅ `cnpjId` de outra conta → 404
4. ✅ Tudo OK → 302 com `Location` começando com `TIKTOK_CONFIG.authUrl`
5. ✅ Query param `state` presente na URL de redirect

### `/callback`

6. ✅ Sem `code` ou `state` → redirect com `error=invalid_callback`
7. ✅ `state` adulterado → redirect com `error=invalid_state`
8. ✅ `state` expirado → redirect com `error=invalid_state`
9. ✅ Mock do `trocarCodigoPorTokens` retornando erro → redirect com `error=internal`
10. ✅ Fluxo feliz com mocks → cria `canais_venda` + `credenciais_oauth_tiktok`
11. ✅ Tokens salvos no banco começam com formato de envelope do `crypto.encrypt` (não plaintext)

### `/canais` (GET)

12. ✅ Sem sessão → 401
13. ✅ Retorna canais filtrados por `contaAtivaId` (RLS)
14. ✅ Nunca retorna tokens no response (só datas de expiração e status)

---

## Critérios de aceitação

- [ ] 3 routes criados e testados
- [ ] Tokens **nunca** aparecem no response JSON
- [ ] `console.log` ou logger não expõem tokens (usar `sanitizar()` do RITM-05 se for logar)
- [ ] Transação no callback garante rollback se alguma etapa falhar
- [ ] Teste manual end-to-end: clicar em "Conectar" pela UI do RITM-08, autorizar uma loja, voltar, ver canal listado

---

## Teste manual end-to-end

1. `npm run dev` local com túnel HTTPS ativo
2. Abrir `/integracoes` logado como usuário da AVZ
3. Clicar "Conectar TikTok Shop" escolhendo um CNPJ
4. Redireciona pro TikTok
5. Autorizar
6. Volta pro ERP
7. Canal aparece listado
8. Conferir no banco: `SELECT * FROM canais_venda` e `SELECT * FROM credenciais_oauth_tiktok`
9. Verificar: tokens encriptados (envelope com 3 partes separadas por ponto)
10. Tentar abrir `/api/canais/tiktok/callback` diretamente no browser (sem fluxo) → deve redirecionar com erro
