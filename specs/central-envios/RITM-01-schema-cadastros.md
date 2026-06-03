# RITM-01 — Schema dos cadastros do módulo Central de Envios

> **Bloqueia:** RITM-02, RITM-03, RITM-04, RITM-05, RITM-06, RITM-10
> **Depende de:** `modelo_principal`/`modelo_cor`/`modelo_tamanho` já existirem (existem desde 0016), `canais_venda` (existe), `sku_kit_regra`/`sku_kit_componente` (existem)
> **Dependência externa:** nenhuma.

---

## Princípio inegociável: zero hardcode de SKU

**Nenhum modelo, cor, tamanho, alias, regra de kit ou categoria de SKU
pode ser hardcoded em código ou seed.** Toda essa informação é do tenant
e vive no cadastro de modelo/SKU (`modelo_principal`, `modelo_cor`,
`modelo_tamanho`, `sku_kit_regra`, `sku_catalogo`).

Consequências práticas:

- O seed deste RITM **não popula** modelos, cores, tamanhos, aliases ou
  categorias. Só popula defaults **genéricos** de SLA por plataforma
  (TikTok, Shopee, ML), que são informações públicas das próprias
  plataformas, não da NWC.
- Tudo o que era constante na ferramenta original (`PRODUTOS`, `CORES`,
  `TAMANHOS`, `MIX 4 = AZ+CZ+PT+BR`, `BALA→PT`) vira leitura em runtime
  do cadastro de modelo da conta ativa.
- Conta nova entra **vazia** e popula seus próprios produtos. A NWC entra
  no mesmo regime — quem cadastra LUA/NBA/BALA é o operador, na UI.

---

## Objetivo

Criar as tabelas de cadastro do módulo Central de Envios e ampliar
`modelo_principal` para suportar as regras de normalização e explosão
**totalmente cadastro-driven**. No fim deste RITM:

- O cadastro de modelo passa a ter 3 propriedades novas (`corPadrao`,
  `exigeTamanho`, `corMixDefault`) que viabilizam a explosão de SKU
  configurável por modelo.
- Operador consegue cadastrar aliases (`EXG→EGG`, `PRETO→PT`) por modelo
  ou globais.
- Feriados são cadastráveis (manual + sync nacional opt-in).
- Regras de prazo viram dado por plataforma e por canal específico, com
  UI de gerenciamento (RITM separado).
- Categorias do extrator viram dado, **derivadas do cadastro** (RITM-09
  da UI), não regex hardcoded.

Itens criados:

1. **3 colunas novas em `modelo_principal`**: `corPadrao`, `exigeTamanho`, `corMixDefault`
2. **Tabela `tamanho_alias`** — aliases por modelo ou globais
3. **Tabela `cor_alias`** — simétrica
4. **Tabela `feriado`** — calendário pro cálculo de dias úteis
5. **Enum `canal_estrategia_prazo`** + **tabela `canal_regra_prazo`** — SLA configurável por canal
6. **Tabela `categoria_sku`** — categorias do extrator (regex/composição), cadastráveis pelo operador
7. **Seed mínimo de plataforma** (script tsx, idempotente) — apenas defaults genéricos de SLA: TikTok 2 dias úteis, Shopee 1 dia útil, ML campo explícito. **Nada NWC-específico.**

> **Fora de escopo deste RITM**:
> - `sessao_central_envios` + `planejamento_envios` (vão pro **RITM-07**).
> - Endpoints HTTP — RITM-10.
> - UI de cadastro de feriado (botão + modal calendário) — entra junto com o RITM-10 das configurações.
> - Sync de feriados nacionais via BrasilAPI — entra no RITM-06 (cálculo de prazo).

---

## Arquivos a modificar

| Arquivo | Mudança |
|---|---|
| `src/lib/db/schema.ts` | Adicionar 3 colunas em `modelo_principal`, 5 tabelas novas, 1 enum novo, types exportados |
| `drizzle/migrations/<timestamp>_central_envios_cadastros.sql` | Gerado via `db:generate:dev`. Adicionar RLS manualmente. |
| `src/lib/db/restore-rls-policies.ts` | Adicionar as 5 tabelas novas ao array `TABELAS_PADRAO` |
| `src/lib/db/seeds/central-envios-nwc-seed.ts` | **Novo** — seed idempotente dos dados NWC |
| `package.json` | Adicionar script `db:seed:central-envios:dev` / `:prod` apontando pro tsx do seed |

---

## Especificação do schema

### 1. Ampliação de `modelo_principal` (3 colunas)

Adicionar **ao final** da definição de `modelo_principal`, mantendo
backwards compat — as 3 colunas são nullable ou têm default genérico
(não assume nada do domínio do cliente).

| Coluna | Tipo | Regras | Função |
|---|---|---|---|
| `cor_padrao` | `text` | nullable | Quando um SKU do modelo aparece **sem cor**, assume esta cor. Editável na UI de cadastro de modelo. Exemplo de uso (cliente decide): produto de cor única padrão pode setar isso para que SKUs antigos sem cor explícita ainda explodam. |
| `exige_tamanho` | `boolean` | NOT NULL DEFAULT true | `false` para produtos de tamanho único. Editável na UI de cadastro de modelo. |
| `cor_mix_default` | `jsonb` | nullable, schema: `Record<string, string[]>` | Override do MIX por N. Chave = N como string, valor = array de cores **em ordem**. Ex.: `{ "3": ["AZ","BR","PT"], "4": ["AZ","CZ","PT","BR"] }`. **Quando null, MIX N usa top-N de `modelo_cor` ativas (ordem alfabética por `codigo`)** — esse é o caminho recomendado; o override jsonb existe só pra casos onde o cliente quer congelar uma seleção específica diferente das cores ativas. |

**Sem novos índices** — buscas continuam por `(contaId, codigo)`.

**Tipos TS**: `InferSelectModel<typeof modeloPrincipal>` já reflete
automaticamente as colunas — nenhum export adicional.

> **UI de cadastro de modelo precisa expor as 3 colunas.** Provavelmente
> já existe uma tela em `/cadastros/modelos` (ou equivalente). Se sim,
> adicionar 3 inputs: `corPadrao` (select com cores do modelo + "nenhuma"),
> `exigeTamanho` (toggle), `corMixDefault` (JSON editor avançado, escondido
> atrás de "configuração avançada"). Se a tela não existir ainda, abrir
> RITM dedicado — fora do escopo deste.

### 2. Tabela `tamanho_alias`

Resolve aliases de tamanho antes da explosão. Escopo opcional por modelo
(precedência: alias específico do modelo > alias global).

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `text` | PK |
| `conta_id` | `text` | NOT NULL, FK → `conta.id` ON DELETE CASCADE |
| `modelo_id` | `text` | nullable, FK → `modelo_principal.id` ON DELETE CASCADE. `null` = alias global da conta. |
| `codigo_alias` | `text` | NOT NULL — texto que aparece no SKU original |
| `codigo_real` | `text` | NOT NULL — texto canônico (deve existir em `tamanho_catalogo` ou `modelo_tamanho`, **não validado no banco**) |
| `created_at` | `timestamp` | NOT NULL DEFAULT NOW() |

**Índices:**
- `idx_tamanho_alias_conta` em `(conta_id)`
- `idx_tamanho_alias_modelo` em `(modelo_id)`
- `uq_tamanho_alias_codigo` unique em `(conta_id, modelo_id, codigo_alias)`
  — modelo_id null conta como valor próprio no Postgres (`NULLS NOT DISTINCT`
  precisa ser declarado explicitamente). **Usar `NULLS NOT DISTINCT`** na
  unique pra evitar duplicar alias global.

> ⚠️ `NULLS NOT DISTINCT` em unique index só funciona Postgres 15+. Neon usa
> 16 e local roda 17 (conforme `docker-compose.yml`). OK.

### 3. Tabela `cor_alias`

Simétrico ao `tamanho_alias`. Mesma estrutura.

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `text` | PK |
| `conta_id` | `text` | NOT NULL, FK → `conta.id` ON DELETE CASCADE |
| `modelo_id` | `text` | nullable, FK → `modelo_principal.id` ON DELETE CASCADE |
| `codigo_alias` | `text` | NOT NULL |
| `codigo_real` | `text` | NOT NULL |
| `created_at` | `timestamp` | NOT NULL DEFAULT NOW() |

**Índices:** idem `tamanho_alias` (substituindo o prefixo).

### 4. Tabela `feriado`

Calendário consultado por `adicionarDiasUteis`. Cache em memória por
request (impl. fica em RITM-06).

**Feriado cadastrado é excluído da contagem de dias úteis** — sáb/dom
+ qualquer linha desta tabela na data de avaliação pulam para o próximo
dia.

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `text` | PK |
| `conta_id` | `text` | NOT NULL, FK → `conta.id` ON DELETE CASCADE |
| `data` | `date` | NOT NULL — armazenada como `DATE` puro (sem timezone) |
| `descricao` | `text` | NOT NULL |
| `fonte` | `text` | NOT NULL DEFAULT `'manual'` — `'manual'` quando criado via botão "Informar feriado" da UI; `'nacional_api'` quando sincronizado de uma API pública. Não é enum porque pode ganhar fontes (estadual_api, municipal_api, …). |
| `referencia_externa` | `text` | nullable — `id`/`slug` do feriado na fonte externa (usado para idempotência no sync nacional) |
| `created_at` | `timestamp` | NOT NULL DEFAULT NOW() |

**Índices:**
- `idx_feriado_conta_data` em `(conta_id, data)` — query principal `WHERE conta_id=? AND data BETWEEN ? AND ?`
- `uq_feriado_conta_data` unique em `(conta_id, data)` — não duplicar feriado

> Tipo Drizzle: usar `date('data', { mode: 'string' })` pra retornar
> `'YYYY-MM-DD'` direto, evitando o bug de timezone documentado em §11 do
> doc de arquitetura.

#### UI esperada (fora do escopo deste RITM, abrir RITM-10 separado)

- **Botão "Informar feriado"** abre modal com calendário (sugestão:
  `<Calendar>` do shadcn/ui com `mode="multiple"` ou `mode="single"`),
  permite escolher data + descrição. Salva como `fonte='manual'`.
- **Botão "Sincronizar feriados nacionais"** chama endpoint que consome
  a [BrasilAPI](https://brasilapi.com.br/) — endpoint público, gratuito,
  sem autenticação: `GET https://brasilapi.com.br/api/feriados/v1/{ano}`.
  Faz upsert em `feriado` com `fonte='nacional_api'` e
  `referencia_externa=<nome do feriado normalizado>`. Idempotente: rodar
  duas vezes não duplica.
- **Listagem** mostra feriados do ano corrente + próximos 12 meses,
  agrupados por mês, com badge da `fonte` (manual = cinza, nacional = azul)
  e botão de remover.

> Decisão: BrasilAPI é a opção mais simples (sem chave, sem rate limit
> documentado pra esse endpoint). Alternativas: API do governo
> (`/feriados.csv` do MTE) ou JSON estático versionado no repo. BrasilAPI
> ganha pela simplicidade — implementação detalhada vai pro RITM-06.

### 5. Enum `canal_estrategia_prazo` + tabela `canal_regra_prazo`

#### Enum `canal_estrategia_prazo`

```
'DIAS_UTEIS_POS_VENDA'  -- TikTok: created_at + N dias úteis
'CAMPO_EXPLICITO'       -- ML: extrai do campo "Estado" via regex
'HIBRIDO'               -- tenta CAMPO_EXPLICITO, fallback DIAS_UTEIS
```

#### Tabela `canal_regra_prazo`

Uma regra ativa por `(contaId, canalVendaId)` OU `(contaId, plataforma, canalVendaId IS NULL)` como default da plataforma.

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `text` | PK |
| `conta_id` | `text` | NOT NULL, FK → `conta.id` ON DELETE CASCADE |
| `canal_venda_id` | `text` | nullable, FK → `canais_venda.id` ON DELETE CASCADE — `null` = default da plataforma na conta |
| `plataforma` | `plataforma_canal` | NOT NULL — duplicado pra suportar regra default por plataforma sem canal específico |
| `estrategia` | `canal_estrategia_prazo` | NOT NULL |
| `dias_uteis` | `integer` | nullable — obrigatório quando estratégia inclui `DIAS_UTEIS_POS_VENDA` (validado em código) |
| `campo_prazo` | `text` | nullable — obrigatório quando estratégia inclui `CAMPO_EXPLICITO`. Ex.: `'Estado'` |
| `regex_prazo` | `text` | nullable — usado com `CAMPO_EXPLICITO`. Ex.: `'coleta do dia (\\d+) de (\\w+)'` |
| `fallback_hoje` | `boolean` | NOT NULL DEFAULT false — quando `CAMPO_EXPLICITO` não casa, retorna HOJE em vez de SEM_DATA |
| `ativo` | `boolean` | NOT NULL DEFAULT true |
| `created_at` | `timestamp` | NOT NULL DEFAULT NOW() |
| `updated_at` | `timestamp` | NOT NULL DEFAULT NOW() |

**Índices:**
- `idx_canal_regra_prazo_conta` em `(conta_id)`
- `uq_canal_regra_prazo_canal` unique em `(conta_id, canal_venda_id)`
  com `NULLS NOT DISTINCT` — uma regra por canal, e no máximo uma regra
  default (canal_venda_id null) por conta+plataforma.
- `uq_canal_regra_prazo_default_plataforma` unique em
  `(conta_id, plataforma)` **WHERE canal_venda_id IS NULL** — garante no
  máximo uma default por plataforma.

> ⚠️ Drizzle suporta unique parcial via `uniqueIndex(...).where(sql\`canal_venda_id IS NULL\`)`.
> Conferir compatibilidade com `drizzle-kit push` (vide AGENTS.md — push
> ignora WHERE em alguns casos). Se push apagar, adicionar ao supplements.

### 6. Tabela `categoria_sku`

Substitui as regex hardcoded da ferramenta standalone. Cada categoria
tem regras em jsonb avaliadas em runtime. **Tudo cadastrável pelo
operador** — não há categoria padrão NWC pré-instalada.

A UI (RITM-09/10) deve **sugerir categorias automáticas** a partir do
cadastro de modelos do tenant — exemplo: para cada modelo `X` ativo,
oferecer com 1 clique criar:

- `X unitário` → `[{tipo:'composicao', modeloCodigo: X, qtdMin: 1, qtdMax: 1}]`
- `KIT 2 X` → `[{tipo:'composicao', modeloCodigo: X, qtdMin: 2, qtdMax: 2}]`
- etc.

Mas essa sugestão é **opcional e feita na UI**. Nada vai no banco como
seed.

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `text` | PK |
| `conta_id` | `text` | NOT NULL, FK → `conta.id` ON DELETE CASCADE |
| `nome` | `text` | NOT NULL — exibido no dropdown do extrator |
| `ordem` | `integer` | NOT NULL DEFAULT 0 — ordenação na UI |
| `ativo` | `boolean` | NOT NULL DEFAULT true |
| `regras` | `jsonb` | NOT NULL — array de regras OR. Cada regra: `{ tipo: 'regex'|'composicao'|'tag', ... }` |
| `created_at` | `timestamp` | NOT NULL DEFAULT NOW() |
| `updated_at` | `timestamp` | NOT NULL DEFAULT NOW() |

**Schema TypeScript do `regras`:**

```ts
type CategoriaRegra =
  | { tipo: 'regex'; pattern: string; flags?: string }
  | { tipo: 'composicao'; modeloCodigo: string; qtdMin?: number; qtdMax?: number }
  | { tipo: 'tag'; tags: string[] };

type CategoriaRegras = CategoriaRegra[]; // OR entre regras
```

Drizzle: declarar a coluna com `.$type<CategoriaRegra[]>()`.

**Índices:**
- `idx_categoria_sku_conta` em `(conta_id)`
- `uq_categoria_sku_nome_conta` unique em `(conta_id, nome)`

> ⚠️ Regex inválida na coluna é problema de **runtime** — validar no
> endpoint (RITM-10) com `try { new RegExp(pattern, flags) }`. Executar com
> timeout no apply.

---

## Convenções (resumo)

- **IDs**: `generateId()` de `@/lib/utils` (mesmo padrão de `coleta_bipagem`, `sku_kit_regra`, etc.).
- **`contaId` default `"nwc-root"`?**: as tabelas existentes do projeto (sku_catalogo, sku_kit_regra) usam `default("nwc-root")`. **NÃO usar default** nestas tabelas novas — tudo já roda no fluxo multi-tenant ativo, e default oculta bugs. Espelhar `modelo_principal` que **não tem default**.
- **camelCase em TS, snake_case no banco** (padrão do `schema.ts`).
- **`updatedAt` automático**: como nas demais tabelas, **sem trigger** — o app é responsável por atualizar no UPDATE.

---

## RLS (Row Level Security)

5 tabelas novas → 5 policies de isolamento por `conta_id`, no mesmo modelo
das demais. Policy padrão (`current_setting('app.conta_atual', true)`).

```sql
-- 1. tamanho_alias
ALTER TABLE tamanho_alias ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tamanho_alias
  USING (conta_id = current_setting('app.conta_atual', true))
  WITH CHECK (conta_id = current_setting('app.conta_atual', true));

-- 2. cor_alias
ALTER TABLE cor_alias ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cor_alias
  USING (conta_id = current_setting('app.conta_atual', true))
  WITH CHECK (conta_id = current_setting('app.conta_atual', true));

-- 3. feriado
ALTER TABLE feriado ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON feriado
  USING (conta_id = current_setting('app.conta_atual', true))
  WITH CHECK (conta_id = current_setting('app.conta_atual', true));

-- 4. canal_regra_prazo
ALTER TABLE canal_regra_prazo ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON canal_regra_prazo
  USING (conta_id = current_setting('app.conta_atual', true))
  WITH CHECK (conta_id = current_setting('app.conta_atual', true));

-- 5. categoria_sku
ALTER TABLE categoria_sku ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON categoria_sku
  USING (conta_id = current_setting('app.conta_atual', true))
  WITH CHECK (conta_id = current_setting('app.conta_atual', true));
```

**Adicionar essas 5 tabelas ao array `TABELAS_PADRAO`** em
`src/lib/db/restore-rls-policies.ts`, antes do `as const` final:

```ts
// Módulo Central de Envios — Cadastros (0028, RITM-01)
"tamanho_alias",
"cor_alias",
"feriado",
"canal_regra_prazo",
"categoria_sku",
```

---

## Supplements (`db:supplements:prod`)

Avaliar se o **unique index parcial** de `canal_regra_prazo`
(`uq_canal_regra_prazo_default_plataforma WHERE canal_venda_id IS NULL`)
sobrevive ao `drizzle-kit push`. Se não, criar:

`src/lib/db/apply-central-envios-ritm-01-supplements.ts`:

```ts
import postgres from "postgres";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não definida");
}
const client = postgres(process.env.DATABASE_URL, {
  ssl: process.env.DATABASE_URL.includes("sslmode=require") ? "require" : false,
});

async function main() {
  await client.begin(async (tx) => {
    await tx.unsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_canal_regra_prazo_default_plataforma
      ON canal_regra_prazo (conta_id, plataforma)
      WHERE canal_venda_id IS NULL
    `);
  });
  await client.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
```

E encadear no script `db:supplements:prod` em `package.json`.

> Se a verificação confirmar que o push preserva o parcial, descartar o
> supplements — não criar arquivo só por precaução.

---

## Seed mínimo de defaults por plataforma (idempotente)

`src/lib/db/seeds/central-envios-defaults-seed.ts`:

População **genérica** das regras de prazo padrão por plataforma. Roda
contra qualquer conta (`conta_id` do `SEED_CONTA_ID` ou `nwc-root` se
ausente). **Nada de modelo/cor/tamanho/alias/categoria** — tudo isso vem
do cadastro do tenant, não do seed.

### O que o seed faz

Apenas **3 registros** em `canal_regra_prazo` (defaults por plataforma,
`canal_venda_id = NULL`):

| Plataforma         | Estratégia              | Config                                                                 |
|--------------------|--------------------------|------------------------------------------------------------------------|
| `tiktok_shop`      | `DIAS_UTEIS_POS_VENDA`  | `diasUteis: 2`                                                         |
| `shopee`           | `DIAS_UTEIS_POS_VENDA`  | `diasUteis: 1`                                                         |
| `mercado_livre`    | `CAMPO_EXPLICITO`       | `campoPrazo: 'Estado'`, `regexPrazo: 'coleta do dia (\\d+) de (\\w+)'`, `fallbackHoje: true` |

> Esses 3 são considerados **fatos públicos das plataformas**, não
> conhecimento NWC. TikTok publica que é "2 dias úteis de prazo de envio",
> Shopee "1 dia útil", e ML expõe o campo `Estado` com a frase fixa.
>
> Mesmo assim, **tudo é editável depois** via UI de configurações
> (RITM-10). O seed só dá ponto de partida pra conta nova não começar
> com SLA `null`.

### O que o seed NÃO faz

| Categoria                 | Origem real                                                  |
|---------------------------|---------------------------------------------------------------|
| Modelos (LUA, NBA, etc.)  | Cadastro de modelo (UI de `modelo_principal`)                |
| Cores                     | `modelo_cor` (por modelo) ou `cor_catalogo` (global)         |
| Tamanhos                  | `modelo_tamanho` (por modelo) ou `tamanho_catalogo` (global) |
| Kit rules                 | `sku_kit_regra` via UI de Coletas (`/coletas/configuracoes`) |
| Aliases (cor/tamanho)     | `cor_alias` / `tamanho_alias` via UI de configurações        |
| Categorias do extrator    | `categoria_sku` via UI (com sugestão automática a partir do cadastro) |
| Feriados                  | Botão "Informar feriado" + sync BrasilAPI (RITM-06)          |

### Idempotência

```ts
await tx.insert(canalRegraPrazo)
  .values({ id: generateId(), contaId, plataforma: 'tiktok_shop', ... })
  .onConflictDoUpdate({
    target: [canalRegraPrazo.contaId, canalRegraPrazo.plataforma], // só onde canal_venda_id IS NULL
    where: sql`${canalRegraPrazo.canalVendaId} IS NULL`,
    set: { /* … só atualiza campos que ainda estavam null pra não pisar em config manual */ },
  });
```

> Importante: se o operador **já alterou o SLA da plataforma na UI**,
> rodar o seed de novo **não pode sobrescrever**. Estratégia: o seed só
> faz UPSERT em campos que ainda estão `null`, ou só insere se a linha
> não existir. Implementar como "insert if not exists" (`onConflictDoNothing`)
> em vez de `onConflictDoUpdate`.

### Uso

```bash
# Dev local
dotenv -e .env.local -- npx tsx src/lib/db/seeds/central-envios-defaults-seed.ts

# Prod (Neon)
dotenv -e .env.prod -- npx tsx src/lib/db/seeds/central-envios-defaults-seed.ts

# Conta-alvo customizada
SEED_CONTA_ID=outra-conta dotenv -e .env.local -- npx tsx ...
```

Scripts em `package.json`:

```json
"db:seed:central-envios:dev":  "dotenv -e .env.local -- npx tsx src/lib/db/seeds/central-envios-defaults-seed.ts",
"db:seed:central-envios:prod": "dotenv -e .env.prod  -- npx tsx src/lib/db/seeds/central-envios-defaults-seed.ts"
```

---

## Type exports (TypeScript)

No fim do `schema.ts`, exportar:

```ts
export type TamanhoAlias = InferSelectModel<typeof tamanhoAlias>;
export type CorAlias = InferSelectModel<typeof corAlias>;
export type Feriado = InferSelectModel<typeof feriado>;
export type CanalRegraPrazo = InferSelectModel<typeof canalRegraPrazo>;
export type CanalEstrategiaPrazo =
  (typeof canalEstrategiaPrazoEnum.enumValues)[number];
export type CategoriaSku = InferSelectModel<typeof categoriaSku>;

// Schema do JSON em categoria_sku.regras (também usado pelo extrator)
export type CategoriaRegra =
  | { tipo: "regex"; pattern: string; flags?: string }
  | { tipo: "composicao"; modeloCodigo: string; qtdMin?: number; qtdMax?: number }
  | { tipo: "tag"; tags: string[] };
```

---

## Workflow obrigatório

⚠️ **Sempre local antes de prod** (ver `AGENTS.md` → Database):

```bash
# 1. Editar schema.ts
# 2. Gerar migration
npm run db:generate:dev

# 3. Revisar SQL gerado em drizzle/migrations/. Adicionar manualmente:
#    - ALTER TABLE ... ENABLE ROW LEVEL SECURITY  (5×)
#    - CREATE POLICY tenant_isolation ON ... (5×)
#    - Confirmar que o ALTER TABLE modelo_principal ADD COLUMN ... foi gerado

# 4. Aplicar local
npm run db:migrate:dev

# 5. (opcional) Aplicar supplements local — só se criou o arquivo
dotenv -e .env.local -- npx tsx src/lib/db/apply-central-envios-ritm-01-supplements.ts

# 6. Testar via Studio
npm run db:studio:dev

# 7. Seed defaults de plataforma local (sanity check do shape)
npm run db:seed:central-envios:dev

# 8. Atualizar restore-rls-policies.ts com as 5 tabelas

# 9. Diff contra prod ANTES do push (vai mostrar se o push vai apagar RLS)
npm run db:generate:prod

# 10. Aplicar no Neon
npm run db:migrate:prod
dotenv -e .env.prod -- npx tsx src/lib/db/restore-rls-policies.ts
# (opcional) supplements + seed prod
dotenv -e .env.prod -- npx tsx src/lib/db/apply-central-envios-ritm-01-supplements.ts
npm run db:seed:central-envios:prod
```

---

## Testes obrigatórios

Criar `src/lib/db/__tests__/central-envios-cadastros.test.ts`:

1. ✅ Inserir `tamanho_alias` com `conta_id='A'` + `SET app.conta_atual='B'` → SELECT retorna 0 linhas (RLS).
2. ✅ Inserir `tamanho_alias` global (`modelo_id=null`) com `codigo_alias='EXG'` duas vezes (mesma conta) → segundo falha (unique com `NULLS NOT DISTINCT`).
3. ✅ Inserir `tamanho_alias` por modelo (`modelo_id=X`, `codigo_alias='EXG'`) e outro global (`modelo_id=null`, `codigo_alias='EXG'`) — ambos passam (escopo diferente).
4. ✅ Deletar `modelo_principal` → `tamanho_alias` / `cor_alias` correspondentes cascateiam.
5. ✅ Inserir 2 `canal_regra_prazo` default (canal_venda_id null) com mesma `(conta_id, plataforma)` → segundo falha (unique parcial).
6. ✅ Inserir 1 default + 1 com canal_venda_id setado, mesma plataforma → ambos passam.
7. ✅ `categoria_sku.regras` aceita array vazio `[]` e jsonb com shape de regex (`{tipo:'regex', pattern:'^X'}`); shape inválido **não é validado no banco** — checagem é no endpoint.
8. ✅ `feriado.data` rejeita timestamp com hora (usar `date`, não `timestamp`).
9. ✅ Feriado duplicado mesma `(conta_id, data)` falha por unique constraint.
10. ✅ Roda o seed 2× — segunda execução é no-op (`onConflictDoNothing`), não sobrescreve config manual feita entre execuções (teste: rodar seed, dar UPDATE manual em `diasUteis: 5`, rodar seed de novo, conferir que ficou em `5`).
11. ✅ Depois do seed: 3 linhas em `canal_regra_prazo` com `canal_venda_id IS NULL`, uma por plataforma, com os valores especificados (TikTok=2, Shopee=1, ML=campo explícito).
12. ✅ Nenhum registro foi criado em `modelo_principal`, `modelo_cor`, `modelo_tamanho`, `categoria_sku`, `tamanho_alias`, `cor_alias`, `feriado` pelo seed (queries devem retornar 0 linhas se a conta começou vazia).

---

## Critérios de aceitação

- [ ] Schema Drizzle: 3 colunas adicionadas em `modelo_principal`, 5 tabelas + 1 enum novos, no padrão do arquivo (camelCase TS, snake_case banco)
- [ ] Migration gerada e aplicada em dev sem erro
- [ ] Policies RLS adicionadas ao SQL gerado e funcionando (testes 1 e 3 passam)
- [ ] Types TypeScript exportados (6)
- [ ] Todos os 12 testes passam
- [ ] `restore-rls-policies.ts` atualizado com as 5 tabelas
- [ ] Supplements criado/encadeado **se** o push apagar o unique parcial
- [ ] Seed roda end-to-end em dev sem erro; segunda execução é no-op (`onConflictDoNothing`); update manual entre execuções não é sobrescrito
- [ ] Seed **não criou** nenhum modelo/cor/tamanho/categoria/alias/feriado (teste 12 passa)
- [ ] `npm run db:studio:dev` mostra: `modelo_principal` com colunas novas, 5 tabelas novas
- [ ] `SELECT relrowsecurity FROM pg_class WHERE relname IN ('tamanho_alias','cor_alias','feriado','canal_regra_prazo','categoria_sku')` retorna `t` para todas
- [ ] **Validado local antes de tocar em prod**
- [ ] Aplicado no Neon: migration + restore-rls + seed prod
- [ ] Code review: nenhum identificador específico da NWC (`LUA`, `NBA`, `BALA`, `AZ`, `PT`, `EGG`, …) aparece em **nenhum arquivo deste RITM** (schema, migration, seed, testes). Sweep com `grep -i` antes de mergear.

---

## Dúvidas (resolvidas)

| # | Pergunta original                                                                          | Resposta                                                                                     |
|---|--------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------|
| 1 | `corMixDefault` LUA com regra legada "MIX 3 sem CZ" — manter no seed?                      | **Não.** MIX 3 sem CZ não é mais regra. E mesmo se fosse, viria do cadastro de modelo (UI), nunca do código. Seed não toca em `modelo_principal`. |
| 2 | Cores ativas de BALA no seed?                                                              | **N/A.** Seed não cria modelo nem cor. Operador cadastra na UI.                              |
| 3 | `exigeTamanho=false` cria entry vazia em `modelo_tamanho`?                                 | **N/A.** Seed não cria modelo. Quando o operador cadastra um modelo na UI com `exigeTamanho=false`, simplesmente não cria `modelo_tamanho` — o código de explosão usa `if (modelo.exigeTamanho) { lookup tamanhos } else { 'unico' }`. |
| 4 | Feriado cadastrável? Sync nacional?                                                        | **Sim para ambos.** Tabela `feriado` com botão "Informar feriado" + modal calendário na UI (RITM-10). Sync via BrasilAPI (`GET https://brasilapi.com.br/api/feriados/v1/{ano}`) implementado no RITM-06. Feriado entra no cálculo de dias úteis (pulado igual sáb/dom). |
| 5 | Shopee SLA?                                                                                | **1 dia útil.** Seed inclui Shopee como `DIAS_UTEIS_POS_VENDA, diasUteis: 1`. UI de gerenciamento de prazo por plataforma é parte do RITM-10. |
| 6 | Categoria "KIT NBA" — regex casa "KIT BALA NBA"?                                           | **N/A.** Categorias não vêm no seed. Operador cadastra via UI a partir de sugestões geradas pelo cadastro de modelo. |

---

## Dúvidas em aberto

1. **`feriado.data` tipo Drizzle**: confirmar se há outra coluna `date` no projeto pra seguir padrão. Default proposto: `date('data', { mode: 'string' })` (retorna `'YYYY-MM-DD'` direto, evita timezone).
2. **`updatedAt` automático**: vale criar trigger Postgres ou continuar deixando o app cuidar? Resposta esperada: manter no app (padrão do projeto), só anotar nas queries de UPDATE.
3. **BrasilAPI no RITM-06**: confirmar se há restrição de saída pra `brasilapi.com.br` no ambiente Vercel (provavelmente não — egress aberto). Se houver, fallback pra JSON estático versionado.
