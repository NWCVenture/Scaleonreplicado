# Módulo de Canais — Arquitetura

> **Status:** Em implementação
> **Última atualização:** 2026-04-23
> **Feature inicial:** Integração TikTok Shop (REQ-MKT-001)

---

## 1. Objetivo do módulo

Permitir que o ERP se conecte a múltiplos marketplaces (TikTok Shop, Shopee, Mercado Livre, Shopify, etc) com uma única abstração, sincronizando pedidos, estoque, catálogo e fulfillment. Meta de longo prazo: substituir completamente o UpSeller (integrador externo atual) e tornar este módulo o diferencial competitivo do ERP quando comercializado como SaaS.

---

## 2. Princípios arquiteturais

### 2.1 Núcleo do ERP não conhece marketplace específico
O ERP só conhece o conceito `canal_venda`. TikTok Shop, Shopee, ML são implementações de uma interface genérica (`ICanalAdapter`). Adicionar um marketplace novo = escrever novo adapter, **nunca** mexer no núcleo.

### 2.2 Multi-tenant desde o dia zero
Toda tabela do módulo carrega `conta_id` e respeita RLS do Postgres. Isolamento entre contas é automático, não dependente do dev lembrar de filtrar.

### 2.3 Credenciais sempre criptografadas
Tokens OAuth, API keys e qualquer secret de canal são criptografados em AES-256-GCM antes de ir pro banco. Chave mestra em env var (MVP) → migrar pra KMS em produção.

### 2.4 Jobs assíncronos desde o começo
Qualquer operação que chama API externa ou processa webhook roda em Inngest. Request handler nunca espera chamada externa.

### 2.5 Log estruturado de toda ida/volta com canal
Toda chamada ao canal é registrada em `log_sincronizacao_canal`. Fonte de verdade pra auditoria, dashboard e debug.

### 2.6 Webhooks são re-executáveis
Eventos de webhook ficam armazenados em `eventos_webhook_tiktok` com payload + assinatura + timestamp. Se o processador falhar ou a lógica mudar, dá pra reprocessar eventos do passado.

### 2.7 Escolhas técnicas que moldam o código
Stack fixada (não mudar sem revisar este doc):

| Componente | Tecnologia |
|---|---|
| Framework | Next.js 16 App Router |
| ORM | Drizzle |
| DB | Postgres (Neon) |
| Auth | Better-Auth |
| Jobs/Crons | Inngest |
| Validação | Zod |
| Crypto | node:crypto AES-256-GCM |
| HTTP | fetch nativo |
| Deploy | Vercel Fluid Compute |

---

## 3. Estrutura do módulo no código

```
src/
├── app/api/
│   ├── canais/
│   │   ├── route.ts                         # GET lista canais da conta
│   │   └── tiktok/
│   │       ├── conectar/route.ts            # GET redireciona pro TikTok
│   │       └── callback/route.ts            # GET recebe code + cria canal
│   ├── webhooks/
│   │   └── tiktok/route.ts                  # POST recebe eventos
│   └── inngest/route.ts                     # endpoint padrão Inngest
│
├── lib/
│   ├── crypto.ts                            # encrypt/decrypt AES-256-GCM
│   ├── oauth-state.ts                       # cookie HMAC pra state OAuth
│   ├── canais/
│   │   ├── types.ts                         # ICanalAdapter + tipos comuns
│   │   └── tiktok-shop/
│   │       ├── adapter.ts                   # TikTokShopAdapter
│   │       ├── oauth.ts                     # URL auth, troca de code, refresh
│   │       ├── sign.ts                      # HMAC-SHA256 de requisição
│   │       ├── http.ts                      # wrapper de fetch com assinatura
│   │       ├── schemas.ts                   # Zod schemas das respostas TikTok
│   │       └── config.ts                    # URLs base, escopos, versão
│   └── db/schema.ts                         # schema Drizzle (existente)
│
├── inngest/
│   ├── client.ts
│   └── functions/
│       ├── tiktok-refresh-tokens.ts
│       └── tiktok-register-webhook-event.ts
│
└── app/(dashboard)/
    └── integracoes/
        ├── page.tsx
        ├── logs/page.tsx
        └── tiktok/conectar/page.tsx
```

---

## 4. Contrato ICanalAdapter

Interface genérica que todo marketplace implementa. Em RITMs futuros, Shopee e ML implementam a mesma interface — zero mudança no núcleo.

```typescript
// src/lib/canais/types.ts

export type Plataforma = 'tiktok_shop' | 'shopee' | 'mercado_livre';

export interface CanalCredenciais {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiraEm: Date;
  refreshTokenExpiraEm: Date;
  metadados: Record<string, unknown>;
}

export interface LojaAutorizada {
  idExterno: string;
  nome: string;
  regiao: string;
  metadados: Record<string, unknown>;
}

export interface ICanalAdapter {
  readonly plataforma: Plataforma;

  // OAuth
  gerarUrlAutorizacao(params: { state: string; redirectUri: string }): string;
  trocarCodigoPorTokens(params: { code: string; redirectUri: string }): Promise<CanalCredenciais>;
  renovarTokens(refreshToken: string): Promise<CanalCredenciais>;
  listarLojasAutorizadas(accessToken: string): Promise<LojaAutorizada[]>;

  // Estoque (stubs na Onda 0)
  publicarEstoque(args: { canalId: number; skuExterno: string; qtd: number }): Promise<void>;

  // Pedidos (stubs na Onda 0)
  listarPedidos(args: { canalId: number; desde: Date; ate: Date }): Promise<unknown[]>;

  // Webhooks
  validarAssinaturaWebhook(rawBody: string, assinatura: string): boolean;
}
```

---

## 5. Modelo de dados

### 5.1 Hierarquia lógica

```
conta (tenant)
├── cnpjs (fiscal)
│   └── canais_venda (lojas de marketplace)
│       ├── credenciais_oauth_tiktok (1:1, específico TikTok)
│       ├── credenciais_oauth_shopee (1:1, futuro)
│       ├── credenciais_oauth_ml (1:1, futuro)
│       ├── sku_canal (mapa SKU interno ↔ externo)
│       ├── eventos_webhook_tiktok (1:N)
│       └── log_sincronizacao_canal (1:N)
```

### 5.2 Tabelas novas

**`canais_venda`** — genérica, vale pra qualquer marketplace.
**`credenciais_oauth_tiktok`** — específica (shop_cipher só existe no TikTok).
**`eventos_webhook_tiktok`** — log de eventos recebidos (processados ou não).
**`log_sincronizacao_canal`** — log de toda chamada ida/volta ao canal.
**`sku_canal`** — mapa de SKU interno ↔ SKU do canal (populada em ondas futuras).

Schema detalhado no RITM-02.

### 5.3 Padrões de RLS

Todas as tabelas novas têm:

```sql
ALTER TABLE <tabela> ENABLE ROW LEVEL SECURITY;
CREATE POLICY <tabela>_isolation ON <tabela>
  USING (conta_id = current_setting('app.conta_id')::int);
```

**Exceção — webhook receiver:** não tem sessão logada. Usa role específica que bypassa RLS até identificar o canal pelo `shop_id`; depois resolve o `conta_id` e insere no `eventos_webhook_tiktok`.

---

## 6. Fluxo OAuth (resumo)

```
┌─────────┐   1. clica "Conectar"    ┌─────────┐
│ Usuário ├─────────────────────────►│   ERP   │
└─────────┘                          └────┬────┘
                                          │ 2. gera state (cookie HMAC)
                                          │    assina com OAUTH_STATE_SECRET
                                          │ 3. redireciona pro TikTok
                                          ▼
                           ┌──────────────────────────┐
                           │  TikTok Shop (login +    │
                           │  consentimento)          │
                           └──────────┬───────────────┘
                                      │ 4. redireciona de volta com code+state
                                      ▼
                                ┌─────────┐
                                │   ERP   │  5. valida state (HMAC)
                                │         │  6. troca code por tokens
                                │         │  7. lista shops autorizados
                                │         │  8. criptografa tokens (AES-GCM)
                                │         │  9. persiste canal_venda + credenciais
                                └─────────┘
```

Detalhamento nos RITMs 03, 04, 05, 07.

---

## 7. Segurança — princípios obrigatórios

- **Nunca** logar `app_secret`, `access_token` ou `refresh_token` em plaintext
- **Nunca** commitar segredos — só em Vercel env vars
- **Sempre** validar `conta_id` do usuário ao criar/modificar canal
- **Sempre** usar `timingSafeEqual` em comparações de HMAC
- **Sempre** responder 200 em webhooks, mesmo com assinatura inválida (marcar como inválido no banco)
- **Sempre** validar payload com Zod antes de trustar dados do TikTok

---

## 8. O que NÃO está neste módulo (escopo de outras features)

- **Emissão fiscal NFe** — REQ-FIS-001 (stack própria via biblioteca open source, consultoria do contador)
- **Processamento de pedidos recebidos** — REQ-MKT-002
- **Sincronização de estoque bidirecional** — REQ-MKT-003 (resolve oversell)
- **Catálogo/anúncios via API** — REQ-MKT-004
- **Adapters Shopee e ML** — REQ-MKT-005 e REQ-MKT-006

---

## 9. Referências externas

- **Partner Center TikTok Shop:** https://partner.tiktokshop.com/
- **Doc oficial (SPA):** https://partner.tiktokshop.com/docv2/page/about-partner-center-console
- **Postman Workspace oficial:** https://www.postman.com/tiktok-shop-open/tiktok-shop-public-workspace/
- **API Testing Tool:** dentro do Partner Center
- **Inngest docs:** https://www.inngest.com/docs
- **Drizzle docs:** https://orm.drizzle.team/

---

*Documento vivo. Atualizar ao final de cada onda de implementação.*
