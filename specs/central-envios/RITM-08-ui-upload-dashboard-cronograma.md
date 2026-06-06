# RITM-08 — UI: Upload + Dashboard + Cronograma

> **Bloqueia:** RITM-09 (UI restante: SKU×Dia, Extrator, Pedidos, Ambíguos), RITM-11 (botão "Arquivar planejamento" usa o estado da sessão).
> **Depende de:** RITM-02/03 (POST upload), RITM-07 (sessão, processar, estado).
> **Dependência externa:** nenhuma.

---

## Princípio inegociável: UI consome a sessão + endpoints, não inventa pipeline

- Toda a lógica de domínio (parser, explosão, prazo) fica no backend. O frontend consome o snapshot já enriquecido em `sessao_central_envios.dados` (`PedidoEnriquecido[]`).
- Detecção de tipo de arquivo é feita **só na UI** pra rotear pro endpoint certo (`tiktok_csv` → `/ingestao/tiktok`, `ml_xlsx` → `/ingestao/mercado-livre`). Backend não tem detecção automática.
- Polling per-upload é resiliente: cada upload tem seu próprio loop independente, com backoff exponencial e cancelamento ao desmontar.

---

## Objetivo

Primeira UI funcional da Central de Envios: o operador entra, sobe arquivos TT/ML, vê o status do parse em tempo real, e ao concluir já vê stats agregadas (Dashboard) e o cronograma de envio por modelo (Cronograma).

Ao fim do RITM:

- `/central-envios/page.tsx` renderiza 3 abas (Upload, Dashboard, Cronograma).
- Item "Central de Envios" no nav da seção Expedição.
- Hook `useCentralEnviosPlanejamento` orquestra sessão + uploads + processar + auto-save de aba/filtros.
- Restauração automática: ao montar, GET /sessao; se há dados, mostra como se a tela nunca tivesse fechado.
- Auto-save da aba ativa (PATCH /sessao/[id] com `tipoVisualizacao`) com debounce 800ms.

**Não inclui:**

- Abas SKU×Dia, Extrator, Pedidos, Ambíguos — RITM-09.
- UI de configurações (regras prazo, aliases, feriados, categorias) — RITM-10.
- Histórico de planejamentos / arquivamento / email — RITM-11.
- Modal "continuar sessão anterior" (mesma lógica de Coletas) — pode entrar aqui se for trivial; senão fica pra RITM-09.

---

## Arquivos a criar / modificar

| Arquivo | Mudança |
|---|---|
| `src/app/(dashboard)/central-envios/page.tsx` | **Novo** — shell com `Tabs` (3 abas). |
| `src/app/(dashboard)/layout.tsx` | Adicionar `{ href: "/central-envios", label: "Central de Envios", icon: Send }` em `expedicaoItems` + array de hrefs. Também em `expedicaoAllowedPaths` e `expedicaoRoleAllowed`. |
| `src/hooks/use-central-envios-planejamento.ts` | **Novo** — hook centralizador. |
| `src/components/central-envios/upload-dropzone.tsx` | **Novo** — multi-file drag-and-drop. |
| `src/components/central-envios/ingestao-status.tsx` | **Novo** — lista de uploads em andamento. |
| `src/components/central-envios/dashboard-tab.tsx` | **Novo** — stat cards + breakdowns. |
| `src/components/central-envios/cronograma-tab.tsx` | **Novo** — matriz por modelo. |
| `src/types/central-envios.ts` | **Novo** — types do payload da sessão/API (re-export dos backend). |
| `docs/arquitetura/modulo-central-envios.md` | Atualizar §9 e §15 (✅ feito). |

---

## Hook `useCentralEnviosPlanejamento`

Estado:

- `sessao`: SessaoCentralEnvios | null
- `dados`: PedidoEnriquecido[] (baixa do `dados` inline OU do `dadosBlobUrl`)
- `estatisticas`: EstatisticasSessao
- `arquivosIngeridos`: ArquivoIngerido[]
- `uploads`: Array<{ id, file, status: 'enviando' | 'processando' | 'concluido' | 'erro', progresso?, runId?, erro? }>
- `abaAtiva`: string (default `'dashboard'`)
- `loading`, `saveState`: 'idle' | 'saving' | 'saved' | 'error'

Ações:

```ts
mount() → GET /sessao
  - Se null + sem ativa → POST /sessao (cria vazia)
  - Se devolveu sessão com dados inline → setDados
  - Se devolveu com dadosBlobUrl → fetch direto + setDados

uploadFiles(files: File[]):
  Detecta tipo:
    - .csv | text/csv → POST /api/central-envios/ingestao/tiktok
    - .xlsx | .xls | application/vnd.openxml...sheet → POST /api/central-envios/ingestao/mercado-livre
  Adiciona ao array uploads, dispara polling

pollUpload(uploadId):
  GET /api/central-envios/ingestao/[runId] em intervalo 1.5s (primeiros 10s),
  depois 3s. Backoff exponencial ao erro. Timeout 5min.
  Quando status=concluido OR erro → atualiza upload.
  Quando concluido → enfileira pra próximo processarRun.

processarRuns(runIds[]):
  POST /api/central-envios/sessao/[id]/processar { runIds }
  Atualiza arquivosIngeridos + estatisticas
  Re-baixa dados (inline ou blob)

setAba(aba):
  Update state + debounce 800ms → PATCH /sessao/[id] { tipoVisualizacao: aba }

setFiltros(filtros):  -- usado por RITM-09
  Update state + debounce 800ms → PATCH /sessao/[id] { filtrosExtrator: filtros }

encerrarSessao(motivo: 'finalizada' | 'forcada'):
  POST /sessao/[id]/encerrar { motivo }
  Limpa estado local.
```

Cleanup: cancelar todos os polls ao desmontar (AbortController).

---

## Componentes

### `upload-dropzone.tsx`

- Drag-and-drop com `onDrop` + `<input type="file" multiple>`.
- Valida tipo na UI; mostra erro se não for CSV/XLSX.
- Anuncia número de arquivos aceitos via Sonner toast.
- Acessível: `role="button"`, mensagem clara.

### `ingestao-status.tsx`

- Lista de uploads em progresso (componente filho).
- Cada item:
  - Nome do arquivo
  - Badge: `Enviando` (azul) / `Processando` (amber) / `Concluído` (verde) / `Erro` (vermelho)
  - Progress bar enquanto processando
  - Linhas válidas/descartadas ao concluir
- Botão "limpar concluídos" no header da lista.

### `dashboard-tab.tsx`

- Empty state quando sem `dados`.
- Stat cards (grid 2-3 colunas):
  - Total pedidos
  - Atrasados (vermelho)
  - HOJE (laranja)
  - No prazo (verde)
  - Sem data (cinza)
  - Ambíguos (amber)
- Card "Por canal" com counts.
- Card "Top 10 modelos" com counts.

### `cronograma-tab.tsx`

- Empty state quando sem `dados`.
- Para cada modelo presente nas `linhasExplodidas`:
  - Card com título do modelo + total geral
  - Tabela: cor × tamanho com `qtd` em cada célula
  - Linha "Total" no fim
- Não filtra por dia (operador filtra via Extrator, RITM-09).

---

## Workflow

```bash
# 1. Spec
# 2. Hook + types
# 3. Componentes
# 4. Page + nav
# 5. npm run check  + npm run lint
# 6. Smoke manual (subir CSV, ver fluxo end-to-end)
# 7. Sweep tenant
# 8. Commit
```

Sem migration. Sem deps novas (`react-dropzone` é overkill; usamos `onDragEnter`/`onDrop` nativo).

---

## Critérios de aceitação

- [ ] 7 arquivos criados (page + hook + types + 4 componentes)
- [ ] Layout/nav atualizado com link "Central de Envios"
- [ ] Hook orquestra todo o lifecycle (load, upload, poll, processar, encerrar)
- [ ] Dashboard mostra stats reais derivadas da sessão
- [ ] Cronograma mostra matrizes por modelo
- [ ] `npm run check` 0; ESLint nos arquivos novos 0 erros
- [ ] Sweep tenant zero nos arquivos do RITM
- [ ] Doc §9 e §15 atualizados
- [ ] **Smoke manual**: subir CSV TT fixture → ver upload → dashboard mostra contagem

---

## Dúvidas (resolvidas)

| # | Pergunta | Resposta |
|---|---|---|
| 1 | Modal "continuar sessão"? | **V2** (RITM-09 ou final). Por enquanto, sessão restaura silenciosa se houver dados; usuário continua na aba salva. |
| 2 | Polling rate? | **1.5s** primeiros 10s, **3s** depois. Backoff exponencial até 30s no erro. |
| 3 | `react-dropzone`? | **Não.** Native HTML5 é suficiente. Menos deps. |
| 4 | Empty state? | **Sim**, em Dashboard e Cronograma quando sem `dados`. Aponta pra aba Upload. |
| 5 | Mobile? | **Best-effort.** Usuário é operador de galpão; quase sempre desktop. Mobile não trava, mas não otimizamos. |

---

## Dúvidas em aberto

1. **Reorder de uploads** (drag pra mover): V2.
2. **Cancelar upload em andamento**: V2. Hoje só `limpar concluídos`.
3. **Indicador de tempo restante no polling**: V2.
