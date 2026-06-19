# RITM-16 — Classificador puro de bipagem

> **Bloqueia:** RITM-17 (POST de bipagem chama o classificador; persiste o resultado em `central_envios_bipagem_pacote`).
> **Depende de:** RITM-15 (enums de categoria existem como referência conceitual; o classificador é puro JS e não importa do schema), RITM-15b (composer agora atualiza `orderStatus` em re-upload — sem isso, classificador nunca vê `CANCELADO`).
> **Dependência externa:** nenhuma.

---

## Princípio inegociável: função pura, sem efeito colateral, testável sem banco

- Zero I/O. Tudo via `ContextoClassificacao` injetado. Permite teste sem mock de banco e elimina latência por bipe (a infra de DB e RLS já roda no caller do RITM-17).
- Reuso de utilidades existentes: `extractShippingIds` e `detectCarrier` de `@/lib/coletas-utils` (já cobrem ML, Shopee, TikTok JDLOG e iMile).
- O classificador devolve **categoria + contexto** — *não* decide nem persiste. A decisão de "retirar vs. enviar mesmo assim" (no caso `CANCELADO`) e o registro em `central_envios_bipagem_pacote` (com `acaoCancelado` preenchido) é responsabilidade do RITM-17, depois da escolha do operador.
- O classificador devolve **lista**: um único bipe pode conter múltiplos códigos válidos (raro mas existe em CSV/etiquetas duplas), e o caller decide o que fazer com cada.

Consequências:

- ❌ Nada de `await db...` ou `fetch(...)` dentro do classificador.
- ❌ Sem ordering dependente do tempo real — `jaBipadosNaSessao` é entrada explícita.
- ✅ Cada call retorna determinística pra entrada idêntica.
- ✅ Reaproveitável fora da API HTTP (ex.: simular bipagens em background pra ferramentas internas, ou testar via REPL).

---

## Objetivo

Implementar `classificarBipe(codigo, ctx)` que dado um texto cru de scanner + contexto da sessão devolve uma lista de `ResultadoClassificacao`, com a categoria e tudo que a UI/API precisam.

Implementar `classificarBipeRastreador(codigo, ctx, pendentesLocalizar)` para o modo Rastreador de Cancelados.

Ao fim do RITM:

- `src/lib/central-envios/bipagem/types.ts` com 4 types principais.
- `src/lib/central-envios/bipagem/classificador.ts` com 2 funções puras.
- `src/lib/central-envios/bipagem/classificador.test.ts` com ≥11 cenários cobrindo precedência, modo normal, modo rastreador, múltiplos IDs no mesmo bipe, edge cases.

**Não inclui:**

- API HTTP (RITM-17).
- Construção do `ContextoClassificacao` a partir de `dados` da sessão — RITM-17 monta.
- Lógica de re-classificação retroativa em re-upload — RITM-17 dispara.
- UI (RITM-18+).

---

## Categorias

### Modo normal (5 categorias)

| Categoria | Quando | `bloqueante` |
|---|---|---|
| `OK` | tracking casa com pedido do CSV, pedido NÃO está cancelado, ainda não foi bipado | false |
| `DUPLICADO` | tracking já está em `jaBipadosNaSessao` | false |
| `CANCELADO` | tracking casa com pedido cujo status é `Cancelado` (ou afins) | **true** |
| `FORA_LOTE` | tracking tem formato válido (regex casou) mas não está em `indexPorTracking` | false |
| `DESCONHECIDA` | texto bipado não casa em nenhuma regex de tracking | false |

**Precedência (do mais específico pro menos):**

```
DUPLICADO > CANCELADO > FORA_LOTE > OK
DESCONHECIDA é separada (avaliada antes — falta de ID extraível)
```

> Justificativa: se o mesmo tracking foi bipado 2× e o pedido virou cancelado entre os dois bipes, queremos `DUPLICADO` (operador já lidou com ele) em vez de abrir o modal de cancelado de novo. O caller do RITM-17 verifica se o anterior tinha categoria diferente e dispara `CANCELAMENTO_RETROATIVO` se necessário (via notificacao).

### Modo rastreador (2 categorias)

Avaliado **separadamente** quando o operador ativou o modo Rastreador de Cancelados. Usa um `Set<string> pendentesLocalizar` calculado pela UI a partir dos cancelados ainda não localizados.

| Categoria | Quando |
|---|---|
| `LOCALIZADOR_ACHADO` | tracking está em `pendentesLocalizar` (cancelado que precisa ser retirado da pilha) |
| `LOCALIZADOR_LIVRE` | tracking NÃO está em `pendentesLocalizar` (pode seguir o fluxo normal) |

Não há "bloqueante" no rastreador — ele alerta visual/sonoramente mas não bloqueia a sequência de bipes (a UI faz o "uau" e segue).

---

## Tipos

`src/lib/central-envios/bipagem/types.ts`:

```ts
import type { TransportadoraLabel } from "@/lib/db/schema";
import type { CarrierPattern } from "@/types/coletas";
import type { PedidoEnriquecido } from "@/lib/central-envios/sessao/types";

export type CategoriaBipe =
  | "OK"
  | "DUPLICADO"
  | "CANCELADO"
  | "FORA_LOTE"
  | "DESCONHECIDA";

export type CategoriaRastreador =
  | "LOCALIZADOR_ACHADO"
  | "LOCALIZADOR_LIVRE";

export type ContextoClassificacao = {
  indexPorTracking: Map<string, PedidoEnriquecido>;
  trackingsCancelados: Set<string>;
  jaBipadosNaSessao: Set<string>;
  patternsCarrier: CarrierPattern[];
};

export type ResultadoClassificacao = {
  categoria: CategoriaBipe;
  codigoBipado: string;       // texto cru bipado (pre-extração)
  trackingId: string | null;
  orderId: string | null;
  pedido: PedidoEnriquecido | null;
  transportadora: TransportadoraLabel;
  bloqueante: boolean;
};

export type ResultadoRastreador = {
  categoria: CategoriaRastreador;
  codigoBipado: string;
  trackingId: string | null;
  pedido: PedidoEnriquecido | null;
  transportadora: TransportadoraLabel;
};
```

---

## Funções

### `classificarBipe(codigo, ctx)`

```ts
export function classificarBipe(
  codigoBipado: string,
  ctx: ContextoClassificacao,
): ResultadoClassificacao[];
```

**Algoritmo:**

1. `extractShippingIds(codigoBipado)` → array de IDs detectados.
2. Se vazio → `[{ categoria: 'DESCONHECIDA', codigoBipado, trackingId: null, ... }]`.
3. Para cada ID:
   - `detectCarrier(id, ctx.patternsCarrier)` → transportadora.
   - Se `id ∈ jaBipadosNaSessao` → `DUPLICADO` (com `pedido` se houver match, senão null).
   - Senão se `id ∉ indexPorTracking` → `FORA_LOTE`.
   - Senão se `id ∈ trackingsCancelados` → `CANCELADO` (com `bloqueante: true`).
   - Senão → `OK`.

### `classificarBipeRastreador(codigo, ctx, pendentesLocalizar)`

```ts
export function classificarBipeRastreador(
  codigoBipado: string,
  ctx: ContextoClassificacao,
  pendentesLocalizar: Set<string>,
): ResultadoRastreador[];
```

**Algoritmo:**

1. `extractShippingIds(codigoBipado)` → array de IDs detectados.
2. Se vazio → `[{ categoria: 'LOCALIZADOR_LIVRE', codigoBipado, trackingId: null, transportadora: 'DESCONHECIDA', pedido: null }]`.
3. Para cada ID:
   - `detectCarrier(id, ctx.patternsCarrier)`.
   - `pedido = indexPorTracking.get(id) ?? null`.
   - Se `id ∈ pendentesLocalizar` → `LOCALIZADOR_ACHADO`.
   - Senão → `LOCALIZADOR_LIVRE`.

---

## Arquivos a tocar

| Arquivo | Mudança |
|---|---|
| `src/lib/central-envios/bipagem/types.ts` | novo |
| `src/lib/central-envios/bipagem/classificador.ts` | novo |
| `src/lib/central-envios/bipagem/classificador.test.ts` | novo |

---

## Critérios de aceitação

### Modo normal

1. **DESCONHECIDA por falta de ID:** `classificarBipe("texto qualquer sem id", ctx)` retorna lista de 1 item com `categoria='DESCONHECIDA'`, `trackingId=null`, `transportadora='DESCONHECIDA'`, `bloqueante=false`.
2. **OK feliz:** tracking no `indexPorTracking`, NÃO em cancelados, NÃO em bipados → `OK`, `bloqueante=false`, `pedido` preenchido, `orderId` igual ao do pedido.
3. **DUPLICADO ganha precedência sobre CANCELADO:** tracking em `jaBipadosNaSessao` **E** em `trackingsCancelados` → `DUPLICADO`.
4. **CANCELADO bloqueante:** tracking no índice, em `trackingsCancelados`, NÃO em bipados → `CANCELADO`, `bloqueante=true`, `pedido` preenchido.
5. **FORA_LOTE:** tracking com formato válido (regex casou), NÃO está em `indexPorTracking` → `FORA_LOTE`, `pedido=null`, `orderId=null`.
6. **DUPLICADO ganha precedência sobre FORA_LOTE:** se um tracking foi bipado antes mas não estava no índice (cenário possível em sessão antiga com re-upload posterior), reclassificação prefere `DUPLICADO`.
7. **Múltiplos IDs no mesmo texto:** `"999881111111111 4000000000"` retorna 2 itens, um TikTok + um ML, com categorias avaliadas individualmente.
8. **Detecção de carrier — ML:** `4000000000` (10 dígitos com `4`) → `transportadora='ML'`.
9. **Detecção de carrier — Shopee:** `BR123456789012` → `transportadora='SHP'`.
10. **Detecção de carrier — TikTok JDLOG:** tracking de 13 dígitos com prefixo configurado em `patternsCarrier` → `transportadora='TTK_JDLOG'`.
11. **Detecção de carrier — DESCONHECIDA:** tracking de 13 dígitos sem prefixo configurado → categoria pode ser `OK` (se está no índice) mas `transportadora='DESCONHECIDA'` (campos independentes).

### Modo rastreador

12. **LOCALIZADOR_ACHADO:** ID está em `pendentesLocalizar` → `LOCALIZADOR_ACHADO`, `pedido` preenchido se também está no índice.
13. **LOCALIZADOR_LIVRE:** ID NÃO está em `pendentesLocalizar` → `LOCALIZADOR_LIVRE` independentemente de estar no índice ou não.
14. **Texto sem ID em rastreador:** retorna 1 item `LOCALIZADOR_LIVRE` com `trackingId=null` (não atrapalha o operador no modo de busca).

### Geral

15. **`tsc --noEmit`** sem erros novos.
16. **Determinismo:** mesma entrada produz mesma saída (sem chamada a `Date.now()`, `Math.random()`, etc).

---

## Out-of-scope (próximos RITMs)

- Construção do `ContextoClassificacao` a partir de `sessao.dados` → RITM-17 (selectors).
- Persistência do resultado em `central_envios_bipagem_pacote` → RITM-17.
- Detecção de duplicação cross-session (query separada) → RITM-17 + RITM-21.
- Emissão de notificação `CANCELAMENTO_RETROATIVO` quando OK→CANCELADO entre dois bipes → RITM-17.
- UI da aba Bipagem → RITM-18.
