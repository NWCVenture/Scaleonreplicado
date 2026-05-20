# RITM-27 — Lalamove API: webhook em produção

Terceira RITM da fase 8. Recebe eventos da Lalamove (`ORDER_STATUS_CHANGED`
e `DRIVER_ASSIGNED`) em `/api/webhooks/lalamove`, persiste o payload cru,
processa assincronamente e atualiza o lalamove interno (status, driver,
timestamps). Adiciona um cron de **polling de fallback** a cada 5min pra
cobrir webhooks perdidos.

Arquitetura: §14.5 (mapeamento de status), §14.8 (webhook) + §19.4 sub-fase 8C.

> Schema `confeccao_lalamove_webhook_event` já existe da RITM-03 — só
> implementar o endpoint, o processador e o cron.

## Escopo

| Mudança | Onde |
|---------|------|
| Validação HMAC do header de assinatura | `src/lib/confeccao/lalamove/webhook-signature.ts` |
| Endpoint `POST /api/webhooks/lalamove` | `src/app/api/webhooks/lalamove/route.ts` |
| Processor (puro, testável) | `src/lib/confeccao/lalamove/webhook-processor.ts` |
| Mapeamento status API → interno | `src/lib/confeccao/lalamove/status-map.ts` |
| Polling fallback cron | `src/app/api/confeccao/jobs/lalamove-sync/route.ts` |
| GitHub Actions workflow */5 * * * * | `.github/workflows/lalamove-sync.yml` |
| Doc: completar `GET /v3/orders/{id}` e webhook events | `docs/referencias/lalamove-api.md` |
| Env nova: `LALAMOVE_WEBHOOK_SECRET` | `.env.example` |

## Estrutura

### Validação de assinatura

`src/lib/confeccao/lalamove/webhook-signature.ts`:

```ts
// Lalamove envia X-Lalamove-Signature: hmac-sha256 hex do body cru,
// usando o secret cadastrado no Partner Portal (separado da API key/secret).
//
// Comparação SEMPRE com timingSafeEqual — evita timing attacks.
export function verificarAssinaturaWebhook(args: {
  bodyRaw: string;     // o JSON cru, exatamente como recebido
  assinatura: string;  // header X-Lalamove-Signature
  secret: string;      // LALAMOVE_WEBHOOK_SECRET
}): boolean;
```

> ⚠️ **Confirmar nome exato do header e formato** com a doc da Lalamove
> antes de testar em sandbox. Em algumas versões da API é
> `X-Webhook-Signature`. Documento o que validamos no
> `docs/referencias/lalamove-api.md`.

### Endpoint

`POST /api/webhooks/lalamove`:

1. Lê body como **texto cru** (pra validar assinatura), depois faz parse.
2. Valida assinatura. Falha → 401, **sem** persistir (não vai pra log).
3. Extrai `orderId` do payload. Se ausente → 200 (sem erro pra não suspender
   webhook) + log no servidor.
4. Tenta resolver `lalamoveId` + `contaId` via lookup em
   `confeccao_lalamove` pelo `orderIdApi`. Pode ser NULL nos primeiros
   eventos (race: webhook chega antes do INSERT finalizar). Persiste mesmo
   assim — o processador resolve depois.
5. INSERT em `confeccao_lalamove_webhook_event` com `processado=false`.
6. Schedule `processarWebhookEvent(eventId)` via `unstable_after` (Next 16).
7. Retorna 200 em < 1s.

> ⚠️ NUNCA responder 4xx/5xx pra Lalamove (exceto erro de infra nossa).
> Webhook suspenso pela Lalamove se taxa de falha > X em janela curta.

### Processador

`src/lib/confeccao/lalamove/webhook-processor.ts`:

```ts
export async function processarWebhookEvent(
  tx: Tx,
  args: { eventoId: string },
): Promise<{
  status: "ok" | "lalamove_nao_encontrado" | "duplicado" | "erro";
  detalhes?: string;
}>;
```

**Idempotência** (arquitetura §14.8): mesma chave evento + orderId + timestamp
do payload já processada → marca como `processado=true` mas retorna `duplicado`.
Implementação: query `WHERE order_id_api = ? AND evento = ? AND payload->>'timestamp' = ?
AND processado = true`.

**Fluxo:**

1. SELECT do evento FOR UPDATE SKIP LOCKED (cron concorrente seguro).
2. Se `processado=true` → noop, retorna `ok`.
3. Resolve `lalamoveId` se ainda NULL (lookup por `orderIdApi`).
4. Se não achar → marca `processado=true` + `erroProcessamento='lalamove_nao_encontrado'`,
   retorna pra Lalamove tentar de novo? NÃO — marcar e seguir; sem retry
   automático pra evitar loop. Polling fallback compensa.
5. Checa duplicação (descrita acima).
6. Aplica mudanças no `confeccaoLalamove` baseado no `evento`:
   - `ORDER_STATUS_CHANGED`: mapeia `payload.data.status` (API) → status interno
     via `status-map.ts`. Atualiza `data_coleta`/`data_entrega` se aplicável.
   - `DRIVER_ASSIGNED`: preenche `driver_id_api`, `driver_nome`,
     `driver_telefone`, `driver_placa`.
   - Outros eventos: marca processado, sem mudança no lalamove.
7. Nota de auditoria registrando `status_anterior → status_novo` + `requestId`.
8. UPDATE evento `processado=true`, `processadoEm=now`.

### Mapeamento de status

`src/lib/confeccao/lalamove/status-map.ts` (pure):

```ts
const API_TO_INTERNO: Record<string, ConfeccaoLalamoveStatus> = {
  ASSIGNING_DRIVER: "procurando_motorista",
  ON_GOING: "motorista_designado",      // ⚠️ na transição inicial; depois vira "a_caminho_coleta"
  PICKED_UP: "coletado",
  COMPLETED: "entregue",
  CANCELED: "cancelado",
  REJECTED: "rejeitado",
  EXPIRED: "expirado",
};
```

> Pra `ON_GOING` o status interno depende de timing — usar `motorista_designado`
> enquanto sem `data_coleta`, e migrar pra `a_caminho_coleta` quando o
> próximo evento chega. Mantemos lógica simples: sempre mapeia pro mesmo,
> aceita inexatidão.

### Polling fallback

`POST /api/confeccao/jobs/lalamove-sync` em
`src/app/api/confeccao/jobs/lalamove-sync/route.ts`:

- Protegido por `Authorization: Bearer $CRON_SECRET` (mesmo padrão da RITM-22).
- Acionado por Vercel Cron a cada 5min.
- Lógica:
  1. Processa eventos pendentes (`processado=false`) — cobre `unstable_after`
     que falhou.
  2. Lista lalamoves com `origemSolicitacao='api'` e status ∈ ativos
     {procurando_motorista, motorista_designado, a_caminho_coleta, coletado}
     E `updatedAt < now - 10min`.
  3. Pra cada um, chama `GET /v3/orders/{order_id_api}` e aplica
     mudanças no banco (mesma função do processor, com payload sintético).
- Retorna `{ eventosProcessados, lalamovesSyncados, erros }`.

### Agendamento via GitHub Actions

⚠️ **Decisão de runtime:** Vercel Hobby tier limita cron a **1 invocação/dia
por cron**. Como precisamos rodar a cada 5min, agendamos via **GitHub Actions**
(mesmo padrão da RITM-23 backup semanal).

`.github/workflows/lalamove-sync.yml` (criação nova):

```yaml
on:
  schedule:
    - cron: "*/5 * * * *"
  workflow_dispatch: {}

jobs:
  sync:
    runs-on: ubuntu-latest
    timeout-minutes: 2
    steps:
      - name: Invoca endpoint de sync
        env:
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
        run: |
          curl -fsSL -X POST https://scaleonerp.com.br/api/confeccao/jobs/lalamove-sync \
            -H "Authorization: Bearer $CRON_SECRET"
```

Custo estimado de Actions: 12 invocações/h × 24h × 30d × ~10s ≈ 24h/mês.
Free tier (2000min/mês) cobre folgado.

> GH Actions pode atrasar crons de alta frequência em 5-15min sob carga
> do GitHub. Aceitável pro caso de uso (janela stale de 10min já dá
> margem).

### Env

`.env.example` ganha:

```bash
# Secret compartilhado pra validar assinatura do webhook da Lalamove.
# Cadastrar no Partner Portal da Lalamove ao registrar a URL do webhook,
# e copiar pra esta variável.
LALAMOVE_WEBHOOK_SECRET=
```

### Doc

`docs/referencias/lalamove-api.md`:
- §`GET /v3/orders/{id}` — completar com schema da response (status, driver, stops, priceBreakdown atualizado).
- Nova §Webhook: payload exemplo, header de assinatura, eventos enviados,
  política de retry da Lalamove.
- Confirmar nome exato do header de assinatura na doc oficial e atualizar
  `verificarAssinaturaWebhook` se necessário.

## Critérios de aceitação

1. Webhook com assinatura inválida → 401, **sem** INSERT em `confeccao_lalamove_webhook_event`.
2. Webhook válido → 200 em < 1s, INSERT com `processado=false`, `unstable_after` agendado.
3. Processor com evento `ORDER_STATUS_CHANGED` status=`PICKED_UP` →
   lalamove vira `coletado`, `data_coleta` preenchida, nota de auditoria criada.
4. Processor com evento `DRIVER_ASSIGNED` → preenche `driver_*`, status fica
   em `motorista_designado` se ainda estava em `procurando_motorista`.
5. Processor com evento duplicado (mesma chave evento+order+timestamp) →
   marca `processado=true` retornando `duplicado`, **sem** alterar lalamove
   nem criar nota.
6. Processor com `order_id_api` desconhecido → marca processado com
   `erroProcessamento='lalamove_nao_encontrado'`, sem throw.
7. Cron sync com `Authorization` inválido → 401.
8. Cron sync processa eventos pendentes E re-sincroniza lalamoves estagnados.
9. Mapeamento de status: testes unit cobrindo todos os pares API → interno
   da seção 14.5 da arquitetura.
10. `verificarAssinaturaWebhook` rejeita assinatura modificada ou body
    alterado (testes com vetores conhecidos).
11. Lint + typecheck limpos.

## Fora de escopo

- **`PATCH /v3/webhook`** pra registrar URL do webhook via API — registramos
  manualmente no Partner Portal. Endpoint via API fica pra eventual RITM
  de "auto-setup" se virar útil.
- **Notificações de driver location em tempo real** → RITM-28.
- **Reprocessar histórico de eventos não processados** (backfill via
  GET /v3/orders) — polling fallback já cobre janela de 10min. Backfill
  manual de eventos > 24h fica fora.
- **Dashboard de saúde do webhook** (taxa de processados/erro) — log
  estruturado no servidor + nota de auditoria são suficientes pra MVP.
- **Retries com backoff exponencial em falhas de processador** — primeiro
  pass marca como `erroProcessamento` + segue; polling fallback re-sincroniza
  pelo `GET /v3/orders/{id}` na próxima janela.

## Antes de mergear

- [ ] Cadastrar URL do webhook no Partner Portal da Lalamove
  - Sandbox: `https://erp-preview.vercel.app/api/webhooks/lalamove` (ou domínio do PR preview)
  - Produção: `https://scaleonerp.com.br/api/webhooks/lalamove`
- [ ] Copiar o secret do Partner Portal pra `LALAMOVE_WEBHOOK_SECRET` no Vercel (Production + Preview + Development)
- [ ] Validar que webhook chega: criar pedido sandbox via UI, acompanhar tabela `confeccao_lalamove_webhook_event` após o motorista aceitar
- [ ] Adicionar `LALAMOVE_WEBHOOK_SECRET` ao `gh secret list` no GitHub se quisermos rodar testes integrados no CI (opcional)
- [ ] Cadastrar `CRON_SECRET` como GitHub secret (mesmo valor cadastrado no Vercel) — sem ele a workflow `lalamove-sync.yml` falha logo no primeiro run
