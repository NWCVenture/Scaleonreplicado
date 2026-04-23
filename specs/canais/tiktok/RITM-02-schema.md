# RITM-02 — Schema Drizzle + Migrations

> **Bloqueia:** RITM-05, RITM-07, RITM-09, RITM-10
> **Depende de:** nada (schema base do projeto — `conta_id`, `cnpj_id` etc — já existe)
> **Dependência externa:** nenhuma (não precisa da doc TikTok)

---

## Objetivo

Criar schema Drizzle de 5 novas tabelas do módulo de canais, gerar migration correspondente, aplicar no banco local, ativar RLS. Tabelas são:

1. `canais_venda` — genérica, vale pra TikTok/Shopee/ML
2. `credenciais_oauth_tiktok` — específica TikTok (shop_cipher existe só aqui)
3. `eventos_webhook_tiktok` — log de webhooks recebidos
4. `log_sincronizacao_canal` — log de ida/volta com canal
5. `sku_canal` — mapa SKU interno ↔ SKU externo (populada em ondas futuras, criada agora)

---

## Arquivos a modificar

- `src/lib/db/schema.ts` (adicionar tabelas ao final — ou em arquivo separado importado, se for a convenção)
- `drizzle/migrations/<timestamp>_canais_modulo.sql` (gerado via `drizzle-kit generate`)

---

## Especificação do schema

### Tabela `canais_venda`

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | serial | PK |
| `conta_id` | integer | NOT NULL, FK → `contas.id` |
| `cnpj_id` | integer | NOT NULL, FK → `cnpjs.id` |
| `plataforma` | varchar(50) | NOT NULL. Valores: `'tiktok_shop'`, `'shopee'`, `'mercado_livre'` |
| `identificador_loja` | varchar(200) | NOT NULL. No TikTok é o `shop_id`. |
| `nome_exibicao` | varchar(200) | NOT NULL |
| `emissor_nota` | varchar(50) | NOT NULL, DEFAULT `'proprio'`. Valores: `'proprio'`, `'upseller'`, `'bling'`, `'manual'` |
| `ativo` | boolean | NOT NULL, DEFAULT true |
| `ultima_sync_em` | timestamptz | nullable |
| `criado_em` | timestamptz | NOT NULL, DEFAULT now() |
| `atualizado_em` | timestamptz | NOT NULL, DEFAULT now() |

**Índices:**
- `idx_canais_conta_plataforma` em `(conta_id, plataforma)`

**Unique constraint:**
- `unq_canal_cnpj_loja` em `(cnpj_id, plataforma, identificador_loja)` — impede duplicar loja pro mesmo CNPJ

---

### Tabela `credenciais_oauth_tiktok`

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | serial | PK |
| `canal_venda_id` | integer | NOT NULL, UNIQUE, FK → `canais_venda.id` ON DELETE CASCADE |
| `conta_id` | integer | NOT NULL, FK → `contas.id` (redundância pra RLS) |
| `shop_id` | varchar(100) | NOT NULL |
| `shop_cipher` | text | NOT NULL |
| `access_token_criptografado` | text | NOT NULL |
| `access_token_expira_em` | timestamptz | NOT NULL |
| `refresh_token_criptografado` | text | NOT NULL |
| `refresh_token_expira_em` | timestamptz | NOT NULL |
| `escopos_autorizados` | jsonb | NOT NULL. Array de strings. |
| `seller_name` | varchar(200) | nullable |
| `ultima_renovacao_em` | timestamptz | nullable |
| `status_renovacao` | varchar(30) | NOT NULL, DEFAULT `'ativo'`. Valores: `'ativo'`, `'falha_reauth'`, `'expirado'` |
| `criado_em` | timestamptz | NOT NULL, DEFAULT now() |
| `atualizado_em` | timestamptz | NOT NULL, DEFAULT now() |

**Índices:**
- `idx_tiktok_oauth_expiracao` em `(access_token_expira_em)` — usado pelo job Inngest
- `idx_tiktok_oauth_conta` em `(conta_id)`

---

### Tabela `eventos_webhook_tiktok`

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | serial | PK |
| `canal_venda_id` | integer | nullable, FK → `canais_venda.id`. Nullable porque webhook pode chegar antes de conseguir resolver qual canal. |
| `conta_id` | integer | nullable, FK → `contas.id`. Idem. |
| `tipo_evento` | varchar(100) | NOT NULL |
| `shop_id_externo` | varchar(100) | nullable |
| `payload_json` | jsonb | NOT NULL |
| `headers_json` | jsonb | NOT NULL |
| `assinatura_valida` | boolean | NOT NULL |
| `processado_em` | timestamptz | nullable |
| `erro_processamento` | text | nullable |
| `criado_em` | timestamptz | NOT NULL, DEFAULT now() |

**Índices:**
- `idx_webhook_tipo_data` em `(tipo_evento, criado_em)`
- `idx_webhook_shop` em `(shop_id_externo)`

---

### Tabela `log_sincronizacao_canal`

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | serial | PK |
| `canal_venda_id` | integer | NOT NULL, FK → `canais_venda.id` |
| `conta_id` | integer | NOT NULL, FK → `contas.id` |
| `tipo` | varchar(50) | NOT NULL. Valores: `'oauth_callback'`, `'refresh_token'`, `'list_shops'`, `'api_call'`, `'webhook_received'` |
| `operacao` | varchar(100) | NOT NULL. Ex: nome do endpoint ou método. |
| `payload_enviado` | jsonb | nullable |
| `resposta_recebida` | jsonb | nullable |
| `status_http` | integer | nullable |
| `sucesso` | boolean | NOT NULL |
| `erro_mensagem` | text | nullable |
| `duracao_ms` | integer | nullable |
| `tentativa` | integer | NOT NULL, DEFAULT 1 |
| `criado_em` | timestamptz | NOT NULL, DEFAULT now() |

**Índices:**
- `idx_log_canal_data` em `(canal_venda_id, criado_em)`
- `idx_log_sucesso` em `(sucesso, criado_em)`

**⚠️ IMPORTANTE:** nunca salvar tokens em `payload_enviado` ou `resposta_recebida`. Ao serializar o response, **remover** campos `access_token`, `refresh_token` e `shop_cipher` antes de insertar.

---

### Tabela `sku_canal`

Populada em ondas futuras. Criada agora pra não ter migration separada depois.

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | serial | PK |
| `canal_venda_id` | integer | NOT NULL, FK → `canais_venda.id` |
| `conta_id` | integer | NOT NULL, FK → `contas.id` |
| `produto_id` | integer | nullable, FK → `produtos.id` |
| `sku_interno` | varchar(100) | NOT NULL |
| `sku_externo` | varchar(200) | NOT NULL |
| `product_id_externo` | varchar(200) | nullable |
| `sku_id_externo` | varchar(200) | nullable |
| `buffer_seguranca` | integer | NOT NULL, DEFAULT 0 |
| `ultima_qtd_publicada` | integer | nullable |
| `ultima_sync_em` | timestamptz | nullable |
| `criado_em` | timestamptz | NOT NULL, DEFAULT now() |

**Índices:**
- `idx_sku_canal_produto` em `(canal_venda_id, produto_id)`

**Unique constraint:**
- `unq_sku_canal_externo` em `(canal_venda_id, sku_externo)`

---

## RLS (Row Level Security)

Todas as 5 tabelas habilitam RLS com policy consistente com o padrão do projeto:

```sql
-- Aplicar em migration SQL adicional (ou dentro da migration gerada)

ALTER TABLE canais_venda ENABLE ROW LEVEL SECURITY;
CREATE POLICY canais_venda_isolation ON canais_venda
  USING (conta_id = current_setting('app.conta_id', true)::int);

ALTER TABLE credenciais_oauth_tiktok ENABLE ROW LEVEL SECURITY;
CREATE POLICY credenciais_oauth_tiktok_isolation ON credenciais_oauth_tiktok
  USING (conta_id = current_setting('app.conta_id', true)::int);

ALTER TABLE eventos_webhook_tiktok ENABLE ROW LEVEL SECURITY;
CREATE POLICY eventos_webhook_tiktok_isolation ON eventos_webhook_tiktok
  USING (conta_id IS NULL OR conta_id = current_setting('app.conta_id', true)::int);
-- Note: conta_id pode ser NULL em webhooks que ainda não conseguiram resolver o canal.
-- A policy permite ler registros sem conta_id APENAS via role de sistema (bypass).

ALTER TABLE log_sincronizacao_canal ENABLE ROW LEVEL SECURITY;
CREATE POLICY log_sincronizacao_canal_isolation ON log_sincronizacao_canal
  USING (conta_id = current_setting('app.conta_id', true)::int);

ALTER TABLE sku_canal ENABLE ROW LEVEL SECURITY;
CREATE POLICY sku_canal_isolation ON sku_canal
  USING (conta_id = current_setting('app.conta_id', true)::int);
```

### ⚠️ Exceção: webhook receiver

O endpoint `/api/webhooks/tiktok` (RITM-10) recebe chamadas sem usuário logado. Opções (seguir a que já existir no projeto, se houver):

- **Opção A (recomendada):** usar role com `BYPASSRLS` pra inserir em `eventos_webhook_tiktok`; depois que resolve o `shop_id` → `canal_venda` → `conta_id`, setar `SET LOCAL app.conta_id = X` antes de qualquer leitura adicional.
- **Opção B:** policy permissiva nessa tabela específica pra INSERT.

Decidir com base no padrão existente. Documentar decisão em `docs/arquitetura/modulo-canais.md` seção 5.3.

---

## Como gerar e aplicar a migration

⚠️ **Workflow obrigatório deste projeto:** migration vai **primeiro no Docker local** (`.env.local`, porta 5433), é testada lá, só depois vai pro Neon. Ver `AGENTS.md` → seção "Database" pra detalhes completos. Nunca rodar `db:migrate:prod` sem ter passado antes pelo local.

```bash
# 1. Escrever o schema em src/lib/db/schema.ts

# 2. Gerar arquivo de migration usando .env.local
npm run db:generate:dev

# 3. Revisar o SQL gerado em drizzle/migrations/<timestamp>_*.sql
#    Se drizzle-kit não gerou as policies RLS (provavelmente não gerou — Drizzle
#    não tem suporte nativo pra RLS), adicionar manualmente no final do SQL.
#    Ver seção "RLS" abaixo pra o SQL que precisa ser colado.

# 4. Aplicar no Docker local
npm run db:migrate:dev

# 5. Testar end-to-end contra o banco local (rodar testes + validar manualmente)

# 6. Só depois de validado: aplicar no Neon (prod)
npm run db:migrate:prod
```

⚠️ **Atenção ao ponto 3:** drizzle-kit gera o DDL das tabelas, índices e constraints, mas **não gera** os statements `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` nem os `CREATE POLICY`. Esses precisam ser adicionados **manualmente ao final do arquivo SQL gerado** antes de rodar `db:migrate:dev`. Use o bloco SQL da seção "RLS" deste documento como fonte.

⚠️ **Sobre `db:migrate:prod`:** conforme `AGENTS.md`, esse comando usa `drizzle-kit push` (sync direto no Neon, não versionado). Se as policies RLS não estiverem no schema.ts (estão só no arquivo de migration versionado), o `push` **não** vai aplicá-las no prod. Soluções:
- **Opção A:** adicionar as policies via SQL direto no Neon depois do push (script one-off, documentar)
- **Opção B:** migrar `db:migrate:prod` pra usar `drizzle-kit migrate` ao invés de `push`, pra que as migrations versionadas (com o SQL de RLS) rodem no prod também
- **Recomendação:** opção B. Ponto de reabertura — avaliar junto com Gabriel antes de rodar o primeiro `db:migrate:prod` desta feature.

---

## Testes obrigatórios

Em `src/lib/db/canais.test.ts` (ou similar):

1. ✅ Inserir `canal_venda` com `conta_id = 1` e depois ler com `SET app.conta_id = 2` **não retorna** o registro (RLS funcionando)
2. ✅ Tentar inserir `canal_venda` com `(cnpj_id, plataforma, identificador_loja)` duplicado **falha** com erro de unique constraint
3. ✅ Deletar `canal_venda` também deleta `credenciais_oauth_tiktok` (ON DELETE CASCADE)
4. ✅ Inserir `log_sincronizacao_canal` com `payload_enviado` contendo `access_token` — confirmar que o código **remove** o token antes de inserir (teste de helper, se criado)

---

## Critérios de aceitação

- [ ] Schema Drizzle em `src/lib/db/schema.ts` com 5 tabelas novas
- [ ] Types TypeScript exportados (ex: `type CanalVenda = InferSelectModel<typeof canaisVenda>`)
- [ ] Migration gerada aplicada em dev sem erro
- [ ] RLS ativo em todas as 5 tabelas
- [ ] Testes RLS passam
- [ ] FKs `ON DELETE CASCADE` onde esperado (credenciais segue o canal)
- [ ] `npm run db:migrate:dev` aplica as tabelas no Docker local sem erro
- [ ] `SELECT` nas 5 tabelas no banco local retorna vazio (tabelas criadas)
- [ ] `SELECT relrowsecurity FROM pg_class WHERE relname IN ('canais_venda', 'credenciais_oauth_tiktok', ...)` confirma RLS ativado
- [ ] Só depois de validação local: `npm run db:migrate:prod` aplica no Neon
- [ ] Nenhuma tabela usa snake_case misturado com camelCase (consistente com o projeto)

---

## Dúvidas pra Gabriel resolver antes

- Convenção de nomes das colunas: o projeto usa snake_case no banco e camelCase no TypeScript? (assumi que sim, padrão Drizzle + Postgres — confirmar olhando `src/lib/db/schema.ts` existente)
- Onde ficam os tipos derivados? (`src/lib/db/types.ts`? arquivo por domínio? dentro do próprio schema.ts?) — seguir o padrão existente
- Qual role do banco é usada em dev (Docker) vs. prod (Neon)? Tem `BYPASSRLS` em alguma?
  - Dev local Docker: provavelmente role `postgres` admin (tem bypass)
  - Prod Neon: role usada pelo runtime (confirmar se tem bypass ou não — afeta os jobs do RITM-09 e webhook do RITM-10)
- No Neon, tem role separada pra migrations (superuser) vs runtime (restrita com RLS)? — importa pras policies funcionarem corretamente
