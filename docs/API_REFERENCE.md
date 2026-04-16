# API Reference — NWC ERP

31 endpoints REST em `src/app/api/`. Todos exigem sessao valida do Better-Auth via `auth.api.getSession({ headers })`. Erros retornam JSON no formato `{ error: string, details?: unknown }` em portugues.

## Convencoes

- **Status codes**: `200` ok, `201` created, `400` validacao (Zod), `401` sem sessao, `403` sem permissao, `404` nao encontrado, `409` conflito (unique), `500` erro interno
- **IDs**: strings geradas por `generateId()` (crypto.randomUUID)
- **Path params** em Next.js 16: `{ params }: { params: Promise<{ id: string }> }` — sempre `await params`
- **`[transaction]`** indica uso de `db.transaction(async (tx) => {...})`

---

## Auth

### `ALL /api/auth/[...all]`
Catch-all delegado ao Better-Auth. Endpoints padrao: `sign-in/email`, `sign-up/email`, `sign-out`, `get-session`.

**Response**: conforme Better-Auth.  
**Status**: 200, 401.

---

## Coletas

### `GET /api/coletas`
Lista bipagens com filtros e paginacao.

**Query params**:
- `dataInicio?`, `dataFim?` — ISO date
- `tipo?` — `FLEX | COLETA | DEVOLUCAO | CANCELADO`
- `conta?` — `TIKTOK_SHOP | MERCADO_LIVRE | SHOPEE`
- `revisado?` — `todos | revisados | pendentes` (default `todos`)
- `limit?` — max 200, default 50
- `offset?` — default 0

**Response**: `{ bipagens: Bipagem[], total: number }`  
**Status**: 200, 401, 500

### `POST /api/coletas` `[transaction]`
Cria sessao de bipagem com pacotes e devolucoes. Uploads de foto em base64 vao para Vercel Blob.

**Body**:
```ts
{
  tipo: "FLEX" | "COLETA" | "DEVOLUCAO" | "CANCELADO",
  conta: "TIKTOK_SHOP" | "MERCADO_LIVRE" | "SHOPEE",
  pacotes: { codigo: string, transportadora?: string }[], // min 1
  devolucoes?: {
    [codigoPacote]: {
      skuLines: { sku: string, qtd: number }[],
      operacao: ContaOperacao,
      avaria: boolean,
      obs?: string,
      tipo: TipoColeta,
      fotoPacoteBase64?: string,
      fotoAvariaBase64?: string
    }
  }
}
```
**Response**: `{ id: string }` (201)  
**Status**: 201, 400, 401, 500

### `GET /api/coletas/[id]`
Detalhes da bipagem com pacotes e devolucoes aninhados.

**Response**:
```ts
{
  id, tipo, conta, total, revisado, revisadoPor, revisadoPorNome,
  revisadoEm, usuarioId, usuarioNome, createdAt,
  pacotes: Array<Pacote & { devolucao?: Devolucao & { skuLines: SkuLine[] } }>
}
```
**Status**: 200, 401, 404, 500

### `PUT /api/coletas/[id]`
Marca a bipagem como revisada.

**Response**: `{ success: true }`  
**Status**: 200, 401, 500

### `GET /api/coletas/temporarias`
Lista rascunhos do usuario autenticado.

**Response**: `{ temporarias: Temporaria[] }`  
**Status**: 200, 401, 500

### `POST /api/coletas/temporarias`
Salva rascunho de sessao em andamento.

**Body**:
```ts
{
  tipo: TipoColeta,
  conta: ContaOperacao,
  total: number,
  dados: { pacotes: [...], devolucoes: {...} }
}
```
**Response**: `{ id: string }` (201)  
**Status**: 201, 400, 401, 500

### `DELETE /api/coletas/temporarias/[id]`
Remove rascunho (apenas do proprio usuario).

**Response**: `{ success: true }`  
**Status**: 200, 401, 403, 404, 500

### `POST /api/coletas/email`
Envia manifesto por email via Resend. Simula quando `RESEND_API_KEY` nao esta configurada.

**Body**: `{ ids: string[], conta: string, tipo: string, para?: string }`  
**Response**: `{ success: true, simulated?: boolean }`  
**Status**: 200, 400, 401, 500

### `GET /api/coletas/configuracoes/kit-rules`
Lista regras de expansao de kit.

**Response**: `{ kitRules: Array<{ id, kitSku, createdAt, components: { id, sku, quantidade }[] }> }`

### `POST /api/coletas/configuracoes/kit-rules` `[transaction]`
Cria regra de kit + componentes.

**Body**: `{ kitSku: string, components: { sku: string, quantidade: number }[] }` (min 1 componente)  
**Response**: regra completa com componentes (201)

### `DELETE /api/coletas/configuracoes/kit-rules`
Remove regra.

**Body**: `{ id: string }`  
**Response**: `{ success: true }`

### `GET /api/coletas/configuracoes/transportadoras`
Lista padroes de deteccao de transportadora.

**Response**: `{ transportadoras: Array<{ id, transportadora, prefixos, createdAt }> }`

### `POST /api/coletas/configuracoes/transportadoras`
Upsert de padrao (por `transportadora` como chave).

**Body**: `{ transportadora: string, prefixos: string[] }`  
**Response**: registro salvo (200 update / 201 create)

### `DELETE /api/coletas/configuracoes/transportadoras`
Remove padrao.

**Body**: `{ id: string }`  
**Response**: `{ success: true }`

---

## Alteracoes de estoque

### `GET /api/alteracoes-estoque`
Lista alteracoes com filtros.

**Query params**: `dataInicio?`, `dataFim?`, `revisado? = todos|revisados|pendentes`, `limit? (max 200, default 50)`, `offset? (default 0)`  
**Response**: `{ registros: Alteracao[], total: number }`

### `POST /api/alteracoes-estoque`
Registra alteracao. Valida que `sum(saidas.quantidade) === sum(entradas.quantidade)`.

**Body**:
```ts
{
  saidas: { sku: string, quantidade: number }[], // min 1
  entradas: { sku: string, quantidade: number }[], // min 1
  codigoPacote: string
}
```
**Response**: registro criado (201)  
**Status**: 201, 400 (desbalanceada), 401, 500

### `DELETE /api/alteracoes-estoque/[id]`
Remove registro.

**Response**: `{ success: true }`

### `PUT /api/alteracoes-estoque/[id]/revisar`
Marca uma alteracao como revisada.

**Response**: `{ success: true }`

### `PUT /api/alteracoes-estoque/bulk-revisar`
Marca varias alteracoes como revisadas.

**Body**: `{ ids: string[] }` (min 1, max 100)  
**Response**: `{ success: true, count: number }`

---

## Contagem

### `GET /api/contagem/bipagem`
Lista contagens de bipagem.

**Response**: `{ items: Array<{ id, sku, lote, quantidade, raw, createdAt }> }`

### `POST /api/contagem/bipagem`
Registra item de bipagem.

**Body**: `{ sku: string, lote: string, quantidade: number, raw: string }`  
**Response**: item criado (201)

### `DELETE /api/contagem/bipagem`
Deleta varios.

**Body**: `{ ids: string[] }` (min 1)  
**Response**: `{ deleted: number }`

### `GET /api/contagem/manuseavel`
Lista contagens manuseaveis.

**Response**: `{ items: Array<{ id, sku, quantidade, createdAt, updatedAt }> }`

### `PUT /api/contagem/manuseavel`
Upsert de contagem manuseavel por SKU.

**Body**: `{ sku: string, quantidade: number }` (qtd >= 0)  
**Response**: `{ ok: true }`

### `GET /api/contagem/embalados`
Lista embalados.

**Response**: `{ items: Array<{ id, sku, quantidade, createdAt }> }`

### `POST /api/contagem/embalados`
Registra embalado.

**Body**: `{ sku: string, quantidade: number }`  
**Response**: item criado (201)

### `DELETE /api/contagem/embalados`
Deleta varios.

**Body**: `{ ids: string[] }`  
**Response**: `{ deleted: number }`

---

## Estantes

### `GET /api/estantes`
Lista estantes com stats agregadas (fardoCount, totalPecas, topSkus).

**Response**: `{ estantes: Array<Estante & { fardoCount, totalPecas, topSkus: string[] }> }`

### `POST /api/estantes`
Cria estante (nome uppercase, unique check).

**Body**: `{ nome: string (max 100), descricao?: string (max 500) }`  
**Response**: estante criada (201)

### `GET /api/estantes/[id]`
Estante + fardos ordenados.

**Response**: `{ estante: {...}, fardos: Fardo[] }`  
**Status**: 200, 401, 404, 500

### `DELETE /api/estantes/[id]`
Remove estante (cascade em fardos e movimentacoes).

**Response**: `{ success: true }`

### `POST /api/estantes/[id]/fardos` `[transaction]`
Adiciona fardos + registra ENTRADA (ou IMPORTACAO quando batch).

**Body**: `{ fardos: { qrCode, sku, lote, quantidade }[] }` (min 1)  
**Response**: `{ added: number }` (201)

### `DELETE /api/estantes/[id]/fardos/[fardoId]` `[transaction]`
Remove fardo e registra SAIDA.

**Response**: `{ success: true }`

### `POST /api/estantes/[id]/bipagem` `[transaction]`
Confirma bipagem semanal e registra movimentacao BIPAGEM_SEMANAL.

**Body**: `{ scannedCount: number }`  
**Response**: `{ success: true, ultimaBipagem: string }`

### `POST /api/estantes/[id]/balanco` `[transaction]`
Registra balanco com snapshot do total atual.

**Response**: `{ success: true, totalFardos: number, totalPecas: number }`

### `GET /api/estantes/movimentacoes`
Lista movimentacoes de todas as estantes.

**Query params**: `tipo?`, `data?` (ISO filtra por dia), `limit?` (max 1000, default 200)  
**Response**: `{ movimentacoes: Array<Movimentacao & { usuarioNome }> }`

---

## Etiquetas

### `GET /api/etiquetas`
Lista todas associacoes etiqueta -> SKU.

**Response**: `{ etiquetas: Array<{ id, etiqueta, sku, quantidade, createdAt }> }`

### `POST /api/etiquetas`
Insere associacoes em lote.

**Body**: `{ etiquetas: { etiqueta: string, sku: string, quantidade: number }[] }` (min 1)  
**Response**: array de associacoes criadas (201)

### `DELETE /api/etiquetas/[id]`
Remove associacao.

**Response**: `{ success: true }`

### `DELETE /api/etiquetas/bulk-delete`
Remove TODAS as associacoes.

**Response**: `{ success: true }`

---

## Lotes

### `GET /api/lotes`
Lista lotes cadastrados.

**Response**: `{ lotes: Array<{ id, nome, createdAt }> }`

### `POST /api/lotes`
Cria lote (nome uppercase, unique).

**Body**: `{ nome: string (max 100) }`  
**Response**: lote criado (201)  
**Status**: 201, 400, 401, 409, 500

---

## SKU Catalogo

### `GET /api/sku-catalogo`
Lista SKUs. Busca opcional por `ilike`.

**Query params**: `search?: string`  
**Response**: `{ skus: Array<{ id, codigo, createdAt }> }`

### `POST /api/sku-catalogo`
Cria SKU (codigo uppercase, unique).

**Body**: `{ codigo: string (max 50) }`  
**Response**: SKU criado (201)  
**Status**: 201, 400, 401, 409, 500

---

## Stock Items

### `POST /api/stock-items`
Cria multiplos itens de estoque em batch.

**Body**: `{ items: { sku: string, lote: string, quantidade: number }[] }` (min 1)  
**Response**: `{ count: number, ids: string[] }` (201)

---

## Produtos Avariados

### `GET /api/produtos-avariados`
Lista registros de avaria.

**Response**: `{ registros: Array<{ id, sku, avaria, localizacao, codigoFardo, usuarioId, createdAt }> }`

### `POST /api/produtos-avariados`
Registra avaria. Se `localizacao === "LOTE_DE_COSTURA"`, `codigoFardo` e obrigatorio.

**Body**:
```ts
{
  sku: string (max 50),
  avaria: string (max 500),
  localizacao: "DEVOLUCAO" | "ESTANTE" | "LOTE_DE_COSTURA",
  codigoFardo?: string // obrigatorio se LOTE_DE_COSTURA
}
```
**Response**: registro criado (201)

### `DELETE /api/produtos-avariados/[id]`
Remove registro.

**Response**: `{ success: true }`

---

## Resumo tecnico

| Aspecto | Valor |
|---|---|
| Total de endpoints | 31 |
| Rotas com transacao | 6 (`POST /api/coletas`, `POST /api/coletas/configuracoes/kit-rules`, `POST /api/estantes/[id]/fardos`, `DELETE /api/estantes/[id]/fardos/[fardoId]`, `POST /api/estantes/[id]/bipagem`, `POST /api/estantes/[id]/balanco`) |
| Auth exigida | Todas (exceto `/api/auth/[...all]` que faz auth internamente) |
| Paginacao | `/api/coletas`, `/api/alteracoes-estoque`, `/api/estantes/movimentacoes` |
| Batch operations | `POST /api/coletas`, `POST /api/etiquetas`, `POST /api/stock-items` |
| Rate limiting | Nao implementado |
| Soft delete | Nao implementado |
