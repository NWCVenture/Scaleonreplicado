# Módulo Central de Envios — Arquitetura (proposta scaleon)

> Documento de **proposta arquitetural** pra trazer a ferramenta standalone
> `central-envios-newcommand.html` pra dentro do ERP, no padrão dos demais
> módulos (`coletas`, `confeccao`, `canais`).
>
> **Objetivo do scaleon**: a versão atual é hardcoded em domínio NWC
> (`PRODUTOS = ['LUA','NBA','BALA',…]`, `CORES = ['PT','AZ',…]`, `MIX 4 = AZ+CZ+PT+BR`,
> `BALA sem cor → PT`, etc.). No ERP isso vira **cadastro-driven** — qualquer
> conta nova entra com seus próprios modelos, cores, tamanhos e regras de
> kit, sem mexer no código.

---

## 1. Propósito

Planejamento operacional diário de envios a partir das vendas dos
marketplaces. A tela `/central-envios` é a **mesa do operador** que decide:

1. O que precisa ser **enviado hoje** (atrasados + vence hoje).
2. Quantas **peças por SKU** estão na fila pra cada dia da semana.
3. Quais **Order IDs / Tracking IDs** copiar pro painel do canal pra ações em
   massa (subir etiqueta, dar baixa, etc.).

Substitui o cruzamento manual de CSV TikTok + XLSX Mercado Livre + planilha
NWC que hoje roda na ferramenta standalone.

### Fluxos suportados

| Fluxo                    | Origem dos dados                                | Status |
|--------------------------|-------------------------------------------------|--------|
| **Upload manual**        | CSV TikTok + XLSX ML (mesmo formato da ferramenta atual) | MVP — paridade com o standalone |
| **Pull automático**      | `ICanalAdapter.listarPedidosAReceber()` via Inngest | V2 — reusa módulo Canais |
| **Híbrido**              | Pull automático + upload manual pra canais sem adapter | Default em prod |

> Pull automático **não é blocker do MVP**. A ferramenta atual já funciona
> com upload e o operador continua baixando CSV do TikTok / XLSX do ML
> manualmente. A integração via Canais entra como evolução.

---

## 2. Mapa de arquivos (proposto)

Espelho do módulo `coletas`. Convenção: tudo que é específico do
**marketplace** mora em `src/lib/canais/<marketplace>/`; tudo que é regra de
**negócio NWC** mora em cadastro, não em código.

```
src/
├── app/(dashboard)/central-envios/page.tsx     ← UI principal (client, abas)
├── app/api/central-envios/
│   ├── route.ts                                 ← GET histórico de planejamentos · POST snapshot/persiste
│   ├── [id]/route.ts                            ← GET detalhe de planejamento salvo
│   ├── ingestao/route.ts                        ← POST upload de CSV/XLSX (multipart) → enfileira no Inngest
│   ├── ingestao/[runId]/route.ts                ← GET status do processamento
│   ├── pull/route.ts                            ← POST trigger manual de pull via canal (V2)
│   ├── sessao/route.ts                          ← GET/POST sessão de planejamento ativa
│   ├── sessao/[id]/route.ts                     ← PATCH auto-save (filtros, arquivos consolidados)
│   ├── sessao/[id]/encerrar/route.ts            ← POST encerra (finalizada/forcada/expirada)
│   ├── extrator/[id]/route.ts                   ← POST aplica filtros → retorna Order IDs / Tracking IDs
│   └── configuracoes/
│       ├── regras-prazo/route.ts                ← GET/POST regras de SLA por canal
│       ├── alias-tamanho/route.ts               ← GET/POST/DELETE aliases tipo EXG→EGG
│       ├── feriado/route.ts                     ← GET/POST/DELETE feriados pro cálculo de dias úteis
│       └── categoria-sku/route.ts               ← GET/POST/DELETE categorias do extrator (regex/tags)
│
├── components/central-envios/
│   ├── upload-dropzone.tsx                       ← Arraste arquivos (multi)
│   ├── ingestao-status.tsx                       ← Progress bar do parser
│   ├── dashboard-tab.tsx                         ← Aba 1 — stats + timeline
│   ├── cronograma-tab.tsx                        ← Aba 2 — matriz cor×tamanho por modelo, por dia
│   ├── sku-dia-tab.tsx                           ← Aba 3 — pivot SKU × data
│   ├── extrator-tab.tsx                          ← Aba 4 — filtros + copy/export
│   ├── pedidos-tab.tsx                           ← Aba 5 — tabela completa
│   ├── ambiguos-tab.tsx                          ← Aba 6 — SKUs que não explodiram
│   └── configuracoes-view.tsx                    ← CRUD regras (feriados, aliases, categorias, SLAs)
│
├── hooks/use-central-envios-planejamento.ts     ← Estado da sessão (ids, filtros, etc.)
│
├── lib/central-envios/
│   ├── ingestao/
│   │   ├── parser-tiktok-csv.ts                  ← extrai linhas do CSV (Order ID, Tracking, Seller SKU, Created Time, …)
│   │   ├── parser-ml-xlsx.ts                     ← header na linha 6, ignora "Pacote de N produtos"
│   │   └── parse-canal-adapter.ts                ← V2 — normaliza saída do ICanalAdapter pra mesmo shape
│   ├── normalizacao/
│   │   ├── normalizar-sku.ts                     ← BALA → BALA <corPadrao>, EXG → EGG (via cadastro)
│   │   ├── parsear-sku.ts                        ← interpreta o token (avulso | KIT N | MIX N | BALA…)
│   │   └── ambiguidade.ts                        ← detecta inconsistências (KIT 3 com 2 cores etc.)
│   ├── explosao/
│   │   ├── expandir-kit.ts                       ← consulta sku_kit_regra OU expande via cadastro de modelo
│   │   └── expandir-mix.ts                       ← MIX N = N cores ativas do modelo (cadastro-driven)
│   ├── prazo/
│   │   ├── adicionar-dias-uteis.ts               ← pula sáb/dom + feriados
│   │   ├── ajustar-para-util.ts                  ← empurra sáb/dom pra segunda
│   │   └── calcular-prazo.ts                     ← roteador por canal (delegate pro ICanalAdapter.calcularPrazo)
│   ├── agrupamento/
│   │   ├── por-dia.ts                            ← cronograma diário (atrasados → HOJE)
│   │   ├── por-sku-dia.ts                        ← pivot pra aba SKU × Dia
│   │   └── por-categoria.ts                      ← classifica em LUA_UNIT, KIT2_LUA, MIX, etc.
│   ├── extrator/
│   │   └── filtrar.ts                            ← aplica os 8 filtros + busca livre
│   └── relatorio/
│       ├── build-resumo-html.ts                  ← email + impressão
│       └── build-extrator-txt.ts                 ← formato "id1,id2,id3,…"
│
└── types/central-envios.ts                       ← PedidoNormalizado, LinhaExplodida, PlanejamentoSnapshot, FiltrosExtrator
```

Endpoints adjacentes que o módulo **consome**:

- `/api/modelo-principal` + `/api/modelo-cor` + `/api/modelo-tamanho` —
  cadastros que substituem `PRODUTOS`/`CORES`/`TAMANHOS` hardcoded.
- `/api/sku-catalogo` — SKUs válidos pra validação.
- `/api/coletas/configuracoes/kit-rules` — reuso de `sku_kit_regra` /
  `sku_kit_componente` pras composições (KIT 2 LUA, KIT BALA LUA, etc.).
- `/api/canais/*` — V2, pra pull automático.

---

## 3. Modelo de dados

### 3.1 Reuso (já existe — **não duplicar**)

| Tabela              | O que substitui no standalone        |
|---------------------|---------------------------------------|
| `modelo_principal`  | `PRODUTOS = ['LUA','NBA','BALA','BOB','SOL','CJ']` |
| `modelo_cor`        | `CORES = ['PT','AZ','CZ','BR']` (por modelo) |
| `modelo_tamanho`    | `TAMANHOS = ['P','M','G','GG','EGG']` (por modelo, com `ordem`) |
| `cor_catalogo`      | Lista global de cores (fallback p/ SKUs combinados livremente) |
| `tamanho_catalogo`  | Idem pra tamanhos |
| `sku_catalogo`      | SKUs explodidos válidos (validação pós-explosão) |
| `sku_kit_regra` + `sku_kit_componente` | Regras de composição (KIT BALA LUA, etc.) |
| `transportadora_padrao` | Detecção de transportadora por prefixo de tracking |
| `canais_venda` + adapters | V2 — pull automático e SLA por canal |

### 3.2 Novas tabelas

```
modelo_principal
└── + corPadrao : text?               ← p/ "BALA sem cor → BALA PT". Null = exige cor.
└── + exigeTamanho : bool default true ← BALA tamanho único = false
└── + corMixDefault : jsonb?           ← "MIX 4" pra LUA = [AZ,CZ,PT,BR]; null = usa todas modelo_cor ativas

tamanho_alias (NOVO)
├── id, contaId
├── modeloId       ← scope opcional; null = alias global
├── codigoAlias    ← 'EXG'
├── codigoReal     ← 'EGG'
└── UNIQUE (contaId, modeloId, codigoAlias)

cor_alias (NOVO — simétrico ao tamanho_alias)
└── ex.: 'PRETO' → 'PT'

feriado (NOVO)
├── id, contaId
├── data : date
├── descricao : text
├── nacional : bool      ← se true e a conta opt-in, o sistema baixa de uma API/lista
└── UNIQUE (contaId, data)

canal_regra_prazo (NOVO)
├── id, contaId, canalVendaId  ← FK opcional; null = regra global por tipo de canal
├── tipoCanal : 'TIKTOK_SHOP' | 'MERCADO_LIVRE' | 'SHOPEE' | …
├── estrategia : 'DIAS_UTEIS_POS_VENDA' | 'CAMPO_EXPLICITO' | 'HIBRIDO'
├── diasUteis : int?           ← p/ DIAS_UTEIS_POS_VENDA (TikTok = 2)
├── campoPrazo : text?         ← p/ CAMPO_EXPLICITO (ML = 'Estado')
├── regexPrazo : text?         ← p/ extrair (ex.: 'coleta do dia (\d+) de (\w+)')
├── fallbackHoje : bool        ← se não conseguiu calcular, prazo = HOJE
└── UNIQUE (contaId, canalVendaId, tipoCanal)

categoria_sku (NOVO — categorias do extrator)
├── id, contaId
├── nome           ← 'LUA unitário', 'KIT 2 LUA', 'MIX'
├── ordem
├── ativo
└── regras : jsonb ← { tipo:'regex', pattern:'^LUA \\w+ \\w+$' }
                   ← { tipo:'composicao', modelo:'LUA', qtdMin:2, qtdMax:2 }
                   ← { tipo:'tag', tags:['kit-grande'] }  ← se decidirmos tags no sku_catalogo

sessao_central_envios (NOVO — espelho de sessao_coletas)
├── status : 'ativa' | 'encerrada'    ← UNIQUE (usuarioId) WHERE status='ativa'
├── arquivosIngeridos : jsonb         ← [{ nome, tipo, runId, totalLinhas, ingeridoEm }]
├── dados : jsonb                     ← snapshot dos pedidos normalizados (cap.: ~10MB compactados)
├── filtrosExtrator : jsonb           ← último estado dos filtros (pra restore)
├── tipoVisualizacao : text           ← 'dashboard'|'cronograma'|'sku-dia'|… (aba ativa)
├── iniciouEm, ultimaAtividadeEm, encerrouEm
└── encerradaMotivo : 'finalizada'|'forcada'|'expirada'

planejamento_envios (NOVO — snapshot persistido)
├── id, contaId, usuarioId
├── geradoEm : timestamp
├── dataReferencia : date              ← qual "hoje" foi usado
├── totalPedidos, totalAtrasados, totalHoje, totalAmbiguos
├── arquivosIngeridos : jsonb          ← cópia dos arquivos consolidados
├── dados : jsonb                      ← snapshot completo (somente leitura após gerar)
└── INDEX (contaId, geradoEm desc)
```

> Diferença crucial vs Coletas: o **dado de trabalho** (snapshot dos pedidos
> normalizados) é grande — manter na `sessao_*` enquanto edita, copiar pra
> `planejamento_envios` quando o operador "finaliza/arquiva". Se passar de
> ~5MB, mover pro **Vercel Blob** e referenciar URL.

### 3.3 Status do pedido (calculados, não persistidos por enquanto)

```
ATRASADO  ← prazoOriginal < HOJE
HOJE      ← prazoOriginal === HOJE
NO_PRAZO  ← prazoOriginal > HOJE
SEM_DATA  ← não foi possível calcular
```

No cronograma, ATRASADO é **absorvido em HOJE** (indicador visual vermelho).

---

## 4. Normalização cadastro-driven (RITM-04, ✅ feito)

Substitui as regras hardcoded da Central de Envios. Tudo em
`src/lib/central-envios/normalizacao/`. Função pública:
`parsearSku(input, contextoCadastro)` — pura, sem DB. O loader
`carregarContextoCadastro(tx)` monta o snapshot via 7 queries paralelas
e é chamado uma única vez por upload.

### 4.1 Tabela de tradução

| Regra original (hardcoded)            | Equivalente cadastro-driven                                |
|----------------------------------------|-------------------------------------------------------------|
| `PRODUTOS = ['LUA','NBA',…]`           | `SELECT codigo FROM modelo_principal WHERE ativo=true`     |
| `CORES = ['PT','AZ','CZ','BR']`        | `modelo_cor WHERE modeloId=X AND ativo=true` (ou `cor_catalogo` global) |
| `TAMANHOS = ['P','M','G','GG','EGG']`  | `modelo_tamanho WHERE modeloId=X AND ativo=true ORDER BY ordem` |
| `BALA sem cor → BALA PT`               | `modelo_principal.corPadrao` (BALA.corPadrao = 'PT')        |
| `BALA tamanho único`                   | `modelo_principal.exigeTamanho = false`                     |
| `EXG → EGG`                            | `tamanho_alias { codigoAlias:'EXG', codigoReal:'EGG' }`     |
| Cores em ordem alfabética em kits      | `ORDER BY codigo ASC` na geração da string canônica         |
| `MIX 4 LUA G` → AZ+CZ+PT+BR            | `modelo_principal.corMixDefault[4]` ou top-4 cores ativas   |
| `MIX 3 LUA G` (legado, sem CZ)         | `modelo_principal.corMixDefault[3] = ['AZ','BR','PT']`      |
| `KIT BALA LUA PT M` → 1× LUA PT M + 1× BALA PT | `sku_kit_regra` cadastrado                          |
| `KIT N LUA AZ BR PT G` (cores listadas) | Mesmo cadastro — listar componentes explícitos             |
| `KIT N LUA 2 PT 1 CZ G` (distribuição) | Não cadastrável estaticamente — interpretado em runtime    |

### 4.2 Pipeline de normalização

```
input: "kit lua 2 pt 1 az m"
  │
  ├─ uppercase + trim
  ├─ aplicar cor_alias  (PRETO → PT, AZUL → AZ, …)
  ├─ aplicar tamanho_alias (EXG → EGG, GG1 → GG, …)
  ├─ tokenizar
  ├─ identificar modelo  ← match contra modelo_principal.codigo
  ├─ inferir N de KIT    ← se ausente, soma dos dígitos OU qtd de cores
  ├─ inferir cor única   ← se modelo tem corPadrao e nenhuma cor citada
  ├─ inferir tamanho     ← se modelo.exigeTamanho=false, default 'unico'
  │
output: SkuParsed { modelo, kind, qtd, cores: [{cor, qtd}], tamanho }
```

`kind` é um dos: `AVULSO`, `KIT_COR_UNICA`, `KIT_CORES_LISTADAS`,
`KIT_DISTRIBUICAO`, `MIX`, `KIT_COMPOSTO` (BALA+LUA), `AMBIGUO`.

### 4.3 Detecção de ambíguos

`src/lib/central-envios/normalizacao/ambiguidade.ts`:

- `KIT N` com cores listadas onde `len(cores) ≠ N` → ambíguo.
- Mistura de dígito + cor inconsistente (`KIT 3 LUA 2 AZ CZ PT EGG` — 1
  dígito de qtd + 3 cores).
- Modelo desconhecido (não está em `modelo_principal`).
- Tamanho desconhecido após resolver aliases.

Ambíguos vão pra `aba ambíguos` com a string original + a `Variação` do ML
(texto livre que ajuda o humano a decidir) e **não entram em nenhum
cronograma**.

---

## 5. Explosão

`src/lib/central-envios/explosao/`. Ordem de resolução:

1. **Match exato em `sku_kit_regra`** (string canônica do SKU). Usa direto
   os `sku_kit_componente`.
2. **Padrão paramétrico** (KIT N, MIX N, etc.) — expande em runtime usando
   o parse do passo 4.2:
   - `KIT_COR_UNICA`: N× (modelo, cor, tamanho).
   - `KIT_CORES_LISTADAS`: 1× por (modelo, cor_i, tamanho).
   - `KIT_DISTRIBUICAO`: qtd_i× por (modelo, cor_i, tamanho).
   - `MIX`: N cores do `corMixDefault` (ou top-N do `modelo_cor` ativo).
3. **Composição cross-product** (`KIT BALA LUA PT M`): cadastro estático
   em `sku_kit_regra` é o caminho recomendado; runtime só como fallback.

> A **fonte oficial das regras** (`LÓGICA_SKUS_NWC.md` do Obsidian) precisa
> ser convertida pra seeds de `modelo_principal` + `sku_kit_regra` no setup
> da conta NWC. Ponto de partida: rodar uma migration de seed que cria
> LUA/NBA/BALA/BOB/SOL/CJ + cores + tamanhos + os kits mais comuns.

---

## 6. Cálculo de prazo (delegado por canal)

Tabela `canal_regra_prazo` traduz as duas estratégias atuais:

| Tipo de canal     | Estratégia              | Config exemplo                                        |
|-------------------|--------------------------|--------------------------------------------------------|
| `TIKTOK_SHOP`     | `DIAS_UTEIS_POS_VENDA`   | `{ diasUteis: 2 }`                                     |
| `MERCADO_LIVRE`   | `CAMPO_EXPLICITO`        | `{ campoPrazo: 'Estado', regexPrazo: 'coleta do dia (\\d+) de (\\w+)', fallbackHoje: true }` |
| `SHOPEE`          | a definir                | —                                                      |

Função principal `calcularPrazo(pedido, regra)`:

```
1. Se estrategia = CAMPO_EXPLICITO:
     tenta extrair via regex do campo configurado.
     Se conseguiu → ajusta pra dia útil + retorna.
     Se falhou e fallbackHoje=true → retorna HOJE.
     Senão → SEM_DATA.

2. Se estrategia = DIAS_UTEIS_POS_VENDA:
     prazo = adicionarDiasUteis(createdAt, diasUteis)
     ajusta pra dia útil (proteção contra config errada).

3. Se estrategia = HIBRIDO:
     tenta CAMPO_EXPLICITO; se falhou, cai pra DIAS_UTEIS_POS_VENDA.
```

`adicionarDiasUteis` consulta `feriado` da conta atual (cache em memória por
request) — fim das limitações conhecidas item 1 (`feriados nacionais não
são considerados`).

Quando a integração via Canais entrar, `ICanalAdapter` ganha um método
opcional `calcularPrazoDePedido(raw)` que sobrescreve a config — pra
plataformas onde a regra é dinâmica/complexa (ex.: ML expandindo pra
mais estados de pedido).

---

## 7. Sessão server-side (mesmo padrão de Coletas)

```
Mount → GET /api/central-envios/sessao
        ├─ Sem sessão: estado limpo, dropzone vazio
        ├─ Sessão com dados: AlertDialog "Continuar / Arquivar agora"
        └─ Sessão vazia: adota silenciosamente

Upload de arquivo:
  POST /api/central-envios/ingestao (multipart)
  → enfileira Inngest "central-envios/parsear-arquivo"
  → retorna runId
  Frontend: polling em GET /api/central-envios/ingestao/[runId] até "concluído"
  Ao concluir: PATCH /api/central-envios/sessao/[id] com arquivos+dados

Auto-save (filtros, aba ativa, dados consolidados):
  Debounce 800ms → PATCH /api/central-envios/sessao/[id]
  Retry exponencial (0, 1s, 2s, 4s); saveState = saving|saved|error

"Arquivar planejamento":
  POST /api/central-envios → cria registro em planejamento_envios
  POST /api/central-envios/sessao/[id]/encerrar  motivo=finalizada
  Limpa o estado local

"Forçar Parada":
  confirm() → POST encerrar motivo=forcada → estado limpo
  (NÃO grava planejamento)

TTL: 8h sem atividade → encerra motivo=expirada no próximo GET.
```

Diferenças vs sessão de Coletas:

- **`dados` é grande** (snapshot dos pedidos normalizados). Auto-save
  precisa de debounce maior (1.5–2s) e considerar **diff/patch** em vez de
  reenviar tudo. Decisão a tomar no RITM-01: PATCH inteiro ou JSON Patch.
- Parsing roda no **Inngest**, não no route handler. Arquivo grande não
  pode bloquear request por 30s.

---

## 8. Endpoints (resumo)

| Método | Path                                              | Função                                                |
|--------|---------------------------------------------------|--------------------------------------------------------|
| GET    | `/api/central-envios`                             | Lista histórico de planejamentos arquivados            |
| POST   | `/api/central-envios`                             | **Arquiva planejamento** (snapshot da sessão atual)    |
| GET    | `/api/central-envios/[id]`                        | Detalhe de planejamento arquivado                      |
| POST   | `/api/central-envios/ingestao`                    | Upload multipart → enfileira parse                     |
| GET    | `/api/central-envios/ingestao/[runId]`            | Status do parse (Inngest run)                          |
| POST   | `/api/central-envios/pull` (V2)                   | Trigger manual de pull via `ICanalAdapter`             |
| GET    | `/api/central-envios/sessao`                      | Sessão ativa (ou null + TTL check)                     |
| POST   | `/api/central-envios/sessao`                      | Cria sessão (idempotente)                              |
| PATCH  | `/api/central-envios/sessao/[id]`                 | Auto-save                                              |
| POST   | `/api/central-envios/sessao/[id]/encerrar`        | Encerra (finalizada/forcada/expirada)                  |
| POST   | `/api/central-envios/extrator/[id]`               | Aplica filtros → retorna Order IDs / Tracking IDs      |
| GET    | `/api/central-envios/configuracoes/regras-prazo`  | Lista regras por canal                                 |
| POST   | `/api/central-envios/configuracoes/regras-prazo`  | Upsert                                                 |
| GET    | `/api/central-envios/configuracoes/alias-tamanho` | Lista aliases                                          |
| POST   | `/api/central-envios/configuracoes/alias-tamanho` | Cria alias                                             |
| DELETE | `/api/central-envios/configuracoes/alias-tamanho` | Remove                                                 |
| GET    | `/api/central-envios/configuracoes/feriado`       | Lista feriados                                         |
| POST   | `/api/central-envios/configuracoes/feriado`       | Cria feriado                                           |
| DELETE | `/api/central-envios/configuracoes/feriado`       | Remove feriado                                         |
| GET    | `/api/central-envios/configuracoes/categoria-sku` | Lista categorias do extrator                           |
| POST   | `/api/central-envios/configuracoes/categoria-sku` | Cria/edita categoria                                   |

Todos passam por `withContaAtiva` (multi-tenant + RLS scoped na `contaId`).

---

## 9. Telas / abas

Espelho da ferramenta original, com adaptações cadastro-driven.

| # | Aba           | Componente                | Notas                                                   |
|---|---------------|---------------------------|----------------------------------------------------------|
| 0 | **Upload**    | `upload-dropzone.tsx`     | Multi-arquivo. Detecção automática TikTok CSV vs ML XLSX. Status em tempo real via `ingestao-status.tsx`. |
| 1 | Dashboard     | `dashboard-tab.tsx`       | Stats (totais, atrasados, hoje, ambíguos) + timeline clicável → Pedidos |
| 2 | Cronograma    | `cronograma-tab.tsx`      | Matriz cor × tamanho **por modelo ativo** (não por LUA/NBA/BALA fixo). Picos destacados. |
| 3 | SKU × Dia     | `sku-dia-tab.tsx`         | Pivot SKU explodido × data. Ordenado por demanda total. |
| 4 | Extrator      | `extrator-tab.tsx`        | 8 filtros (plataforma, prazo, status, **categoria — do cadastro**, modelo, cor, tamanho, busca). Copy Order IDs / Tracking IDs / TXT. |
| 5 | Pedidos       | `pedidos-tab.tsx`         | Tabela completa com explosão legível. Limite UI 500 linhas. |
| 6 | Ambíguos      | `ambiguos-tab.tsx`        | Lista + "tipo de ambiguidade" + botão "Editar manualmente" (V2: cria entry em `sku_kit_regra` direto) |
| 7 | Configurações | `configuracoes-view.tsx`  | CRUD de regras de prazo, aliases, feriados, categorias |

**Mudanças visuais relevantes vs standalone:**

- A aba Cronograma **enumera modelos ativos** (não 3 cards LUA/NBA/BALA
  fixos). Conta sem produtos cadastrados → aba mostra um empty-state
  apontando pro cadastro de modelos.
- A aba Extrator carrega categorias de `categoria_sku` em vez de hardcoded.
- Stats cards "TikTok / Mercado Livre" passam a **iterar sobre canais
  ativos** (`canais_venda`), não cards fixos.

---

## 10. Ingestão de arquivos (TikTok CSV / ML XLSX)

### 10.1 TikTok CSV — `parser-tiktok-csv.ts` (RITM-02, ✅ feito)

- Nome padrão: `Para_enviar_pedido-AAAA-MM-DD-HH_MM.csv`.
- Limpa `\t` no fim de campos (TikTok adiciona).
- Server-side com `csv-parse/sync`. Função pura — input Buffer/string →
  `ResultadoParser` (sem efeito colateral, idempotente).
- Colunas obrigatórias: `Order ID`, `Tracking ID`, `Seller SKU`, `Quantity`,
  `Buyer Username`, `Created Time` (`MM/DD/YYYY HH:MM:SS AM/PM`),
  `Order Status`. `Order Substatus` opcional.
- Filtra `Order Status = "A ser enviado"` (cancelamentos já vêm fora,
  mas defensivo). Customizável via `opts.filtrarOrderStatus`.
- Created Time é convertido pra ISO UTC assumindo TZ `America/Sao_Paulo`
  (UTC-3 fixo). Parse manual (não usa `new Date(str)`) — determinístico
  entre runtimes.
- Limite hard de input: 50MB.

### 10.2 Mercado Livre XLSX — `parser-ml-xlsx.ts` (RITM-03, ✅ feito)

- Nome padrão:
  `AAAAMMDD_Vendas_BR_Mercado_Libre_y_Mercado_Shops_AAAA-MM-DD_HH-MMhs_<CONTA>.xlsx`.
  **Não validamos o nome** — operador pode renomear.
- Header na **linha 6** (índice 5), dados a partir da linha 7.
  `XLSX.utils.sheet_to_json(sheet, { header: 1, range: 5, ... })`.
- Colunas obrigatórias: `N.º de venda`, `Data da venda`, `SKU`,
  `Unidades`. Opcionais: `Variação`, `Estado`, `Comprador`,
  `N.º de envio`. Atenção: `N.º` usa `º` (U+00BA, ordinal masculino).
- Ignora linhas `Pacote de N produtos` (agregador) — vêm linha-a-linha
  na sequência.
- **Dedup intra-arquivo** por `N.º de venda` — mantém primeiro. Dedup
  cross-file fica pro RITM-07 (sessão merge).
- `Data da venda` aceita Date nativo (`cellDates: true`), serial XLSX
  numérico, ou string pt-BR `DD/MM/YYYY [HH:MM[:SS]]`. Quando não bate,
  `dataVendaIso` fica `null` e o `dataVendaRaw` preserva o original.
- `Estado` (com `coleta do dia X de Y`) vem **literal** — extração de
  prazo é RITM-06.
- Limite hard de input: 50MB (compartilhado com TikTok via re-export).

### 10.3 Multi-arquivo / multi-conta

- Cada upload vira um run no Inngest. Concluído → PATCH na sessão com
  `arquivosIngeridos` cumulativo + `dados` mesclado.
- Dedup transversal por `(canal, orderId)` na hora do merge.
- Conflito (mesmo `orderId` com SKU diferente entre arquivos) →
  vai pra `ambíguos` com tipo `CONFLITO_INGESTAO`.

---

## 11. Bug histórico de timezone (mantido na blacklist)

A ferramenta original tinha **`toISOString().slice(0,10)`** convertendo pra
UTC e depois `new Date("2026-05-08")` interpretando como UTC — no Brasil
(UTC-3) puxava a data pro dia anterior. Solução: `dataKey()` e
`parseKeyAsLocalDate()` em timezone local.

**Em scaleon**: usar `date-fns` com `Intl.DateTimeFormat({ timeZone: 'America/Sao_Paulo' })`
ou trabalhar com `Date` em UTC **apenas pra storage** e converter no
boundary. Adicionar ao lint custom uma regra que proíbe
`.toISOString().slice(0, 10)` no diretório `src/lib/central-envios/`.

---

## 12. Pontos sensíveis / quirks conhecidos

1. **Snapshot de dados na `sessao_central_envios` pode estourar jsonb** se
   o operador subir CSV de 10k+ linhas. Estratégia:
   - Calcular tamanho do JSON antes do PATCH.
   - > 4MB → grava no Vercel Blob e persiste só a URL na sessão.
   - Considerar formato comprimido (gzip + base64) pra reduzir 80%.

2. **Parsing precisa rodar no Inngest** (CSV/XLSX pesado). Route handler
   só enfileira e devolve `runId`. UI faz polling.

3. **Dedup transversal** entre múltiplos XLSX do ML pode mascarar erro
   real (mesmo `N.º de venda` em duas contas = bug na seleção do export).
   Logar quando rejeita dedup.

4. **Categorias do extrator dependem de regex** (`categoria_sku.regras`).
   Regex inválida = explosão no servidor. Validar no upsert e rodar em
   sandbox (timeout) no apply.

5. **Feriado nacional** — a config é por conta. Decisão: ter um
   **botão "Sincronizar feriados nacionais BR"** que popula `feriado`
   a partir de uma API (ex.: BrasilAPI) ou JSON estático. Permanece opt-in.

6. **`corMixDefault` por modelo é override**, não obrigatório. Se nulo,
   `MIX N` usa as N primeiras cores ativas do `modelo_cor` (ordem alfabética
   por padrão, ou por `ordem` se decidir adicionar a coluna).

7. **Cancelamentos do TikTok** — CSV atual já vem sem eles
   (`Order Status = "A ser enviado"`). Se a regra mudar, filtrar no parser
   pra não estragar cronograma.

8. **`PACOTE_DIVERSOS` do ML** é informativo (linha "Pacote de N
   produtos"). Ignorar sempre — a venda real já vem com produtos
   individualmente.

9. **Pull automático via Canais (V2)**: cuidado pra não duplicar com upload
   manual. Marcar no `arquivosIngeridos` se a origem foi `upload` ou
   `pull-canal:<id>` e bloquear merge conflitante.

10. **RLS / `drizzle-kit push`** — vide AGENTS.md. Toda tabela nova precisa
    da policy declarada em migration; push não cria RLS.

11. **Tamanho de aliases globais vs por modelo**: alias `EXG → EGG` é
    geralmente seguro globalmente, mas alias `M → P` (improvável)
    poderia conflitar. Política: alias por modelo tem precedência sobre
    global; aplicação avisa quando alias global colide.

---

## 13. Onde mexer pra cada tipo de mudança

| Mudança                                              | Arquivo(s) primário(s)                                  |
|-------------------------------------------------------|----------------------------------------------------------|
| Novo **modelo** (ex.: novo produto)                  | UI: `/cadastros/modelos` (`modelo_principal` + filhos). **Nenhum código de Central de Envios muda.** |
| Nova **cor** ou **tamanho**                          | UI de cadastro de modelo. Idem — zero código.            |
| Nova regra de **kit nominal**                        | `/coletas/configuracoes` → kit rules (`sku_kit_regra`)  |
| Novo **canal** com SLA próprio                       | `canal_regra_prazo` via UI de configurações              |
| Mudar **dias úteis** do TikTok                       | UPDATE em `canal_regra_prazo.diasUteis`                  |
| Novo **alias de tamanho** (ex.: G1 → G)              | UPSERT em `tamanho_alias`                                |
| **Feriado** novo                                     | UPSERT em `feriado` (manual ou via sync nacional)        |
| Nova **categoria** no extrator                       | UPSERT em `categoria_sku`                                |
| Suportar **novo formato de arquivo** de marketplace  | Adicionar `src/lib/central-envios/ingestao/parser-<canal>.ts` + detector |
| Mudar **layout do email/relatório**                  | `lib/central-envios/relatorio/build-resumo-html.ts`      |
| Pull **automático via API**                          | Implementar `ICanalAdapter.listarPedidosAReceber` no adapter do canal |

---

## 14. Variáveis de ambiente

| Var                       | Função                                                  |
|---------------------------|----------------------------------------------------------|
| `BLOB_READ_WRITE_TOKEN`   | Storage do snapshot de planejamento (`planejamento_envios.dados`) quando exceder 4MB |
| `INNGEST_EVENT_KEY` / `SIGNING_KEY` | Já configurados (módulo Canais). Reutilizados pro parsing assíncrono |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | Envio do resumo do planejamento por email     |
| `FERIADOS_API_URL`        | Opcional — endpoint pra sync de feriados nacionais (ex.: BrasilAPI) |

Sem chaves novas obrigatórias (Inngest e Resend já existem do módulo Canais
e Coletas).

---

## 15. Roadmap proposto (RITMs)

| RITM     | Escopo                                                                    | Esforço | Status |
|----------|---------------------------------------------------------------------------|---------|--------|
| **01**   | Schema cadastros + migration + seed de defaults por plataforma            | M       | ✅ feito |
| **02**   | Parser TikTok CSV server-side + ingestão via Inngest (`ingestao_run` + Inngest setup compartilhado) | M | ✅ feito |
| **03**   | Parser ML XLSX server-side + dedup intra-arquivo (reusa Inngest do RITM-02) | M       | ✅ feito |
| **04**   | Pipeline de normalização cadastro-driven (parser puro `parsearSku`, snapshot + aliases) | L       | ✅ feito |
| **05**   | Pipeline de explosão (kit nominal + paramétrico + MIX cadastro-driven)    | M |
| **06**   | Cálculo de prazo + tabela `canal_regra_prazo` + feriados                  | M |
| **07**   | Sessão server-side + auto-save + Blob para snapshots grandes              | M |
| **08**   | UI — Upload + Dashboard + Cronograma                                       | L |
| **09**   | UI — SKU × Dia + Extrator + Pedidos + Ambíguos                            | L |
| **10**   | UI — Configurações (regras prazo, aliases, feriados, categorias)          | M |
| **11**   | Histórico/arquivamento (`planejamento_envios`) + email de resumo          | S |
| **V2-01** | Pull automático via `ICanalAdapter` (substituir upload onde houver adapter) | L |
| **V2-02** | "Editar manualmente" em ambíguos → cria `sku_kit_regra`                  | S |
| **V2-03** | Sync de feriados nacionais via API externa                                | S |

---

## 16. Hardcodes da versão atual — mapa scaleon

Lista exaustiva do que precisa **sair do código** e ir pra cadastro/config
ao portar pro ERP. Use como checklist na review de cada RITM.

| # | Hardcode original                                            | Local (standalone)                       | Substituto scaleon                                             |
|---|---------------------------------------------------------------|------------------------------------------|-----------------------------------------------------------------|
| 1 | `PRODUTOS = ['LUA','NBA','BALA','BOB','SOL','CJ']`           | constantes JS                            | `modelo_principal.codigo` (consulta por conta)                  |
| 2 | `CORES = ['PT','AZ','CZ','BR']`                              | constantes JS                            | `modelo_cor` (por modelo) com fallback em `cor_catalogo`         |
| 3 | `TAMANHOS = ['P','M','G','GG','EGG']`                        | constantes JS                            | `modelo_tamanho` (por modelo) com fallback em `tamanho_catalogo` |
| 4 | `BALA sem cor → BALA PT`                                     | switch hardcoded                         | `modelo_principal.corPadrao`                                    |
| 5 | `BALA tamanho único`                                         | if (modelo === 'BALA')                   | `modelo_principal.exigeTamanho = false`                         |
| 6 | `EXG → EGG`                                                  | replace hardcoded                        | `tamanho_alias`                                                  |
| 7 | `MIX 4 = AZ+CZ+PT+BR`                                        | array literal                            | `modelo_principal.corMixDefault[4]` (ou top-4 ativas)            |
| 8 | `MIX 3 LUA = AZ+BR+PT` (sem CZ)                              | array literal legado                     | `modelo_principal.corMixDefault[3]`                              |
| 9 | `KIT BALA LUA` (composição)                                  | regra hardcoded                          | `sku_kit_regra` cadastrado                                      |
| 10 | `LUA` = camiseta dry fit manga longa (significado)          | comentário                               | `modelo_principal.descricao` (campo novo opcional)              |
| 11 | TikTok prazo = +2 dias úteis                                 | função `adicionarDiasUteis(2)`           | `canal_regra_prazo { tipoCanal:'TIKTOK_SHOP', diasUteis: 2 }`   |
| 12 | ML prazo = regex `coleta do dia (\d+) de (\w+)`              | regex literal                            | `canal_regra_prazo.regexPrazo`                                  |
| 13 | Estados ML fallback (`PREPARACAO_NFE`, etc.) → HOJE          | array hardcoded                          | `canal_regra_prazo.fallbackHoje = true` + lista de estados como config no parser ML |
| 14 | Feriados nacionais ignorados                                 | limitação documentada                    | tabela `feriado` + opt-in sync nacional                         |
| 15 | Categorias do extrator (`LUA_UNIT`, `KIT2_LUA`, etc.)        | regex hardcoded                          | `categoria_sku` com `regras: jsonb`                             |
| 16 | Cores em ordem alfabética em kits                            | `.sort()` implícito                      | Documentado; ordenar por `modelo_cor.codigo ASC`               |
| 17 | Header ML na linha 6                                         | índice 5 hardcoded                       | OK manter — é estrutura fixa do export ML                       |
| 18 | "Pacote de N produtos" ignorado                              | string match                             | OK manter — semântica do ML                                     |
| 19 | Cancelamentos não filtrados                                  | "TikTok já vem sem"                      | Defensivo: filtrar `Order Status` no parser                     |
| 20 | Plataformas hardcoded (TT, ML)                               | UI fixa                                  | Iterar sobre `canais_venda` ativos                              |
| 21 | Operação física São Bernardo / iMile                         | documentação                             | Não vai pro código                                              |
| 22 | "Upseller / super-waves" como destino                        | documentação                             | Permanece como nota operacional                                 |

---

*Documento gerado em junho de 2026 como proposta arquitetural. Atualizar
conforme RITMs forem implementados.*
