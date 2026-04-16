# Arquitetura — NWC ERP

Sistema de gestao de estoque e expedicao textil. Migrado de React SPA (localStorage) para Next.js 16 com backend completo em PostgreSQL.

## Stack

- **Framework**: Next.js 16.2.3 (App Router, Turbopack em dev)
- **Runtime**: React 19.2.4, TypeScript 5 (strict)
- **Banco**: PostgreSQL 16 (Docker dev / Neon prod) via Drizzle ORM 0.45.x
- **Auth**: Better-Auth 1.6.3 (email/password, session 7 dias)
- **UI**: Tailwind v4 (dark-only), 54 componentes shadcn/ui, Radix UI, lucide-react, sonner
- **Integracoes**: Resend (email), @vercel/blob (upload de fotos), pdf-lib + pdfjs-dist (PDFs), xlsx (planilhas), jsqr (QR/barcode), qrcode.react (geracao QR)
- **Formularios**: react-hook-form + zod 4.x
- **Porta de dev**: 3009

## Visao geral

```
┌───────────────────────────────────────────┐
│  Browser (React 19 client)                │
│  "use client" em todas paginas            │
└──────────────┬────────────────────────────┘
               │ fetch()
               ▼
┌───────────────────────────────────────────┐
│  Next.js 16 App Router                    │
│  ├─ (auth)/login          publica         │
│  ├─ (dashboard)/*         gated no layout │
│  └─ api/*                 auth por rota   │
└──────────────┬────────────────────────────┘
               │ Drizzle
               ▼
┌───────────────────────────────────────────┐
│  PostgreSQL (Docker dev / Neon prod)      │
│  25 tabelas + 6 enums                     │
└───────────────────────────────────────────┘
```

### Route groups

- `src/app/(auth)/` — rotas publicas (apenas `/login`)
- `src/app/(dashboard)/` — rotas protegidas; o `layout.tsx` verifica `useSession()` e bloqueia render se nao autenticado
- `src/app/api/` — endpoints REST; cada rota faz `auth.api.getSession({ headers })` no inicio

Nao existe `middleware.ts` na raiz — a protecao e por layout (client) + checagem em cada handler de API.

## Estrutura de diretorios

```
src/
├── app/
│   ├── (auth)/
│   │   └── login/page.tsx            Form de login + usuarios demo
│   ├── (dashboard)/
│   │   ├── layout.tsx                Sidebar + gate de sessao + restricoes por email
│   │   ├── page.tsx                  Dashboard home com menu em grid
│   │   ├── coletas/                  Bipagem de pacotes (FLEX/COLETA/DEVOLUCAO/CANCELADO)
│   │   ├── contagem/                 Contagem em 3 modos (bipagem/manuseavel/embalado)
│   │   ├── cadastro/                 Gerar etiquetas QR
│   │   ├── estante-virtual/          Gestao de estantes + fardos + movimentacoes
│   │   ├── alteracao-estoque/        Transferencias entre SKUs
│   │   ├── produtos-avariados/       Registro de avarias
│   │   ├── associar-etiquetas/       Vincular etiquetas a SKUs (planilha/scanner/ZPL)
│   │   ├── verificador-etiquetas/    Verificacao de etiquetas
│   │   ├── gestao-custos-textil/     Calculadora de custos de producao
│   │   ├── criar-qr-code/            Gerador de QR (fardos/embalados/kits)
│   │   ├── kit-organizer/            Reorganiza PDFs detectando KITs
│   │   ├── processador-anuncios/     Processa planilhas ML em lote
│   │   └── recuperar-dados/          Exportacao de dados de localStorage
│   └── api/                          31 endpoints REST agrupados em 10 dominios
├── components/
│   ├── layout/                       page-header.tsx, header.tsx (mobile)
│   ├── ui/                           54 componentes shadcn/ui
│   ├── shared/                       camera-scanner.tsx (QR via jsqr)
│   ├── coletas/                      6 componentes especificos
│   ├── associar-etiquetas/           4 componentes (planilha, scanner, ZPL, lista)
│   └── estante-virtual/              5 componentes (modais, fardos, historico)
├── hooks/
│   ├── use-coletas-bipagem.ts        Logica de bipagem (dedup, autoclear, extrator de IDs)
│   ├── use-composition.ts
│   ├── use-mobile.tsx
│   └── use-persist-fn.ts
├── lib/
│   ├── auth.ts                       Setup do Better-Auth
│   ├── auth-client.ts                Cliente React do Better-Auth (useSession, signIn, signOut)
│   ├── db/
│   │   ├── index.ts                  Conexao postgres + drizzle
│   │   ├── schema.ts                 Fonte da verdade: 25 tabelas + 6 enums + relations
│   │   └── seed.ts                   Usuarios demo
│   ├── utils.ts                      cn(), generateId(), formatDate()
│   ├── coletas-utils.ts              Deteccao de transportadora, extracao de IDs, explode kits
│   ├── etiquetas-utils.ts            Parser de planilhas (export_order / lista_empacotamento)
│   ├── estante-utils.ts              Parser QR/import, helpers de tamanho de SKU
│   └── stock-transfer-utils.ts       Relatorios de alteracao de estoque
└── types/
    └── coletas.ts                    Tipos compartilhados da feature Coletas
```

## Banco de dados

Schema em `src/lib/db/schema.ts`. 25 tabelas + 6 enums `pgEnum`. IDs sao strings (`text`) geradas por `crypto.randomUUID()` via `generateId()` de `src/lib/utils.ts`.

### Enums

| Enum | Valores |
|---|---|
| `userRoleEnum` | `admin`, `funcionario` |
| `tipoColetaEnum` | `FLEX`, `COLETA`, `DEVOLUCAO`, `CANCELADO` |
| `contaOperacaoEnum` | `TIKTOK_SHOP`, `MERCADO_LIVRE`, `SHOPEE` |
| `transportadoraLabelEnum` | `TTK_JDLOG`, `TTK_IMILE`, `ML`, `SHP`, `DESCONHECIDA` |
| `tipoMovimentacaoEnum` | `ENTRADA`, `SAIDA`, `BIPAGEM_SEMANAL`, `IMPORTACAO`, `BALANCO` |
| `localizacaoAvariaEnum` | `DEVOLUCAO`, `ESTANTE`, `LOTE_DE_COSTURA` |

### Tabelas por dominio

**Autenticacao (Better-Auth)**
| Tabela | Proposito |
|---|---|
| `user` | Usuarios (id, name, email, role, emailVerified, image, timestamps) |
| `session` | Sessoes ativas (token, expiresAt, userId, ip, userAgent) |
| `account` | Credenciais (providerId, accessToken, refreshToken, password) |
| `verification` | Tokens de verificacao de email |

**Referencia**
| Tabela | Proposito |
|---|---|
| `skuCatalogo` | Catalogo de SKUs (codigo unico) |
| `skuKitRegra` | Regras de expansao de kit (1 kitSku -> N componentes) |
| `skuKitComponente` | Componentes de um kit (sku, quantidade, kitRegraId) |
| `loteCadastrado` | Nomes de lotes cadastrados (unique) |
| `transportadoraPadrao` | Regex/prefixos de deteccao de transportadora |

**Stock & Cadastro**
| Tabela | Proposito |
|---|---|
| `stockItem` | Itens de estoque cadastrados via `/cadastro` |

**Contagem**
| Tabela | Proposito |
|---|---|
| `contagemBipagem` | Bipagens de fardos (sku, lote, quantidade, raw) |
| `contagemManuseavel` | Contagem manual por SKU (upsert) |
| `contagemEmbalado` | Itens ja embalados via QR |

**Coletas (bipagem de pacotes)**
| Tabela | Proposito |
|---|---|
| `coletaBipagem` | Sessao de bipagem (tipo, conta, total, revisado) |
| `coletaBipagemPacote` | Pacotes da sessao (codigo, transportadora) |
| `coletaDevolucao` | Dados de devolucao por pacote (operacao, avaria, fotos) |
| `coletaDevolucaoSku` | SKUs da devolucao (sku, quantidade) |
| `coletaBipagemTemporaria` | Rascunho da sessao em andamento (JSON com pacotes + devolucoes) |

**Alteracao de estoque**
| Tabela | Proposito |
|---|---|
| `alteracaoEstoque` | Transferencia saidas -> entradas (JSON), codigoPacote, revisado |

**Produtos avariados**
| Tabela | Proposito |
|---|---|
| `produtoAvariado` | Registros de avaria (sku, localizacao, codigoFardo quando LOTE_DE_COSTURA) |

**Estante virtual**
| Tabela | Proposito |
|---|---|
| `estante` | Estante virtual (nome, descricao, ultimaBipagem) |
| `estanteFardo` | Fardos na estante (qrCode, sku, lote, quantidade) |
| `estanteMovimentacao` | Historico (ENTRADA/SAIDA/BIPAGEM_SEMANAL/IMPORTACAO/BALANCO) |

**Etiquetas**
| Tabela | Proposito |
|---|---|
| `etiquetaAssociacao` | Vinculo etiqueta -> sku + quantidade |

**Textil**
| Tabela | Proposito |
|---|---|
| `textilLote` | Lote textil com 13+ campos de entrada e `resultados` JSON calculado |

### Relations

Tipadas via `relations()` do Drizzle:
- `user` -> `coletaBipagem`, `alteracaoEstoque`, `estante`, `produtoAvariado`, `stockItem`
- `skuKitRegra` -> `skuKitComponente` (1:N)
- `coletaBipagem` -> `user`, `coletaBipagemPacote` (1:N)
- `coletaBipagemPacote` -> `coletaDevolucao` (1:1)
- `coletaDevolucao` -> `coletaDevolucaoSku` (1:N)
- `estante` -> `user`, `estanteFardo` (1:N), `estanteMovimentacao` (1:N)

## Fluxo de autenticacao

```
Usuario -> /login (form email/senha)
        -> signIn.email() do auth-client
        -> POST /api/auth/[...all]  (delegado ao Better-Auth)
        -> cookie de sessao (7 dias, renova a cada 24h)
        -> redirect para /

(dashboard)/layout.tsx:
  const { data: session, isPending } = useSession()
  if (isPending) spinner
  if (!session) spinner (navegacao bloqueada)
  else render children

Cada API route:
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) return 401 "Nao autorizado"
  ... continua
```

Config em `src/lib/auth.ts` (7 dias, secret via env, basePath `/api/auth`). Cliente em `src/lib/auth-client.ts` exporta `useSession`, `signIn`, `signOut`, `signUp`.

## Padrao de API routes

Cada arquivo `src/app/api/**/route.ts` segue esta ordem:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { tabela } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";

const bodySchema = z.object({ /* ... */ });

export async function POST(request: NextRequest) {
  try {
    // 1. Auth
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

    // 2. Validacao
    const body = await request.json();
    const data = bodySchema.parse(body);

    // 3. Query (opcionalmente em transacao)
    const id = generateId();
    await db.insert(tabela).values({ id, ...data, usuarioId: session.user.id });

    // 4. Response
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: "Dados invalidos", details: error.issues }, { status: 400 });
    }
    console.error(error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
```

### Convencoes

- Status: `200` (ok), `201` (created), `400` (validacao), `401` (sem sessao), `403` (sem permissao), `404` (nao encontrado), `409` (unique conflict), `500` (erro interno)
- Mensagens de erro em portugues ("Nao autorizado", "Dados invalidos", "Nao encontrado")
- IDs gerados com `generateId()` de `@/lib/utils` (crypto.randomUUID)
- Transacoes com `db.transaction(async (tx) => { ... })` em insercoes multi-tabela (ex.: coleta + pacotes + devolucoes)
- Next.js 16 async params: `{ params }: { params: Promise<{ id: string }> }` — sempre `await params`

## Padrao de paginas

Todas as paginas do dashboard sao client components:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/auth-client";
import { PageHeader } from "@/components/layout/page-header";
import { toast } from "sonner";

export default function MinhaPage() {
  const { data: session } = useSession();
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    fetch("/api/items")
      .then((r) => r.json())
      .then((d) => setItems(d.items))
      .catch(() => toast.error("Erro ao carregar"));
  }, []);

  return (
    <>
      <PageHeader title="Minha pagina" description="..." />
      {/* render */}
    </>
  );
}
```

### O que NAO usar

- `React Query`, `SWR`, `Zustand`, `Redux` — apenas `useState` + `fetch()`
- Server Actions — tudo via API routes REST
- `localStorage` para persistencia de dados — sempre via API (excecao: `sessionStorage` para preferencias UI como `stockflow_modo_livre` ou `textil_lotes` legado)

## Componentes compartilhados

### `src/components/layout/`

- **`page-header.tsx`** — cabecalho padrao (`title`, `description`). Usar em toda pagina.
- **`header.tsx`** — `MobileHeader` com toggle de menu e modo-livre (usado em `(dashboard)/layout.tsx`).

### `src/components/shared/`

- **`camera-scanner.tsx`** — scanner QR/barcode via `jsqr`, usado em coletas, estante-virtual e associar-etiquetas.

### `src/components/ui/` (54 componentes shadcn)

accordion, alert-dialog, alert, aspect-ratio, avatar, badge, breadcrumb, button, button-group, calendar, card, carousel, chart, checkbox, collapsible, command, context-menu, dialog, drawer, dropdown-menu, empty, field, form, form-elements, hover-card, input, input-group, input-otp, item, kbd, label, menubar, navigation-menu, popover, progress, radio-group, scroll-area, select, separator, sheet, skeleton, slider, sonner, switch, table, tabs, textarea, toggle, toggle-group, tooltip.

Gerenciados via `components.json` (style `new-york`, baseColor `neutral`). Nao editar a mao — usar `npx shadcn add <comp>` para acrescentar.

### Features com componentes dedicados

- **`coletas/`**: `configuracoes-view`, `continuar-view`, `devolucao-modal`, `historico-view`, `pacote-list-item`, `scan-overlay`
- **`associar-etiquetas/`**: `lista-associacoes`, `scanner-input`, `upload-planilha`, `upload-zpl`
- **`estante-virtual/`**: `fardos-agrupados`, `historico-view`, `modal-criar`, `modal-importar`, `modal-scanner`

## Utilitarios

### `src/lib/utils.ts`

- `cn(...inputs)` — merge de classes Tailwind (`clsx` + `twMerge`)
- `generateId()` — `crypto.randomUUID()`
- `formatDate(date)` — pt-BR locale (DD/MM/YYYY HH:MM)

### `src/lib/coletas-utils.ts`

- `detectCarrier(code, patterns)` — detecta transportadora (ML, SHP, TTK_JDLOG, TTK_IMILE, DESCONHECIDA) via regex/prefixo
- `extractFlexIds(text)` — extrai IDs FLEX no padrao `\^id\^Ç\^(\d{11})\^`
- `extractShippingIds(text)` — extrai tracking ML (`4\d{10}`), SHP (`BR\d{12,13}[A-Z]?`), TTK (`\d{13,14}`)
- `explodeSkuLines(lines, kitRules)` — expande linhas de SKU de kit em componentes
- `sumSkuLines(lines)` — deduplica e soma quantidades por SKU
- `buildManifestHTML(ids, accountName, functionType, devolucoesData)` — gera romaneio HTML imprimivel (1-4 colunas dinamicas)
- `buildDevolucaoExportTxt(ids, devolucoesData, kitRules, filterOperacao)` — TXT para upload em Upseller

### `src/lib/etiquetas-utils.ts`

- `detectAndParseSpreadsheet(data)` — auto-detecta formato (`export_order` ou `lista_empacotamento`) pelos headers
- `parseListaEmpacotamento(data)` — parser Shopee (tracking + SKU reference + quantity)
- `parseExportOrder(data)` — parser coluna A (ID), AD (SKU), AH (qtd)
- Tipos: `PlanilhaItem`, `FormatoPlanilha`, `ParsedSpreadsheetResult`, `EtiquetaAssociadaLocal`

### `src/lib/estante-utils.ts`

- `parseQRCode(raw)` — decodifica `SKU|LOTE|QTD` ou `SKU|QTD|LOTE`
- `parseImportText(text)` — extrai fardos de texto com timestamp
- `SIZES`, `extractSize(sku)`, `replaceSize(sku, novo)`, `parseSKUParts(sku)` — helpers de tamanho
- `compareSKU(a, b)` — ordena SKUs por produto (CJ, LUA, NBA, SOL, PUFFER) -> cor -> tamanho
- `isThisWeek(ts)` — checa se timestamp esta nos ultimos 7 dias

### `src/lib/stock-transfer-utils.ts`

- `AlteracaoEstoqueRecord` — tipo compartilhado
- `formatItens(itens)` — formata lista como `"SKU (QTD), SKU (QTD)"`
- `filterByDate(registros, filtros)` — filtra por `dataInicio`/`dataFim`
- `gerarRelatorioGeral(registros, filtros)` — relatorio TXT tabular

## Hooks customizados

### `src/hooks/use-coletas-bipagem.ts`

Nucleo da logica de bipagem na pagina `/coletas`. Gerencia:

- Estado: `ids`, `devolucoesData`, `currentFunction`, `currentAccount`, `inputValue`, `statusMsg`, `statusType`, `dedup`, `autoClear`
- Config carregada pelo parent: `carrierPatterns`, `kitRules`, `skuCatalog`
- Metodos: `processText`, `handleInput`, `addId`, `removeId`, `clear`, `setDevolucao`, `removeDevolucao`, `loadFromTemp`
- Suporta FLEX (extrai por regex) e outras operacoes (tracking por transportadora), com dedup opcional e autoclear do input

### Outros

- `use-mobile.tsx` — detecta viewport mobile
- `use-composition.ts` — helpers de composicao de layout
- `use-persist-fn.ts` — estabiliza referencia de funcoes (similar a `useEventCallback`)
