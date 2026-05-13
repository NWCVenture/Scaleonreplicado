# RITM-01 — Schema dos cadastros do módulo Confecção

> **Bloqueia:** RITM-02, RITM-05, RITM-06, RITM-08, RITM-09, RITM-10, RITM-11, RITM-12
> **Depende de:** nada (tabela `conta` e `user` já existem)
> **Dependência externa:** nenhuma

---

## Objetivo

Criar as tabelas de cadastro do módulo Confecção e os enums correspondentes:

1. `confeccao_produto` — produto produzido pela confecção (separado de `sku_catalogo` que é o SKU comercial)
2. `confeccao_fornecedor` — prestador de serviço (Risco, Tecido, Corte, Costura, Viés)
3. `confeccao_tipo_tecido` — catálogo de tipos (Helanca, Moletinho, etc)
4. `confeccao_cor` — catálogo de cores específicas do módulo (separado de `cor_catalogo` que é a cor do SKU comercial)
5. `confeccao_fornecedor_tecido_preco` — preço sugerido por (fornecedor × tipo de tecido)

E os enums: `confeccao_fornecedor_categoria`.

---

## Arquivos a modificar

- `src/lib/db/schema.ts` (adicionar tabelas e enums no final, antes da seção "Inferred types")
- `drizzle/migrations/<timestamp>_confeccao_cadastros.sql` (gerado via `npm run db:generate:dev`)
- `src/lib/db/restore-rls-policies.ts` (adicionar as policies novas — ver `AGENTS.md`)

---

## Especificação do schema

### Enum `confeccao_fornecedor_categoria`

Valores: `risco`, `tecido`, `corte`, `costura`, `vies`

### Tabela `confeccao_produto`

Produto produzido pela confecção. **Não confundir com `sku_catalogo`** — vinculação SKU↔produto da confecção fica como roadmap futuro.

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `text` | PK (gerar com nanoid igual ao resto do projeto) |
| `conta_id` | `text` | NOT NULL, FK → `conta.id` ON DELETE CASCADE |
| `nome` | `text` | NOT NULL |
| `descricao` | `text` | nullable |
| `ativo` | `boolean` | NOT NULL DEFAULT true |
| `created_at` | `timestamp` | NOT NULL DEFAULT NOW() |
| `updated_at` | `timestamp` | NOT NULL DEFAULT NOW() |

**Índices:**
- `idx_confeccao_produto_conta` em `(conta_id)`
- `uq_confeccao_produto_nome_conta` unique em `(conta_id, nome)`

### Tabela `confeccao_fornecedor`

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `text` | PK |
| `conta_id` | `text` | NOT NULL, FK → `conta.id` ON DELETE CASCADE |
| `nome` | `text` | NOT NULL |
| `categorias` | `confeccao_fornecedor_categoria[]` | NOT NULL — multi-categoria |
| `whatsapp` | `text` | NOT NULL — formato livre, usado nos links `wa.me/{numero}` |
| `telefone_e164` | `text` | nullable — formato `+5511999999999`, obrigatório quando usar API Lalamove |
| `endereco_rua` | `text` | NOT NULL |
| `endereco_numero` | `text` | NOT NULL |
| `endereco_complemento` | `text` | nullable |
| `endereco_bairro` | `text` | NOT NULL |
| `endereco_cep` | `text` | NOT NULL |
| `endereco_cidade` | `text` | NOT NULL |
| `endereco_estado` | `text` | NOT NULL — sigla 2 letras |
| `latitude` | `text` | nullable — preenchido por geocoding background (RITM-05) |
| `longitude` | `text` | nullable |
| `contato_nome` | `text` | nullable — nome da pessoa de contato no fornecedor |
| `observacoes` | `text` | nullable |
| `ativo` | `boolean` | NOT NULL DEFAULT true |
| `created_at` | `timestamp` | NOT NULL DEFAULT NOW() |
| `updated_at` | `timestamp` | NOT NULL DEFAULT NOW() |

**Índices:**
- `idx_confeccao_fornecedor_conta` em `(conta_id)`
- `idx_confeccao_fornecedor_categorias` em `(categorias)` usando GIN (otimiza filtros por categoria nos lookups das subtasks)

> **Decisão sobre lat/long como `text`:** o resto do projeto usa `text` para tudo, evitando `decimal`/`real` no banco. Confirmar com schema atual — se já houver coordenadas armazenadas como `real`/`decimal` em alguma tabela, seguir esse padrão.

### Tabela `confeccao_tipo_tecido`

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `text` | PK |
| `conta_id` | `text` | NOT NULL, FK → `conta.id` ON DELETE CASCADE |
| `nome` | `text` | NOT NULL |
| `ativo` | `boolean` | NOT NULL DEFAULT true |
| `created_at` | `timestamp` | NOT NULL DEFAULT NOW() |

**Índices:**
- `idx_confeccao_tipo_tecido_conta` em `(conta_id)`
- `uq_confeccao_tipo_tecido_nome_conta` unique em `(conta_id, nome)`

### Tabela `confeccao_cor`

> **Por que não reusar `cor_catalogo`?** `cor_catalogo` modela cores de SKUs comerciais. As cores aqui são as do tecido sendo trabalhado na confecção — semântica diferente. Vínculo futuro entre as duas é roadmap, não escopo do MVP.

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `text` | PK |
| `conta_id` | `text` | NOT NULL, FK → `conta.id` ON DELETE CASCADE |
| `nome` | `text` | NOT NULL |
| `ativo` | `boolean` | NOT NULL DEFAULT true |
| `created_at` | `timestamp` | NOT NULL DEFAULT NOW() |

**Índices:**
- `idx_confeccao_cor_conta` em `(conta_id)`
- `uq_confeccao_cor_nome_conta` unique em `(conta_id, nome)`

### Tabela `confeccao_fornecedor_tecido_preco`

Preço sugerido por KG, por fornecedor × tipo de tecido. Read-only nas subtasks (puxa pro campo "preço sugerido" da Compra).

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `text` | PK |
| `conta_id` | `text` | NOT NULL, FK → `conta.id` ON DELETE CASCADE |
| `fornecedor_id` | `text` | NOT NULL, FK → `confeccao_fornecedor.id` ON DELETE CASCADE |
| `tipo_tecido_id` | `text` | NOT NULL, FK → `confeccao_tipo_tecido.id` ON DELETE CASCADE |
| `preco_kg_sugerido` | `real` | NOT NULL |
| `created_at` | `timestamp` | NOT NULL DEFAULT NOW() |
| `updated_at` | `timestamp` | NOT NULL DEFAULT NOW() |

**Índices:**
- `uq_confeccao_fornecedor_tecido_preco` unique em `(fornecedor_id, tipo_tecido_id)`
- `idx_confeccao_fornecedor_tecido_preco_conta` em `(conta_id)`

---

## RLS (Row Level Security)

Todas as 5 tabelas ativam RLS, isolando por `conta_id`. Policy padrão do projeto:

```sql
ALTER TABLE confeccao_produto ENABLE ROW LEVEL SECURITY;
CREATE POLICY confeccao_produto_isolation ON confeccao_produto
  USING (conta_id = current_setting('app.conta_id', true));

ALTER TABLE confeccao_fornecedor ENABLE ROW LEVEL SECURITY;
CREATE POLICY confeccao_fornecedor_isolation ON confeccao_fornecedor
  USING (conta_id = current_setting('app.conta_id', true));

ALTER TABLE confeccao_tipo_tecido ENABLE ROW LEVEL SECURITY;
CREATE POLICY confeccao_tipo_tecido_isolation ON confeccao_tipo_tecido
  USING (conta_id = current_setting('app.conta_id', true));

ALTER TABLE confeccao_cor ENABLE ROW LEVEL SECURITY;
CREATE POLICY confeccao_cor_isolation ON confeccao_cor
  USING (conta_id = current_setting('app.conta_id', true));

ALTER TABLE confeccao_fornecedor_tecido_preco ENABLE ROW LEVEL SECURITY;
CREATE POLICY confeccao_fornecedor_tecido_preco_isolation ON confeccao_fornecedor_tecido_preco
  USING (conta_id = current_setting('app.conta_id', true));
```

> ⚠️ Drizzle não gera RLS automaticamente. Adicionar essas linhas **manualmente** no SQL gerado por `db:generate:dev` antes de aplicar.
>
> ⚠️ `db:migrate:prod` no projeto usa `drizzle-kit push`, que **não preserva RLS** (vai dropar policies não declaradas no schema.ts). Adicionar essas policies em `src/lib/db/restore-rls-policies.ts` na mesma PR. Depois de `db:migrate:prod`, rodar:
> ```bash
> dotenv -e .env.prod -- npx tsx src/lib/db/restore-rls-policies.ts
> ```

---

## Type exports (TypeScript)

No fim do `schema.ts`, exportar:

```ts
export type ConfeccaoProduto = InferSelectModel<typeof confeccaoProduto>;
export type ConfeccaoFornecedor = InferSelectModel<typeof confeccaoFornecedor>;
export type ConfeccaoTipoTecido = InferSelectModel<typeof confeccaoTipoTecido>;
export type ConfeccaoCor = InferSelectModel<typeof confeccaoCor>;
export type ConfeccaoFornecedorTecidoPreco = InferSelectModel<typeof confeccaoFornecedorTecidoPreco>;
export type ConfeccaoFornecedorCategoria =
  (typeof confeccaoFornecedorCategoriaEnum.enumValues)[number];
```

---

## Workflow obrigatório

⚠️ **Sempre local antes de prod** (ver `AGENTS.md` → Database):

```bash
# 1. Editar schema.ts
# 2. Gerar migration usando .env.local
npm run db:generate:dev

# 3. Revisar SQL gerado em drizzle/migrations/, adicionar manualmente:
#    - As policies RLS da seção acima
#    - Statements `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`

# 4. Aplicar local
npm run db:migrate:dev

# 5. Testar via Drizzle Studio
npm run db:studio:dev

# 6. Atualizar src/lib/db/restore-rls-policies.ts com as 5 policies novas

# 7. Só depois de validar local: aplicar no Neon
npm run db:generate:prod   # primeiro ver o diff
npm run db:migrate:prod    # se OK
dotenv -e .env.prod -- npx tsx src/lib/db/restore-rls-policies.ts
```

---

## Testes obrigatórios

Criar `src/lib/db/__tests__/confeccao-cadastros.test.ts`:

1. ✅ Inserir `confeccao_produto` com `conta_id = 'A'` + `SET app.conta_id = 'B'` → SELECT retorna 0 linhas (RLS)
2. ✅ Duplicar `(conta_id, nome)` em `confeccao_produto` → falha com unique constraint
3. ✅ Deletar `conta` → tudo cascateia (`confeccao_produto`, `confeccao_fornecedor`, etc)
4. ✅ Deletar `confeccao_fornecedor` → também deleta linhas dependentes em `confeccao_fornecedor_tecido_preco`
5. ✅ Array `categorias = ['tecido', 'corte']` é gravado e recuperado corretamente

---

## Critérios de aceitação

- [ ] Schema Drizzle em `src/lib/db/schema.ts` com 5 tabelas + 1 enum novos, seguindo convenções do arquivo (camelCase em TS, snake_case no banco)
- [ ] Types TypeScript exportados (5)
- [ ] Migration gerada e aplicada em dev sem erro
- [ ] Policies RLS adicionadas ao SQL gerado e funcionando (teste 1 passa)
- [ ] Todos os 5 testes passam
- [ ] `restore-rls-policies.ts` atualizado com as 5 policies
- [ ] `npm run db:studio:dev` mostra as 5 tabelas, vazias
- [ ] Confirmação no Postgres: `SELECT relrowsecurity FROM pg_class WHERE relname LIKE 'confeccao_%'` retorna `t` pra todas
- [ ] **Validado local antes de tocar em prod**
- [ ] Aplicado no Neon (`db:migrate:prod` + `restore-rls-policies.ts`)

---

## Dúvidas a confirmar antes de implementar

- Convenção de geração de ID no projeto: nanoid? cuid? UUID v4? — olhar como `sku_catalogo` ou outras tabelas geram (provavelmente é nanoid via app — `crypto.randomUUID()` ou `nanoid()`)
- `latitude`/`longitude` como `text` ou `real`/`decimal`? Conferir se já existe algum padrão de coordenadas no projeto (provavelmente não — primeira tabela com geo)
- Multi-tenant default `"nwc-root"` em `conta_id` (como em `sku_catalogo`)? Provavelmente sim, mas confirmar
