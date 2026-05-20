# RITM-26 — Lalamove API: pedido automatizado

Segunda RITM da fase 8. Implementa **criação de pedido via API** (`POST /v3/orders`)
e **cancelamento via API** (`DELETE /v3/orders/{id}`). Depende da RITM-25
(cotação assistida — já em produção).

Arquitetura: §14.6 (fluxo) + §14.7 (cancelamento) + §19.4 (sub-fase 8B).

> Não inclui webhook nem polling — esses são RITM-27. Após criar a order,
> status interno fica em `procurando_motorista` e operador atualiza
> manualmente (rascunho → coletado → entregue) **ou** espera RITM-27 ligar
> as atualizações automáticas. O share_link da Lalamove fica disponível
> pra acompanhamento manual.

## Escopo

| Mudança | Onde |
|---------|------|
| Service `criarOrderLalamove(tx, args)` (puro, testável) | `src/lib/confeccao/lalamove/order.ts` |
| Service `cancelarOrderLalamove(tx, args)` (idempotente) | `src/lib/confeccao/lalamove/order.ts` (mesmo arquivo) |
| Endpoint `POST /api/confeccao/lalamoves/[id]/criar-pedido` | `src/app/api/confeccao/lalamoves/[id]/criar-pedido/route.ts` |
| Endpoint `POST /api/confeccao/lalamoves/[id]/cancelar-api` | `src/app/api/confeccao/lalamoves/[id]/cancelar-api/route.ts` |
| UI: enable "Confirmar pedido" + share_link + "Cancelar via API" | `src/components/confeccao/bloco-lalamove.tsx` |
| Doc de referência: completar §POST /v3/orders e §DELETE /v3/orders | `docs/referencias/lalamove-api.md` |

## Estrutura

### Service `criarOrderLalamove`

`src/lib/confeccao/lalamove/order.ts`:

```ts
export interface CriarOrderInput {
  contaId: string;
  lalamoveId: string;
  criadaPorId: string;
  // Contatos vêm do fornecedor (origem e destino) por default. Override
  // permite operador editar antes de confirmar.
  contatoOrigem?: { nome: string; telefoneE164: string };
  contatoDestino?: { nome: string; telefoneE164: string };
  remarksDestino?: string;
  // Injetável pra testes
  httpRequest?: typeof lalamoveRequest;
}

export interface CriarOrderResult {
  orderIdApi: string;
  shareLink: string | null;
  priceBreakdown: Record<string, unknown>;
  novaCotacao?: { quotationIdApi: string; valorCotado: number };
}

export class CriarOrderError extends Error {
  constructor(
    public readonly code:
      | "feature_flag_off"
      | "lalamove_nao_encontrado"
      | "lalamove_estado_invalido"   // só pode criar order de status='cotado'
      | "cotacao_ausente"
      | "contato_incompleto"          // origem/destino sem nome+E.164
      | "api_erro",
    message: string,
    public readonly extra?: Record<string, unknown>,
  ) { super(message); this.name = "CriarOrderError"; }
}
```

**Fluxo do service:**

1. SELECT lalamove FOR UPDATE. Estado válido: `cotado`. Outros → erro `lalamove_estado_invalido`.
2. SELECT cotação mais recente (status='valida' OR expirada — pra revalidar).
3. Se cotação expirou (`expira_em < now`): **re-cota silenciosamente** chamando `cotarLalamove` internamente. Atualiza `quotation_id_api`. Salva flag `novaCotacao` no result pra UI saber.
4. Valida contatos: `contato_origem_nome` + `contato_origem_telefone` (E.164) + idem destino. Se algum faltar e override não passou → erro `contato_incompleto`.
5. POST /v3/orders com `quotationId`, `sender`, `recipients` (array — Lalamove suporta múltiplos stops mas usamos 1 + 1), `metadata`.
6. Salva no lalamove: `order_id_api`, `share_link`, `status='procurando_motorista'`, contatos efetivos, `priceBreakdown` atualizado.
7. Marca cotação como `convertida_em_pedido`.
8. Nota de auditoria com `order_id_api` + `requestId`.

**Validação de contato (estrutura esperada do fornecedor):**

- `confeccao_fornecedor.contato_nome` (text, pode ser null) → usar `nome` default
- `confeccao_fornecedor.telefone_e164` (text, formato `+5511999999999`) → usar telefone default
- Se ambos vazios pra fornecedor de origem ou destino do lalamove → erro 422 com mensagem clara apontando qual fornecedor está incompleto

> Decisão: o operador pode passar override no payload do endpoint pra
> sobrescrever os contatos sem editar o cadastro. Útil pra "atendente do
> dia diferente do contato padrão".

### Service `cancelarOrderLalamove`

```ts
export interface CancelarOrderInput {
  contaId: string;
  lalamoveId: string;
  canceladaPorId: string | null; // null = chamada automática (cascata)
  motivo: string;
  httpRequest?: typeof lalamoveRequest;
}

export interface CancelarOrderResult {
  cancelado: boolean;
  motivo: "api_ok" | "api_falhou" | "sem_order_id" | "status_nao_cancelavel";
  requestIdApi?: string | null;
}
```

**Fluxo:**

1. SELECT lalamove. Se `order_id_api` IS NULL → noop, retorna `sem_order_id`.
2. Se status NÃO ∈ {`cotado`, `procurando_motorista`, `motorista_designado`, `a_caminho_coleta`} → noop, retorna `status_nao_cancelavel` (após coletado a Lalamove não cancela mais).
3. DELETE /v3/orders/{order_id_api}.
   - Sucesso → UPDATE lalamove SET status='cancelado', cancelada_em=now, cancelada_por_id, cancelamento_motivo. Nota de auditoria.
   - Falha → **não rolla back o estado interno**. Marca lalamove status='cancelado' com motivo na nota apontando a falha + requestId pro suporte. Retorna `api_falhou`.

> Idempotência: chamadas repetidas pro mesmo lalamove são noops após o primeiro
> sucesso (status já é `cancelado` e cai no caso `status_nao_cancelavel`).

### Cancelamento em cascata

**Decidido: NÃO nesta RITM.** Operador cancela cada lalamove via API
manualmente (botão "Cancelar via API") antes de cancelar a OP. Reabre
cascade automática se virar fluxo regular.

Justificativa: hoje OPs com lalamoves API ainda são raros (RITM-25/26
estão em sandbox). Adicionar cascade implica complexidade de tx longa
ou job assíncrono — desproporcional pra volume atual. Operador atento
faz manual. Documentar no comportamento da UI: ao tentar cancelar OP
com lalamoves API ativos, mostrar warning não-bloqueante listando-os.

### Endpoints

`POST /api/confeccao/lalamoves/[id]/criar-pedido`
- Auth: sessão com conta ativa
- Body (Zod):
  ```ts
  {
    contatoOrigem?: { nome: string; telefoneE164: string };
    contatoDestino?: { nome: string; telefoneE164: string };
    remarksDestino?: string;  // max 250 chars
  }
  ```
- Flag off → 503
- CriarOrderError → 4xx por code (422 pra estado inválido / contato incompleto)
- LalamoveApiError → 502 com requestId no body
- Sucesso → 201 com `{ orderIdApi, shareLink, novaCotacao?, priceBreakdown }`

`POST /api/confeccao/lalamoves/[id]/cancelar-api`
- Auth: sessão com conta ativa + role admin (cancelar via API tem custo zero mas é ação visível)
- Body: `{ motivo: string }` (max 500)
- Sucesso (qualquer outcome) → 200 com `{ cancelado, motivo, requestIdApi }`
- Sem 4xx pra `status_nao_cancelavel` — devolve 200 com motivo explicativo

> Justificativa: cancelar é idempotente, então qualquer chamada retorna 200
> com diagnóstico. Não é erro do cliente solicitar cancelamento de algo já
> cancelado.

### UI

`src/components/confeccao/bloco-lalamove.tsx` — extensões:

**No bloco de cotação (já existente da RITM-25):**
- Remover `disabled` do botão "Confirmar pedido (RITM-26)"
- Renomear pra "Confirmar pedido"
- Ao clicar:
  - Abre dialog menor pedindo contatos (prefill do fornecedor se já cadastrado)
  - Se contatos OK → POST `/criar-pedido`
  - Sucesso: dialog mostra `orderIdApi` + `shareLink` (botão "Copiar link"), fecha o dialog principal
  - Se novaCotacao retornada (re-cotou): mostra aviso "Cotação anterior expirou — re-cotada por R$ X"

**No card do lalamove (per-row):**
- Quando `origemSolicitacao === 'api'` e tiver `orderIdApi`:
  - Mostrar badge "API" + `orderIdApi` truncado
  - Link "Rastrear" (abre `shareLink` em nova aba)
  - Botão "Cancelar via API" se status ∈ {procurando_motorista, motorista_designado, a_caminho_coleta}
  - Botão "Cancelar via API" abre confirm dialog com input de motivo, depois POST `/cancelar-api`

### Doc de referência

Completar `docs/referencias/lalamove-api.md`:
- §POST /v3/orders: payload com sender/recipients/metadata, response com orderId/shareLink/priceBreakdown
- §DELETE /v3/orders/{id}: behavior, 422 errors after PICKED_UP
- §Errors mais comuns: ERR_QUOTATION_EXPIRED, ERR_QUOTATION_NOT_FOUND, ERR_INVALID_CONTACT

## Critérios de aceitação

1. `criarOrderLalamove` com lalamove em status≠'cotado' → throw `lalamove_estado_invalido`.
2. Cotação expirada (`expira_em < now`) → re-cota silenciosamente, retorna `novaCotacao` no result.
3. Fornecedor sem `contato_nome` ou `telefone_e164` (e sem override) → throw `contato_incompleto` SEM chamar API.
4. Sucesso: UPDATE lalamove com `order_id_api`, `share_link`, `status='procurando_motorista'`, contatos preenchidos. UPDATE cotação para `convertida_em_pedido`. Nota de auditoria com `requestId`.
5. `cancelarOrderLalamove` em lalamove sem `order_id_api` → noop, retorna `sem_order_id`.
6. Cancelar lalamove em status='coletado' → noop, retorna `status_nao_cancelavel`.
7. Cancelar com falha da API → marca interno como `cancelado` MESMO ASSIM. Nota de auditoria com `requestId` + flag de falha.
8. Endpoint `criar-pedido` com flag off → 503. Body inválido → 400. Sucesso → 201.
9. UI: "Confirmar pedido" habilitado após cotação; "Cancelar via API" só em estados pré-coletado.
10. Lint + typecheck limpos. Testes unit do client (já existem) + DB-dependentes dos services (novos) passando.
11. Doc de referência atualizada com payloads/responses de POST e DELETE /v3/orders.

## Fora de escopo

- **Webhook** (`POST /api/webhooks/lalamove`) → RITM-27.
- **Polling de fallback** quando webhook falha → RITM-27.
- **Mapa em tempo real** + polling de localização do motorista → RITM-28.
- **Edição de orders pós-criação** (mudar endereço, adicionar stops) — Lalamove permite via PATCH; não está na arquitetura como prioridade. Reabrir se a operação pedir.
- **Sender/recipient múltiplos por order** — payload da Lalamove suporta `recipients[]`, mas pro Confecção usamos sempre 1 origem + 1 destino (igual ao manual). Multi-stop fica pra V2 se houver demanda.
- **Cancellation by subtask** (não pela OP inteira) — quando subtask é "cancelada" individualmente (caso raro hoje), os lalamoves dela continuam. Reabrir se virar fluxo regular.
- **Re-criar order após cancelamento** — operador precisa criar lalamove novo. Não permitimos "reabrir" um lalamove cancelado (definitivo, igual OP).
