# RITM-09 — UI: SKU × Dia + Extrator + Pedidos + Ambíguos

> **Bloqueia:** RITM-10 (configurações), RITM-11 (arquivar planejamento usa filtros do extrator).
> **Depende de:** RITM-07 (sessão + composer), RITM-08 (page shell + hook).
> **Dependência externa:** nenhuma.

---

## Princípio inegociável: filtros e copy ficam no cliente

- Toda lógica de filtragem do Extrator é **client-side** sobre `dados: PedidoEnriquecido[]` — o snapshot já está em memória. Sem round-trip por filtro.
- Categorias do extrator (`categoria_sku`) são avaliadas localmente: regex e composição. Tag não tem fonte de verdade hoje — ignorar com warning silencioso.
- Limite de UI explícito (500 linhas em Pedidos) — sem paginação por agora; mostra aviso "exibindo 500 de N".
- Copy actions usam `navigator.clipboard.writeText` com fallback `document.execCommand('copy')` pra navegadores legados (pouco provável mas tipo seguro).

---

## Objetivo

Completar as 4 abas restantes da UI principal:

- **SKU × Dia**: pivot de `linhasExplodidas` por SKU canônico × prazo, ordenado por demanda total.
- **Extrator**: 8 filtros aplicados sobre `dados`, exibe contagem + 3 copy actions (Order IDs com vírgula, Tracking IDs com vírgula, TXT por linha).
- **Pedidos**: tabela completa (até 500 linhas) com explosão legível por pedido.
- **Ambíguos**: lista dos pedidos com `parsed.kind === 'AMBIGUO'`, com motivo + detalhes + botão "Cadastrar como kit" (placeholder V2).

Ao fim do RITM:

- 4 novas abas no shell da página (`upload`, `dashboard`, `cronograma`, **`sku-dia`**, **`extrator`**, **`pedidos`**, **`ambiguos`**).
- GET `/api/central-envios/configuracoes/categoria-sku` exposto.
- Filtros do extrator persistem em `filtrosExtrator` (auto-save via hook do RITM-08).

**Não inclui:**

- POST/PUT/DELETE de categoria — RITM-10.
- Email / arquivamento / planejamento_envios — RITM-11.
- Edição inline de SKU ambíguo → cadastrar kit no banco — V2.

---

## Arquivos a criar / modificar

| Arquivo | Mudança |
|---|---|
| `src/app/api/central-envios/configuracoes/categoria-sku/route.ts` | **Novo** — GET lista categorias ativas. |
| `src/components/central-envios/sku-dia-tab.tsx` | **Novo**. |
| `src/components/central-envios/pedidos-tab.tsx` | **Novo**. |
| `src/components/central-envios/ambiguos-tab.tsx` | **Novo**. |
| `src/components/central-envios/extrator-tab.tsx` | **Novo**. |
| `src/lib/central-envios/ui/avaliar-categoria.ts` | **Novo** — função pura `avaliarCategoria(pedido, categoria)`. |
| `src/hooks/use-central-envios-planejamento.ts` | Modificado — load + expose `categorias`. |
| `src/app/(dashboard)/central-envios/page.tsx` | Modificado — 4 novas Tabs. |
| `src/types/central-envios.ts` | Modificado — `CategoriaSkuClient`, `FiltrosExtrator`. |
| `docs/arquitetura/modulo-central-envios.md` | Atualizar §9 e §15 (✅ feito). |

---

## Endpoint

### `GET /api/central-envios/configuracoes/categoria-sku`

- Auth: sessão válida + `withContaAtiva` (qualquer papel, só leitura).
- Retorna `{ categorias: CategoriaSku[] }`, filtrado por `ativo=true`, ordenado por `ordem ASC, nome ASC`.

> POST/PUT/DELETE entram no RITM-10.

---

## `avaliarCategoria(pedido, categoria)`

Função pura — itera `categoria.regras` (OR entre regras):

```ts
- regex: new RegExp(pattern, flags ?? 'i').test(pedido.skuRaw)
- composicao: pedido.parsed.kind === 'OK' && parsed.modeloCodigo === regra.modeloCodigo
              && (regra.qtdMin === undefined || parsed.qtdKit >= regra.qtdMin)
              && (regra.qtdMax === undefined || parsed.qtdKit <= regra.qtdMax)
- tag: false (V2)
```

Regex inválida → false + console.warn (não derruba UI).

---

## SKU × Dia

`sku-dia-tab.tsx`:

- Agrega `dados`:
  - Para cada pedido OK com `prazo.prazoIso` (incluindo HOJE → hojeIso):
    - Para cada `linha` em `linhasExplodidas`:
      - Chave SKU canonical = `${modelo} ${cor} ${tamanho}`
      - Coluna data = `prazoIso`
      - Soma `qtd`
- Linhas: SKUs ordenadas por demanda total desc.
- Colunas: datas únicas no recorte (limitado às próximas 14 datas a partir de hoje pra evitar tabela quilométrica). Datas mais antigas que hoje viram bucket "ATRASADO".
- Sem dados → empty state.

---

## Pedidos

`pedidos-tab.tsx`:

- Tabela limitada a 500 linhas (mostra aviso quando > 500).
- Colunas: Canal, OrderID, Tracking, SKU raw, Modelo, Tamanho, Cores, Qtd, Prazo, Status.
- Ordenação: por `criadoEmIso` desc.
- Linhas AMBIGUO destacadas com badge amarelo na coluna "Modelo".
- `Status` = "ATRASADO" (vermelho) | "HOJE" (laranja) | "NO PRAZO" (verde) | "SEM DATA" (cinza), derivado client-side de `prazo.prazoIso` vs `hojeIso`.

---

## Ambíguos

`ambiguos-tab.tsx`:

- Lista os pedidos com `parsed.kind === 'AMBIGUO'`.
- Cada item: SKU raw + motivo (Badge) + detalhes + canal + orderId + trackingId.
- Botão "Cadastrar como kit" — toast.info("Disponível em V2").
- Empty state quando 0 ambíguos.

---

## Extrator

`extrator-tab.tsx`:

Filtros (persistem em `filtrosExtrator` via hook):

- **Plataforma** (multi-toggle entre `tiktok_shop`, `mercado_livre`, `shopee`)
- **Status prazo** (multi: ATRASADO, HOJE, NO PRAZO, SEM DATA)
- **Categoria** (multi-select das categorias carregadas)
- **Modelo** (multi-select das opções únicas em `dados`)
- **Cor** (multi-select)
- **Tamanho** (multi-select)
- **Busca livre** (`String.includes` case-insensitive no `skuRaw`, `orderId`, `trackingId`, `comprador`)
- **Só ambíguos** (toggle)

Aplicação:

- Pipeline: filtro a filtro sobre `dados`. Ordem irrelevante (todos AND).
- Mostra contagem `<filtered>/<total>` no topo.

Copy actions (3 botões):

- **Copiar Order IDs** — `orderId.join(',')`.
- **Copiar Tracking IDs** — `trackingId.filter(Boolean).join(',')`.
- **Copiar TXT** — `orderId\n` por linha.

Cada botão mostra toast "Copiado N IDs".

---

## Workflow

```bash
# 1. Spec
# 2. Endpoint categoria
# 3. avaliarCategoria + types
# 4. 4 componentes de aba
# 5. Atualizar hook + page
# 6. npm run check + lint
# 7. Smoke manual (sequência: upload → extrator com filtros → copy)
# 8. Commit
```

Sem migration. Sem deps novas.

---

## Critérios de aceitação

- [ ] 6 arquivos novos: route + 4 tabs + avaliar-categoria
- [ ] hook + types + page atualizados
- [ ] GET `/configuracoes/categoria-sku` retorna lista ativa
- [ ] 4 abas renderizam corretamente com empty states
- [ ] Extrator filtra client-side por 8 critérios
- [ ] Copy actions funcionam (verificar via toast no smoke)
- [ ] Limite 500 pedidos respeitado, aviso visível
- [ ] `npm run check` 0, ESLint 0 erros nos arquivos do RITM
- [ ] Sweep tenant zero
- [ ] Doc §9 e §15 atualizados
- [ ] 494/494 testes continuam passando

---

## Dúvidas (resolvidas)

| # | Pergunta | Resposta |
|---|---|---|
| 1 | Categorias regex em runtime → DOS? | Avaliada local com try/catch; regex maliciosa só afeta o operador atual. |
| 2 | SKU × Dia agrupa por canonical ou raw? | **Canonical da `LinhaExplodida`** (`modelo cor tamanho`). |
| 3 | Datas no futuro distante? | Recorte a 14 dias + bucket "ATRASADO" pro passado. |
| 4 | Edição manual de ambíguos? | **V2.** Botão mostra toast por enquanto. |
| 5 | Persistir filtros? | **Sim** — via `filtrosExtrator` do hook RITM-08 (auto-save 800ms). |

---

## Dúvidas em aberto

1. **Tag-based categoria**: hoje skuCatalogo não tem coluna `tags`. Avaliar adicionar em RITM-10 se houver demanda.
2. **Paginação > 500 pedidos**: hoje aviso só. Se virar bottleneck, adicionar paginação na tabela.
3. **Export Excel do Extrator** (em vez de só TXT): V2.
