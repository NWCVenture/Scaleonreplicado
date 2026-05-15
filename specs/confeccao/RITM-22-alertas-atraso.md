# RITM-22 — Alertas de atraso

Implementa **alertas automáticos de atraso** do módulo Confecção
(arquitetura §15.3 e §18.2). Detecta prazos vencendo ou vencidos por
oficina e dispara emails pra os destinatários certos sem duplicar.

## Escopo

Conforme arquitetura §18.2 + §11.1:

| Momento | Alerta | Destinatários |
|---------|--------|---------------|
| 24h antes do vencimento (uma vez) | `vencendo_24h` | Atribuído da subtask Costura |
| No momento do vencimento (uma vez) | `vencido` | Atribuído da Costura + todos os admins/owners ativos |
| Diariamente após vencimento (persistente) | `vencido` (re-emitido a cada dia) | Atribuído + admins/owners |

> O dashboard geral (RITM-20) já mostra **oficinas em atraso** como painel
> permanente. Esta RITM é sobre o **disparo automático de emails** —
> a UI fica como está.

## Estrutura

### Schema (migration nova)

```ts
// Enum
export const confeccaoAlertaAtrasoTipoEnum = pgEnum(
  "confeccao_alerta_atraso_tipo",
  ["vencendo_24h", "vencido"],
);

// Log de envios — uma linha por (oficina, tipo, dia)
export const confeccaoAlertaAtrasoLog = pgTable(
  "confeccao_alerta_atraso_log",
  {
    id: text("id").primaryKey(),
    contaId: text("conta_id").notNull().references(...),
    ordemProducaoId: text("ordem_producao_id").notNull().references(...),
    subtaskId: text("subtask_id").notNull().references(...),
    oficinaId: text("oficina_id").notNull().references(...),
    tipoAlerta: confeccaoAlertaAtrasoTipoEnum("tipo_alerta").notNull(),
    // Data de referência (truncada em UTC, formato yyyy-mm-dd via timestamp 00:00:00Z)
    dataReferencia: timestamp("data_referencia").notNull(),
    // Quantos emails efetivamente saíram (sucesso) e quantos destinatários
    enviadosCount: integer("enviados_count").notNull().default(0),
    destinatariosCount: integer("destinatarios_count").notNull().default(0),
    enviadoEm: timestamp("enviado_em").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_confeccao_alerta_atraso").on(
      table.contaId,
      table.subtaskId,
      table.oficinaId,
      table.tipoAlerta,
      table.dataReferencia,
    ),
    index("idx_confeccao_alerta_atraso_op").on(table.ordemProducaoId),
  ],
);
```

A constraint UNIQUE garante idempotência: se o cron rodar duas vezes no
mesmo dia (retry após falha, deploy duplicado, etc.) a segunda execução
faz `INSERT ... ON CONFLICT DO NOTHING` e não re-envia o email.

> ⚠️ **RLS**: ativar policy `conta_id = current_setting('app.conta_id', true)::text`
> conforme padrão do módulo (mesma do RITM-02). Adicionar manualmente na
> migration SQL e no `restore-rls-policies.ts`.

### Service `montarAlertasAtraso` (puro)

`src/lib/confeccao/alertas-atraso.ts`. Recebe:

- `agora: Date`
- `ops: Array<{ id, numero, status }>` — só status `em_andamento`
- `subtasksCostura: Array<{ id, ordemProducaoId, atribuidoAId, payload }>`
- `oficinas: Array<{ id, nome }>` (lookup)
- `usuarios: Array<{ id, name, email }>` (atribuídos + admins)
- `adminsIds: string[]` (papel admin/owner ativo na conta)
- `logExistente: Array<{ subtaskId, oficinaId, tipoAlerta, dataReferenciaISO }>`
  (chaves do log do dia)

Retorna lista de alertas a disparar:

```ts
Array<{
  opId: string;
  opNumero: string;
  subtaskId: string;
  oficinaId: string;
  oficinaNome: string;
  tipoAlerta: "vencendo_24h" | "vencido";
  prazoProducao: string; // ISO
  dataReferencia: string; // ISO (00:00:00Z do dia)
  destinatarios: Array<{ id: string; name: string; email: string }>;
}>
```

#### Regras

1. Iterar todas as subtasks `OPSEW` de OPs em andamento.
2. Para cada `oficina` no payload da subtask, se `statusInterno !== "finalizada"` e tem `prazoProducao`:
   - Se `prazo - agora` está em `(0, 24h]` → candidato `vencendo_24h`
   - Se `prazo < agora` → candidato `vencido`
3. Filtrar candidatos já presentes em `logExistente` (mesma chave + dia).
4. Determinar destinatários:
   - `vencendo_24h`: só atribuído da Costura
   - `vencido`: atribuído + todos admins/owners ativos (`adminsIds`)
5. Deduplicar destinatários por `id` (caso atribuído seja admin).
6. Resultado vazio se nada a disparar.

> Edge cases:
> - Oficina sem `prazoProducao` → ignorada.
> - Atribuído inexistente/sem email → registro segue, mas só admins (no caso `vencido`); pra `vencendo_24h` é noop (sem destinatário).
> - OP cancelada/concluída → não conta (filtro `em_andamento`).

### Endpoint cron

`POST /api/confeccao/jobs/alertas-atraso` em
`src/app/api/confeccao/jobs/alertas-atraso/route.ts`.

Proteção: header `Authorization: Bearer ${CRON_SECRET}`. Se ausente ou
diferente, retorna 401.

Comportamento:

1. Carrega contas ativas (todas — cron é global).
2. Para cada conta, dentro de uma transação separada:
   - Carrega OPs em andamento + subtasks OPSEW + fornecedores + admins + atribuídos.
   - Carrega log do dia atual.
   - Chama `montarAlertasAtraso`.
   - Pra cada alerta retornado:
     - `INSERT INTO confeccao_alerta_atraso_log ... ON CONFLICT DO NOTHING RETURNING id`
     - Se inseriu (não conflito), dispara emails (fire-and-forget como o RITM-17).
     - Atualiza `enviados_count`/`destinatarios_count` depois (ou simplesmente registra antes).
3. Retorna `{ contasProcessadas, alertasEnviados, alertasIgnorados }`.

> Por que ON CONFLICT antes do envio: garante que dois processos
> concorrentes (raro, mas possível em redeploy) não disparem duas vezes.
> Quem perdeu o INSERT não envia.

### Templates de email

`src/lib/confeccao/email/templates.ts` ganha 2 builders:

- `buildAlertaPrazoVencendoEmail({ destinatarioNome, opNumero, oficinaNome, prazoProducaoFormatado, opUrl })`
  - Subject: `"Prazo vencendo em 24h — OP {numero}"`
- `buildAlertaPrazoVencidoEmail({ destinatarioNome, opNumero, oficinaNome, prazoProducaoFormatado, diasAtraso, opUrl })`
  - Subject: `"Prazo vencido — OP {numero}"`

> Padrão consistente com `escapeHtml` + `envelope` já existentes.

Dispatchers em `src/lib/confeccao/email/eventos.ts`:

- `notificarPrazoVencendo({ subtaskId, oficinaId, destinatariosIds })`
- `notificarPrazoVencido({ subtaskId, oficinaId, destinatariosIds, diasAtraso })`

### Vercel cron

`vercel.json` na raiz do projeto (criação nova):

```json
{
  "crons": [
    {
      "path": "/api/confeccao/jobs/alertas-atraso",
      "schedule": "0 12 * * *"
    }
  ]
}
```

`0 12 * * *` UTC = 9h BRT. 1× ao dia. Cobre tanto "24h antes" quanto
"diariamente após vencimento" (re-disparo diário pra `vencido`).

> Alternativa: `vercel.ts` com `@vercel/config` (recomendação atual da
> Vercel). Por simplicidade e zero dependência nova, fico com `vercel.json`
> nesta RITM. Migração pra `vercel.ts` pode ser tarefa transversal
> separada.

### Variáveis de ambiente

Adicionar em `.env.local` e `.env.prod`:

```bash
# Secret enviado no header Authorization do cron (Vercel injeta automático
# via header `x-vercel-cron`, mas mantemos verificação explícita)
CRON_SECRET=<32 bytes base64>
```

## Critérios de aceitação

1. Migration aplicada localmente cria `confeccao_alerta_atraso_log` com UNIQUE constraint e RLS policy ativa.
2. Endpoint sem header `Authorization: Bearer ${CRON_SECRET}` retorna 401.
3. Endpoint com header válido executa pra todas as contas e retorna `{ contasProcessadas, alertasEnviados, alertasIgnorados }`.
4. Rodar o endpoint duas vezes no mesmo dia → segundo run reporta `alertasIgnorados` igual ao número de alertas do primeiro run, **nenhum email duplicado é enviado** (verificável por log).
5. Oficina com `statusInterno = "finalizada"` nunca gera alerta.
6. OP cancelada/concluída nunca gera alerta.
7. Sem `prazoProducao` → ignorada.
8. `vencendo_24h`: só atribuído recebe; `vencido`: atribuído + todos admins/owners ativos (dedup se atribuído for admin).
9. Service `montarAlertasAtraso` tem testes unit cobrindo:
   - Vazio → []
   - Oficina vencendo em 24h → 1 alerta tipo `vencendo_24h`
   - Oficina vencida → 1 alerta tipo `vencido` com admins inclusos
   - Oficina finalizada → ignorada
   - Sem prazo → ignorada
   - Já no log → ignorada
   - Atribuído é admin → não duplica destinatário
   - OP cancelada → ignorada
10. Lint + typecheck limpos.
11. `vercel.json` válido e versionado.

## Fora de escopo

- **In-app notifications** (sino no header com badge) — proposta pra RITM futura, separada de email.
- **Notificações WhatsApp** — não pedido na arquitetura.
- **Configuração de janela de antecedência** por usuário (ex: alertar 48h em vez de 24h) — fixar 24h por enquanto.
- **Email de digest semanal** (§11.2) — RITM separado se priorizado depois.
- **Migração `vercel.json` → `vercel.ts`** — tarefa transversal, fora do escopo desta RITM.
