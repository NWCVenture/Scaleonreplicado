# RITM-03 — Schema Lalamove (manual + modelagem API), retiradas e subconferências

> **Bloqueia:** RITM-12 (Costura), RITM-13 (Conferência), RITM-18 (Cancelamento), RITM-25–28 (Lalamove API)
> **Depende de:** RITM-02 (subtask e anexo precisam existir)
> **Dependência externa:** nenhuma (a API Lalamove só é chamada nas RITMs 25+)

---

## Objetivo

Modelar **toda** a estrutura de transporte (Lalamove) e fluxo de retiradas/conferência, antecipando os campos da API Lalamove v3 desde o MVP — assim a fase 8 (API) ativa o fluxo sem migration estrutural.

**Tabelas:**
1. `confeccao_lalamove` — registro de transporte (manual ou via API)
2. `confeccao_lalamove_cotacao` — histórico de cotações (só usado em modo API, mas tabela criada agora)
3. `confeccao_lalamove_webhook_event` — log cru de eventos do webhook (idempotência)
4. `confeccao_retirada` — retirada de peças de uma oficina (parcial ou final)
5. `confeccao_subconferencia` — uma conferência associada a uma retirada

**Enums:**
- `confeccao_lalamove_status`
- `confeccao_lalamove_tipo`
- `confeccao_lalamove_origem_solicitacao`
- `confeccao_lalamove_cotacao_status`
- `confeccao_lalamove_webhook_evento`
- `confeccao_retirada_tipo`
- `confeccao_tipo_defeito`
- `confeccao_destino_reprovadas`

> **Importante:** este RITM **não** implementa nada de chamada à API Lalamove. Só cria as tabelas + enums. O modo manual usa os mesmos registros, deixando os campos da API como `NULL`.

---

## Arquivos a modificar/criar

- `src/lib/db/schema.ts` (tabelas + enums + relations)
- `drizzle/migrations/<timestamp>_confeccao_lalamove_retiradas.sql`
- `src/lib/db/restore-rls-policies.ts` (5 policies novas)

---

## Especificação dos enums

```ts
export const confeccaoLalamoveStatusEnum = pgEnum("confeccao_lalamove_status", [
  "rascunho",
  "cotado",
  "procurando_motorista",
  "motorista_designado",
  "a_caminho_coleta",
  "coletado",
  "entregue",
  "cancelado",
  "rejeitado",
  "expirado",
]);

export const confeccaoLalamoveTipoEnum = pgEnum("confeccao_lalamove_tipo", [
  "principal",  // Lalamove de fluxo (compra→corte, corte→costura, etc)
  "outros",     // Ex: envio de etiquetas — não compõe custo principal
]);

export const confeccaoLalamoveOrigemSolicitacaoEnum = pgEnum(
  "confeccao_lalamove_origem_solicitacao",
  ["manual", "api"],
);

export const confeccaoLalamoveCotacaoStatusEnum = pgEnum(
  "confeccao_lalamove_cotacao_status",
  ["valida", "expirada", "convertida_em_pedido", "descartada"],
);

export const confeccaoLalamoveWebhookEventoEnum = pgEnum(
  "confeccao_lalamove_webhook_evento",
  ["ORDER_STATUS_CHANGED", "DRIVER_ASSIGNED", "OUTROS"],
);

export const confeccaoRetiradaTipoEnum = pgEnum("confeccao_retirada_tipo", [
  "parcial",
  "final",
]);

export const confeccaoTipoDefeitoEnum = pgEnum("confeccao_tipo_defeito", [
  "rebarba",
  "costura_desalinhada",
  "costura_incompleta",
  "gola",
  "mancha",
  "tecido",
  "furo",
  "outros",
]);

export const confeccaoDestinoReprovadasEnum = pgEnum(
  "confeccao_destino_reprovadas",
  ["doacao", "descarte", "retrabalho"],
);
```

---

## `confeccao_lalamove`

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `text` | PK |
| `conta_id` | `text` | NOT NULL, FK → `conta.id` ON DELETE CASCADE |
| `subtask_id` | `text` | nullable, FK → `confeccao_subtask.id` ON DELETE CASCADE |
| `retirada_id` | `text` | nullable — FK adicionada após `confeccao_retirada` ser criada (mesma migration, ordem importa) |
| `tipo` | `confeccao_lalamove_tipo` | NOT NULL DEFAULT `'principal'` |
| `origem_solicitacao` | `confeccao_lalamove_origem_solicitacao` | NOT NULL DEFAULT `'manual'` |
| `status` | `confeccao_lalamove_status` | NOT NULL DEFAULT `'rascunho'` |
| **Endereços (snapshot, não muda se fornecedor editar depois)** | | |
| `origem_endereco` | `jsonb` | NOT NULL — `{rua, numero, bairro, cep, cidade, estado, complemento?}` |
| `origem_lat` | `text` | nullable |
| `origem_lng` | `text` | nullable |
| `destino_endereco` | `jsonb` | NOT NULL |
| `destino_lat` | `text` | nullable |
| `destino_lng` | `text` | nullable |
| **Contatos** | | |
| `contato_origem_nome` | `text` | nullable (manual); obrigatório em modo API a partir do `cotado` |
| `contato_origem_telefone` | `text` | nullable; E.164 (`+5511999999999`) quando API |
| `contato_destino_nome` | `text` | nullable |
| `contato_destino_telefone` | `text` | nullable |
| `remarks_destino` | `text` | nullable — instruções pro motorista |
| **Operacional** | | |
| `valor` | `real` | nullable — manual: digitado; API: vem de `priceBreakdown.total` |
| `moeda` | `text` | NOT NULL DEFAULT `'BRL'` |
| `conteudo_descricao` | `text` | nullable |
| `quantidade_pecas` | `integer` | nullable |
| **API (NULL no manual)** | | |
| `service_type` | `text` | nullable — ex: `'MOTORCYCLE'`, `'VAN'` |
| `special_requests` | `text[]` | nullable |
| `schedule_at` | `timestamp` | nullable — sempre UTC |
| `quotation_id_api` | `text` | nullable — ID da última cotação aceita |
| `order_id_api` | `text` | nullable — **SEMPRE TEXT, NUNCA INTEGER**. Lalamove estendeu pra 19 dígitos em set/2025 |
| `share_link` | `text` | nullable — link público de rastreio |
| `driver_id_api` | `text` | nullable |
| `driver_nome` | `text` | nullable |
| `driver_telefone` | `text` | nullable |
| `driver_placa` | `text` | nullable |
| `distancia_metros` | `integer` | nullable |
| `price_breakdown` | `jsonb` | nullable |
| `last_driver_lat` | `text` | nullable |
| `last_driver_lng` | `text` | nullable |
| `last_driver_location_at` | `timestamp` | nullable |
| **Timestamps** | | |
| `data_solicitacao` | `timestamp` | NOT NULL DEFAULT NOW() |
| `data_coleta` | `timestamp` | nullable |
| `data_entrega` | `timestamp` | nullable |
| `cancelada_em` | `timestamp` | nullable |
| `cancelada_por_id` | `text` | nullable, FK → `user.id` ON DELETE SET NULL |
| `cancelamento_motivo` | `text` | nullable |
| `created_at` | `timestamp` | NOT NULL DEFAULT NOW() |
| `updated_at` | `timestamp` | NOT NULL DEFAULT NOW() |

**Constraints:**

```sql
-- pelo menos uma das FKs deve estar preenchida
ALTER TABLE confeccao_lalamove ADD CONSTRAINT confeccao_lalamove_tem_pai
  CHECK (subtask_id IS NOT NULL OR retirada_id IS NOT NULL);

-- modo API: a partir do momento que o pedido é criado, campos da API são obrigatórios
ALTER TABLE confeccao_lalamove ADD CONSTRAINT confeccao_lalamove_api_completo
  CHECK (
    origem_solicitacao = 'manual'
    OR status IN ('rascunho', 'cotado')
    OR (order_id_api IS NOT NULL AND service_type IS NOT NULL)
  );
```

**Índices:**
- `idx_confeccao_lalamove_subtask` em `(subtask_id)`
- `idx_confeccao_lalamove_retirada` em `(retirada_id)`
- `idx_confeccao_lalamove_status` em `(status)`
- `idx_confeccao_lalamove_order_id_api` em `(order_id_api) WHERE order_id_api IS NOT NULL` (parcial)
- `idx_confeccao_lalamove_procura_alta` em `(status, data_solicitacao) WHERE status = 'procurando_motorista'` (parcial, alimenta alerta de tempo de procura alto)

---

## `confeccao_lalamove_cotacao`

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `text` | PK |
| `conta_id` | `text` | NOT NULL, FK → `conta.id` ON DELETE CASCADE |
| `lalamove_id` | `text` | NOT NULL, FK → `confeccao_lalamove.id` ON DELETE CASCADE |
| `quotation_id_api` | `text` | NOT NULL UNIQUE — retornado por `POST /v3/quotations` |
| `status` | `confeccao_lalamove_cotacao_status` | NOT NULL DEFAULT `'valida'` |
| `valor_cotado` | `real` | NOT NULL |
| `moeda` | `text` | NOT NULL DEFAULT `'BRL'` |
| `distancia_metros` | `integer` | nullable |
| `service_type` | `text` | NOT NULL |
| `stops_api` | `jsonb` | NOT NULL — array com `{stopId, address, coordinates}` retornado pela API. **Essencial: os `stopId`s precisam ser repassados no `POST /v3/orders`** |
| `request_payload` | `jsonb` | NOT NULL — snapshot do request enviado |
| `response_payload` | `jsonb` | NOT NULL — snapshot da resposta |
| `expira_em` | `timestamp` | NOT NULL — = `criada_em` + 5 minutos |
| `criada_por_id` | `text` | NOT NULL, FK → `user.id` ON DELETE RESTRICT |
| `created_at` | `timestamp` | NOT NULL DEFAULT NOW() |

**Índices:**
- `idx_confeccao_lalamove_cotacao_validas` em `(lalamove_id, expira_em) WHERE status = 'valida'` (parcial)

---

## `confeccao_lalamove_webhook_event`

Log cru, append-only. Garante idempotência e permite reprocessamento.

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `text` | PK |
| `lalamove_id` | `text` | nullable, FK → `confeccao_lalamove.id` ON DELETE SET NULL (resolvido por lookup do `order_id_api`) |
| `conta_id` | `text` | nullable, FK → `conta.id` ON DELETE SET NULL (resolvido após match com lalamove) |
| `evento` | `confeccao_lalamove_webhook_evento` | NOT NULL |
| `order_id_api` | `text` | NOT NULL — vem no payload, usado para correlacionar |
| `payload` | `jsonb` | NOT NULL — payload integral recebido |
| `assinatura_header` | `text` | nullable — header de validação HMAC se a Lalamove enviar |
| `recebido_em` | `timestamp` | NOT NULL DEFAULT NOW() |
| `processado` | `boolean` | NOT NULL DEFAULT false |
| `processado_em` | `timestamp` | nullable |
| `erro_processamento` | `text` | nullable |

**Índices:**
- `idx_confeccao_lalamove_webhook_nao_processados` em `(recebido_em) WHERE processado = false` (parcial)
- `idx_confeccao_lalamove_webhook_order` em `(order_id_api)`

> **RLS especial:** webhook chega sem usuário logado e `conta_id` é resolvido depois. Seguir Opção A do RITM-02 de canais: o endpoint de webhook usa role do banco com `BYPASSRLS` pra inserir, e após resolver `conta_id`, faz `SET LOCAL app.conta_id = X` para queries subsequentes. Confirmar com o setup atual do projeto.

---

## `confeccao_retirada`

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `text` | PK |
| `conta_id` | `text` | NOT NULL, FK → `conta.id` ON DELETE CASCADE |
| `subtask_costura_id` | `text` | NOT NULL, FK → `confeccao_subtask.id` ON DELETE CASCADE |
| `oficina_id` | `text` | NOT NULL, FK → `confeccao_fornecedor.id` ON DELETE RESTRICT |
| `numero` | `text` | NOT NULL — formato `OPXXXXXXXX-RET-NN` (ex: `OP05260001-RET-01`) |
| `tipo` | `confeccao_retirada_tipo` | NOT NULL |
| `pecas_por_tamanho_cor` | `jsonb` | NOT NULL — `{"M": {"preto": 100, "branco": 50}, ...}` |
| `data_retirada` | `timestamp` | NOT NULL |
| `cancelada_em` | `timestamp` | nullable |
| `cancelada_por_id` | `text` | nullable, FK → `user.id` ON DELETE SET NULL |
| `created_at` | `timestamp` | NOT NULL DEFAULT NOW() |

**Índices:**
- `uq_confeccao_retirada_numero` unique em `(numero)`
- `idx_confeccao_retirada_subtask_costura` em `(subtask_costura_id)`
- `idx_confeccao_retirada_oficina` em `(oficina_id)`

> O sequencial `-RET-NN` é por OP+oficina. Implementação: contar retiradas existentes da mesma `(subtask_costura_id, oficina_id)` e somar 1. Validar atomicamente dentro da transação que cria a retirada (lock advisory ou `SELECT … FOR UPDATE` na subtask).

---

## `confeccao_subconferencia`

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `text` | PK |
| `conta_id` | `text` | NOT NULL, FK → `conta.id` ON DELETE CASCADE |
| `subtask_conferencia_id` | `text` | NOT NULL, FK → `confeccao_subtask.id` ON DELETE CASCADE |
| `retirada_id` | `text` | NOT NULL UNIQUE, FK → `confeccao_retirada.id` ON DELETE CASCADE — 1:1 com retirada |
| `numero` | `text` | NOT NULL — herda da retirada: `OP05260001-CONF-RET01` |
| `status` | `confeccao_subtask_status` | NOT NULL DEFAULT `'em_andamento'` |
| **Bloco 1 — quantitativa** | | |
| `pecas_recebidas` | `jsonb` | nullable — por tamanho × cor |
| `divergencia_confirmada` | `boolean` | NOT NULL DEFAULT false |
| `oficina_responsavel_divergencia_id` | `text` | nullable, FK → `confeccao_fornecedor.id` ON DELETE SET NULL |
| `quantidade_revelada` | `boolean` | NOT NULL DEFAULT false — sistema só revela esperado após confirmação |
| **Bloco 2 — inspeção** | | |
| `responsavel_inspecao_id` | `text` | nullable, FK → `user.id` ON DELETE SET NULL |
| `aprovadas` | `jsonb` | nullable — por tamanho × cor |
| `reprovadas` | `jsonb` | nullable |
| `tipos_defeito` | `confeccao_tipo_defeito[]` | nullable |
| `data_inspecao` | `timestamp` | nullable |
| **Bloco 3 — destinação** | | |
| `destino_reprovadas` | `confeccao_destino_reprovadas` | nullable |
| `localizacao_armazem` | `text` | nullable |
| **Timestamps** | | |
| `concluida_em` | `timestamp` | nullable |
| `created_at` | `timestamp` | NOT NULL DEFAULT NOW() |
| `updated_at` | `timestamp` | NOT NULL DEFAULT NOW() |

**Índices:**
- `uq_confeccao_subconferencia_numero` unique em `(numero)`
- `idx_confeccao_subconferencia_subtask` em `(subtask_conferencia_id)`

---

## RLS

Todas as 5 tabelas habilitam RLS por `conta_id`. Exceção: `confeccao_lalamove_webhook_event` permite INSERT sem `conta_id` (NULL temporário até o lookup), assim como `eventos_webhook_tiktok` faz:

```sql
CREATE POLICY confeccao_lalamove_webhook_event_isolation ON confeccao_lalamove_webhook_event
  USING (conta_id IS NULL OR conta_id = current_setting('app.conta_id', true));
```

---

## Migration — ordem de criação e ALTER TABLE da RITM-02

A migration gerada precisa ser editada manualmente para:

1. **Ordem das tabelas** dentro da migration: `confeccao_retirada` antes de `confeccao_lalamove` (Lalamove tem FK pra retirada). OU criar Lalamove primeiro sem a FK e adicionar via `ALTER TABLE` no final.

2. **Adicionar FK em `confeccao_anexo.lalamove_id`** (declarada como coluna `text` sem FK na RITM-02):
   ```sql
   ALTER TABLE confeccao_anexo
     ADD CONSTRAINT confeccao_anexo_lalamove_fk
     FOREIGN KEY (lalamove_id) REFERENCES confeccao_lalamove(id) ON DELETE CASCADE;
   ```

3. **CHECK constraints** das tabelas (Drizzle não gera automaticamente em todos os casos):
   - `confeccao_lalamove_tem_pai`
   - `confeccao_lalamove_api_completo`

4. **Índices parciais** (Drizzle pode gerar como índices completos; verificar e ajustar `WHERE` clause manualmente):
   - `idx_confeccao_lalamove_order_id_api`
   - `idx_confeccao_lalamove_procura_alta`
   - `idx_confeccao_lalamove_cotacao_validas`
   - `idx_confeccao_lalamove_webhook_nao_processados`

---

## Type exports

```ts
export type ConfeccaoLalamove = InferSelectModel<typeof confeccaoLalamove>;
export type ConfeccaoLalamoveCotacao = InferSelectModel<typeof confeccaoLalamoveCotacao>;
export type ConfeccaoLalamoveWebhookEvent = InferSelectModel<typeof confeccaoLalamoveWebhookEvent>;
export type ConfeccaoRetirada = InferSelectModel<typeof confeccaoRetirada>;
export type ConfeccaoSubconferencia = InferSelectModel<typeof confeccaoSubconferencia>;
// e os enums correspondentes
```

---

## Testes obrigatórios

`src/lib/db/__tests__/confeccao-lalamove.test.ts`:

1. ✅ INSERT em `confeccao_lalamove` sem `subtask_id` nem `retirada_id` → falha pela CHECK
2. ✅ INSERT com `origem_solicitacao='api'`, `status='procurando_motorista'` mas `order_id_api IS NULL` → falha pela CHECK
3. ✅ INSERT com `origem_solicitacao='api'`, `status='rascunho'`, `order_id_api IS NULL` → aceita
4. ✅ DELETE em `confeccao_subtask` → CASCADE deleta `confeccao_lalamove` filhos
5. ✅ DELETE em `confeccao_retirada` → CASCADE deleta `confeccao_subconferencia` (relação 1:1)
6. ✅ RLS: `confeccao_lalamove_webhook_event` aceita INSERT com `conta_id=NULL` quando role tem bypass
7. ✅ `order_id_api` armazenado como string `'1234567890123456789'` (19 dígitos) volta inteiro

---

## Critérios de aceitação

- [ ] 8 enums novos no schema.ts
- [ ] 5 tabelas novas com relations apropriadas
- [ ] FK `confeccao_anexo.lalamove_id` adicionada via `ALTER TABLE` na migration
- [ ] CHECK constraints aplicadas
- [ ] Índices parciais (`WHERE …`) presentes no SQL gerado
- [ ] 5 policies RLS adicionadas + `restore-rls-policies.ts` atualizado
- [ ] Todos os 7 testes passam
- [ ] Type exports completos
- [ ] Validado local antes de tocar em prod
- [ ] Aplicado no Neon
- [ ] `db:studio:dev` mostra todas as tabelas

---

## Pontos críticos e armadilhas conhecidas

- ❌ **NÃO** armazenar `order_id_api` como `INTEGER`. Lalamove estendeu pra 19 dígitos em set/2025; só `TEXT` cabe.
- ❌ **NÃO** assumir que cotação dura mais que 5 minutos. `expira_em` é hard limit; verificar antes de qualquer order.
- ❌ **NÃO** chamar `confeccao_lalamove_webhook_event` direto do código de produção sem `BYPASSRLS` — o endpoint público que recebe webhook precisa dessa exceção, qualquer outro fluxo respeita RLS normal.
- ⚠️ Numeração de retiradas (`-RET-NN`) é por (subtask_costura × oficina). Implementação na RITM-12, mas o schema permite — só não esquecer.
