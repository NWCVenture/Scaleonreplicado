<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Database

## Ambientes

| Ambiente | Host | Porta | Env file |
|----------|------|-------|----------|
| Local (Docker) | `localhost` | `5433` | `.env.local` |
| Produção (Neon) | AWS `sa-east-1` | 5432 | `.env.prod` |

## Workflow de Migrations — SEMPRE local antes de prod

1. Edite o schema em `src/lib/db/schema.ts`
2. `npm run db:generate:dev` — gera o arquivo de migration usando `.env.local`
3. `npm run db:migrate:dev` — aplica a migration no Docker local
4. Teste a feature end-to-end contra o banco local
5. `npm run db:migrate:prod` — aplica no Neon (prod) **somente após validação local**

> **Atenção:** `db:migrate:dev` usa `drizzle-kit migrate` (migrations versionadas).
> `db:migrate:prod` usa `drizzle-kit push` (sync direto do schema no Neon).
> Nunca execute push em prod sem ter passado pelo passo local primeiro.

> ⚠️ **RLS policies não estão declaradas no `schema.ts`** — vivem nas migrations
> 0007/0008/0014. `drizzle-kit push` considera qualquer objeto fora do schema
> como "remover pra sincronizar" e vai dropar RLS + policies silenciosamente.
> Antes de rodar `db:migrate:prod`:
>  - rode `npm run db:generate:prod` primeiro pra ver o diff proposto, OU
>  - passe `--strict` no push pra confirmação interativa
>
> Se policies foram dropadas por acidente, restaurar com:
> `dotenv -e .env.prod -- npx tsx src/lib/db/restore-rls-policies.ts`

## Scripts disponíveis

| Script | Descrição |
|--------|-----------|
| `db:generate:dev` | Gera arquivo de migration (`.env.local`) |
| `db:generate:prod` | Gera arquivo de migration (`.env.prod`) |
| `db:migrate:dev` | Aplica migrations no Docker local |
| `db:migrate:prod` | Push do schema para o Neon (prod) |
| `db:studio:dev` | Abre Drizzle Studio contra o banco local |
| `db:studio:prod` | Abre Drizzle Studio contra o banco prod |
| `db:seed:dev` | Seed de dados padrão no banco local |
| `db:seed:prod` | Seed de dados padrão no banco prod |

# Módulo de Canais (Integração Marketplaces)

Em implementação. Primeira integração: TikTok Shop.

## Documentos de referência

- **Arquitetura:** `docs/arquitetura/modulo-canais.md` (ler antes de mexer no módulo)
- **Especificações de implementação:** `specs/canais/tiktok/*.md` (uma por tarefa/RITM)
- **Referência da API TikTok:** `docs/referencias/tiktok-shop-api.md` (alimentada manualmente com trechos da doc oficial)

## Princípio chave

O ERP núcleo **não conhece marketplace específico**. Existe a abstração `ICanalAdapter` em `src/lib/canais/types.ts`; cada marketplace é uma implementação da interface.

**Ao adicionar marketplace novo:** criar novo adapter em `src/lib/canais/<marketplace>/`. **Nunca** alterar código do núcleo pra acomodar especificidade de marketplace.

## Stack do módulo

- **Jobs/crons/webhooks duráveis:** Inngest (`src/inngest/functions/`)
- **Criptografia de credenciais:** AES-256-GCM via `src/lib/crypto.ts` (node:crypto nativo, sem libs)
- **Validação de payloads:** Zod
- **Logs estruturados:** tabela `log_sincronizacao_canal` no Postgres (não `console.log`)
- **HTTP client:** `fetch` nativo (sem axios)
- **State OAuth:** HMAC-SHA256 em query param (`src/lib/oauth-state.ts`), não cookie

## Regras inegociáveis

- ❌ **NUNCA** logar `access_token`, `refresh_token`, `app_secret`, `shop_cipher` em plaintext
- ❌ **NUNCA** salvar tokens no banco sem passar por `encrypt()` do `src/lib/crypto.ts`
- ❌ **NUNCA** processar webhook síncrono dentro do route handler (sempre disparar evento Inngest, responder 200 rápido)
- ❌ **NUNCA** responder 4xx/5xx pra webhook do TikTok, exceto erro de infra nossa (evita suspensão do webhook)
- ❌ **NUNCA** comparar HMAC/assinaturas com `===` ou `==` (sempre `timingSafeEqual` do `node:crypto`)
- ❌ **NUNCA** chamar API externa dentro de transação de banco (lock longo, risco de deadlock)
- ✅ **SEMPRE** usar `sanitizar()` de `src/lib/canais/tiktok-shop/http.ts` antes de gravar payloads em `log_sincronizacao_canal`

# Workflow de features via `specs/`

Features complexas são organizadas em `specs/<feature>/`, com **um arquivo MD por tarefa** (padrão RITM, inspirado em ServiceNow). Cada MD é auto-contido: descreve arquivos a criar, especificação, testes obrigatórios e critérios de aceitação.

## Como executar um RITM

Prompt padrão ao começar uma tarefa:

```
Leia CLAUDE.md (que aponta pra AGENTS.md) e docs/arquitetura/<feature>.md.
Depois implemente specs/<feature>/RITM-<NN>-<nome>.md seguindo exatamente
a especificação. Execute os critérios de aceitação descritos no final do
documento antes de considerar pronto.

Se precisar de detalhes de API externa, consulte docs/referencias/. Se a
seção necessária estiver vazia ou marcada com ⚠️, pare e me avise antes
de chutar formato.
```

## Regras

- **Um RITM por commit/PR.** Não misturar tarefas.
- **Validar critérios de aceitação** antes de considerar done — eles estão no fim de cada MD.
- **Se a spec estiver ambígua ou algo não bater com a realidade do código**, pausar e perguntar. Não inventar/chutar.
- **Se seção de `docs/referencias/` estiver vazia**, pausar. Não implementar com formato assumido.

# Variáveis de ambiente (módulo de canais)

Adicionar ao `.env.local` (dev) e `.env.prod` (Neon):

```bash
# Criptografia de credenciais OAuth
# Gerar com: openssl rand -base64 32
ENCRYPTION_MASTER_KEY=<32 bytes base64>
OAUTH_STATE_SECRET=<32 bytes base64, DIFERENTE da ENCRYPTION_MASTER_KEY>

# TikTok Shop (Custom App criado em partner.tiktokshop.com)
TIKTOK_SHOP_APP_KEY=
TIKTOK_SHOP_APP_SECRET=
TIKTOK_SHOP_WEBHOOK_KEY=
TIKTOK_SHOP_API_VERSION=202309      # validar versão atual na doc
TIKTOK_SHOP_REGION=BR

# URL pública da app (pra redirect de OAuth e webhooks)
# Em dev: URL do túnel HTTPS (Cloudflare Tunnel, ngrok, etc)
# Em prod: URL real do Vercel
NEXT_PUBLIC_APP_URL=https://<tunel-dev-ou-prod>

# Inngest (conta gratuita em inngest.com)
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=
```

⚠️ OAuth e webhooks do TikTok **exigem HTTPS público**. Em dev local (Docker), Next.js roda em `localhost:3000` sem HTTPS, então é obrigatório um túnel (Cloudflare Tunnel recomendado). A URL do túnel vai em `NEXT_PUBLIC_APP_URL` e precisa ser cadastrada no Partner Center como Redirect URL + Webhook URL.

# Variáveis de ambiente (módulo de expedição diária)

```bash
# Senha para autorizar reimpressão de etiquetas já impressas (janela 30d)
# Gerar: openssl rand -base64 24
EXPEDICAO_REPRINT_PASSWORD=
```

A senha é validada server-side em `POST /api/expedicao-diaria/tracking-ids/grant-reprint` com `crypto.timingSafeEqual`. Em troca, o endpoint emite um token HMAC-SHA256 (TTL 60s, assinado com `OAUTH_STATE_SECRET`) que o `POST /historico` aceita pra autorizar reimpressão. Sem essa env var configurada o endpoint retorna 503.

# Gestão de segredos

- **Em env vars:** ok pra MVP. Nunca commitar (`.env.local`, `.env.prod` no `.gitignore`).
- **No banco:** tudo sensível (tokens OAuth, futuros certificados digitais A1, credenciais de outros canais) passa por `encrypt()` antes do INSERT.
- **Em logs:** usar `sanitizar()` de `src/lib/canais/tiktok-shop/http.ts` pra redactar campos sensíveis antes de serializar. Lista atual de campos redactados: `access_token`, `refresh_token`, `app_secret`, `shop_cipher`, `authorization`.
- **Em respostas de API (endpoints do ERP):** jamais retornar tokens ou credenciais completas no JSON. Só metadados (expira em, status, etc).
- **Migração pra KMS:** planejada pra quando o ERP começar a ter clientes SaaS externos. Ponto de reabertura: antes do primeiro onboarding de cliente pagante fora da NWC/AVZ.
