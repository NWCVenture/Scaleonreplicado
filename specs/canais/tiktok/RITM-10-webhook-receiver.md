# RITM-10 — Webhook Receiver (só registrar, modo discovery)

> **Bloqueia:** processamento de pedidos (REQ-MKT-002)
> **Depende de:** RITM-02 (schema)
> **Dependência externa:** ⚠️ **Parcialmente resolvida** — a doc fornecida (§6) cobre tipos de evento disponíveis mas NÃO detalha validação de assinatura de webhook recebido

---

## Objetivo

Criar endpoint que **recebe e registra** todos os eventos de webhook do TikTok Shop. Nesta Onda 0, não processa nada — só registra no banco como "modo discovery".

**Três propósitos:**
1. **Obrigatório:** TikTok exige webhook URL configurada. Se o endpoint não existir ou retornar erro, TikTok pode suspender webhooks
2. **Discovery:** acumular 2-4 semanas de eventos reais pra entender estrutura do payload e descobrir qual header carrega a assinatura
3. **Preparatório:** na próxima onda (REQ-MKT-002), processamos esses eventos com segurança

---

## ⚠️ LIMITAÇÃO: validação de assinatura

A documentação fornecida pelo Gabriel (177 páginas do Partner Center) cobre:
- ✅ Como **registrar** um webhook (endpoint `Update Shop Webhook`)
- ✅ **Tipos de eventos** disponíveis (Order Status, Package Update, Seller Deauth, etc.)
- ❌ **NÃO cobre** como validar a assinatura dos webhooks **recebidos**

Sem essa info, **não sabemos qual header carrega a assinatura** nem **qual é o algoritmo de validação**.

### Estratégia adotada: registrar tudo, validar depois

- Receber TODOS os webhooks e salvar integralmente (payload + headers + body raw)
- Marcar `assinaturaValida = null` (significando "não verificado") em vez de `false`
- Em RITM-11 (dashboard), mostrar os headers recebidos — Gabriel identifica visualmente qual parece ser assinatura
- Quando descobrirmos o header + algoritmo (via doc atualizada, suporte, ou engenharia reversa), adicionar validação em REQ futuro

**Consequência:** na Onda 0, **não** processar os webhooks em lógica de negócio. Só armazenar. Processamento real vem na REQ-MKT-002 quando tivermos validação.

---

## Arquivos a criar

- `src/app/api/webhooks/tiktok/route.ts`
- `src/app/api/webhooks/tiktok/route.test.ts`

---

## Schema de `eventos_webhook_tiktok` — ajuste necessário

⚠️ **Ajuste no schema original (RITM-02):**

O campo `assinatura_valida` precisa virar **nullable** pra suportar estado "não verificado":

```typescript
// Em src/lib/db/schema.ts
assinaturaValida: boolean('assinatura_valida'),  // remover notNull()
```

Semântica:
- `null` = assinatura **não verificada** (Onda 0, modo discovery)
- `true` = assinatura verificada e válida (Onda futura, depois de descobrir algoritmo)
- `false` = assinatura verificada e inválida (possível tentativa de ataque)

---

## Especificação do route handler

```typescript
// src/app/api/webhooks/tiktok/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { eventosWebhookTiktok, canaisVenda } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const headers = Object.fromEntries(req.headers);

  // 1. Parse do body (se der) — nunca falha se não conseguir
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // Registra mesmo se não for JSON válido — vai no rawBody como string
  }

  // 2. Tentar extrair tipo e shop_id
  const tipoEvento = extrairTipoEvento(payload);
  const shopIdExterno = extrairShopId(payload);

  // 3. Tentar resolver qual canal da nossa conta
  let canalVendaId: number | null = null;
  let contaId: number | null = null;

  if (shopIdExterno) {
    // ⚠️ query sem RLS (webhook não tem sessão) — seguir padrão do projeto
    // para bypass, conforme definido em docs/arquitetura/modulo-canais.md §5.3
    const [canal] = await db
      .select({ id: canaisVenda.id, contaId: canaisVenda.contaId })
      .from(canaisVenda)
      .where(eq(canaisVenda.identificadorLoja, shopIdExterno))
      .limit(1);

    if (canal) {
      canalVendaId = canal.id;
      contaId = canal.contaId;
    }
  }

  // 4. Registrar SEMPRE (mesmo sem conseguir validar)
  try {
    await db.insert(eventosWebhookTiktok).values({
      canalVendaId,
      contaId,
      tipoEvento,
      shopIdExterno,
      payloadJson: payload,
      headersJson: headers,
      assinaturaValida: null,  // modo discovery — ainda não validamos
      // rawBody também fica em headersJson["_raw_body"] pra permitir revalidação futura
    });

    // Armazenar raw body separadamente se o banco tiver campo próprio pra isso
    // (alternativa: adicionar coluna raw_body text no schema)
  } catch (err) {
    console.error('[webhook tiktok] erro ao gravar evento:', err);
    // Continua pra responder 200 — perder 1 evento é melhor que o TikTok suspender webhook
  }

  // 5. Responder 200 SEMPRE (exceto se quisermos forçar retry por erro infra)
  return NextResponse.json({ ok: true });
}

/**
 * Extrai tipo de evento do payload.
 * Os campos candidatos são tentados em ordem — sabemos que existe alguma
 * convenção em um deles, mas não qual. Discovery via dashboard vai esclarecer.
 */
function extrairTipoEvento(payload: Record<string, unknown>): string {
  return (
    (payload.type as string) ??
    (payload.event_type as string) ??
    (payload.event as string) ??
    (payload.category as string) ??
    'unknown'
  );
}

/**
 * Extrai shop_id do payload.
 * Caminhos comuns em APIs semelhantes. Discovery via dashboard vai esclarecer.
 */
function extrairShopId(payload: Record<string, unknown>): string | null {
  if (typeof payload.shop_id === 'string') return payload.shop_id;
  const data = payload.data as Record<string, unknown> | undefined;
  if (data && typeof data.shop_id === 'string') return data.shop_id;
  if (typeof payload.shopId === 'string') return payload.shopId;
  return null;
}
```

---

## Requisitos críticos

### Sempre responder 200

Mesmo com payload malformado, shop_id desconhecido ou erro interno. Motivo: se respondermos 4xx/5xx, o TikTok faz retry em loop e pode suspender o webhook. Eventos problemáticos ficam marcados no banco pra auditoria manual.

**Única exceção considerável:** erro de conexão com banco. Mesmo nesse caso, responder 500 é aceitável — TikTok faz retry e esperançosamente o banco volta.

### Tempo de resposta

Próximas ondas vão processar os eventos. Nesta Onda 0, o handler só armazena (1 INSERT) — deve responder em <500ms.

### RLS

Webhook não tem sessão. O INSERT em `eventos_webhook_tiktok` precisa funcionar sem `app.conta_id` setado. Usar o padrão do projeto pra bypass (mesmo do RITM-09 do job Inngest). Ver `docs/arquitetura/modulo-canais.md §5.3`.

### Tipos de eventos conhecidos (da doc §6)

Pra popular dashboards e futuros filtros, esses são os tipos documentados:

- `ORDER_STATUS_UPDATE` — mudança de status de pedido
- `CANCELLATION_STATUS_CHANGE` — cancelamento
- `RETURN_STATUS_CHANGE` — devolução
- `RECIPIENT_ADDRESS_UPDATE` — atualização de endereço
- `PACKAGE_UPDATE` — atualização de pacote/envio
- `PRODUCT_STATUS_UPDATE` — mudança de status de produto
- `SELLER_DEAUTHORIZATION` — seller desconectou o app
- `AUTH_EXPIRE` — notificação de expiração próxima

⚠️ O evento `SELLER_DEAUTHORIZATION` tem tratamento especial a ser implementado em REQ-MKT-002: quando chegar, marcar `canal_venda.ativo = false` e `credenciais.status_renovacao = 'falha_reauth'`. Na Onda 0 só registramos.

---

## Testes obrigatórios

1. ✅ POST com JSON válido → 200 + registro criado com `assinaturaValida = null`
2. ✅ POST com body vazio → 200 + registro com `payloadJson = {}`
3. ✅ POST com JSON inválido → 200 + registro com `payloadJson = {}` (não quebra)
4. ✅ POST com `shop_id` conhecido → registro tem `canalVendaId` e `contaId` preenchidos
5. ✅ POST com `shop_id` desconhecido → registro com `canalVendaId: null`, `contaId: null` (não falha)
6. ✅ POST com `type: "ORDER_STATUS_UPDATE"` no payload → `tipoEvento` extraído corretamente
7. ✅ POST com `event_type: "..."` (formato alternativo) → extração funciona
8. ✅ Headers completos são salvos (`headersJson`)
9. ✅ Erro de banco → 500 (única exceção à regra "sempre 200")

---

## Critérios de aceitação

- [ ] Todos os 9 testes passam
- [ ] Endpoint responde em <500ms em teste manual
- [ ] Responde 200 em praticamente todos os cenários
- [ ] Headers completos preservados (pra depois descobrir qual é a assinatura)
- [ ] Payload preservado integralmente (nunca truncar ou filtrar)
- [ ] Schema de `eventos_webhook_tiktok` permite `assinatura_valida = null`

---

## Testes manuais

### 1. API Testing Tool do Partner Center

Partner Center → App → API Testing Tool → selecionar um evento de teste (ex: `PACKAGE_UPDATE`) → configurar webhook URL pro túnel HTTPS → disparar.

Verificar:
- Resposta 200
- Registro aparece em `eventos_webhook_tiktok`
- `headersJson` inclui todos os headers do TikTok
- Inspecionar manualmente os headers — identificar candidatos a carregar assinatura (procurar `X-*`, `Signature*`, `Authorization`, `X-TTS-*`)

### 2. Evento real (após conectar loja)

Depois de conectar uma loja de homologação, simular uma venda e ver eventos reais chegarem. Coletar amostras de pelo menos 3 tipos diferentes de evento.

### 3. Ataque simulado

```bash
curl -X POST https://<seu-tunel>/api/webhooks/tiktok \
  -H "Content-Type: application/json" \
  -d '{"type": "FAKE_EVENT", "shop_id": "nao_existe"}'
```

Esperado: 200, e registro criado com `canalVendaId: null` (não conseguiu resolver).

---

## Descoberta da validação de assinatura (próximo passo)

Depois de 1-2 semanas acumulando eventos reais no banco, análise manual dos headers identifica qual carrega a assinatura. Padrões esperados (a confirmar via análise):

- **Header candidato 1:** `Authorization` — padrão OAuth
- **Header candidato 2:** `X-TTS-Signature` — TikTok usa `X-TTS-` pra outros contextos
- **Header candidato 3:** custom tipo `Webhook-Signature`

Uma vez identificado:
1. Criar RITM novo `RITM-10b-webhook-verify.md`
2. Implementar validação em `src/lib/canais/tiktok-shop/webhook-verify.ts`
3. Backfill: reprocessar eventos passados marcando `assinaturaValida = true/false` retroativamente

---

## Alternativas pra descobrir o algoritmo antes

Se Gabriel quiser antecipar essa descoberta:

1. **Buscar docs adicionais** fora do PDF (página específica no Partner Center)
2. **Abrir ticket** com TikTok Developer Support perguntando pelo webhook signature docs
3. **SDK oficial** — o TypeScript SDK tem `AccessTokenTool` mas a própria doc diz que webhooks **não** estão no SDK atual
4. **Repositórios open source** — devs que já integraram (PHP, Python) podem ter documentado
5. **Experimentação:** tentar HMAC-SHA256 do body com `webhook_key` em hex (padrão mais comum) e ver se bate com algum header recebido

---

## Dependências

✅ Parcialmente resolvida: tipos de eventos conhecidos (`docs/referencias/tiktok-shop-api.md §6`)
⚠️ Pendente: algoritmo de validação de assinatura (bloqueante pra processamento real, mas NÃO bloqueante pra esta REQ)
