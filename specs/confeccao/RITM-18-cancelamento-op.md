# RITM-18 — Cancelamento de OP (com dupla autorização)

Implementa o cancelamento de OPs do módulo Confecção. Schema já contempla
os campos (`status='cancelada'`, `canceladaEm`, `canceladaPorId`,
`cancelamentoAutorizadoPorId`, `cancelamentoJustificativa`) — nenhuma
migration nova.

## Regras (arquitetura §6.4)

- **Quem pode cancelar:** apenas admins/owners.
- **Quando pode cancelar:** em qualquer etapa, inclusive após OP concluída.
- **Dupla autorização:** se a OP está com status `concluida` no momento
  do cancelamento, é obrigatório informar `autorizadoPorId` (outro admin
  da conta, diferente de quem cancela).
- **Justificativa obrigatória** em todos os casos.
- **OP cancelada não pode ser reaberta** — transição definitiva.

## Comportamento após cancelamento

- OP fica `status='cancelada'` — bloqueia todas as mutações nas
  subtasks, retiradas, subconferências, lalamoves e anexos da OP.
- Dados preservados — nenhum payload é zerado; custos viram referência
  histórica (categorização especial cabe ao módulo de relatórios — fora
  do escopo desta RITM).
- UI mostra banner "OP cancelada" e read-only em todas as subtasks.

## Backend

### Service `cancelarOP`

`src/lib/confeccao/cancelar-op.ts` — recebe `{ contaId, opId,
canceladaPorId, justificativa, autorizadoPorId? }` em transação:

1. Valida que OP pertence à conta e não está já cancelada.
2. Se OP está `concluida`: exige `autorizadoPorId` ≠ `canceladaPorId`,
   e valida que o autorizador é admin/owner ativo da conta.
3. Atualiza OP: `status='cancelada'`, `canceladaEm`, `canceladaPorId`,
   `cancelamentoAutorizadoPorId`, `cancelamentoJustificativa`.
4. Cria nota de auditoria com metadata.
5. Retorna `{ op, statusAnterior }` pra dispatcher decidir destinatários.

### Erros tipados

- `op_nao_encontrada` — 404
- `ja_cancelada` — 400
- `requer_autorizacao_dupla` — 400 (OP fechada sem autorizadoPorId)
- `autorizador_invalido` — 400 (autorizador não é admin/owner ativo,
  ou é o próprio canceladaPorId)
- `justificativa_obrigatoria` — handled by Zod

### Endpoint

`POST /api/confeccao/ops/[numero]/cancelar` — admin only. Body:

```json
{
  "justificativa": "string (min 10, max 2000)",
  "autorizadoPorId": "string (obrigatório se OP concluída)"
}
```

### Bloqueio de mutações — `assertOpAtiva`

Helper `src/lib/confeccao/assert-op-ativa.ts` que recebe `(tx,
ordemProducaoId)` ou `(tx, subtaskId, modo: 'porSubtask')`, faz lookup e
lança `OpCanceladaError` se status=='cancelada'. Chamado no início da
transação em todos os endpoints que mutam estado da OP:

- `POST /api/confeccao/subtasks/[id]/iniciar`
- `POST /api/confeccao/subtasks/[id]/concluir`
- `POST /api/confeccao/subtasks/[id]/reabrir` (RITM-15)
- `PATCH /api/confeccao/subtasks/[id]/payload`
- `PATCH /api/confeccao/subtasks/[id]` (atribuído/status)
- `POST /api/confeccao/subtasks/[id]/retiradas`
- `DELETE /api/confeccao/retiradas/[id]` (cancelar retirada)
- `POST /api/confeccao/subconferencias/[id]/concluir`
- `PATCH /api/confeccao/ops/[numero]` (atribuído/observações)
- `PATCH /api/confeccao/lalamoves/[id]`
- `PATCH/DELETE /api/confeccao/anexos/[id]`

Resposta 409 quando bloqueada, com `code: "op_cancelada"`.

## Notificação por email (estende RITM-17)

Novo evento: `notificarOpCancelada` dispara para:

- Todos admins/owners ativos da conta
- Atribuído atual da OP
- Atribuídos das subtasks com status `pendente`/`em_andamento`

Template novo `buildOpCanceladaEmail` (subject, html, text). Mesmo padrão
dos outros: helpers puros sem deps.

## UI

### `CancelarOpDialog` (novo componente)

`src/components/confeccao/cancelar-op-dialog.tsx` — dialog com:

- Textarea para justificativa (obrigatório, min 10 chars)
- Se `opStatus === 'concluida'`: dropdown obrigatório com admins
  ativos (`/api/confeccao/membros-conta?papel=admin&papel=owner`) pra
  selecionar autorizador
- Checkbox "Tenho certeza que quero cancelar esta OP" (obrigatório)
- Botões: Cancelar (fecha) / Confirmar cancelamento (destrutivo)

### Integração `OPHeader`

Substitui o botão placeholder `<Button disabled title="Cancelar OP — RITM-18">`
por um `DropdownMenu` com item destrutivo "Cancelar OP" (só visível
para admins, e somente se OP ainda não está cancelada).

### Banner "OP cancelada"

Quando `status === 'cancelada'`, exibe banner na tela da OP com a
justificativa + quem cancelou + autorizador (se houver). Subtasks já
respeitam o readonly via status do payload — mas adiciona tag visual
extra "OP cancelada" nas subtasks ativas.

## Critérios de aceitação

1. Tentar cancelar OP `em_andamento` sem `autorizadoPorId` → sucesso.
2. Tentar cancelar OP `concluida` sem `autorizadoPorId` → 400
   `requer_autorizacao_dupla`.
3. Tentar cancelar OP `concluida` com `autorizadoPorId == canceladaPorId`
   → 400 `autorizador_invalido`.
4. Após cancelamento, tentar iniciar/concluir/reabrir/payload-PATCH em
   qualquer subtask da OP → 409 `op_cancelada`.
5. Após cancelamento, tentar PATCH na OP → 409.
6. Após cancelamento, tentar nova POST `cancelar` → 400 `ja_cancelada`.
7. Email dispara pra admins + atribuído OP + atribuídos das subtasks
   ativas (deduplicado).
8. Lint e typecheck limpos. Testes unit do service + email template.
