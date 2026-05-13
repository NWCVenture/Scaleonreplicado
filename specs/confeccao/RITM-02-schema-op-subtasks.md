# RITM-02 — Schema da OP, subtasks, notas, anexos + helper de numeração

> **Bloqueia:** RITM-03, RITM-06, RITM-07, RITM-08, RITM-09, RITM-10, RITM-11, RITM-12, RITM-13
> **Depende de:** RITM-01 (tabela `confeccao_produto` precisa existir como FK)
> **Dependência externa:** nenhuma

---

## Objetivo

Criar a espinha dorsal do módulo:

1. **Tabelas:**
   - `confeccao_ordem_producao` — a OP
   - `confeccao_subtask` — cada uma das 6 etapas (Compra, Risco, Corte, Viés, Costura, Conferência)
   - `confeccao_nota` — notas manuais + auditoria automática
   - `confeccao_anexo` — anexos no R2 (a integração R2 vem na RITM-04; aqui só o schema da tabela)

2. **Enums:** `confeccao_op_status`, `confeccao_subtask_status`, `confeccao_subtask_prefixo`

3. **Helper de numeração** em `src/lib/confeccao/numeracao.ts`:
   - `gerarNumeroOP(): string` → formato `OPMMAANNNN` (ex: `OP05260001`)
   - `gerarIdInternoSubtask(prefixo, mes, ano, sequencial): string` → `[PREFIXO]-MMAA-NNNN`
   - `gerarNumeroSubtaskVisivel(prefixo, sequencial): string` → `[PREFIXO]NNNN` (ex: `OPBUY0001`)

---

## Arquivos a modificar/criar

- `src/lib/db/schema.ts` (tabelas + enums)
- `drizzle/migrations/<timestamp>_confeccao_op_subtasks.sql`
- `src/lib/db/restore-rls-policies.ts` (adicionar 4 policies novas)
- `src/lib/confeccao/numeracao.ts` (**novo**)
- `src/lib/confeccao/__tests__/numeracao.test.ts` (**novo**)

---

## Especificação dos enums

```ts
export const confeccaoOpStatusEnum = pgEnum("confeccao_op_status", [
  "em_andamento",
  "concluida",
  "cancelada",
]);

export const confeccaoSubtaskStatusEnum = pgEnum("confeccao_subtask_status", [
  "bloqueada",
  "pendente",
  "em_andamento",
  "concluida",
  "cancelada",
]);

export const confeccaoSubtaskPrefixoEnum = pgEnum("confeccao_subtask_prefixo", [
  "OPBUY",   // Compra de Tecido
  "OPRIS",   // Risco
  "OPCOR",   // Corte
  "OPVIE",   // Viés (condicional)
  "OPSEW",   // Costura
  "OPCONF",  // Conferência
]);
```

---

## Especificação das tabelas

### `confeccao_ordem_producao`

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `text` | PK |
| `conta_id` | `text` | NOT NULL, FK → `conta.id` ON DELETE CASCADE |
| `numero` | `text` | NOT NULL — formato `OPMMAANNNN` (ex: `OP05260001`) |
| `sequencial_global` | `integer` | NOT NULL — sequencial contínuo (0–9999), reseta após 9999 |
| `produto_id` | `text` | NOT NULL, FK → `confeccao_produto.id` |
| `tem_vies` | `boolean` | NOT NULL DEFAULT false |
| `status` | `confeccao_op_status` | NOT NULL DEFAULT `'em_andamento'` |
| `criada_por_id` | `text` | NOT NULL, FK → `user.id` ON DELETE RESTRICT |
| `atribuido_a_id` | `text` | NOT NULL, FK → `user.id` ON DELETE RESTRICT |
| `observacoes` | `text` | nullable |
| `cancelada_em` | `timestamp` | nullable |
| `cancelada_por_id` | `text` | nullable, FK → `user.id` ON DELETE SET NULL |
| `cancelamento_autorizado_por_id` | `text` | nullable, FK → `user.id` ON DELETE SET NULL (só preenchido se OP já estava fechada) |
| `cancelamento_justificativa` | `text` | nullable |
| `concluida_em` | `timestamp` | nullable |
| `created_at` | `timestamp` | NOT NULL DEFAULT NOW() |
| `updated_at` | `timestamp` | NOT NULL DEFAULT NOW() |

**Índices:**
- `uq_confeccao_op_numero` unique em `(numero)` — número visível é único globalmente
- `idx_confeccao_op_conta_status` em `(conta_id, status)`
- `idx_confeccao_op_atribuido` em `(atribuido_a_id)`
- `idx_confeccao_op_produto` em `(produto_id)`

> O `numero` é único globalmente (não por conta) porque o sequencial é global no projeto. Se cada conta tivesse sequencial próprio, seria por `(conta_id, numero)`. Por ora seguir sequencial global.

### `confeccao_subtask`

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `text` | PK |
| `conta_id` | `text` | NOT NULL, FK → `conta.id` ON DELETE CASCADE |
| `ordem_producao_id` | `text` | NOT NULL, FK → `confeccao_ordem_producao.id` ON DELETE CASCADE |
| `numero` | `text` | NOT NULL — formato `[PREFIXO]NNNN` (ex: `OPBUY0001`) |
| `id_interno` | `text` | NOT NULL — formato `[PREFIXO]-MMAA-NNNN` (ex: `OPBUY-0526-0001`) |
| `prefixo` | `confeccao_subtask_prefixo` | NOT NULL |
| `ordem_sequencial` | `integer` | NOT NULL — 1..6, define ordem no fluxo |
| `status` | `confeccao_subtask_status` | NOT NULL DEFAULT `'bloqueada'` |
| `atribuido_a_id` | `text` | nullable, FK → `user.id` ON DELETE SET NULL |
| `payload` | `jsonb` | NOT NULL DEFAULT `'{}'::jsonb` — campos específicos por tipo (validação no app, não no schema) |
| `valor_servico` | `real` | nullable — valor do serviço da subtask (não aplica à Conferência) |
| `iniciada_em` | `timestamp` | nullable |
| `concluida_em` | `timestamp` | nullable |
| `created_at` | `timestamp` | NOT NULL DEFAULT NOW() |
| `updated_at` | `timestamp` | NOT NULL DEFAULT NOW() |

**Índices:**
- `uq_confeccao_subtask_id_interno` unique em `(id_interno)`
- `uq_confeccao_subtask_op_prefixo` unique em `(ordem_producao_id, prefixo)` — só uma de cada tipo por OP
- `idx_confeccao_subtask_status` em `(status)`
- `idx_confeccao_subtask_atribuido` em `(atribuido_a_id)`

> **Decisão técnica — payload em JSONB:** o `GUIA-TECNICO.md` recomenda começar com JSONB pra simplificar o MVP. Os schemas Zod de cada `payload` ficam em `src/lib/confeccao/subtasks/<tipo>/schema.ts`, criados nas RITMs 08–13 conforme cada subtask é implementada. Se complexidade crescer, migrar pra tabelas dedicadas é refator estrutural (não trivial) — adiar até dor real.

### `confeccao_nota`

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `text` | PK |
| `conta_id` | `text` | NOT NULL, FK → `conta.id` ON DELETE CASCADE |
| `ordem_producao_id` | `text` | nullable, FK → `confeccao_ordem_producao.id` ON DELETE CASCADE |
| `subtask_id` | `text` | nullable, FK → `confeccao_subtask.id` ON DELETE CASCADE |
| `autor_id` | `text` | nullable, FK → `user.id` ON DELETE SET NULL — `NULL` quando auditoria automática do sistema |
| `conteudo` | `text` | NOT NULL |
| `is_auditoria` | `boolean` | NOT NULL DEFAULT false |
| `is_interna` | `boolean` | NOT NULL DEFAULT true — preparação para notas públicas futuras (V2) |
| `metadata` | `jsonb` | nullable — para auditoria estruturada (campo alterado, valor antigo, valor novo) |
| `created_at` | `timestamp` | NOT NULL DEFAULT NOW() |

**Constraint:**
```sql
CHECK (ordem_producao_id IS NOT NULL OR subtask_id IS NOT NULL)
```
Pelo menos uma das duas FKs deve estar preenchida.

**Índices:**
- `idx_confeccao_nota_op_data` em `(ordem_producao_id, created_at)`
- `idx_confeccao_nota_subtask_data` em `(subtask_id, created_at)`
- `idx_confeccao_nota_auditoria` em `(is_auditoria, created_at)`

### `confeccao_anexo`

> Schema só. O fluxo de upload (presigned URL, R2 helper) vem na RITM-04.

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `text` | PK |
| `conta_id` | `text` | NOT NULL, FK → `conta.id` ON DELETE CASCADE |
| `subtask_id` | `text` | nullable, FK → `confeccao_subtask.id` ON DELETE CASCADE |
| `ordem_producao_id` | `text` | nullable, FK → `confeccao_ordem_producao.id` ON DELETE CASCADE |
| `lalamove_id` | `text` | nullable — FK adicionada na RITM-03; deixar como coluna `text` sem FK aqui e adicionar a FK na migration da RITM-03 |
| `categoria` | `text` | NOT NULL — ex: `'nf_compra'`, `'risco_digital'`, `'foto_papagaio'`, `'foto_defeito'`, `'comprovante_lalamove'`, `'outros'` |
| `nome_arquivo` | `text` | NOT NULL |
| `tipo_mime` | `text` | NOT NULL |
| `tamanho_bytes` | `integer` | NOT NULL CHECK (`tamanho_bytes <= 52428800`) — 50 MB |
| `blob_url` | `text` | NOT NULL UNIQUE — URL completa retornada por `put()`/`handleUpload` do Vercel Blob |
| `blob_pathname` | `text` | NOT NULL — pathname relativo no Blob (ex: `confeccao/nwc-root/op-OP05260001/subtask-OPBUY0001/{id}.pdf`), usado pra `del()` |
| `enviado_por_id` | `text` | NOT NULL, FK → `user.id` ON DELETE RESTRICT |
| `created_at` | `timestamp` | NOT NULL DEFAULT NOW() |

**Constraint:**
```sql
CHECK (subtask_id IS NOT NULL OR ordem_producao_id IS NOT NULL OR lalamove_id IS NOT NULL)
```

**Índices:**
- `idx_confeccao_anexo_subtask` em `(subtask_id)`
- `idx_confeccao_anexo_op` em `(ordem_producao_id)`
- `idx_confeccao_anexo_lalamove` em `(lalamove_id)`
- `idx_confeccao_anexo_categoria` em `(categoria)`

---

## RLS

Todas as 4 tabelas ativam RLS com policy `conta_id = current_setting('app.conta_id', true)`. Mesmo padrão da RITM-01. Adicionar manualmente no SQL gerado e em `restore-rls-policies.ts`.

---

## Helper de numeração (`src/lib/confeccao/numeracao.ts`)

### API esperada

```ts
import { db } from "@/lib/db";

/**
 * Gera próximo número de OP no formato OPMMAANNNN.
 * Sequencial é global e contínuo (0000-9999, reseta após 9999).
 * Deve ser chamado dentro da mesma transação que cria a OP, com row lock
 * em algum recurso pra evitar race condition.
 */
export async function gerarNumeroOP(tx: typeof db): Promise<{
  numero: string;
  sequencial: number;
  mes: string;
  ano: string;
}>;

/**
 * Gera ID interno único de subtask: [PREFIXO]-MMAA-NNNN
 * Usado como chave de banco; combina prefixo + mes/ano + sequencial da OP.
 */
export function gerarIdInternoSubtask(
  prefixo: ConfeccaoSubtaskPrefixo,
  mes: string,
  ano: string,
  sequencial: number,
): string;

/**
 * Gera número visível de subtask: [PREFIXO]NNNN
 * Mostrado na UI; mesmo sequencial pra todas as subtasks da mesma OP.
 */
export function gerarNumeroSubtaskVisivel(
  prefixo: ConfeccaoSubtaskPrefixo,
  sequencial: number,
): string;
```

### Regras de implementação

1. **Sequencial global, não por mês.** Reseta apenas após 9999 → 0000.
2. **Race condition:** `gerarNumeroOP` precisa ler `MAX(sequencial_global)` e inserir a OP em uma única transação com lock. Opções:
   - `SELECT ... FOR UPDATE` numa tabela auxiliar de contador
   - Sequence Postgres dedicada (`CREATE SEQUENCE confeccao_op_sequencial`)
   - **Recomendação:** sequence dedicada com `nextval('confeccao_op_sequencial')` — atomic, sem lock manual. Tratar o overflow 9999 → 0000 com `MOD(nextval(seq), 10000)` no insert.

   Se for sequence:
   ```sql
   CREATE SEQUENCE confeccao_op_sequencial START 1 MINVALUE 0 MAXVALUE 9999 CYCLE;
   ```
   E no helper: `SELECT nextval('confeccao_op_sequencial')::int`.

3. **MM/AA** vêm de `new Date()` em UTC, formatados como `String(n).padStart(2, '0')`.

4. **Sequencial → NNNN:** `String(seq).padStart(4, '0')`.

### Testes em `numeracao.test.ts`

1. ✅ `gerarNumeroSubtaskVisivel('OPBUY', 1)` → `'OPBUY0001'`
2. ✅ `gerarNumeroSubtaskVisivel('OPCOR', 1234)` → `'OPCOR1234'`
3. ✅ `gerarIdInternoSubtask('OPBUY', '05', '26', 42)` → `'OPBUY-0526-0042'`
4. ✅ Mock data atual = maio/2026 → `gerarNumeroOP()` retorna `OP0526XXXX` com sequencial monotônico
5. ✅ Duas chamadas concorrentes a `gerarNumeroOP()` retornam números diferentes (sem colisão)
6. ✅ Sequencial 9999 → próxima chamada retorna 0000 (CYCLE da sequence)

---

## Critérios de aceitação

- [ ] 3 enums novos no schema.ts
- [ ] 4 tabelas novas no schema.ts com relations apropriadas
- [ ] Migration aplicada em dev sem erro
- [ ] Sequence `confeccao_op_sequencial` criada (se for a opção escolhida)
- [ ] Policies RLS adicionadas + `restore-rls-policies.ts` atualizado
- [ ] Helper de numeração em `src/lib/confeccao/numeracao.ts` exportando 3 funções
- [ ] Todos os 6 testes do helper passam
- [ ] Types TS exportados (`ConfeccaoOrdemProducao`, `ConfeccaoSubtask`, `ConfeccaoNota`, `ConfeccaoAnexo`)
- [ ] Validação manual via `db:studio:dev`: criar uma OP fake, criar 6 subtasks linkadas, criar uma nota → tudo aparece e respeita FKs
- [ ] Validado local antes de tocar em prod
- [ ] Aplicado no Neon

---

## Pontos críticos

- ⚠️ `numero` da OP é **único globalmente**. Se o sistema for usado por múltiplas contas no futuro, e cada uma quiser sua própria numeração, isso vira `(conta_id, numero)`. **Decisão atual:** sequencial global; reavaliar quando houver mais de uma conta produtiva.
- ⚠️ `confeccao_anexo.lalamove_id` fica sem FK nessa RITM (a tabela ainda não existe). A RITM-03 adiciona a FK via `ALTER TABLE`.
- ⚠️ `payload` JSONB **não tem validação no banco**. Toda subtask deve validar via Zod no app layer antes de gravar. Não confiar que `payload` é "correto" só porque está no banco.
- ⚠️ A constraint CHECK em `confeccao_nota` (pelo menos uma FK) garante integridade — sem isso, notas órfãs viram lixo silencioso.
