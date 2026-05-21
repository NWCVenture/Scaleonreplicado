# Lalamove API v3 — Referência

> **Propósito deste arquivo:** guardar trechos da documentação oficial da
> Lalamove API v3 consultados pelos RITMs 25–28 (fase 8 — Integração
> Lalamove API).
>
> **Fonte:** [developers.lalamove.com/docs](https://developers.lalamove.com/docs/)
> **Última atualização:** 2026-05-15
>
> ⚠️ Quando um RITM for implementado, validar o trecho da doc oficial
> antes de seguir — a Lalamove muda endpoints/payloads sem aviso.

---

## §1 — Hosts e ambientes

| Ambiente | Host | Quando usar |
|----------|------|-------------|
| Sandbox | `https://rest.sandbox.lalamove.com` | Dev + preview + prod até validação completa (RITM-25/26 ficam aqui) |
| Produção | `https://rest.lalamove.com` | Só ativar quando RITM-26 estiver smoke-testada e RITM-27 (webhook) deployada |

Configuração via env `LALAMOVE_API_HOST` (sem hardcode). Ver
`specs/confeccao/RITM-25-lalamove-cotacao-assistida.md` pra config completa.

---

## §2 — Autenticação (HMAC-SHA256)

Todo request da API v3 precisa do header `Authorization: hmac <api_key>:<timestamp>:<signature>`.

### Algoritmo da assinatura

```
RAW_SIGNATURE = TIMESTAMP + "\r\n" + METHOD + "\r\n" + PATH + "\r\n" + CUSTOM_HEADERS + "\r\n" + BODY
SIGNATURE     = HMAC-SHA256(API_SECRET, RAW_SIGNATURE)  // hex lowercase
```

| Campo | Detalhe |
|-------|---------|
| `TIMESTAMP` | Unix epoch em **milissegundos** (string). Ex.: `"1715794800000"`. Deve estar dentro de ±30 min do horário do servidor da Lalamove. |
| `METHOD` | Maiúsculas: `GET` / `POST` / `PUT` / `PATCH` / `DELETE` |
| `PATH` | Path com query string, começando com `/`. Ex.: `/v3/quotations` ou `/v3/orders/12345?detail=1` |
| `CUSTOM_HEADERS` | Geralmente vazio. Quando houver, formato `Header1: value1\nHeader2: value2`. Para nosso uso, **sempre string vazia** entre os `\r\n`. |
| `BODY` | Para `POST`/`PUT`/`PATCH`: JSON serializado **exatamente** como vai no request (sem reformat). Para `GET`/`DELETE`: string vazia. |

### Headers obrigatórios em todo request

```
Authorization: hmac <API_KEY>:<TIMESTAMP>:<SIGNATURE_HEX>
Accept: application/json
Content-Type: application/json
Market: BR
```

### ⚠️ Pegadinhas

- **A serialização do body precisa ser estável** — se o objeto for serializado pra assinar e re-serializado pra enviar com chaves em outra ordem, a assinatura quebra. Centralizar: serializa **uma vez**, usa a mesma string pra assinar e enviar.
- **Não confundir milissegundos com segundos** — vários exemplos da doc usam `s`. A v3 usa **ms**.
- **`\r\n` é literal CRLF**, não LF. Em JavaScript: `"\r\n"`.
- **`CUSTOM_HEADERS` vazio mantém os dois `\r\n` consecutivos** — ou seja, há `\r\n\r\n` entre PATH e BODY.

### Vetor de teste (válido)

Pra validar o algoritmo da implementação. **Não é uma chave real** — só serve pra unit test do HMAC.

```
API_KEY    = "pk_test_demo"
API_SECRET = "sk_test_demo_secret"
TIMESTAMP  = "1715794800000"
METHOD     = "POST"
PATH       = "/v3/quotations"
BODY       = '{"data":{"serviceType":"MOTORCYCLE"}}'

RAW = "1715794800000\r\nPOST\r\n/v3/quotations\r\n\r\n{\"data\":{\"serviceType\":\"MOTORCYCLE\"}}"
SIG = HMAC-SHA256(API_SECRET, RAW)  // hex
    = "f3f44e4c1b1e89e6df0e2f08c9a59c95f9b6f1c25b3a3b8c80f5a2d2cb8e0d2a"  ⚠️ valor de exemplo, calcular no teste

AUTH = "hmac pk_test_demo:1715794800000:" + SIG
```

> O teste em `client.test.ts` deve **calcular** a SIG com o algoritmo
> implementado e comparar com um vetor gerado offline (via `openssl
> dgst -sha256 -hmac "$SECRET" <<< "$RAW"` ou equivalente em Python).
> Não copiar o valor placeholder acima.

---

## §3 — Envelope de erro

Toda resposta de erro segue o formato:

```json
{
  "errors": [
    {
      "id": "ERR_REQUIRED_FIELD",
      "message": "stops is required",
      "detail": "stops must contain at least 2 elements"
    }
  ],
  "meta": { "requestId": "550e8400-e29b-41d4-a716-446655440000" }
}
```

| Campo | Uso |
|-------|-----|
| `errors[].id` | Code estável (ex.: `ERR_REQUIRED_FIELD`, `ERR_NOT_FOUND`, `ERR_QUOTATION_EXPIRED`). Pode aparecer mais de um. |
| `errors[].message` | Descrição em inglês. Não traduzir; mostrar em logs / notas de auditoria, não na UI. |
| `meta.requestId` | **Sempre** logar este valor. O suporte da Lalamove pede pra investigar. |

### Códigos de erro comuns

| HTTP | `errors[0].id` | O que fazer |
|------|----------------|-------------|
| 400 | `ERR_REQUIRED_FIELD` / `ERR_INVALID_FIELD` | Validação nossa antes de chamar. Logar payload. |
| 401 | `ERR_UNAUTHORIZED` | Assinatura HMAC errada ou timestamp drift. Validar relógio. |
| 403 | `ERR_FORBIDDEN` | API key sem permissão pro mercado ou endpoint. |
| 404 | `ERR_NOT_FOUND` | Recurso não existe (quotationId/orderId errado ou já expirado). |
| 422 | `ERR_QUOTATION_EXPIRED` | Cotação passou de 5min. Re-cotar antes de criar order. |
| 429 | `ERR_RATE_LIMIT` | Backoff exponencial. Não chamar de novo por 1+ min. |
| 5xx | — | Retry 1× com backoff 1s. Se persistir, alertar (não bloquear UI). |

---

## §4 — `GET /v3/cities`

Lista cidades habilitadas, com `serviceType` e `specialRequest` válidos por cidade.
Usado pra validar/popular o select da UI.

### Request

```
GET /v3/cities
Headers: Authorization, Accept, Market
Body: (vazio)
```

### Response (parcial — campos relevantes pro RITM-25)

```json
{
  "data": [
    {
      "locode": "BR_SAO",
      "name": "São Paulo",
      "services": [
        {
          "key": "MOTORCYCLE",
          "description": "Motorcycle / Up to 20kg",
          "dimensions": {
            "length": { "value": "50", "unit": "cm" },
            "width":  { "value": "40", "unit": "cm" },
            "height": { "value": "40", "unit": "cm" }
          },
          "load": { "weight": { "value": "20", "unit": "kg" } },
          "specialRequests": [
            { "name": "HELP_BUY", "description": "Help buy items along the way" },
            { "name": "CASH_HANDLING_FEE", "description": "Cash on delivery" }
          ]
        },
        {
          "key": "CAR",
          "description": "Car / Up to 200kg",
          "load": { "weight": { "value": "200", "unit": "kg" } },
          "specialRequests": []
        },
        {
          "key": "VAN",
          "description": "Van / Up to 1000kg",
          "load": { "weight": { "value": "1000", "unit": "kg" } },
          "specialRequests": []
        }
      ]
    }
  ]
}
```

### Notas

- `services[].key` é o valor pra `serviceType` em `POST /v3/quotations`.
- `specialRequests[].name` é o valor pra `specialRequests[]` em `POST /v3/quotations`.
- Em **BR sandbox**, esperar pelo menos `MOTORCYCLE`, `CAR`, `VAN` em `BR_SAO`. Outras cidades têm cobertura variável.
- Cache em memória por 24h é seguro — a Lalamove muda a lista raramente.

---

## §5 — `POST /v3/quotations`

Cria uma cotação. Resposta inclui preço estimado + `quotationId` válido por **5 minutos**.

### Request

```json
POST /v3/quotations
{
  "data": {
    "serviceType": "MOTORCYCLE",
    "specialRequests": [],
    "language": "pt_BR",
    "stops": [
      {
        "coordinates": { "lat": "-23.55052", "lng": "-46.633308" },
        "address": "Av Paulista, 1000 - Bela Vista, São Paulo - SP, 01310-100"
      },
      {
        "coordinates": { "lat": "-23.561414", "lng": "-46.655881" },
        "address": "R. Augusta, 500 - Consolação, São Paulo - SP, 01304-000"
      }
    ],
    "item": {
      "quantity": "1",
      "weight": "LESS_THAN_3_KG",
      "categories": ["GENERAL_CARGO"],
      "handlingInstructions": ["KEEP_UPRIGHT"]
    },
    "isRouteOptimized": false,
    "scheduleAt": null
  }
}
```

| Campo | Obrigatório | Notas |
|-------|:-----------:|-------|
| `serviceType` | ✓ | Validar contra `/v3/cities` |
| `specialRequests` | — | Array (pode ser vazio). Validar contra `/v3/cities`. |
| `language` | — | Default `en_US`. Usar `pt_BR` pra BR. |
| `stops` | ✓ | Mín 2, máx 10. **Sempre** com `coordinates` (lat/lng como string). |
| `stops[].address` | ✓ | Texto livre — vai pro motorista. Detalhar complemento aqui. |
| `item.quantity` | — | Padrão `"1"`. String, não number. |
| `item.weight` | — | Enum: `LESS_THAN_3_KG`, `3_KG_TO_10_KG`, `MORE_THAN_10_KG`. |
| `item.categories` | — | Array. `GENERAL_CARGO` cobre quase tudo. `FOOD_DELIVERY`, `OFFICE_ITEMS` etc disponíveis. |
| `isRouteOptimized` | — | Apenas com 3+ stops. Pra confecção, sempre `false`. |
| `scheduleAt` | — | ISO 8601 **UTC**. `null` = imediato. ⚠️ Sempre UTC, não horário local. |

### Response (sucesso)

```json
{
  "data": {
    "quotationId": "12345678901234567890",
    "scheduleAt": null,
    "expiresAt": "2026-05-15T20:15:00.000Z",
    "serviceType": "MOTORCYCLE",
    "specialRequests": [],
    "language": "pt_BR",
    "stops": [
      {
        "stopId": "stop_abc1",
        "coordinates": { "lat": "-23.55052", "lng": "-46.633308" },
        "address": "Av Paulista, 1000 - ..."
      },
      {
        "stopId": "stop_def2",
        "coordinates": { "lat": "-23.561414", "lng": "-46.655881" },
        "address": "R. Augusta, 500 - ..."
      }
    ],
    "priceBreakdown": {
      "base": "8.00",
      "extraMileage": "2.50",
      "totalBeforeOptimization": "10.50",
      "totalExcludePriorityFee": "10.50",
      "total": "10.50",
      "currency": "BRL"
    },
    "distance": { "value": "5200", "unit": "m" }
  }
}
```

### ⚠️ Pegadinhas

- **`quotationId` é string de 19+ dígitos** — armazenar como `TEXT`, **nunca** `INTEGER`. A Lalamove estendeu de 12 pra 19 em set/2025.
- **`stopId` precisa ser preservado** pra `POST /v3/orders` (RITM-26). Salvar `stopsApi` completo no banco.
- **`priceBreakdown.total` é string** com decimal (ex.: `"10.50"`). Converter pra `Number` na hora de salvar (`Real` no schema).
- **5 minutos é firme** — depois disso `POST /v3/orders` com esse `quotationId` retorna `422 ERR_QUOTATION_EXPIRED`. Re-cotar.
- **Apenas 1 cotação aceita por order** — se cotar de novo, o `quotationId` anterior fica órfão (sem efeito). Marcar como `expirada` ou `descartada` no banco.

---

## §6 — Endpoints adicionais (stubs — expandir nas RITMs futuras)

### `GET /v3/quotations/{quotationId}`

Re-busca uma cotação existente. Útil pra revalidar antes do order. Mesmo
schema de response do `POST /v3/quotations`. Se expirou, retorna 422
`ERR_QUOTATION_EXPIRED`.

### `POST /v3/orders`

Cria pedido a partir de cotação válida. Resposta inclui `orderId` (19+
dígitos string) e `shareLink` (URL pública de rastreio).

#### Request

```json
POST /v3/orders
{
  "data": {
    "quotationId": "12345678901234567890",
    "sender": {
      "stopId": "stop_abc1",
      "name": "Fornecedor Tecidos ABC",
      "phone": "+5511999999999"
    },
    "recipients": [
      {
        "stopId": "stop_def2",
        "name": "Oficina Corte X",
        "phone": "+5511988887777",
        "remarks": "Entregar para João — OP05260001"
      }
    ],
    "isPODEnabled": false,
    "isRecipientSMSEnabled": true,
    "metadata": {
      "internalOrderId": "OP05260001-OPBUY"
    },
    "partner": null
  }
}
```

| Campo | Obrigatório | Notas |
|-------|:-----------:|-------|
| `quotationId` | ✓ | Da resposta de POST /v3/quotations. **Deve estar válida** (5min). Re-cotar antes se expirou. |
| `sender.stopId` | ✓ | `stopId` do primeiro stop da cotação. **Preservado** desde `confeccao_lalamove_cotacao.stops_api`. |
| `sender.name` | ✓ | Nome do contato (1-50 chars). |
| `sender.phone` | ✓ | **E.164** (`+5511...`). |
| `recipients[]` | ✓ | Array, mínimo 1. Cada item bate com um stop ≥1 da cotação. |
| `recipients[].stopId` | ✓ | `stopId` correspondente da cotação. |
| `recipients[].name` | ✓ | Nome (1-50 chars). |
| `recipients[].phone` | ✓ | E.164. |
| `recipients[].remarks` | — | Instruções pro motorista (max 250 chars). |
| `isPODEnabled` | — | Default `false`. Quando `true`, motorista coleta foto + assinatura na entrega. |
| `isRecipientSMSEnabled` | — | Default `true`. Lalamove envia SMS pro destinatário com o tracking. |
| `metadata` | — | Free-form. Útil pra rastrear pelo nosso lado (ex: número da OP). |
| `partner` | — | Sempre `null` pra Confecção. |

#### Response (sucesso)

```json
{
  "data": {
    "orderId": "98765432101234567890",
    "quotationId": "12345678901234567890",
    "priceBreakdown": {
      "base": "8.00",
      "extraMileage": "2.50",
      "total": "10.50",
      "currency": "BRL"
    },
    "driverId": null,
    "shareLink": "https://share.lalamove.com/?...",
    "status": "ASSIGNING_DRIVER",
    "distance": { "value": "5200", "unit": "m" },
    "stops": [
      { "stopId": "stop_abc1", "coordinates": {...}, "address": "..." },
      { "stopId": "stop_def2", "coordinates": {...}, "address": "..." }
    ],
    "metadata": { "internalOrderId": "OP05260001-OPBUY" }
  }
}
```

#### ⚠️ Pegadinhas

- **`orderId` 19+ dígitos string** — armazenar como TEXT.
- **`shareLink`** é o link de rastreio público — pode ser compartilhado
  com fornecedor/oficina. Salvar e exibir na UI.
- **`status` inicial é `ASSIGNING_DRIVER`** — mapeia pro nosso
  `procurando_motorista`.
- **`driverId` é null** até motorista aceitar.
- Após `POST /v3/orders` bem-sucedido, a cotação fica "consumida" —
  marcar `confeccao_lalamove_cotacao.status = 'convertida_em_pedido'`
  pra rastreabilidade.

### `GET /v3/orders/{orderId}`

Retorna estado atual do pedido. Usado pelo polling fallback do RITM-27 quando
o webhook não chega — varremos lalamoves ativos com `updatedAt` estagnado
(>10min) e sincronizamos.

#### Request

```
GET /v3/orders/12345678901234567890
Headers: Authorization, Accept, Market
Body: (vazio)
```

#### Response

```json
{
  "data": {
    "orderId": "12345678901234567890",
    "quotationId": "98765432101234567890",
    "status": "PICKED_UP",
    "shareLink": "https://share.lalamove.com/?...",
    "distance": { "value": "5200", "unit": "m" },
    "priceBreakdown": {
      "base": "8.00",
      "extraMileage": "2.50",
      "total": "10.50",
      "currency": "BRL"
    },
    "driverId": "drv_abc123",
    "metadata": { "internalOrderId": "OP05260001-OPBUY" },
    "stops": [
      {
        "stopId": "stop_abc1",
        "coordinates": { "lat": "-23.55", "lng": "-46.63" },
        "address": "...",
        "name": "Origem",
        "phone": "+5511999999999"
      },
      {
        "stopId": "stop_def2",
        "coordinates": { "lat": "-23.56", "lng": "-46.64" },
        "address": "...",
        "name": "Destino",
        "phone": "+5511988887777"
      }
    ]
  }
}
```

#### Pegadinhas

- `status` é o status atual da API (ex: `ASSIGNING_DRIVER`, `PICKED_UP`).
  Usar `mapearStatusApi` em `src/lib/confeccao/lalamove/status-map.ts`
  pra converter pro nosso enum interno.
- `driverId` é `null` enquanto motorista não aceitou.
- Pra detalhes do motorista (nome, telefone, placa), chamar
  `GET /v3/orders/{orderId}/drivers/{driverId}` (não documentado aqui).

### `DELETE /v3/orders/{orderId}`

Cancela pedido. Permitido enquanto status ∈ {`ASSIGNING_DRIVER`, `ON_GOING`}.
Após `PICKED_UP` retorna `422 ERR_INVALID_ORDER_STATUS`.

#### Request

```
DELETE /v3/orders/12345678901234567890
Headers: Authorization, Accept, Market
Body: (vazio)
```

#### Response (sucesso) — 204 No Content (ou 200 com body vazio)

Sem corpo de resposta. Cliente deve marcar `confeccao_lalamove.status = 'cancelado'`
+ `cancelada_em`/`cancelada_por_id`/`cancelamento_motivo`.

#### Erros comuns

| HTTP | `errors[0].id` | O que fazer |
|------|----------------|-------------|
| 404 | `ERR_NOT_FOUND` | orderId inexistente ou já cancelado há mais de 24h (purga da Lalamove). Tratar como sucesso idempotente. |
| 422 | `ERR_INVALID_ORDER_STATUS` | Pedido já passou de `PICKED_UP` — cancelamento não é mais possível. Marcar lalamove internamente com nota explicando. |

#### ⚠️ Idempotência

A Lalamove **não retorna erro** ao cancelar duas vezes — segunda chamada
retorna 404 (ERR_NOT_FOUND) ou 204. Tratar ambos como sucesso pra
permitir retry seguro.

### `GET /v3/orders/{orderId}/drivers/{driverId}/location`

Polling de localização do motorista (RITM-28). Chamado pelo cron
`lalamove-sync` a cada 5min pra cada lalamove com `status ∈
{motorista_designado, a_caminho_coleta, coletado}` e `driverIdApi NOT NULL`.

#### Request

```
GET /v3/orders/{orderId}/drivers/{driverId}/location
Headers: Authorization, Accept, Market
Body: (vazio)
```

#### Response (sucesso)

```json
{
  "data": {
    "lat": "-23.561414",
    "lng": "-46.655881",
    "updatedAt": "2026-05-21T18:30:00.000Z"
  }
}
```

> Algumas versões da API podem aninhar em `coordinates`:
> ```json
> { "data": { "coordinates": { "lat": "...", "lng": "..." }, "updatedAt": "..." } }
> ```
> Nossa implementação (`driver-location.ts`) aceita ambos os formatos.

#### Errors

| HTTP | Tratamento |
|------|------------|
| 404 | Driver ainda não reportou location (cedo demais). Contar como `semDriverDisponivel`, não erro. |
| 500+ | Erro transitório. Contar como `erros`; próximo polling tenta de novo em 5min. |

#### ⚠️ Pegadinhas

- `lat`/`lng` são **strings** (não números). Salvar como `text` no DB.
- `updatedAt` é da Lalamove (quando o motorista enviou). Não confundir
  com `last_driver_location_at` (quando nós salvamos no nosso DB).
- Sem nota de auditoria por update — localização muda muito; viraria spam.

### `PATCH /v3/webhook` — RITM-27 (setup 1×)

Registra URL de webhook. Alternativa: configurar no Partner Portal.

---

## §7 — Mapeamento de status (interno ↔ API)

Já documentado em `specs/confeccao/GUIA-TECNICO.md` §"Mapeamento status
interno ↔ status da API". Resumo:

| API Lalamove | Interno (`confeccao_lalamove.status`) |
|---|---|
| — (sem order) | `rascunho` / `cotado` |
| `ASSIGNING_DRIVER` | `procurando_motorista` |
| `ON_GOING` | `motorista_designado` → `a_caminho_coleta` |
| `PICKED_UP` | `coletado` |
| `COMPLETED` | `entregue` |
| `CANCELED` | `cancelado` |
| `REJECTED` | `rejeitado` |
| `EXPIRED` | `expirado` |

---

## §8 — Webhook (RITM-27)

A Lalamove POST-a pra `/api/webhooks/lalamove` quando status muda. Eventos
esperados:

- `ORDER_STATUS_CHANGED` — inclui `orderId`, `status` (string da API), `timestamp`.
- `DRIVER_ASSIGNED` — quando motorista aceita; inclui `driverId`, `driverName`, `driverPhone`, `driverPlateNumber`.

### Payload (exemplo)

```json
{
  "event": "ORDER_STATUS_CHANGED",
  "data": {
    "orderId": "12345678901234567890",
    "status": "PICKED_UP",
    "timestamp": "2026-05-20T18:30:00.000Z"
  }
}
```

### Validação de assinatura

⚠️ **Descoberta durante setup (2026-05-21):** a doc oficial da Lalamove v3
NÃO documenta secret de webhook nem header de assinatura. O Partner Portal
só pede que o endpoint retorne 200 — não gera um webhook secret separado.
A única chave compartilhada é o `API_SECRET` usado pra assinar chamadas à
API REST (RITM-25).

Possíveis cenários (a confirmar com o primeiro webhook real):

1. **Lalamove não assina webhook v3** — segurança via URL secreta.
   `LALAMOVE_WEBHOOK_SECRET` permanece vazio; nosso endpoint processa
   eventos sem validação.
2. **Lalamove assina com o API_SECRET** — caso afirmativo, basta setar
   `LALAMOVE_WEBHOOK_SECRET=<mesmo valor de LALAMOVE_API_SECRET>` e o
   código existente valida.
3. **Header não-documentado** — endpoint atual loga todos os headers
   recebidos no primeiro webhook (modo investigação) pra descobrirmos.

Nossa implementação aceita os três formatos de header via lookup ordenado:

- `X-Lalamove-Signature`
- `X-Webhook-Signature`
- `Lalamove-Signature`

Comparação **sempre** com `timingSafeEqual`. Algoritmo HMAC-SHA256 do body
cru. Formatos aceitos: `<hex>`, `sha256=<hex>`, `hmac-sha256 <hex>`.

### Política de resposta

- **Tempo máximo:** 5s pra a Lalamove. Maior que isso → webhook suspenso.
- **Sempre 200** quando body é válido (mesmo sem `orderId` ou com payload
  inesperado). **401** apenas pra assinatura inválida.
- Processamento é **assíncrono** via `after()` (Next.js 16). Falha do
  processador NÃO afeta o 200 retornado.

### Política de retry da Lalamove

- Em failure (2xx não retornado), Lalamove re-tenta com backoff exponencial
  (~3 tentativas em ~5min).
- Após esgotar retries, evento **é perdido**. Polling fallback (cron 5min)
  é o backup pra garantir consistência.

### Idempotência

Eventos com mesma chave `(orderId, evento, timestamp)` já processados
viram noop — `processarWebhookEvent` checa e retorna `duplicado` sem
alterar lalamove nem criar nota duplicada.

---

## §9 — Quando atualizar este arquivo

- Antes de começar uma RITM que toca endpoint não documentado aqui →
  abrir a doc oficial, copiar trecho relevante, salvar na seção correta.
- Quando a Lalamove publicar versão nova da API (`v4`, etc.) → marcar
  seção atual como deprecated e criar nova.
- Sempre que um campo da response surpreender em produção → adicionar
  observação na seção do endpoint.

**Não confiar cegamente** em conhecimento de LLM sobre Lalamove. A API
mudou 3+ vezes em 2024–2025; sempre validar contra a doc oficial.
