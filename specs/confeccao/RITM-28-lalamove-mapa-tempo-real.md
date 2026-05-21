# RITM-28 — Lalamove API: mapa em tempo real

Última RITM da fase 8. Faz polling da localização dos motoristas via
`GET /v3/orders/{orderId}/drivers/{driverId}/location` e popula
`confeccao_lalamove.last_driver_lat/lng/location_at`. O componente
`LalamovesMapa` no Dashboard Geral (RITM-20) **já lê esses campos** e
prefere `driver` sobre `origem`/`destino` quando disponível — então
quando o polling roda, os pontos do mapa começam a se mover sozinhos.

Arquitetura: §14.9 + §19.4 sub-fase 8D.

## Escopo

| Mudança | Onde |
|---------|------|
| Service `sincronizarLocalizacaoMotoristas` (puro, testável) | `src/lib/confeccao/lalamove/driver-location.ts` |
| Integrar polling no cron existente `lalamove-sync` | `src/app/api/confeccao/jobs/lalamove-sync/route.ts` |
| Doc da API: `GET /v3/orders/{id}/drivers/{driverId}/location` | `docs/referencias/lalamove-api.md` |

> Cron continua `*/5 * * * *` via GitHub Actions (RITM-27). Arquitetura
> sugere 60s, mas Vercel free tier limita a 1/dia, e GH Actions de alta
> frequência (1min) é instável. 5min é a melhor combinação custo/precisão
> pra MVP.

## Estrutura

### Service

`src/lib/confeccao/lalamove/driver-location.ts`:

```ts
export interface SyncLocationResult {
  consultados: number;
  atualizados: number;
  semDriverDisponivel: number; // driver ainda não tem location na API
  erros: number;
}

export async function sincronizarLocalizacaoMotoristas(args?: {
  // Injetável pra testes
  httpRequest?: typeof lalamoveRequest;
  // Limita quantos lalamoves por execução (default 50)
  limit?: number;
}): Promise<SyncLocationResult>;
```

**Fluxo:**

1. Lista lalamoves com:
   - `origemSolicitacao = 'api'`
   - `status IN ('motorista_designado', 'a_caminho_coleta', 'coletado')`
   - `orderIdApi NOT NULL`
   - `driverIdApi NOT NULL`
   - Limit (default 50; ordenado por `lastDriverLocationAt ASC NULLS FIRST`
     pra priorizar os que estão mais atrasados).
2. Pra cada um, chama `GET /v3/orders/{orderId}/drivers/{driverId}/location`.
3. Atualiza `last_driver_lat`, `last_driver_lng`, `last_driver_location_at`.
4. **Não** cria nota de auditoria — localização muda muito; viraria spam.
5. Conta erros separadamente; 404 da API (driver ainda não tem location)
   é contado como `semDriverDisponivel`, não erro.

**Trade-offs:**

- N lalamoves ativos = N chamadas serial. Para volume baixo (1-10
  lalamoves ativos por vez) é OK. Se virar gargalo, paralelizar com
  `Promise.allSettled` em chunks de 5.
- Sem rate-limit handling explícito (assume Lalamove não vai 429 com
  volume baixo). Documentar como reabrir se acontecer.

### Integração no cron

`POST /api/confeccao/jobs/lalamove-sync` ganha terceira etapa após:

1. Processa eventos pendentes (já existe)
2. Sincroniza lalamoves estagnados via `GET /v3/orders/{id}` (já existe)
3. **NOVO**: chama `sincronizarLocalizacaoMotoristas()` e inclui contagem
   no return.

Return novo formato:
```json
{
  "ok": true,
  "eventosProcessados": 0,
  "eventosComErro": 0,
  "lalamovesSyncados": 0,
  "lalamovesComErroApi": 0,
  "driverLocation": {
    "consultados": 3,
    "atualizados": 2,
    "semDriverDisponivel": 1,
    "erros": 0
  }
}
```

> Adicionar no mesmo endpoint mantém uma única chamada pelo cron — menos
> uso de Actions minutes.

### Doc

`docs/referencias/lalamove-api.md` §`GET /v3/orders/{id}/drivers/{id}/location`:
- Request (path params, sem body)
- Response (lat/lng como string, updatedAt ISO)
- Status code 404 quando driver ainda não reportou location
- Política de rate limit (a confirmar com docs oficiais)

### Mapa do dashboard

**Nada a fazer.** O componente `LalamovesMapa` e o service
`montarDashboard` (RITM-20) já preferem `last_driver_*` quando preenchidos.
Quando o cron começar a popular os campos, os pontos no mapa
automaticamente migram de `fonte: "origem"` pra `fonte: "driver"` e
ficam móveis a cada refresh do dashboard (que recarrega a cada N min
ou no F5).

## Critérios de aceitação

1. Service `sincronizarLocalizacaoMotoristas` lista só lalamoves com
   status ativo + `driverIdApi NOT NULL` + ordem `lastDriverLocationAt ASC NULLS FIRST`.
2. Pra cada lalamove, chama `GET /v3/orders/{orderId}/drivers/{driverId}/location`
   e atualiza `last_driver_lat/lng/location_at`.
3. 404 da API → conta como `semDriverDisponivel`, não como erro.
4. Outras falhas (500, network) → conta como `erros`; processo continua
   pros próximos lalamoves (não throw).
5. Cron `lalamove-sync` retorna `driverLocation: {...}` no payload.
6. Componente `LalamovesMapa` mostra pontos com `fonte: 'driver'` quando
   `last_driver_lat` está presente (já é o comportamento atual).
7. Testes unit do service injetando mock do `httpRequest`:
   - 0 lalamoves → result vazio
   - lalamove com location ok → atualiza campos
   - lalamove com 404 → conta semDriverDisponivel sem update
   - Erro genérico de API → conta erro, continua
   - Lalamove sem driverIdApi → ignorado na listagem
8. Lint + typecheck limpos.

## Fora de escopo

- **WebSocket / SSE** pra atualização em tempo real no mapa — dashboard
  recarrega no F5 ou via refresh interval que já existe. Reabre se virar
  requisito de UX.
- **Polling em janela menor que 5min** — limite do GH Actions free tier;
  Vercel cron na Hobby é 1/dia.
- **Histórico de localização (trail)** — sobrescreve `last_driver_*`
  a cada poll. Trail vira tabela nova quando houver demanda.
- **Cancelamento de lalamoves > 24h sem update de driver** — não
  automatizamos. Operador acompanha pela UI e cancela manual.
- **Rate limiting handling** (429 da Lalamove) — não implementado. Se
  ocorrer com volume realista, abrir RITM separada.
- **Push notification quando motorista chega perto da entrega** — fora
  do escopo do módulo Confecção (caso de uso de consumer).
