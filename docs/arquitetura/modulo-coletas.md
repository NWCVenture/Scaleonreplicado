# Módulo Coletas — Arquitetura

Documento de referência da feature **Coletas** (bipagem de pacotes para coleta,
devolução e cancelamento). Lê-se antes de mexer no módulo.

---

## 1. Propósito

A tela `/coletas` é a **estação de bipagem** do galpão. O operador encosta o
leitor no código do pacote (ou cola um bloco de IDs FLEX) e o sistema:

1. Extrai cada ID válido,
2. Detecta a transportadora a partir do prefixo,
3. Persiste numa **sessão server-side** com auto-save (suporta perda de aba/PC),
4. No "Finalizar", grava o lote em `coleta_bipagem` + filhos, gera os TXT/HTML
   de manifesto e zera a tela.

Há quatro fluxos paralelos (`tipo`):

| Tipo        | Caso de uso                                                |
|-------------|-------------------------------------------------------------|
| `FLEX`      | Bipagem do bloco copiado do Mercado Livre Flex (formato `^id^Ç^…`). Sem seleção de conta. Gera **romaneio HTML** pronto pra impressão. |
| `COLETA`    | Coleta diária dos marketplaces. Seleciona conta (TikTok / ML / Shopee). Gera TXT. |
| `DEVOLUCAO` | Pacote devolvido. Abre **modal de devolução** por pacote (SKUs, avaria, fotos). Gera TXT por operação. |
| `CANCELADO` | Pedido cancelado antes do envio. Mesmo modal da devolução, salvo como tipo distinto. |

---

## 2. Mapa de arquivos

```
src/
├── app/(dashboard)/coletas/page.tsx          ← UI principal (client component, ~1640 linhas)
├── app/api/coletas/
│   ├── route.ts                               ← GET histórico paginado · POST finalize (grava lote)
│   ├── [id]/route.ts                          ← GET detalhe de bipagem (pacotes + devoluções + SKUs)
│   ├── [id]/revisar/route.ts                  ← PUT marca como revisado
│   ├── email/route.ts                         ← POST manifesto avulso por email (Resend)
│   ├── sessao/route.ts                        ← GET sessão ativa do usuário · POST cria
│   ├── sessao/[id]/route.ts                   ← PATCH auto-save (tipo/conta/pacotes/devolucoesData)
│   ├── sessao/[id]/encerrar/route.ts          ← POST encerra (motivo: finalizada/forcada/expirada)
│   ├── sessao/[id]/enviar-email/route.ts      ← POST envia resumo da sessão pro operador + admins
│   └── configuracoes/
│       ├── transportadoras/route.ts           ← GET/POST(upsert)/DELETE padrões de prefixo
│       └── kit-rules/route.ts                 ← GET/POST/DELETE regras SKU-kit → componentes
├── components/coletas/
│   ├── scan-overlay.tsx                       ← Overlay flash verde/vermelho no bipe
│   ├── pacote-list-item.tsx                   ← Item memoizado da lista (evita re-render por bipe)
│   ├── devolucao-modal.tsx                    ← Form de devolução por pacote (SKUs + avaria + fotos)
│   ├── historico-view.tsx                     ← Aba "Histórico" (filtros, revisar, exportar)
│   └── configuracoes-view.tsx                 ← Aba "Configurações" (catálogo SKU, kits, prefixos)
├── hooks/use-coletas-bipagem.ts                ← Estado do scanner (ids, processText, etc.)
├── lib/
│   ├── coletas-utils.ts                       ← detectCarrier, extract*Ids, manifest HTML, TXT, kit explode
│   └── coletas-sessao-relatorio.ts            ← buildResumoTxt + sendEmail (resumo da sessão)
└── types/coletas.ts                            ← Re-exports + constantes de display + DevolucaoFormData
```

Endpoints relacionados (fora de `/api/coletas/`):

- `/api/sku-catalogo` (GET/POST) — catálogo global de SKUs usado no autocomplete do modal de devolução.

---

## 3. Modelo de dados (Drizzle)

Definições em `src/lib/db/schema.ts`.

### Lote persistido (após "Finalizar")

```
coleta_bipagem (PK id)
├── tipo : FLEX | COLETA | DEVOLUCAO | CANCELADO
├── conta : TIKTOK_SHOP | MERCADO_LIVRE | SHOPEE
├── total : int                  ← snapshot da quantidade de pacotes
├── revisado : bool              ← marcado via PUT /coletas/[id]/revisar
├── revisadoPor / revisadoEm
├── usuarioId, contaId, createdAt
│
└── coleta_bipagem_pacote (1:N, cascade)
    ├── codigo : text
    ├── transportadora : TTK_JDLOG | TTK_IMILE | ML | SHP | DESCONHECIDA
    │
    └── coleta_devolucao (0..1 por pacote, cascade)
        ├── operacao : marketplace de origem (pode diferir do `conta` do lote)
        ├── avaria : bool
        ├── observacao : text
        ├── tipo : FLEX|COLETA|DEVOLUCAO|CANCELADO (redundante c/ o lote, snapshot p/ relatório)
        ├── fotoPacoteUrl / fotoAvariaUrl  ← Vercel Blob (pode ser null se Blob não configurado)
        │
        └── coleta_devolucao_sku (1:N, cascade)
            └── { sku, quantidade }       ← linhas brutas; kits só explodem no relatório
```

### Sessão em andamento (auto-save)

```
sessao_coletas
├── status : 'ativa' | 'encerrada'         ← UNIQUE (usuarioId) WHERE status='ativa'
├── tipo, conta                            ← snapshot do tipo/conta correntes
├── pacotes : jsonb (string[])             ← IDs já bipados
├── devolucoesData : jsonb (Record<id,…>)  ← form data do modal de devolução
├── totalPacotes : int                     ← derivado, atualizado no PATCH
├── iniciouEm, ultimaAtividadeEm
├── encerrouEm, encerradaMotivo : 'finalizada'|'forcada'|'expirada'
```

> **TTL:** sessão inativa há > 8h é marcada `expirada` no próximo GET (vide
> `SESSAO_TTL_MS` em `app/api/coletas/sessao/route.ts:11`). Sem job de
> limpeza — só o GET preguiçoso.

### Configurações

- `transportadora_padrao` — { transportadora, prefixos: string[] }. Único por
  (contaId, transportadora) — POST faz upsert.
- `sku_kit_regra` + `sku_kit_componente` — kit → componentes (SKU mãe + filhos
  com quantidades). Usado na **explosão de SKUs** no relatório de devolução.
- `sku_catalogo` (módulo separado) — lista global de SKUs pro autocomplete.

### Enums

| Enum                       | Valores                                          |
|----------------------------|---------------------------------------------------|
| `tipoColetaEnum`           | FLEX, COLETA, DEVOLUCAO, CANCELADO               |
| `contaOperacaoEnum`        | TIKTOK_SHOP, MERCADO_LIVRE, SHOPEE               |
| `transportadoraLabelEnum`  | TTK_JDLOG, TTK_IMILE, ML, SHP, DESCONHECIDA      |
| `sessaoColetasStatusEnum`  | ativa, encerrada                                 |

Tenancy: tudo carrega `contaId` (default `nwc-root`) e passa por
`withContaAtiva` — multi-tenant futuro já vem de graça.

---

## 4. Detecção de transportadora

`detectCarrier` em `src/lib/coletas-utils.ts:14`:

1. `/^4\d{10}$/` → `ML` (Mercado Livre, 11 dígitos começando com 4).
2. `/^BR\d{12,13}[A-Z]?$/` → `SHP` (Shopee).
3. `/^\d{13,14}$/` → cruza com `transportadora_padrao.prefixos`. Se algum
   match incluir `JDLOG` no nome → `TTK_JDLOG`; se incluir `IMILE` → `TTK_IMILE`.
   Senão → `DESCONHECIDA`.
4. Tudo o mais → `DESCONHECIDA`.

> Regra **hardcoded** no nome: o cadastro de prefixo só serve pra decidir
> *quando* aplicar o label, mas o label final é fixo (`TTK_JDLOG` ou
> `TTK_IMILE`). Adicionar nova transportadora hoje exige mudar o código.

---

## 5. Extração de IDs

Em `coletas-utils.ts:37+`:

- `extractFlexIds(text)` — bloco copiado do ML Flex, no formato `^id^Ç^XXXXXXXXXXX^`.
  Captura todos os 11 dígitos entre `^Ç^` e `^`.
- `extractShippingIds(text)` — regex genérica que casa ML (`4\d{10}`), Shopee
  (`BR\d{12,13}[A-Z]?`) e códigos de 13–14 dígitos (TikTok).

Estratégia em `processText` (`use-coletas-bipagem.ts:45`):

- Tipo `FLEX`: tenta `extractFlexIds` primeiro. Se vier vazio, cai pra
  `extractShippingIds` (suporta operador colando IDs avulsos).
- Outros tipos: só `extractShippingIds`.
- Dedup opcional (`dedup=true` default) compara com `idsRef.current` (snapshot
  sincrônico — **importante**: usar `setIds(prev => …)` aqui faria leitura
  stale em React 18 com batching, conforme comentário do código).

---

## 6. Lifecycle da sessão (server-side, recente)

A sessão server-side substituiu o `localStorage` antigo. Fluxo em
`app/(dashboard)/coletas/page.tsx`:

```
Mount → GET /api/coletas/sessao
        ├─ Sem sessão ou vazia: estado limpo
        ├─ Sessão vazia já criada: adota silenciosamente (sessaoId no estado)
        └─ Sessão com pacotes: abre AlertDialog "Continuar / Finalizar agora"

1º bipe (sem sessão e sem lock):
  POST /api/coletas/sessao  → cria sessão
  PATCH /api/coletas/sessao/[id] (sem debounce)
  initLockRef.current = true   ← evita StrictMode criar 2x

Bipes seguintes:
  Debounce 800ms → PATCH /api/coletas/sessao/[id]
  Retry exponencial (0, 1s, 2s, 4s); saveState = saving|saved|error
  Badge UI clicável quando 'error' → handleRetrySave

"Finalizar":
  POST /api/coletas (grava lote definitivo, faz upload das fotos pro Blob)
  Download TXT (lista de IDs) + opcionalmente:
    - DEVOLUCAO → segundo TXT com SKUs explodidos por kit
    - FLEX     → abre janela com manifesto HTML (window.print)
  POST /api/coletas/sessao/[id]/encerrar  motivo=finalizada
  bipagem.clear() + reset locks

"Forçar Parada":
  confirm() → POST encerrar motivo=forcada → bipagem.clear()
  (NÃO grava em coleta_bipagem — só descarta a sessão)

"Enviar Resumo" (manual):
  Flush PATCH (espelha o estado atual) →
  POST /api/coletas/sessao/[id]/enviar-email
  Envia HTML+TXT pro operador + admins via Resend

TTL: GET marca `expirada` e devolve null se > 8h sem atividade.
```

Pontos sutis (já comentados no código):

- **`finalizingFromRestoreRef`**: o effect que dispara `handleFinalize` após o
  modal de restauração roda múltiplas vezes (cada `setState` do
  `handleFinalize` muda a identidade do `useCallback([bipagem])` → re-roda o
  effect). O ref garante execução única.
- **`pendingRestore`**: enquanto o modal está aberto o auto-save é suprimido,
  senão criaria uma sessão paralela por cima da que está aguardando decisão.
- **`isFinalizing` / `isFinalizingFromRestore`**: também suprimem auto-save,
  evitando PATCH contra sessão que está sendo encerrada (e que geraria
  `saveState='error'` cosmético).

---

## 7. Modal de devolução

`devolucao-modal.tsx` (526 linhas). Abre automaticamente após bipe quando
`currentFunction in {DEVOLUCAO, CANCELADO}`. Captura:

- `skuLines`: lista { sku, qtd }. Autocomplete contra `skuCatalog` (catálogo
  global). Suporta kits — não explode na entrada, só no relatório.
- `operacao`: marketplace de origem do pacote (pode diferir do `conta` do
  lote — ex.: lote "geral" com devoluções de várias contas misturadas).
- `avaria`: bool. Se true, libera campo de obs (e ativa upload da foto de
  avaria).
- `obs`: texto livre.
- `fotoPacoteBase64` / `fotoAvariaBase64`: base64 inline; **enviados no POST
  final**, não no PATCH (sessão guarda só metadados leves).
- `tipo`: snapshot do tipo corrente da bipagem.

> ⚠ As fotos só fazem upload pro Vercel Blob **no finalize** (vide
> `app/api/coletas/route.ts:155`). Se o operador "Forçar Parada" antes,
> as fotos somem com a sessão.

---

## 8. Explosão de kits no relatório de devolução

`buildDevolucaoExportTxt` em `coletas-utils.ts:178`:

1. Filtra `devolucoesData` por `tipo='DEVOLUCAO'` (cancelados não entram aqui).
2. Para cada pacote, lista as linhas brutas (SKU mãe + qtd).
3. Roda `explodeSkuLines` (`coletas-utils.ts:52`) — se algum SKU casar com um
   `kitRules[].kitSku`, troca pela soma `componente.qtd × line.qtd`.
4. Se houve expansão, imprime bloco "→ Unidades:" com componentes.
5. Acumula tudo em `allExploded` → no fim, "TOTAL PARA ENTRADA NO UPSELLER"
   (sumarizado por SKU).

> O Upseller (sistema externo) é o destino final do relatório — daí o nome.

---

## 9. Endpoints (resumo)

| Método | Path                                          | Função                                                |
|--------|-----------------------------------------------|--------------------------------------------------------|
| GET    | `/api/coletas`                                | Lista histórico paginado (filtros: data, tipo, conta, revisado) |
| POST   | `/api/coletas`                                | **Finalize** — grava lote + pacotes + devoluções + SKUs, upload fotos |
| GET    | `/api/coletas/[id]`                           | Detalhe de um lote (pacotes com devolução aninhada)   |
| PUT    | `/api/coletas/[id]/revisar`                   | Marca lote como revisado pelo usuário atual           |
| POST   | `/api/coletas/email`                          | Email avulso de manifesto (Resend) — legado, não-sessão |
| GET    | `/api/coletas/sessao`                         | Sessão ativa do usuário (ou null + TTL check)         |
| POST   | `/api/coletas/sessao`                         | Cria sessão ativa (idempotente — devolve a existente) |
| PATCH  | `/api/coletas/sessao/[id]`                    | Auto-save (tipo, conta, pacotes, devolucoesData)      |
| POST   | `/api/coletas/sessao/[id]/encerrar`           | Encerra sessão (motivo: finalizada/forcada/expirada)  |
| POST   | `/api/coletas/sessao/[id]/enviar-email`       | Envia resumo da sessão pro operador + admins          |
| GET    | `/api/coletas/configuracoes/transportadoras`  | Lista padrões de prefixo                              |
| POST   | `/api/coletas/configuracoes/transportadoras`  | Upsert por (contaId, transportadora)                  |
| DELETE | `/api/coletas/configuracoes/transportadoras`  | Remove por id                                          |
| GET    | `/api/coletas/configuracoes/kit-rules`        | Lista kits + componentes                              |
| POST   | `/api/coletas/configuracoes/kit-rules`        | Cria kit + componentes (atômico)                      |
| DELETE | `/api/coletas/configuracoes/kit-rules`        | Remove kit (cascade nos componentes)                  |

Todos os endpoints (exceto `/email`) usam `withContaAtiva` — multi-tenant +
RLS scoped na `contaId` do usuário logado.

---

## 10. Pontos sensíveis / quirks conhecidos

1. **Histórico não é a fonte de verdade do `usuário` que bipou** — o lote
   guarda quem fez o `POST /api/coletas` (finalize), não necessariamente
   quem bipou. Se um operador inicia a sessão e outro finaliza, a sessão
   server-side tem o usuário inicial, mas o lote vai com o finalizador.
   (Hoje é "ok" porque o índice único de sessão é por usuário, então é o
   mesmo. Mas vale lembrar antes de mexer no fluxo.)

2. **`drizzle-kit push` em prod ignora o `uniqueIndex` parcial da sessão**
   (vide `AGENTS.md` — index parcial `WHERE status='ativa'`). Conferir após
   qualquer push se o índice ainda existe; senão, dois POSTs concorrentes
   podem criar duas sessões ativas.

3. **Detecção de transportadora hardcoded**: ver §4. Adicionar Loggi, Total
   Express, etc. exige mexer no enum + `detectCarrier` + UI de display.

4. **Upload de foto no finalize, não no auto-save**: ver §7. Forçar Parada
   descarta fotos. Se for crítico, mover upload pro PATCH (precisa criar
   bucket por sessão e relink no finalize).

5. **`coleta_bipagem.total` é snapshot na criação** e não é atualizado se
   alguém deletar um pacote (não há endpoint pra isso hoje). Ok porque
   bipagens são imutáveis após finalize.

6. **`processText` debounce de 5ms** (`use-coletas-bipagem.ts:99`): leitor
   industrial dispara muito rápido; 5ms é o suficiente pra agrupar mas
   imperceptível pro humano.

7. **`audio.play()` precisa de gesto do usuário** — o effect "arm audio on
   first interaction" (`page.tsx:414`) pré-aquece os elementos `<audio>`.
   Sem isso o primeiro bipe sai mudo no Chrome.

8. **Email do finalize foi removido** (TODO na linha 760 de `page.tsx`,
   2026-04-27). Hoje só envia se o operador clicar "Enviar Resumo"
   explicitamente.

9. **RLS policies dropadas por `drizzle-kit push`** — vide aviso global em
   AGENTS.md. Sempre rodar `db:generate:prod` antes pra ver o diff.

---

## 11. Telas / componentes

| Aba           | Componente                       | O que faz                                              |
|---------------|----------------------------------|---------------------------------------------------------|
| Bipagem       | `page.tsx` (inline)              | Tipo + conta + textarea + lista + ações                |
| Histórico     | `historico-view.tsx`             | Filtros, "Revisar", "Copiar IDs", "Retomar bipagem", exportar TXT |
| Configurações | `configuracoes-view.tsx`         | CRUD de catálogo SKU, kits e prefixos de transportadora |

Componentes auxiliares:

- `scan-overlay.tsx` — flash visual + ID + transportadora, sumindo em ~700ms.
  Animação suprimida no primeiro bipe pra evitar "flash de spinner" (commit
  recente `9549e85`).
- `pacote-list-item.tsx` — `React.memo`. Callback `onRemove` precisa ser
  estável (vide `handleRemovePacote` em `page.tsx:867`).

---

## 12. Onde mexer pra cada tipo de mudança

| Mudança                                              | Arquivo(s) primário(s)                                  |
|-------------------------------------------------------|----------------------------------------------------------|
| Novo tipo de coleta (ex.: TROCA)                     | enum `tipoColetaEnum` no schema + `FUNCTION_TYPES`/`FUNCTION_DISPLAY` em `types/coletas.ts` + UI no `page.tsx` |
| Nova conta de marketplace                            | enum `contaOperacaoEnum` + `OPERATIONS`/`OPERATION_DISPLAY` |
| Nova transportadora                                  | enum `transportadoraLabelEnum` + `detectCarrier` + `CARRIER_DISPLAY`/`CARRIER_COLORS` |
| Mudar regex de extração de ID                        | `extractFlexIds` / `extractShippingIds` em `coletas-utils.ts` |
| Tempo de TTL da sessão                               | `SESSAO_TTL_MS` em `api/coletas/sessao/route.ts`        |
| Debounce do auto-save                                | `800` em `page.tsx` (effect que monta `sessaoSaveTimeoutRef`) |
| Layout do romaneio HTML                              | `buildManifestHTML` em `coletas-utils.ts`                |
| Formato do TXT de devolução                          | `buildDevolucaoExportTxt` em `coletas-utils.ts`          |
| Conteúdo do email de resumo                          | `buildResumoTxt` + `enviarRelatorioColetas` em `coletas-sessao-relatorio.ts` |
| Campos de devolução                                  | `DevolucaoFormData` em `types/coletas.ts` + `devolucao-modal.tsx` + schema Zod no `POST /api/coletas` + tabelas `coleta_devolucao`/`coleta_devolucao_sku` |

---

## 13. Variáveis de ambiente

| Var                     | Onde                                | Função                                |
|-------------------------|-------------------------------------|----------------------------------------|
| `RESEND_API_KEY`        | `email/route.ts`, `sessao-relatorio.ts` | Envio de emails (opcional — sem ela, "simulated") |
| `RESEND_FROM_EMAIL`     | Idem                                | Remetente (default `noreply@resend.dev`) |
| `BLOB_READ_WRITE_TOKEN` | `@vercel/blob` em `coletas/route.ts` | Upload de fotos de devolução (opcional — sem, foto null) |

---

## 14. O que ficou pra trás (TODOs explícitos)

- **L760 em `page.tsx`** — reativar (ou não) o envio automático de email no
  finalize. Talvez condicional ao tipo, talvez toggle.
- **Histórico de tracking IDs por sessão** — hoje só lote tem registro. Se
  precisar saber "esse ID foi bipado em qual sessão e quando", não dá.
- **Migração de prefixo de transportadora → enum dinâmico** — hoje
  hardcoded JDLOG/IMILE.
