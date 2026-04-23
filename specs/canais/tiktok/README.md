# Entrega: Módulo de Canais (Onda 0) — TikTok Shop

**O que este pacote contém:** toda a documentação e especificação pra você começar a implementação do módulo de integração com TikTok Shop no seu ERP, trabalhando com Claude Code.

---

## Como aplicar no seu projeto

### 1. Copiar os arquivos pra raiz do projeto

Os arquivos deste pacote seguem a estrutura que vai ficar no seu repo. Descompacta na raiz do projeto:

```
<seu projeto>/
├── docs/
│   ├── arquitetura/
│   │   └── modulo-canais.md        ← arquitetura de referência
│   └── referencias/
│       └── tiktok-shop-api.md      ← você vai preencher com trechos da doc
└── specs/
    └── canais/
        └── tiktok/
            ├── README.md           ← índice e ordem dos RITMs
            ├── RITM-01-crypto.md
            ├── RITM-02-schema.md
            ├── RITM-03-oauth-state.md
            ├── RITM-04-oauth-ida.md
            ├── RITM-05-oauth-callback.md
            ├── RITM-06-sign-hmac.md
            ├── RITM-07-route-handlers.md
            ├── RITM-08-ui-conectar.md
            ├── RITM-09-inngest-refresh.md
            ├── RITM-10-webhook-receiver.md
            └── RITM-11-dashboard.md
```

### 2. Patch do AGENTS.md

Seu `CLAUDE.md` é só `@AGENTS.md` (ponteiro). O conteúdo vai pro `AGENTS.md`.

O arquivo `PATCH-CLAUDE-MD.md` contém 4 seções novas pra **adicionar no fim** do seu `AGENTS.md`. Não mexe no bloco Next.js nem na seção Database que já existem. Segue aditivo.

Abre o `PATCH-CLAUDE-MD.md`, copia os 4 blocos e cola no fim do `AGENTS.md`.

### 3. Commitar a documentação

```bash
git add docs/ specs/ AGENTS.md
git commit -m "docs: módulo de canais — arquitetura + specs da Onda 0 TikTok"
```

---

## Como começar a implementação

### Semana 1 — RITMs que não dependem da doc TikTok

Estes 3 RITMs podem ser feitos **em paralelo**, nenhum depende de conhecer detalhes da API TikTok:

1. **RITM-01 (crypto)** — módulo de encrypt/decrypt AES-GCM
2. **RITM-02 (schema)** — 5 tabelas novas + migrations
3. **RITM-03 (oauth-state)** — cookie HMAC pro state OAuth

Prompt pra Claude Code:

```
Leia CLAUDE.md e docs/arquitetura/modulo-canais.md.
Depois implemente specs/canais/tiktok/RITM-01-crypto.md seguindo
exatamente a especificação. Execute os critérios de aceitação
descritos no final do documento antes de considerar pronto.
```

(Repita trocando o número do RITM.)

### Pausa — alimentar a doc TikTok

Antes de seguir pros RITMs 04+, você precisa preencher o arquivo `docs/referencias/tiktok-shop-api.md` com trechos da doc oficial do TikTok.

**Primeiros trechos necessários (§1 a §5):**

Abra https://partner.tiktokshop.com/docv2/page/about-partner-center-console no browser e navegue até:

1. **Authorization → Overview** (ou título similar) — copia pro §1 do arquivo
2. **Authorization → Obtain Access Token** — copia pro §2
3. **Authorization → Refresh Access Token** — copia pro §3
4. **Authorization → Get Authorized Shops** (ou Shop API correspondente) — copia pro §4
5. **API Concepts → Signature Algorithm** (ou Common Rules) — copia pro §5 **(CRÍTICO)**

Cada seção tem comentários HTML (`<!-- -->`) com instruções do que procurar especificamente.

Quando terminar o §5 especialmente, **me manda o conteúdo aqui** se tiver dúvida de como interpretar, que eu valido antes do RITM-06.

### Semana 2 — RITMs que dependem da doc

Depois de preencher §1-§5:

4. **RITM-04 (oauth-ida)** — URL de autorização
5. **RITM-05 (oauth-callback)** — troca de code, refresh, listar shops
6. **RITM-06 (sign-hmac)** — assinatura HMAC
7. **RITM-07 (routes)** — endpoints HTTP
8. **RITM-08 (ui)** — página de conectar

Em paralelo à semana 2:

9. **RITM-09 (inngest-refresh)** — pode começar junto com RITM-05

### Pausa 2 — alimentar §6 da doc

Antes do RITM-10, preencher §6 (Webhooks) em `docs/referencias/tiktok-shop-api.md`.

### Semana 3 — RITMs finais

10. **RITM-10 (webhook-receiver)** — depois de preencher §6
11. **RITM-11 (dashboard)** — opcional mas recomendado pra debug

---

## Antes de começar, faça:

### No Partner Center do TikTok Shop

Ainda não criou o Custom App? Siga `specs/canais/tiktok/README.md` → seção "Pré-requisitos antes de iniciar".

Tempo estimado: 30-45 min.

### Criar conta Inngest

https://www.inngest.com → sign up gratuito → criar app.

Tempo estimado: 10 min.

### Gerar as chaves de criptografia

```bash
# Chave mestra de criptografia
openssl rand -base64 32
# Copiar resultado → ENCRYPTION_MASTER_KEY no .env.local

# Secret do OAuth state (diferente)
openssl rand -base64 32
# Copiar resultado → OAUTH_STATE_SECRET no .env.local
```

### Configurar túnel HTTPS pra dev

Recomendo Cloudflare Tunnel (grátis, URL fixa):
https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/

Alternativa: ngrok.

A URL do túnel vai no `NEXT_PUBLIC_APP_URL` do `.env.local` e precisa ser adicionada como Redirect URL + Webhook URL no Custom App do Partner Center.

---

## Checklist de pré-requisitos

Antes de começar o RITM-01, verifique:

- [ ] `docs/`, `specs/` e `CLAUDE.md` atualizados no repo
- [ ] Custom App criado no TikTok Shop Partner Center
- [ ] `app_key`, `app_secret`, `webhook_key` no `.env.local`
- [ ] Emails da NWC e AVZ na Seller Whitelist do app
- [ ] Conta Inngest criada, envs no `.env.local`
- [ ] `ENCRYPTION_MASTER_KEY` e `OAUTH_STATE_SECRET` geradas
- [ ] Túnel HTTPS rodando
- [ ] URLs de callback e webhook registradas no Partner Center

---

## Dúvidas frequentes

**P: O Claude Code precisa de contexto extra pra começar cada RITM?**
R: Não. Cada RITM-XX.md é auto-contido. Ele só lê esse arquivo + CLAUDE.md + arquitetura. Se precisar de doc de API, consulta `docs/referencias/tiktok-shop-api.md`.

**P: E se a doc TikTok tiver mudado desde que o RITM foi escrito?**
R: Cada RITM marca com `⚠️` os pontos que dependem da doc. Se o Claude Code (ou você) notar discrepância, ajustar no momento da implementação e atualizar a seção correspondente em `docs/referencias/`.

**P: Posso pular RITMs?**
R: Só os que não bloqueiam outros. O README do módulo (`specs/canais/tiktok/README.md`) tem o grafo de dependências. RITM-11 (dashboard), por exemplo, é puramente quality-of-life.

**P: E se um RITM falhar no meio?**
R: Cada RITM tem testes + critérios de aceitação. Se algum critério não bate, não marca como done. Me avisa aqui pra a gente revisar a spec ou debugar junto.

**P: Depois da Onda 0, o que vem?**
R: REQ-MKT-002 (processamento de pedidos) e REQ-MKT-003 (sync de estoque — resolve oversell). A gente especifica quando a Onda 0 estiver em produção validada.

---

## Contato

Qualquer dúvida, erro inesperado, ou detalhe que a spec não cobriu — me chama aqui no chat. Melhor pausar e alinhar do que o Claude Code seguir com suposição errada.
