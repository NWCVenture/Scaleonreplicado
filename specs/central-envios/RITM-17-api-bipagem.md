# RITM-17 — API REST de bipagem

> **Bloqueia:** RITM-18 (UI consome esses endpoints), RITM-19 (modal cancelado bate em `decidir-cancelado`), RITM-21 (polling lê `central_envios_notificacao` criada aqui).
> **Depende de:** RITM-15 (tabelas), RITM-15b (composer atualiza status mutável em re-upload), RITM-16 (classificador puro).
> **Dependência externa:** nenhuma.

---

## Princípio inegociável: API como casca fina sobre o classificador puro

- Toda lógica de decisão fica no classificador (RITM-16). A API só:
  1. autentica + RLS-gateia;
  2. monta `ContextoClassificacao` a partir do estado da sessão;
  3. chama `classificarBipe` / `classificarBipeRastreador`;
  4. persiste resultado não-bloqueante em `central_envios_bipagem_pacote`;
  5. detecta duplicação cross-session e cria registros em `central_envios_notificacao`;
  6. devolve o resultado pra UI.
- **CANCELADO bloqueante NÃO é persistido aqui** — aguarda decisão do operador via endpoint `decidir-cancelado`. Defesa contra TOCTOU: o `decidir-cancelado` re-classifica antes do INSERT (se o tracking sumiu da lista de cancelados nesse meio tempo, recusa).
- **Bipagem não persiste o cache JSON em `sessao.dados.bipagem`** — só atualiza `ultimaAtividadeEm`. A verdade vive em `central_envios_bipagem_pacote`. GET reconstrói a lista quando precisa.

Consequências:

- ❌ Sem cache JSON na sessão → UI faz polling/refresh ou usa `bipagemId` retornado pra atualizar localmente. RITM-18 trata.
- ✅ Concorrência relaxada: 2 operadores bipando em sessões diferentes da mesma conta não disputam linha do JSON.
- ✅ Cross-session duplicação detectada por query indexada (`idx_ce_bipagem_dedup_global`) — barato.

---

## Endpoints

### `POST /api/central-envios/sessao/[id]/bipagem`

Adiciona um bipe à sessão.

**Body:**

```ts
{
  codigoBipado: string;     // texto cru do scanner (1..200 chars)
  modo?: "NORMAL" | "RASTREADOR";  // default "NORMAL"
}
```

**Comportamento:**

1. Valida sessão pertence ao usuário, está `ativa`. 404 se não.
2. Carrega `dados` da sessão (inline ou via blob).
3. Resolve `patternsCarrier` via `transportadora_padrao` (query existente — caller já filtra por conta).
4. Monta `ContextoClassificacao`:
   - `indexPorTracking`: derivado de `dados.filter(p => p.trackingId !== null)`.
   - `trackingsCancelados`: subconjunto cujo `camposExtras.orderStatus` está em lista de status cancelados (config abaixo).
   - `jaBipadosNaSessao`: query `SELECT tracking_id FROM central_envios_bipagem_pacote WHERE sessao_id = ? AND tracking_id IS NOT NULL AND categoria IN ('OK','CANCELADO_RETIRADO','CANCELADO_ENVIADO_MESMO_ASSIM','LOCALIZADOR_ACHADO')`.
   - `patternsCarrier`: lookup da config.
5. Chama `classificarBipe` ou `classificarBipeRastreador`.
6. Para cada resultado:
   - Se `bloqueante: true` (modo NORMAL, categoria CANCELADO) → **não persiste**. Retorna no array com `bipagemId: null, persistido: false`.
   - Senão → INSERT em `central_envios_bipagem_pacote` com o mapeamento de categoria abaixo.
   - Detecta duplicação cross-session se `trackingId != null` e categoria persistida implica "pacote físico saiu" (`OK`, `LOCALIZADOR_ACHADO`). FORA_LOTE, DESCONHECIDA e LOCALIZADOR_LIVRE não disparam alarme.
   - Para cada match cross-session: INSERT em `central_envios_notificacao` na **outra sessão** com tipo `DUPLICACAO_CROSS_SESSAO`. NÃO cria notificação na própria sessão (a UI já mostra na resposta).
7. Atualiza `sessao.ultimaAtividadeEm = now()`.
8. Retorna 200.

**Mapeamento `CategoriaBipe → CentralEnviosBipagemCategoria`:**

| Classificador | Persiste como |
|---|---|
| `OK` | `OK` |
| `DUPLICADO` | `DUPLICADO` |
| `CANCELADO` (modo NORMAL) | **não persiste** (espera decisão) |
| `FORA_LOTE` | `FORA_LOTE` |
| `DESCONHECIDA` | `DESCONHECIDA` |
| `LOCALIZADOR_ACHADO` (rastreador) | `LOCALIZADOR_ACHADO` |
| `LOCALIZADOR_LIVRE` (rastreador) | `LOCALIZADOR_LIVRE` |

**Resposta:**

```ts
{
  resultados: Array<{
    bipagemId: string | null;  // null quando bloqueante
    persistido: boolean;
    categoria: CategoriaBipe | CategoriaRastreador;
    codigoBipado: string;
    trackingId: string | null;
    orderId: string | null;
    pedido: PedidoEnriquecidoResumo | null;  // só campos pra UI (cliente, sku, prazo)
    transportadora: TransportadoraLabel;
    bloqueante: boolean;
    duplicacoesCrossSessao: Array<{
      outraSessaoId: string;
      outroUsuarioId: string;
      outroUsuarioNome: string;
      outroBipadoEm: string;  // ISO
    }>;
  }>;
}
```

`PedidoEnriquecidoResumo` em `types.ts`:

```ts
{
  orderId: string;
  trackingId: string | null;
  comprador: string | null;
  criadoEmIso: string | null;
  camposExtras: Record<string, string | null>;
  parsed: PedidoEnriquecido["parsed"];
  prazo: PedidoEnriquecido["prazo"];
}
```

(omite `linhasExplodidas`, `explosaoErro`, `origemRunId` — UI da bipagem não usa).

### `GET /api/central-envios/sessao/[id]/bipagem`

Lista bipes da sessão, ordenados por `bipado_em DESC`.

**Resposta:**

```ts
{
  bipes: Array<{
    id: string;
    codigoBipado: string;
    trackingId: string | null;
    orderId: string | null;
    canal: string | null;
    categoria: CentralEnviosBipagemCategoria;
    transportadora: TransportadoraLabel | null;
    acaoCancelado: "RETIRADO" | "ENVIADO_MESMO_ASSIM" | null;
    bipadoEm: string;
  }>;
}
```

### `POST /api/central-envios/sessao/[id]/bipagem/decidir-cancelado`

Persiste a decisão do operador para um bipe que veio como CANCELADO bloqueante.

**Body:**

```ts
{
  codigoBipado: string;
  acao: "RETIRADO" | "ENVIADO_MESMO_ASSIM";
}
```

**Comportamento:**

1. Valida sessão ativa.
2. Re-monta `ContextoClassificacao` e chama `classificarBipe`. Se a categoria mais nova **não é** `CANCELADO`, retorna 409 (`{ error: "Tracking não está mais cancelado", classificacaoAtual: <cat> }`). UI deve refletir.
3. Se é `CANCELADO`, INSERT com:
   - `categoria = CANCELADO_RETIRADO` ou `CANCELADO_ENVIADO_MESMO_ASSIM`
   - `acao_cancelado = "RETIRADO" | "ENVIADO_MESMO_ASSIM"`
4. Se `acao = ENVIADO_MESMO_ASSIM`: detecta duplicação cross-session (operador despachou pacote cancelado — risco alto de duplicação real).
5. Retorna 200 com `bipagemId` e duplicações detectadas.

---

## Arquivos a tocar

| Arquivo | Mudança |
|---|---|
| `src/lib/central-envios/bipagem/contexto.ts` | novo: monta `ContextoClassificacao` + define lista de status cancelados |
| `src/lib/central-envios/bipagem/persistir.ts` | novo: INSERT bipe + cross-session detect + INSERT notificações |
| `src/lib/central-envios/bipagem/types.ts` | + `PedidoEnriquecidoResumo`, helpers de mapeamento |
| `src/app/api/central-envios/sessao/[id]/bipagem/route.ts` | novo: POST + GET |
| `src/app/api/central-envios/sessao/[id]/bipagem/decidir-cancelado/route.ts` | novo: POST |
| `src/app/api/central-envios/sessao/[id]/bipagem/route.test.ts` | novo: testes de integração |

---

## Status considerados "cancelado" (TikTok Shop)

Definidos em `contexto.ts`. Configurável depois via config UI (RITM-10), mas v1 hardcoded:

```ts
const ORDER_STATUS_CANCELADOS = new Set([
  "Cancelado",
  "Cancelled",  // se algum tenant trocar pra inglês
  "Em devolução",
  "Reembolsado",
]);
```

Caller monta `trackingsCancelados` filtrando `dados.filter(p => ORDER_STATUS_CANCELADOS.has(p.camposExtras.orderStatus ?? ""))`.

---

## Critérios de aceitação

### POST bipagem

1. **POST OK persiste:** mando código TikTok que casa com pedido OK → resposta `categoria='OK'`, `bipagemId` retornado, linha em `central_envios_bipagem_pacote` com `categoria='OK'`, `tracking_id`, `order_id`.
2. **POST DUPLICADO:** bipo o mesmo código 2× → 1º retorna OK, 2º retorna `categoria='DUPLICADO'` mas **persistido=true** (auditoria de tentativas).
3. **POST CANCELADO bloqueante NÃO persiste:** código bipado em pedido cancelado → resposta `categoria='CANCELADO'`, `bipagemId=null`, `persistido=false`, NADA na tabela.
4. **POST FORA_LOTE persiste:** código com formato válido fora do CSV → `categoria='FORA_LOTE'`, linha criada.
5. **POST DESCONHECIDA persiste:** texto sem ID válido → `categoria='DESCONHECIDA'`, linha criada com `tracking_id=null`.
6. **POST RASTREADOR achado:** modo `RASTREADOR`, código em pendentes → `categoria='LOCALIZADOR_ACHADO'`, linha criada.
7. **Cross-session detect:** 2 sessões da mesma conta, sessão A bipa código X. Sessão B bipa mesmo X → resposta de B inclui `duplicacoesCrossSessao` com 1 item; linha em `central_envios_notificacao` com `sessao_destino_id = A.id`, `tipo='DUPLICACAO_CROSS_SESSAO'`.
8. **Cross-session NÃO dispara para FORA_LOTE:** mesma topologia mas tracking não está no índice → sem notificação criada.
9. **`ultimaAtividadeEm` atualizado:** após POST, `sessao_central_envios.ultima_atividade_em > timestamp anterior`.

### GET bipagem

10. **GET lista ordenada DESC:** após N bipes, `GET` retorna em ordem `bipadoEm DESC`.
11. **GET respeita RLS:** sessão de outra conta → 404 (não 403 pra não vazar existência).

### POST decidir-cancelado

12. **decidir RETIRADO:** após POST com CANCELADO bloqueante, mando `decidir-cancelado` com `acao=RETIRADO` → linha criada com `categoria='CANCELADO_RETIRADO'`, `acao_cancelado='RETIRADO'`.
13. **decidir ENVIADO_MESMO_ASSIM:** mesmo cenário com `acao=ENVIADO_MESMO_ASSIM` → linha com categoria correspondente. Se houver outra sessão que bipou OK, duplicação cross-session é detectada.
14. **decidir-cancelado 409 quando não é mais cancelado:** entre o bipe inicial e a decisão, alguém re-uploadou e o pedido não está mais cancelado → 409 com `classificacaoAtual` informando.

### Geral

15. **`tsc --noEmit`** sem erros novos.
16. **Sem regressão:** testes existentes (sessão, processar, encerrar) continuam passando.

---

## Out-of-scope

- DELETE bipe (desfazer scan errado) → RITM-18 (operação UI).
- Atualização incremental do cache `sessao.dados.bipagem` → não usaremos.
- Notificação cross-session sobre cancelamento retroativo (OK → CANCELADO entre re-uploads) → RITM-17b ou RITM-21.
- Modo Rastreador: lista de pendentes calculada client-side (RITM-20 monta a partir do GET).
