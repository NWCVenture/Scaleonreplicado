# RITM-25 — Lalamove API: cotação assistida

Primeira RITM da fase 8 (integração com a API v3 do Lalamove). Implementa
apenas o **fluxo de cotação** — operador clica "Estimar via API", sistema
chama `POST /v3/quotations`, mostra valor + countdown de 5 min e grava a
cotação no banco. **NÃO cria pedidos via API ainda** (isso é RITM-26).

Arquitetura: §14 + §19.4 (sub-fase 8A) + GUIA-TECNICO "Integração Lalamove
API — implementação técnica".

> ⚠️ **Módulo separado, não compartilha com `src/lib/canais/`.** Lalamove é
> provedor logístico do Confecção, não marketplace. Toda lógica vai em
> `src/lib/confeccao/lalamove/`. Reusa as decisões da arquitetura (HMAC,
> idempotência) mas com módulo próprio. [[feedback_confeccao_separado_canais]]

## Escopo

| Mudança | Onde |
|---------|------|
| Client HTTP com HMAC-SHA256 + retry/timeout | `src/lib/confeccao/lalamove/client.ts` |
| Cache de cidades/serviceTypes (lazy, TTL 24h em memória) | `src/lib/confeccao/lalamove/cities.ts` |
| Service `cotarLalamove(tx, args)` (puro, testável) | `src/lib/confeccao/lalamove/cotacao.ts` |
| Endpoint `POST /api/confeccao/lalamoves/[id]/cotar` | `src/app/api/confeccao/lalamoves/[id]/cotar/route.ts` |
| UI: rename `bloco-lalamove-manual.tsx` → `bloco-lalamove.tsx` com modos manual/API + dialog de cotação | `src/components/confeccao/bloco-lalamove.tsx` |
| Validação de envs no startup (sem credenciais → flag desligada) | `src/lib/confeccao/lalamove/config.ts` |

**Não está aqui (vai pra RITM-26):**
- `POST /v3/orders` (criar pedido a partir da cotação)
- Botão "Confirmar pedido"
- Cancelamento via API
- Polling/webhook de status

## Estrutura

### Feature flag e config

`src/lib/confeccao/lalamove/config.ts`:

```ts
// Lê env vars + valida no boot. Se faltar qualquer um dos obrigatórios,
// flagHabilitada retorna false (UI esconde botões, endpoint retorna 503).
export function getLalamoveConfig(): {
  flagHabilitada: boolean;
  host: string;       // default https://rest.sandbox.lalamove.com
  market: string;     // default BR
  apiKey: string;
  apiSecret: string;
} | null;
```

Envs novas em `.env.local` e `.env.prod`:

```bash
LALAMOVE_API_HOST=https://rest.sandbox.lalamove.com
LALAMOVE_API_KEY=pk_test_...
LALAMOVE_API_SECRET=sk_test_...
LALAMOVE_MARKET=BR
LALAMOVE_FEATURE_FLAG=true   # liga em todos os ambientes; default false se faltar env
```

> ⚠️ **Decisão para a fase 8A: sandbox em todos os ambientes.** Dev local,
> Vercel preview E Vercel prod apontam pro mesmo host `rest.sandbox.lalamove.com`
> usando as chaves `pk_test_*` / `sk_test_*`. Razão: cotação só lê (não cria
> order), então não há risco de gerar custo real; ganhamos exercício end-to-end
> do fluxo com dados de produção (OPs reais, fornecedores reais) sem chamar a
> Lalamove de verdade. A migração pra `rest.lalamove.com` + chaves `pk_prod_*`
> acontece quando RITM-26 fechar e RITM-27 (webhook) estiver deployada.

### Client HTTP

`src/lib/confeccao/lalamove/client.ts`. Centraliza:

- Assinatura HMAC-SHA256 dos requests (algoritmo: timestamp + method + path + body → HMAC com `apiSecret` → header `Authorization: hmac <key>:<ts>:<sig>`)
- Headers obrigatórios: `Content-Type`, `Market` (= LALAMOVE_MARKET), `Authorization`
- Timeout 10s (Lalamove costuma responder < 2s; 10s cobre p99)
- Single retry com backoff 1s pra erros de rede / 5xx
- Parsing do envelope de erro: `{ errors: [{id, message}], meta: { requestId } }` — sempre extrair `requestId` (suporte da Lalamove pede)

```ts
export interface LalamoveResponse<T> {
  data: T;
  meta: { requestId: string };
}

export class LalamoveApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly errorId: string | null,
    public readonly requestId: string | null,
    message: string,
  ) { super(message); }
}

export async function lalamoveRequest<T>(args: {
  method: "GET" | "POST" | "DELETE" | "PATCH";
  path: string;       // ex: "/v3/quotations"
  body?: unknown;
}): Promise<LalamoveResponse<T>>;
```

**Tests** (`client.test.ts`) — função pura, sem rede:
- Gera assinatura HMAC bate com fixture conhecido (algoritmo deterministico)
- Header `Market` aparece no request
- Body JSON é estável (sem chaves trocadas) — assinatura depende disso

### Cache de cidades

`src/lib/confeccao/lalamove/cities.ts`:

```ts
// Lazy: primeira chamada faz GET /v3/cities, cacheia em memória por 24h.
// Sem cron — overhead aceitável (1 req por boot da função / dia).
export async function getCitiesCache(): Promise<{
  cities: Array<{
    locode: string;       // ex: BR_SAO
    name: string;
    services: Array<{ key: string; description: string; specialRequests: Array<{name, description}> }>;
  }>;
  fetchedAt: Date;
}>;

export async function validateServiceType(args: {
  cityLocode: string;
  serviceType: string;
}): Promise<{ valid: boolean; available: string[] }>;
```

> Decisão: cache **por instância** (Map global). Em Fluid Compute o pool de
> instâncias reutiliza isso entre requests, então hit rate fica alto. Re-
> render mais cedo se a Lalamove mudar oferta de service types — aceitável.

### Service de cotação

`src/lib/confeccao/lalamove/cotacao.ts`:

```ts
// Roda dentro de uma transação. Faz:
//   1. SELECT lalamove (FOR UPDATE) — valida estado: rascunho ou cotado
//   2. Monta payload do POST /v3/quotations com:
//      - serviceType (validado contra cities cache)
//      - stops[0] = endereço de origem (lat/lng obrigatório)
//      - stops[1] = endereço de destino (lat/lng obrigatório)
//   3. Chama lalamoveRequest (com timeout)
//   4. INSERT confeccao_lalamove_cotacao com expiraEm = now + 5min
//   5. UPDATE confeccao_lalamove SET status='cotado', service_type, quotation_id_api
//   6. Insere nota de auditoria com requestId
export async function cotarLalamove(
  tx: Tx,
  args: {
    contaId: string;
    lalamoveId: string;
    criadaPorId: string;
    serviceType: string;
    // Endereços via override (default: usa contato_*/origem_*/destino_* do registro)
    overrides?: { origem?: Partial<Endereco>; destino?: Partial<Endereco> };
  },
): Promise<{
  cotacaoId: string;
  valorCotado: number;
  moeda: string;
  expiraEm: Date;
  distanciaMetros: number | null;
}>;

export class CotacaoError extends Error {
  constructor(
    public readonly code:
      | "lalamove_nao_encontrado"
      | "lalamove_estado_invalido"      // status não é rascunho/cotado
      | "endereco_sem_coordenadas"      // origem ou destino sem lat/lng
      | "service_type_invalido"
      | "api_erro"
      | "feature_flag_off",
    message: string,
  ) { super(message); }
}
```

**Tests** (`cotacao.test.ts`, DB-dependentes):
- Lalamove rascunho → cota com sucesso, INSERT cotação, UPDATE status='cotado'
- Lalamove já entregue → throw `lalamove_estado_invalido`
- Endereço sem lat/lng → throw `endereco_sem_coordenadas` (não chama API)
- Feature flag off → throw `feature_flag_off`
- API retorna 4xx → throw `api_erro` com requestId no message
- Nota de auditoria criada com requestId no conteúdo

> Cliente HTTP é mockado via dependency injection (passa `httpClient` opcional
> no args; default usa `lalamoveRequest` real).

### Endpoint

`POST /api/confeccao/lalamoves/[id]/cotar` em
`src/app/api/confeccao/lalamoves/[id]/cotar/route.ts`.

- Auth: sessão com conta ativa
- Body: `{ serviceType: string, overrides?: {...} }` (Zod)
- Se feature flag off → `503 Service Unavailable` com `{ error: "Lalamove API desabilitada" }`
- Sucesso → 201 com `{ cotacaoId, valorCotado, moeda, expiraEm, distanciaMetros }`
- Erros de domínio (CotacaoError) → 400/404/422 com `{ code, error }`
- Erros HTTP da API (LalamoveApiError) → 502 com `{ error, requestId }` pra debug

### UI

Modifica `src/components/confeccao/bloco-lalamove-manual.tsx` (ou cria
componente irmão `bloco-lalamove.tsx` que envolve manual + api — decidir
durante a implementação):

- Se `flagHabilitada === false` → comportamento atual (manual só, sem
  botão de API).
- Se `flagHabilitada === true` → no header do card, dois botões lado a
  lado: **"Criar manual"** (cria com `origemSolicitacao='manual'`) e
  **"Estimar via API"** (cria com `origemSolicitacao='api'`).
- "Estimar via API" abre dialog com:
  - Lookup origem (fornecedor da subtask, prefill com dados do cadastro)
  - Lookup destino (próximo fornecedor no fluxo)
  - Select `serviceType` (opções vindas de `/api/confeccao/lalamoves/service-types`)
  - Botão "Cotar"
- Após cotação:
  - Mostra valor (`R$ 25,90`), distância (`12.3 km`), countdown ("expira em
    4:32")
  - Botão "Confirmar pedido" **desabilitado com tooltip "RITM-26"** (placeholder)
  - Botão "Re-cotar" (re-chama o endpoint quando expirar)
  - Botão "Descartar" (apenas fecha o dialog; cotação fica no banco com status
    `expirada` quando passa de 5min — limpeza por cron futuro, fora de escopo)

> Endpoint auxiliar `GET /api/confeccao/lalamoves/service-types?city=...`
> retorna a lista do cache + filtro pela cidade (ou todas se sem filtro).
> Adicionar nesta RITM pra alimentar o select.

### Flag de habilitação na API

`GET /api/confeccao/lalamoves/config` em
`src/app/api/confeccao/lalamoves/config/route.ts`:

- Retorna `{ flagHabilitada: boolean, market: string }` (sem expor secrets)
- UI consulta isso ao montar pra decidir se mostra o botão API

## Variáveis de ambiente

Adicionar em `.env.example`, `.env.local` e `.env.prod`:

```bash
# Lalamove API v3 — fase 8 (cotação assistida começa aqui)
LALAMOVE_API_HOST=https://rest.sandbox.lalamove.com
LALAMOVE_API_KEY=
LALAMOVE_API_SECRET=
LALAMOVE_MARKET=BR
LALAMOVE_FEATURE_FLAG=false  # mudar pra true após smoke em sandbox
```

> Chaves sandbox e prod estão em `C:\Users\molin\Documents\AVZ DEV\auxiliares\modulo confec e api lala\` (fora do repo).

## Critérios de aceitação

1. `getLalamoveConfig()` retorna `null` (flag desligada) quando qualquer env obrigatória falta.
2. Cliente HMAC: assinatura calculada bate com vetor de teste publicado pela Lalamove (ver `docs/referencias/`).
3. `GET /api/confeccao/lalamoves/service-types?city=BR_SAO` retorna pelo menos `MOTORCYCLE`, `CAR`, `VAN` em sandbox.
4. `POST /api/confeccao/lalamoves/[id]/cotar` com feature flag off → 503.
5. `POST /api/confeccao/lalamoves/[id]/cotar` com payload válido → 201 com cotação no banco + nota de auditoria com `requestId`.
6. Lalamove em estado `entregue` → 422 `lalamove_estado_invalido`.
7. Origem/destino sem lat/lng (fornecedor sem geocoding) → 400 `endereco_sem_coordenadas`, **sem chamar API**.
8. UI mostra valor + countdown; "Confirmar pedido" desabilitado com tooltip apontando pra RITM-26.
9. Re-cotar uma vez gera novo registro em `confeccao_lalamove_cotacao` (cotações anteriores ficam, expiram naturalmente).
10. Testes unit do client (HMAC) + testes DB-dependentes do service: lint + typecheck limpos, todos passando.
11. Não há código de Lalamove dentro de `src/lib/canais/` (separação de domínios garantida).

## Fora de escopo

- **`POST /v3/orders`** → RITM-26
- **Webhook `/api/webhooks/lalamove`** → RITM-27
- **Polling/mapa em tempo real** → RITM-28
- **Cron de limpeza de cotações expiradas** — útil mas não bloqueante. Reabrir quando volume justificar (uma cotação ocupa < 2KB).
- **Cache persistente de `/v3/cities`** — começamos com cache em memória por instância. Se vira gargalo, migrar pra tabela `confeccao_lalamove_city_cache` em RITM separada.
- **Re-cotar automaticamente quando expira** — operador clica "Re-cotar" manualmente. Auto-recotação no submit do pedido fica pra RITM-26.
- **Migração pra prod da Lalamove** — fase 8A fica em sandbox. Reabrir quando RITM-26 fechar.
