# TikTok Shop API — Referência

> **Propósito deste arquivo:** guardar trechos da documentação oficial do TikTok Shop consultados pelos RITMs durante a implementação.
>
> **Fonte:** doc exportada do Partner Center (partner.tiktokshop.com/docv2) em PDF, versão **202407**.
> **Última atualização:** 2026-04-23
> **Processado por:** Claude (a partir de `documentação_tiktok.pdf`, 177 páginas)

---

## ⚠️ Versão da API

A doc está na versão **202407** (`Authorization overview (202407)`), mas **os endpoints continuam com versão `202309` no path** (ex: `/authorization/202309/shops`). A versão do endpoint **não é** a mesma coisa que a versão da doc.

Na prática:
- Endpoints de **autorização** (/authorization/*): versão `202309`
- Endpoints de **produto** (/product/*): versão mista — alguns `202309`, outros `202502`
- Validar a versão **por endpoint** nas páginas específicas da doc

**Configuração recomendada:** manter `TIKTOK_SHOP_API_VERSION=202309` como default pra endpoints de autorização. Outras versões são tratadas caso a caso.

---

## §1 — Autorização: Overview

### Requisitos pré-autorização

**Custom apps** (nosso caso):
1. App deve ter pelo menos 1 API scope habilitado (seller/creator/partner)
2. App deve passar no "enrollment review"

**Public apps** (quando virar SaaS):
1. API scope habilitado
2. Enrollment review
3. USDS/OPIS review (só pra US)
4. Listing review
5. App review
6. Beta testing (só pra connector apps)

### URL de autorização

**Depende do mercado:**

```
US:  https://services.tiktokshops.us/open/authorize?service_id=7369437808455026474

ROW (Rest of World, INCLUI BR):
     https://services.tiktokshop.com/open/authorize?service_id=7431458374265161478
```

### ⚠️ DIFERENÇA IMPORTANTE vs. assumido nos RITMs

- ❌ **Não usa** `app_key` na query string da autorização
- ✅ **Usa** `service_id` — é um ID fixo por mercado, não é o nosso app_key
- ✅ Para BR, usar `service_id=7431458374265161478`

A doc recomenda: "A state parameter should be added to your authorization link for extra security."

### Callback de autorização

Se o usuário aceita, é redirecionado pra Redirect URL com:
```
{redirect_url}?code=FeBoANmHP3yqdoUI9fZOCw&state={state}
```

Se rejeita:
```
{redirect_url}?code=null&error=auth_denied&state={state}
```

### Restrições do auth_code

- **Expira em 30 minutos**
- **Só pode ser usado uma vez** (single-use)
- Prefixo observado no exemplo: `TTP_` (ex: `TTP_FeBoANmHP3yqdoUI9fZOCw`)

---

## §2 — Obter Access Token

### Endpoint

```
GET https://auth.tiktok-shops.com/api/v2/token/get
```

### Query parameters

| Param | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `app_key` | string | Sim | App key do Partner Center |
| `app_secret` | string | Sim | App secret do Partner Center |
| `auth_code` | string | Sim | `code` recebido no callback |
| `grant_type` | string | Sim | Valor fixo: `authorized_code` |

### Exemplo de request

```
https://auth.tiktok-shops.com/api/v2/token/get?app_key=123abcd&app_secret=15abf8a4972afd1f275d5b19bfa9a17e0d142aa7&auth_code=TTP_FeBoANmHP3yqdoUI9fZOCw&grant_type=authorized_code
```

### Response schema

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "access_token": "TTP_Fw8rBwAAAAAkW03FYd09DG-9INtpw361...",
    "access_token_expire_in": 1660556783,
    "refresh_token": "TTP_NTUxZTNhYTQ2ZDk2YmRmZWNmYWY2YWY2YzkxNGYwNjQ3...",
    "refresh_token_expire_in": 1691487031,
    "open_id": "7010736057180325637",
    "seller_name": "Jjj test shop",
    "seller_base_region": "ID",
    "user_type": 0,
    "granted_scopes": [
      "seller.affiliate_collaboration.read",
      "seller.affiliate_collaboration.write"
    ]
  },
  "request_id": "2022080809462301024509910319695C45"
}
```

### ⚠️ DIFERENÇAS IMPORTANTES vs. assumido nos RITMs

- **`access_token_expire_in` é timestamp Unix ABSOLUTO** (segundos desde 1970), **não duração em segundos**
- **`refresh_token_expire_in` também é timestamp absoluto**
- Default de expiração do access_token: **7 dias** (não 24h como eu assumi inicialmente)
- Campo `seller_base_region` (string) informa região do seller
- Campo `user_type`: 0=Seller, 1=Creator, 3=Partner
- Campo `granted_scopes`: array com os escopos efetivamente aprovados
- Response success: `code == 0`

### Códigos de response (tabela base)

| Campo | Tipo | Descrição |
|---|---|---|
| `code` | int | `0` = sucesso. Outros códigos = erro (ver §7) |
| `message` | string | Mensagem human-readable |
| `request_id` | string | ID único pra tracking/debug |
| `data` | object | Payload principal (null em caso de erro) |

---

## §3 — Refresh Access Token

### Endpoint

```
GET https://auth.tiktok-shops.com/api/v2/token/refresh
```

### Query parameters

| Param | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `app_key` | string | Sim | App key |
| `app_secret` | string | Sim | App secret |
| `refresh_token` | string | Sim | Refresh token obtido no Get Access Token |
| `grant_type` | string | Sim | Valor fixo: `refresh_token` |

### Exemplo

```
https://auth.tiktok-shops.com/api/v2/token/refresh?app_key=65t6a8e8bfejb&app_secret=f4c770e4b45aa62e&refresh_token=TTP_EB9rlwAAAADXbnMESTWAZSxIcC-XUA5AyeEOdmGBKY2FiKFYKqON6jco&grant_type=refresh_token
```

### Response

**Mesma estrutura do Get Access Token.** Retorna:
- Novo `access_token` com novo `access_token_expire_in`
- Novo `refresh_token` com novo `refresh_token_expire_in`
- Demais campos iguais

### ⚠️ Importante

- Refresh retorna **novo refresh_token** — precisamos substituir o antigo
- Timestamps de expiração também são absolutos Unix

---

## §4 — Listar Shops Autorizados

### Endpoint

```
GET https://open-api.tiktokglobalshop.com/authorization/202309/shops
```

⚠️ **Versão do path é `202309`** (continua sendo essa versão mesmo com doc em 202407).

### Parâmetros

Este endpoint **exige assinatura HMAC** (ver §5). Parâmetros:

| Param | Localização | Tipo | Descrição |
|---|---|---|---|
| `app_key` | query | string | App key |
| `sign` | query | string | Assinatura HMAC-SHA256 (ver §5) |
| `timestamp` | query | Unix timestamp | Timestamp atual (deve estar a <5min do servidor) |
| `x-tts-access-token` | **header** | string | Access token obtido no §2 |

### Content-Type header

```
Content-Type: application/json
```

### Exemplo cURL

```bash
curl --location --request GET \
  'https://open-api.tiktokglobalshop.com/authorization/202309/shops?app_key=<app_key>&sign=<signature>&timestamp=<unix_ts>' \
  --header 'Content-Type: application/json' \
  --header 'x-tts-access-token: <access_token>'
```

### Response

```json
{
  "code": 0,
  "data": {
    "shops": [
      {
        "cipher": "<shop cipher>",
        "code": "<shop code>",
        "id": "<shop identifier>",
        "name": "<shop name>",
        "region": "<shop region>",
        "seller_type": "<seller type>"
      }
    ]
  },
  "message": "Success",
  "request_id": "<request_id>"
}
```

### Campos importantes

- `cipher` — necessário pra chamar outros endpoints (produto, pedido, etc)
- `id` — identificador único da loja (`shop_id`)
- `code` — código interno (não confundir com `auth_code`)
- `region` — ex: `"BR"`, `"ID"`, `"US"`

---

## §5 — Algoritmo de Assinatura HMAC-SHA256 🔴 CRÍTICO

### Overview

**Algoritmo:** HMAC-SHA256
**Output:** hex (lowercase)
**Ordenação:** alfabética crescente das chaves
**Separador:** nenhum (concatenação direta `key+value`)

### Params excluídos da assinatura

Remover **SEMPRE** antes de gerar a assinatura:
- `sign`
- `access_token` (note: o token vai em **header** `x-tts-access-token`, não em query)

### Passo a passo

1. Extrair todas as query params **exceto** `sign` e `access_token`
2. Ordenar as chaves **alfabeticamente**
3. Concatenar no formato `{key}{value}{key}{value}...` (sem separador)
4. **Prepender o path** (só o path, sem domain, sem query string)
5. **Se Content-Type != `multipart/form-data`** e tem body: **appendar body JSON serializado** (ao final)
6. **Wrappar com app_secret**: `app_secret + string_atual + app_secret`
7. Aplicar HMAC-SHA256 usando `app_secret` como chave, output em hex

### Vetor de teste oficial 🔴 USAR NOS TESTES

```
INPUT:
  app_key:    29a39d
  app_secret: e59af819cc
  timestamp:  1623812664
  path:       /authorization/202309/shops
  method:     GET
  body:       (nenhum)

PASSO A PASSO:
  1. params filtrados: { app_key: "29a39d", timestamp: "1623812664" }
  2. ordenados:        [app_key, timestamp]
  3. concatenado:      "app_key29a39dtimestamp1623812664"
  4. path + concat:    "/authorization/202309/shopsapp_key29a39dtimestamp1623812664"
  5. wrap:             "e59af819cc/authorization/202309/shopsapp_key29a39dtimestamp1623812664e59af819cc"
  6. HMAC-SHA256(key=e59af819cc, msg=<wrap>):

EXPECTED OUTPUT:
  b596b73e0cc6de07ac26f036364178ab16b0a907af13d43f0a0cd2345f582dc8
```

⚠️ **Nota:** a doc também menciona outro hash (`bc721f0e0182914e3487b81df204de37a352fc3aa96947efda6dc1e5dd0d5290`) num exemplo de cURL anterior. A versão definitiva do vetor com o step-by-step completo é `b596b73e0cc6...` acima — usar essa como referência.

### Vetor de teste com body (endpoint Update Shop Webhook)

```
INPUT:
  app_key:     68xu9ks5p4i8
  timestamp:   1696909648
  shop_cipher: ROW_xkMbgAAAeVAQra0eZWebFQq5aIK
  path:        /event/202309/webhooks
  method:      POST
  body:        {"address":"https://partner.tiktokshop.com", "event_type": "PACKAGE_UPDATE"}
  content-type: application/json (não é multipart)

STRING APÓS STEP 4:
  /event/202309/webhooksapp_key68xu9ks5p4i8shop_cipherROW_xkMbgAAAeVAQra0eZWebFQq5aIKtimestamp1696909648{"address":"https://partner.tiktokshop.com", "event_type": "PACKAGE_UPDATE"}
```

(A doc não dá o hash final deste exemplo, mas o exemplo mostra como o body é appendado **sem modificação** — a serialização JSON é usada como veio.)

### Implementação Node.js de referência (copiada da doc, adaptada pra `ICanalAdapter`)

```typescript
import crypto from "crypto";

const excludeKeys = ["access_token", "sign"] as const;

export function generateSign(
  requestOption: {
    qs?: Record<string, string>;
    uri?: string;              // URL completa ou só path
    headers?: Record<string, string>;
    body?: Record<string, unknown>;
  },
  app_secret: string
): string {
  // Step 1 & 2: extrair params, filtrar, ordenar, concatenar
  const params = requestOption.qs || {};
  const sortedParams = Object.keys(params)
    .filter((key) => !excludeKeys.includes(key as any))
    .sort()
    .map((key) => ({ key, value: params[key] }));

  const paramString = sortedParams
    .map(({ key, value }) => `${key}${value}`)
    .join("");

  // Step 3: prepend path
  const pathname = new URL(requestOption.uri || "").pathname;
  let signString = `${pathname}${paramString}`;

  // Step 4: se não é multipart, append body
  if (
    requestOption.headers?.["content-type"] !== "multipart/form-data" &&
    requestOption.body &&
    Object.keys(requestOption.body).length
  ) {
    signString += JSON.stringify(requestOption.body);
  }

  // Step 5: wrap com app_secret
  signString = `${app_secret}${signString}${app_secret}`;

  // Step 6: HMAC-SHA256 hex
  const hmac = crypto.createHmac("sha256", app_secret);
  hmac.update(signString);
  return hmac.digest("hex");
}
```

### Validação de timestamp

O servidor do TikTok valida o `timestamp`:
- Deve ser Unix epoch em **segundos** (10 dígitos)
- Deve estar entre **5 minutos antes** e **30 segundos depois** do horário do servidor
- Fora disso: erro `360090/04 - Invalid timestamp`

### Erros comuns (troubleshooting)

- ❌ App key/secret errados → erro `1060/01`
- ❌ `sign` ou `access_token` incluídos na ordenação (Step 2)
- ❌ SHA-256 simples ao invés de HMAC-SHA256
- ❌ Timestamp fora da janela de 5 min
- ❌ Timestamp em milissegundos (TikTok quer segundos, 10 dígitos)

---

## §6 — Webhooks

### ⚠️ LIMITAÇÃO DA DOC FORNECIDA

A documentação exportada pelo Gabriel **não inclui** detalhes completos sobre:

- Validação da assinatura de webhooks **recebidos** (quando o TikTok chama nosso endpoint)
- Nome exato do header onde vai a assinatura do webhook
- Formato completo do payload por tipo de evento

A doc cobre **registrar** um endpoint de webhook (via "Update Shop Webhook" API) mas não como validar as requisições que chegam.

### O que a doc tem sobre webhooks

**Tipos de eventos disponíveis** (da tabela de migração v202309):

| Tipo | Nome v202309 | Descrição |
|---|---|---|
| Type 1 | `ORDER_STATUS_UPDATE` | Mudanças de status de pedido (pendente, pago, enviado, etc) |
| Type 2 | `CANCELLATION_STATUS_CHANGE` | Mudanças de status de cancelamento |
| Type 2 | `RETURN_STATUS_CHANGE` | Mudanças de status de devolução |
| Type 3 | `RECIPIENT_ADDRESS_UPDATE` | Atualização de endereço do destinatário |
| Type 4 | `PACKAGE_UPDATE` | Atualização de pacote/envio |
| Type 5 | `PRODUCT_STATUS_UPDATE` | Mudança de status de produto |
| Type 6 | `SELLER_DEAUTHORIZATION` | Seller revogou autorização (desconectou o app) |
| Type 7 | `AUTH_EXPIRE` | Notificação de expiração próxima de autorização |

**APIs relacionadas** (precisamos implementar em onda futura):
- `Update Shop Webhook` — registra ou atualiza URL de webhook
- `Get Shop Webhooks` — lista webhooks registrados
- `Delete Shop Webhook` — remove webhook

### Estratégia recomendada enquanto a info não está disponível

Para o **RITM-10**, implementar o receiver com as seguintes precauções:

1. Registrar **todos os eventos recebidos** em `eventos_webhook_tiktok`, mesmo sem validar assinatura
2. Deixar `assinaturaValida = false` (ou `null`) até conseguirmos a info de validação
3. **NÃO processar** eventos em produção até termos validação de assinatura funcionando
4. Em dev/homologação: usar o "API Testing Tool" do Partner Center pra disparar eventos de teste
5. Tentar identificar o header de assinatura olhando os headers do próprio evento recebido no dashboard do RITM-11

### Ações pendentes pro Gabriel

- [ ] Localizar na doc SPA a seção "Webhook signature verification" ou equivalente
- [ ] Verificar se o Partner Center tem seção específica sobre webhook security
- [ ] Em caso de dúvida, abrir ticket no suporte TikTok pedindo a doc específica

---

## §7 — Códigos de Erro

### Sucesso

- `code: 0` → requisição bem-sucedida

### Erros gerais (General errors)

| Código | Erro | O que fazer |
|---|---|---|
| `36009002` | Too many requests | Rate limit — aguardar e retry |
| `36009007` | Request timeout | Retry ou dividir em requests menores |
| `36009009` | Invalid path | Corrigir endpoint |
| `36009010` | Invalid method | Método HTTP errado (GET vs POST) |
| `36009021` | Invalid file size | Arquivo muito grande |
| `36009022` | Invalid request format | Body deve ser JSON ou multipart |
| `36009023` | Invalid Content-Type | Deve ser multipart/form-data pra upload |

### Erros de autorização (Authorization errors)

| Código | Erro | O que fazer |
|---|---|---|
| `105005` | Access denied — scope insuficiente | Pedir reautorização com scope correto ou habilitar scope no Partner Center |
| `36009033` | IP não está na whitelist | Adicionar IP no Partner Center → App & Service |
| `1010000` | Invalid query/header — `x-tts-access-token` inválido | Reautorizar |

### Erros de autenticação (Authentication errors)

| Código | Erro | O que fazer |
|---|---|---|
| `105002` | **Expired credentials** — access_token expirou | **Chamar Refresh Token** |
| `106001` | Invalid signature (`sign`) | Revisar geração de assinatura (§5) |
| `36009004` | Missing signature | Assinatura não foi enviada |
| `36009004` | Invalid access_token | Token inválido/malformado |
| `36009004` | Invalid app_key | Verificar env var |
| `36009004` | Invalid timestamp | Relógio local dessincronizado com servidor (janela 5min+30s) |

### Erros de parâmetros (Parameter errors)

| Código | Erro | O que fazer |
|---|---|---|
| `106013` | Missing `shop_cipher` | Chamar Get Authorized Shops pra obter |

### Mapeamento para `TikTokShopError`

Pra implementar em `src/lib/canais/tiktok-shop/errors.ts`:

```typescript
// Códigos que triggeram refresh automático de token
const RECOVERABLE_WITH_REFRESH = [105002];

// Códigos que requerem re-autorização do usuário
const REQUIRES_REAUTH = [
  1010000,   // x-tts-access-token inválido
  36009004,  // access_token inválido (não é o mesmo que expirado)
  105005,    // scope insuficiente
];

// Códigos transitórios (retry com backoff)
const RECOVERABLE_TRANSIENT = [
  36009002,  // rate limit
  36009007,  // timeout
];

// Códigos fatais (nunca retry)
const FATAL = [
  36009009,  // invalid path
  36009010,  // invalid method
  36009022,  // invalid format
  36009023,  // invalid content-type
  106001,    // invalid sign (erro no código)
  36009033,  // IP não whitelisted
];
```

---

## §8 — Update Inventory (Estoque)

*Não incluído nesta exportação — preencher quando for implementar Onda de estoque.*

Endpoints relevantes (da tabela de migração):
- `Update Inventory` (v202309) — antes era `Update Stock`
- `Inventory Search` (v202309) — antes era `Get Product Stock`

---

## §9 — Order APIs

*Não incluído em detalhes nesta exportação — preencher quando for implementar Onda de pedidos.*

Endpoints relevantes (da tabela de migração):
- `Search Orders` (v202309)
- Webhook `ORDER_STATUS_UPDATE` (Type 1)

---

## Notas gerais extraídas da doc

### Arquitetura de URLs

Padrão: `https://{domain}/{category}/{version}/{resource}`

Domínio produção: `https://open-api.tiktokglobalshop.com`

### Autenticação — dois mecanismos simultâneos

1. **Query params:** `app_key`, `timestamp`, `sign` → provam que é NOSSO app
2. **Header:** `x-tts-access-token` → prova que estamos autorizados POR UM SELLER específico

Ambos precisam estar corretos.

### Rate limits

A doc menciona `36009002` como erro de rate limit mas **não especifica limites exatos** nesta exportação. A própria doc remete a uma seção "Rate limits" que não está neste PDF.

### IP whitelist

O Partner Center permite configurar IP whitelist pro app. Em dev local com túnel (Cloudflare Tunnel), **IP whitelist deve estar DESATIVADA** — o IP do túnel muda. Em prod (Vercel), pode ser configurado com IPs de saída do Vercel se quisermos camada extra.

### Escopos (scopes)

Partner Center permite habilitar por API. Alguns escopos disponíveis mencionados:
- `product.list.read`, `product.list.write`
- `product.stock.read`, `product.stock.write` (chamados `Modify Product Stock` na doc)
- `order.list.read`, `order.list.write`
- `fulfillment.*`
- `finance.read`
- `authorization.read`
- `return_refund.*`
- `promotion.*`
- `affiliate_collaboration.*` (seller affiliate)

**Habilitar apenas o que vai usar:** a doc alerta que escopos desnecessários aumentam tempo de review e reduzem taxa de aceitação do usuário.

---

## Dúvidas em aberto (pra resolver conforme implementação)

- [ ] Qual o header exato de assinatura de webhook recebido?
- [ ] A doc de validação de webhook existe em outra parte do Partner Center?
- [ ] Rate limits numéricos por endpoint
- [ ] Comportamento do `auth_code` único — se a mesma loja autoriza duas vezes, o primeiro token é invalidado?
- [ ] Quando ocorre `SELLER_DEAUTHORIZATION`, o refresh_token fica inválido imediatamente? (assumir que sim)

---

*Arquivo baseado em `documentação_tiktok.pdf` (177 páginas, versão 202407). Atualizar conforme novas informações chegarem.*
