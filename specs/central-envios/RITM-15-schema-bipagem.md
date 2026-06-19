# RITM-15 — Schema da Bipagem (Central de Envios)

> **Bloqueia:** RITM-16 (classificador puro), RITM-17 (API de bipagem), RITM-17b (API de sessões ativas), RITM-18+ (UI), RITM-20 (rastreador), RITM-21 (notificações cross-session), RITM-22 (relatório).
> **Depende de:** RITM-07 (`sessao_central_envios` existe).
> **Dependência externa:** nenhuma.

---

## Princípio inegociável: schema-first, RLS-gated, múltiplas sessões ativas por usuário

- Toda persistência de bipagem nasce nessa tabela auditável (`central_envios_bipagem_pacote`). O JSON live em `sessao_central_envios.dados.bipagem` é cache de UI — verdade está na tabela.
- Notificações cross-session (`central_envios_notificacao`) ficam separadas — operam por *push* (poll do cliente) e têm ciclo de vida próprio (`lida_em`).
- O **índice único parcial** que limitava 1 sessão `status='ativa'` por usuário (`uq_sessao_ce_ativa_por_usuario`) é **removido**: a UX agora aceita múltiplas sessões em paralelo (operadores diferentes ou múltiplas abas), avisando o usuário via modal e não via constraint do banco.
- RLS por `conta_id` em ambas as tabelas novas — restore-rls-policies.ts atualizado.

Consequências:

- ❌ Nenhum código deve assumir "1 sessão ativa por usuário" a partir desse RITM.
- ❌ Nada de constraint única em `tracking_id` — pacotes podem ser bipados legitimamente em sessões diferentes (e a detecção de duplicação é responsabilidade de query, não de constraint).
- ✅ `sessao_central_envios` ganha índice `(conta_id, status, iniciou_em DESC)` pra `GET /sessoes?status=ativa` rodar barato.
- ✅ `central_envios_bipagem_pacote.sessao_id` cascateia (delete cascade) — auditoria some junto com a sessão se a sessão for purgada por TTL ou admin. Histórico de longo prazo virá via `planejamento_envios` (RITM-11) quando virar relevante. v1 não cobre.

---

## Objetivo

Modelar o substrato relacional pra:

1. Persistir cada bipe como uma linha auditável com a categoria classificada.
2. Persistir notificações enviadas pra outras sessões (push de duplicação ou cancelamento retroativo).
3. Liberar concorrência relaxada de sessões (sem unique parcial bloqueante).

Ao fim do RITM:

- 2 tabelas novas (`central_envios_bipagem_pacote`, `central_envios_notificacao`) + 2 enums novos.
- `sessao_central_envios` perde o índice único parcial e ganha índice de busca por conta+status.
- RLS aplicada em dev e prod via migration versionada.
- Tipos Drizzle exportados e disponíveis pra os RITMs seguintes.

**Não inclui:**

- Classificador (RITM-16) — só consome a tabela.
- API REST (RITM-17) — só persiste/consulta.
- UI da aba Bipagem (RITM-18+).
- Migração de "última ocorrência ganha" no composer (RITM-15b — separado).

---

## Schema

### Enums (2 novos)

```sql
central_envios_bipagem_categoria :
  | 'OK'                              -- preparado normalmente
  | 'DUPLICADO'                       -- já bipado nessa sessão; descartado
  | 'CANCELADO_RETIRADO'              -- bipou cancelado, operador retirou
  | 'CANCELADO_ENVIADO_MESMO_ASSIM'   -- bipou cancelado, operador despachou
  | 'FORA_LOTE'                       -- tracking não está no CSV (avulso)
  | 'DESCONHECIDA'                    -- não casa em regex de carrier
  | 'LOCALIZADOR_ACHADO'              -- modo Rastreador: identificou cancelado
  | 'LOCALIZADOR_LIVRE'               -- modo Rastreador: pacote OK passou

central_envios_notificacao_tipo :
  | 'DUPLICACAO_CROSS_SESSAO'   -- mesmo tracking bipado em outra sessão
  | 'CANCELAMENTO_RETROATIVO'   -- pedido virou cancelado depois do bipe
```

### Tabela `central_envios_bipagem_pacote`

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `text` | PK |
| `sessao_id` | `text` | NOT NULL, FK → `sessao_central_envios.id` ON DELETE CASCADE |
| `bipado_em` | `timestamp` (tz) | NOT NULL DEFAULT NOW() |
| `codigo_bipado` | `text` | NOT NULL — texto cru bipado (pré-normalização) |
| `tracking_id` | `text` | nullable — `null` se não casou com pedido do CSV |
| `order_id` | `text` | nullable — `null` se `FORA_LOTE` ou `DESCONHECIDA` |
| `canal` | `text` | nullable — `'tiktok_shop' \| 'mercado_livre' \| 'shopee'` quando casou |
| `canal_venda_id` | `text` | nullable — FK lógica pra `canais_venda.id` (não FK no banco — `canal_venda_id` pode ser de canal externo) |
| `categoria` | `central_envios_bipagem_categoria` | NOT NULL |
| `transportadora` | `transportadora_label` | nullable — usa enum existente |
| `acao_cancelado` | `text` | nullable — `'RETIRADO' \| 'ENVIADO_MESMO_ASSIM'` quando categoria pertence ao grupo cancelado |
| `usuario_id` | `text` | NOT NULL, FK → `user.id` ON DELETE RESTRICT |
| `conta_id` | `text` | NOT NULL DEFAULT `'nwc-root'`, FK → `conta.id` ON DELETE CASCADE |

**Índices:**

- `idx_ce_bipagem_sessao` em `(sessao_id)` — listar bipes da sessão atual.
- `idx_ce_bipagem_categoria` em `(sessao_id, categoria)` — relatório agrupado.
- `idx_ce_bipagem_dedup_global` em `(conta_id, tracking_id, bipado_em DESC)` WHERE `tracking_id IS NOT NULL` — detecção cross-session.
- `idx_ce_bipagem_conta` em `(conta_id)` — sweep RLS.

### Tabela `central_envios_notificacao`

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `text` | PK |
| `sessao_destino_id` | `text` | NOT NULL, FK → `sessao_central_envios.id` ON DELETE CASCADE |
| `tipo` | `central_envios_notificacao_tipo` | NOT NULL |
| `payload` | `jsonb` | NOT NULL — schema livre por tipo (ver abaixo) |
| `criada_em` | `timestamp` (tz) | NOT NULL DEFAULT NOW() |
| `lida_em` | `timestamp` (tz) | nullable — marca quando o cliente fez poll e recebeu |
| `conta_id` | `text` | NOT NULL DEFAULT `'nwc-root'`, FK → `conta.id` ON DELETE CASCADE |

**Schema de `payload` por tipo:**

```ts
// DUPLICACAO_CROSS_SESSAO
{
  trackingId: string;
  orderId: string | null;
  outraSessaoId: string;
  outroUsuarioId: string;
  outroUsuarioNome: string;
  outroBipadoEm: string;  // ISO
}

// CANCELAMENTO_RETROATIVO (criada após re-upload do CSV)
{
  trackingId: string;
  orderId: string;
  pedidoCancelouEm: string | null;  // ISO; null se CSV não trouxe data
  motivoCancelamento: string | null;
}
```

**Índices:**

- `idx_ce_notif_sessao_pendentes` em `(sessao_destino_id, criada_em DESC)` WHERE `lida_em IS NULL` — poll do cliente.
- `idx_ce_notif_conta` em `(conta_id)` — sweep RLS.

### Alteração em `sessao_central_envios`

- **Remover** o índice único parcial `uq_sessao_ce_ativa_por_usuario`.
- **Criar** o índice não-único `idx_sessao_ce_ativas_conta` em `(conta_id, status, iniciou_em DESC)`.

> ⚠️ O DROP do índice único pode não ser detectado pelo `drizzle-kit push` em prod (mesmo problema do RITM-07 ao contrário). Após `db:migrate:prod`, validar com:
> ```sql
> SELECT indexname FROM pg_indexes WHERE tablename = 'sessao_central_envios';
> ```
> Se `uq_sessao_ce_ativa_por_usuario` ainda existir, dropar manual: `DROP INDEX uq_sessao_ce_ativa_por_usuario;`

### RLS

```sql
ALTER TABLE central_envios_bipagem_pacote ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON central_envios_bipagem_pacote
  USING (conta_id = current_setting('app.conta_atual', true))
  WITH CHECK (conta_id = current_setting('app.conta_atual', true));

ALTER TABLE central_envios_notificacao ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON central_envios_notificacao
  USING (conta_id = current_setting('app.conta_atual', true))
  WITH CHECK (conta_id = current_setting('app.conta_atual', true));
```

Adicionar `"central_envios_bipagem_pacote"` e `"central_envios_notificacao"` ao `TABELAS_PADRAO` em `restore-rls-policies.ts`.

---

## Arquivos a tocar

| Arquivo | Mudança |
|---|---|
| `src/lib/db/schema.ts` | + 2 enums, + 2 tabelas, alterar índices de `sessaoCentralEnvios`, + types `InferSelectModel` |
| `src/lib/db/restore-rls-policies.ts` | + 2 entradas em `TABELAS_PADRAO` |
| `drizzle/migrations/0034_<auto>.sql` | gerada via `db:generate:dev` |
| `drizzle/migrations/meta/0034_snapshot.json` | gerada via `db:generate:dev` |

---

## Critérios de aceitação

1. **Schema válido:** `npx tsc --noEmit` passa sem erro novo.
2. **Migration gerada:** `npm run db:generate:dev` cria `0034_*.sql` contendo:
   - `CREATE TYPE` dos 2 enums novos
   - `CREATE TABLE central_envios_bipagem_pacote` com todas as colunas e FKs
   - `CREATE TABLE central_envios_notificacao` idem
   - `DROP INDEX "uq_sessao_ce_ativa_por_usuario"` (ou `IF EXISTS`)
   - `CREATE INDEX idx_sessao_ce_ativas_conta`
   - 4 índices na `central_envios_bipagem_pacote` (sessao, categoria, dedup, conta)
   - 2 índices na `central_envios_notificacao` (pendentes, conta)
3. **Migration aplica local:** `npm run db:migrate:dev` retorna sucesso, sem warning de drift.
4. **DDL conferida no banco local:**
   ```sql
   \d central_envios_bipagem_pacote
   \d central_envios_notificacao
   SELECT indexname FROM pg_indexes
     WHERE tablename = 'sessao_central_envios'
     ORDER BY indexname;
   -- esperado: idx_sessao_ce_ativas_conta, idx_sessao_ce_conta, idx_sessao_ce_usuario
   -- não esperado: uq_sessao_ce_ativa_por_usuario
   ```
5. **RLS ativo:** após `dotenv -e .env.local -- npx tsx src/lib/db/restore-rls-policies.ts`, ambas as tabelas aparecem com policy `tenant_isolation`:
   ```sql
   SELECT tablename, policyname FROM pg_policies
     WHERE tablename IN ('central_envios_bipagem_pacote', 'central_envios_notificacao');
   ```
6. **Tipos exportados:** `import { centralEnviosBipagemPacote, centralEnviosNotificacao } from "@/lib/db/schema"` compila e expõe types `InferSelectModel`.

---

## Out-of-scope (próximos RITMs)

- Lógica de classificação → RITM-16
- Endpoint POST/GET de bipagem → RITM-17
- Endpoint de sessões ativas → RITM-17b
- Migração "última ocorrência ganha" no composer → RITM-15b
- UI da aba Bipagem → RITM-18
- Modo Rastreador → RITM-20
- Polling de notificações no cliente → RITM-21
- Relatório de encerramento → RITM-22
