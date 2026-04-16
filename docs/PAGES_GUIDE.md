# Guia de Paginas — NWC ERP

15 paginas (14 do dashboard + 1 de login). Todas client-side (`"use client"`). O layout `(dashboard)/layout.tsx` gate a sessao e monta a sidebar.

## Indice

| Rota | Nome | Grupo | Complexidade |
|---|---|---|---|
| `/login` | Login | auth | Simples |
| `/` | Dashboard Home | dashboard | Simples |
| `/coletas` | Coletas (Bipagem) | Expedicao | Alta |
| `/contagem` | Contagem de Estoque | Expedicao | Alta |
| `/cadastro` | Cadastrar QR | Expedicao | Alta |
| `/estante-virtual` | Estante Virtual | Expedicao | Alta |
| `/alteracao-estoque` | Alteracao de Estoque | Expedicao | Alta |
| `/produtos-avariados` | Produtos com Avarias | Expedicao | Simples |
| `/associar-etiquetas` | Associar Etiquetas | Outros | Alta |
| `/verificador-etiquetas` | Verificador de Etiquetas | Outros | Media |
| `/gestao-custos-textil` | Gestao de Custos Texteis | Outros | Alta |
| `/criar-qr-code` | QR Code Personalizado (restrito) | Outros | Media |
| `/kit-organizer` | Organizador de Etiquetas (restrito) | Outros | Alta |
| `/processador-anuncios` | Editar Estoque ML (restrito) | Outros | Media |
| `/recuperar-dados` | Recuperar Dados | Outros | Simples |

**Restrito** = `beatriz@nwc.com` nao tem acesso (filtrado em `(dashboard)/layout.tsx` via `restrictedPages`).

---

## `/login` — Autenticacao

Arquivo: `src/app/(auth)/login/page.tsx` (~150 linhas)

Form de login com email/senha e atalhos para 6 usuarios demo. Autenticacao via `signIn.email()` do `auth-client`. Redireciona para `/` em caso de sucesso.

- **Features**: preenchimento rapido com credenciais demo, loading state, toast de feedback
- **Componentes**: Button, Card, Input, Label
- **Auth**: `signIn.email()` do `@/lib/auth-client`
- **Redirect**: `useRouter().push("/")`

---

## `/` — Dashboard Home

Arquivo: `src/app/(dashboard)/page.tsx` (~180 linhas)

Landing com grid de atalhos para as principais funcionalidades + status do sistema.

- **Features**: menu em grid, restricao visual por email (Beatriz), card de status, placeholder de atividade recente
- **Componentes**: Card, icones lucide
- **Hooks**: `useSession`
- **API**: nenhuma

---

## `/coletas` — Bipagem de Pacotes

Arquivo: `src/app/(dashboard)/coletas/page.tsx` (~1.140 linhas)

Sistema completo de bipagem de pacotes por operacao (TikTok Shop / Mercado Livre / Shopee) e tipo (FLEX / COLETA / DEVOLUCAO / CANCELADO). Suporta modal de devolucao com foto, historico, continuar rascunho e configuracoes de kits/transportadoras.

- **Features**:
  - 4 visualizacoes: Bipagem, Historico, Continuar, Configuracoes
  - Scanner com feedback sonoro (sucesso/erro)
  - Modal de devolucao (SKU + avaria + fotos base64)
  - Exportacao de manifesto (HTML imprimivel) e TXT para Upseller
  - Envio por email via Resend
  - Config dinamica de transportadoras e regras de kit
  - Rascunho (temporaria) para retomar depois
- **Componentes**: PageHeader, Button, Card, Textarea, Dialog, `ScanOverlay`, `DevolucaoModal`, `HistoricoView`, `ContinuarView`, `ConfiguracoesView`
- **Hooks**: `useColetasBipagem`
- **API**: `/api/coletas`, `/api/coletas/[id]`, `/api/coletas/temporarias`, `/api/coletas/email`, `/api/coletas/configuracoes/kit-rules`, `/api/coletas/configuracoes/transportadoras`, `/api/sku-catalogo`

---

## `/contagem` — Contagem de Estoque

Arquivo: `src/app/(dashboard)/contagem/page.tsx` (~1.382 linhas)

Contagem em 3 abas: bipagem de fardos (QR `SKU|LOTE|QTD`), manuseavel (upsert por SKU) e embalado (QR). Gera relatorio em TXT.

- **Features**:
  - 3 abas independentes
  - Modo fullscreen para contagem focada
  - Autocomplete de SKUs
  - Relatorio TXT com multiplas formatacoes
  - Feedback sonoro
- **Componentes**: PageHeader, Button, Card, Input, Table, Dialog
- **API**: `/api/contagem/bipagem`, `/api/contagem/manuseavel`, `/api/contagem/embalados`, `/api/sku-catalogo`

---

## `/cadastro` — Cadastrar QR

Arquivo: `src/app/(dashboard)/cadastro/page.tsx` (~940 linhas)

Geracao de etiquetas QR para fardos. Suporta modo individual e fardo agrupado (1 QR grande por pagina).

- **Features**:
  - Selecao por produto (LUA, SOL, PUFFER, NBA, CJ) + cor + tamanho
  - Criacao de lotes
  - Importacao de TXT com preview
  - QR com logo embutido
  - Fila de impressao paginada
- **Componentes**: PageHeader, Button, Card, Input, Dialog, Switch, QRCodeSVG
- **API**: `/api/lotes`, `/api/stock-items`

---

## `/estante-virtual` — Estante Virtual

Arquivo: `src/app/(dashboard)/estante-virtual/page.tsx` (~680 linhas)

Gestao de estantes fisicas com fardos. Scanner para adicionar/retirar, bipagem semanal, balanco, importacao.

- **Features**:
  - 3 visualizacoes: lista, detalhe, historico
  - Agrupamento de fardos por SKU (expand/collapse)
  - Bipagem semanal com verificacao de data
  - Importacao de balanco via TXT
  - Download de relatorio CSV
- **Componentes**: PageHeader, Button, Card, `ModalCriar`, `ModalImportar`, `ModalScanner`, `FardosAgrupados`, `HistoricoView`
- **API**: `/api/estantes`, `/api/estantes/[id]`, `/api/estantes/[id]/fardos`, `/api/estantes/[id]/bipagem`, `/api/estantes/[id]/balanco`, `/api/estantes/movimentacoes`

---

## `/alteracao-estoque` — Alteracao de Estoque

Arquivo: `src/app/(dashboard)/alteracao-estoque/page.tsx` (~812 linhas)

Transferencias entre SKUs (tipicamente troca de tamanho). Mantem historico com filtros, selecao em lote e marcacao de revisao.

- **Features**:
  - Dialog de alteracao rapida com seletor de tamanho
  - Historico com filtros (data, status revisado/pendente)
  - Selecao em lote + bulk revisar
  - Exportacao de relatorio (geral, resumido, saidas, entradas)
  - Popup para Upseller
- **Componentes**: PageHeader, Button, Card, Input, Label, Dialog
- **API**: `/api/alteracoes-estoque`, `/api/alteracoes-estoque/[id]`, `/api/alteracoes-estoque/[id]/revisar`, `/api/alteracoes-estoque/bulk-revisar`, `/api/sku-catalogo`

---

## `/produtos-avariados` — Produtos com Avarias

Arquivo: `src/app/(dashboard)/produtos-avariados/page.tsx` (~370 linhas)

Registro simples de produtos com avarias. Campo `codigoFardo` condicional (apenas quando localizacao = `LOTE_DE_COSTURA`).

- **Features**:
  - Form com autocomplete de SKU
  - Historico com toggle de visibilidade
  - Delete individual
- **Componentes**: PageHeader, Button, Card, Input, Label, Textarea
- **API**: `/api/produtos-avariados`, `/api/produtos-avariados/[id]`, `/api/sku-catalogo`

---

## `/associar-etiquetas` — Associar Etiquetas

Arquivo: `src/app/(dashboard)/associar-etiquetas/page.tsx` (~627 linhas)

Vincular etiquetas de pedidos a SKUs. Suporta upload de planilha (XLSX com auto-deteccao de formato), scanner e upload de ZPL.

- **Features**:
  - Upload XLSX (auto-deteccao Lista Empacotamento ou Export Order)
  - Scanner com processamento de bipes
  - Upload ZPL + geracao de PDF a partir do template
  - Exportacao CSV / clipboard
  - Bulk delete
- **Componentes**: PageHeader, Card, Button, `UploadPlanilha`, `UploadZpl`, `ScannerInput`, `ListaAssociacoes`
- **API**: `/api/etiquetas`, `/api/etiquetas/[id]`, `/api/etiquetas/bulk-delete`

---

## `/verificador-etiquetas` — Verificador de Etiquetas

Arquivo: `src/app/(dashboard)/verificador-etiquetas/page.tsx`

Verificacao de integridade das etiquetas cadastradas. Le associacoes e checa consistencia.

- **Componentes**: PageHeader, Card, Input
- **API**: `/api/etiquetas`

---

## `/gestao-custos-textil` — Gestao de Custos Texteis

Arquivo: `src/app/(dashboard)/gestao-custos-textil/page.tsx` (~670 linhas)

Calculadora de custo por peca (rolo, risco, corte, costura, aviamentos, margem). Computa 12+ metricas e sugere preco de venda.

- **Features**:
  - Formulario com 13 campos de entrada
  - Validacao completa com mensagens em portugues
  - Modal de detalhe por lote salvo
  - Persistencia em `localStorage` (`textil_lotes`) — migracao para tabela `textilLote` do BD esta planejada
  - Formatacao pt-BR (virgula decimal)
- **Componentes**: PageHeader, Button, Card, Input, Label, Dialog
- **API**: nenhuma (calculo local)

---

## `/criar-qr-code` — QR Code Personalizado (restrito)

Arquivo: `src/app/(dashboard)/criar-qr-code/page.tsx` (~730 linhas)

Gerador de QR Codes em 3 abas: Fardos (texto livre), Embalados (SKU + qtd), Kits (referencia catalogo).

- **Features**:
  - QR com logo embutido (qrcode.react)
  - Impressao HTML nativa
  - Download PNG via canvas
- **Componentes**: PageHeader, Button, Card, Input, Label, QRCodeSVG
- **API**: nenhuma (le SKUs de localStorage do modulo Coletas)
- **Acesso**: restrito (Beatriz nao ve)

---

## `/kit-organizer` — Organizador de Etiquetas (restrito)

Arquivo: `src/app/(dashboard)/kit-organizer/page.tsx` (~775 linhas)

Reorganizador de PDF de etiquetas: detecta paginas com quantidade > 1 (KITs), move para o inicio e marca visualmente.

- **Features**:
  - Drag & drop de PDF
  - Analise de conteudo da pagina (busca "Declaracao de Conteudo")
  - Parsing inteligente LUA/SOL
  - Marcacao com quadrado preto + icone
  - Adicao de "ATENCAO" com imagens de manga
  - Barra de progresso
- **Componentes**: PageHeader, Button, Card, Progress
- **API**: nenhuma (processa local com pdf-lib + pdfjs-dist)
- **Acesso**: restrito

---

## `/processador-anuncios` — Editar Estoque ML (restrito)

Arquivo: `src/app/(dashboard)/processador-anuncios/page.tsx` (~582 linhas)

Processamento em lote de planilhas Mercado Livre: filtra por SKU/cor/kit e aplica regras de estoque/prazo.

- **Features**:
  - Upload XLSX
  - Filtros por SKU, cores, tipo de kit
  - Zerar estoque seletivo / adicionar se zerado
  - Alterar prazo de fabricacao
  - Download planilha atualizada + relatorio TXT
- **Componentes**: PageHeader, Button, Card, Input, Label, Checkbox
- **API**: nenhuma (processa local com xlsx)
- **Acesso**: restrito

---

## `/recuperar-dados` — Recuperar Dados

Arquivo: `src/app/(dashboard)/recuperar-dados/page.tsx` (~305 linhas)

Ferramenta de transicao: exporta dados salvos no localStorage (de versoes anteriores do app) em TXT.

- **Features**:
  - Le `coletas_ids` e `stockflow_scanned_items` do localStorage
  - Exporta em TXT / clipboard
  - Info sobre a migracao para BD
- **Componentes**: PageHeader, Button, Card
- **API**: nenhuma
