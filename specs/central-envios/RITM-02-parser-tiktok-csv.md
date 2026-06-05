# RITM-02 — Parser TikTok CSV server-side + ingestão via Inngest

> **Bloqueia:** RITM-03 (parser ML XLSX reusa a infra de ingestão), RITM-04 (normalização consome output do parser), RITM-07 (sessão referencia `ingestao_run.id`).
> **Depende de:** RITM-01 (schema base) aplicado em dev e prod.
> **Dependência externa:** conta Inngest (plano grátis), conta Vercel Blob (já existe).

---

## Princípio inegociável: parser puro + fila durável

O parser deve ser uma **função pura** sobre `Buffer | string` → resultado normalizado, sem efeitos colaterais (sem DB, sem fetch, sem fs). Testável só com fixtures. A ingestão (upload, fila, persistência) é orquestrada por cima da função pura via **Inngest** — não rodando no route handler.

Consequências:

- ❌ Route handler **não pode** parsear inline. Sobe arquivo pro Blob, dispara evento Inngest, devolve `runId` e retorna em < 1s.
- ❌ Não persistir SKU/cor/tamanho normalizados aqui. Parser produz `PedidoNormalizadoBruto` — campos do CSV mapeados, *sem* aplicar aliases/explosão. Normalização vem em RITM-04, explosão em RITM-05.
- ✅ Todo trabalho assíncrono passa pela infra Inngest criada neste RITM. Outros módulos (Canais, Confecção) podem encostar quando quiserem — não criar Inngest paralelo por módulo.
- ✅ Estado do processamento mora em `ingestao_run` (tabela durável) — não em memória do worker nem em status interno do Inngest. Frontend faz polling no Postgres.

---

## Objetivo

Plumbing completo de ingestão de arquivos para a Central de Envios, validado end-to-end com TikTok CSV. Ao fim do RITM:

- Subir um CSV TikTok via `POST /api/central-envios/ingestao/tiktok` retorna `runId` em < 1s.
- Inngest processa o arquivo em background (read do Blob → parse → persiste resultado).
- `GET /api/central-envios/ingestao/[runId]` devolve status `pendente|processando|concluido|erro` + estatísticas + resultado quando pronto.
- Parser é função pura testada com fixtures de CSVs reais (cabeçalho, `\t` no fim, filtro Order Status, 1k linhas).
- A mesma infra está pronta pra RITM-03 (parser ML XLSX) — basta adicionar mais uma função Inngest.

**Não inclui:**

- Parser ML XLSX — RITM-03.
- Pipeline de normalização (aliases, ambiguidade) — RITM-04.
- Explosão de kit / MIX — RITM-05.
- Cálculo de prazo — RITM-06.
- `sessao_central_envios` / merge entre arquivos — RITM-07.
- UI de upload — RITM-08.

---

## Arquivos a criar / modificar

| Arquivo | Mudança |
|---|---|
| `package.json` | Adicionar deps `inngest` + `csv-parse`. Adicionar script `inngest:dev`. |
| `.env.example` | Documentar `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` (já tem, **revalidar comentário** pra apontar Central de Envios como user atual; antes apontava Canais). |
| `src/lib/db/schema.ts` | Adicionar enum `ingestaoRunStatusEnum`, enum `ingestaoRunTipoEnum`, tabela `ingestao_run`, types exportados. |
| `drizzle/migrations/<ts>_ingestao_run.sql` | Gerada via `db:generate:dev`. Adicionar RLS manualmente. |
| `src/lib/db/restore-rls-policies.ts` | Adicionar `ingestao_run` ao array `TABELAS_PADRAO`. |
| `src/inngest/client.ts` | **Novo** — instância única do Inngest client (`new Inngest({ id: 'scaleon-erp' })`). |
| `src/inngest/functions/central-envios/parsear-tiktok.ts` | **Novo** — Inngest function que reage a `central-envios/parsear-tiktok.solicitado`. |
| `src/inngest/functions/index.ts` | **Novo** — exporta array de todas as functions registradas. Outros módulos adicionam aqui. |
| `src/app/api/inngest/route.ts` | **Novo** — endpoint `serve` do Inngest (GET/POST/PUT). |
| `src/lib/central-envios/ingestao/parser-tiktok-csv.ts` | **Novo** — função pura `parsearTikTokCsv(input)`. |
| `src/lib/central-envios/ingestao/parser-tiktok-csv.test.ts` | **Novo** — testes node:test com fixtures. |
| `src/lib/central-envios/ingestao/__fixtures__/tiktok-*.csv` | **Novo** — fixtures sintéticas (não usar exports reais com dados de cliente). |
| `src/app/api/central-envios/ingestao/tiktok/route.ts` | **Novo** — POST: upload + dispara evento. |
| `src/app/api/central-envios/ingestao/[runId]/route.ts` | **Novo** — GET: status + resultado. |
| `src/lib/db/ingestao-run.test.ts` | **Novo** — testes node:test (RLS, transições de status). |
| `docs/arquitetura/modulo-central-envios.md` | Atualizar §10 e §15 mencionando estado atual da implementação. |

---

## Dependências (npm)

Adicionar **2** deps de produção:

```
"inngest": "^3.x"      # cliente + serve para Next.js
"csv-parse": "^5.x"    # parser CSV oficial do Node (sem dependências runtime)
```

`xlsx` já existe (`0.18.5`) — usado em RITM-03.

> **Por que `csv-parse` e não `papaparse`**: csv-parse é Node-native, streaming, sem dependências e sem peso de browser-globals. Vamos rodar isso dentro do Inngest function (Node 24), nunca no browser.

---

## Schema da tabela `ingestao_run`

Durabilidade da fila independente do Inngest. Vai ser referenciada por `sessao_central_envios` (RITM-07).

### Enums

```sql
ingestao_run_status: 'pendente' | 'processando' | 'concluido' | 'erro'
ingestao_run_tipo:   'tiktok_csv' | 'ml_xlsx'   -- ml_xlsx entra no RITM-03
```

> `tipo` é enum (não `text`) porque a lista é fechada e queremos type safety no Drizzle. Adicionar valor novo = `ALTER TYPE ... ADD VALUE`.

### Tabela

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `text` | PK |
| `conta_id` | `text` | NOT NULL, FK → `conta.id` ON DELETE CASCADE |
| `usuario_id` | `text` | NOT NULL, FK → `user.id` ON DELETE RESTRICT — quem subiu o arquivo |
| `tipo` | `ingestao_run_tipo` | NOT NULL |
| `arquivo_nome` | `text` | NOT NULL — `originalFilename` que o cliente mandou |
| `arquivo_blob_url` | `text` | NOT NULL — URL pública (`https://*.public.blob.vercel-storage.com/...`) |
| `arquivo_tamanho_bytes` | `integer` | NOT NULL |
| `arquivo_content_type` | `text` | nullable — `text/csv`, etc. (informativo) |
| `inngest_event_id` | `text` | nullable — id devolvido por `inngest.send(...)` (informativo p/ debug) |
| `status` | `ingestao_run_status` | NOT NULL DEFAULT `'pendente'` |
| `total_linhas` | `integer` | nullable — preenchido pelo worker ao concluir |
| `linhas_validas` | `integer` | nullable — passaram no filtro de Order Status |
| `linhas_descartadas` | `integer` | nullable — total descartado |
| `descartes_resumo` | `jsonb` | nullable — `Record<string, number>`, ex.: `{ "status_diferente_a_ser_enviado": 17, "linha_vazia": 2 }` |
| `resultado` | `jsonb` | nullable — `PedidoNormalizadoBruto[]` (vide §parser). Tamanho típico < 1MB; > 4MB vai pro Blob (vide caveat 1). |
| `resultado_blob_url` | `text` | nullable — preenchido quando `resultado` excede 1MB (offload). Apenas um dos dois é não-nulo. |
| `erro` | `text` | nullable — mensagem de erro humano |
| `erro_codigo` | `text` | nullable — slug machine-readable (`download_falhou`, `csv_invalido`, `colunas_ausentes`, …) |
| `created_at` | `timestamp` | NOT NULL DEFAULT NOW() |
| `started_at` | `timestamp` | nullable — quando o worker pegou |
| `finished_at` | `timestamp` | nullable — sucesso ou erro |

**Índices:**

- `idx_ingestao_run_conta_created` em `(conta_id, created_at DESC)` — listagem por conta no painel.
- `idx_ingestao_run_status` em `(status)` WHERE `status IN ('pendente','processando')` — query de "runs órfãs" futura.

**Tipos TS exportados:**

```ts
export type IngestaoRun = InferSelectModel<typeof ingestaoRun>;
export type IngestaoRunStatus = (typeof ingestaoRunStatusEnum.enumValues)[number];
export type IngestaoRunTipo = (typeof ingestaoRunTipoEnum.enumValues)[number];
```

### RLS

Política padrão por `conta_id`:

```sql
ALTER TABLE ingestao_run ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ingestao_run
  USING (conta_id = current_setting('app.conta_atual', true))
  WITH CHECK (conta_id = current_setting('app.conta_atual', true));
```

Adicionar `"ingestao_run"` ao `TABELAS_PADRAO` em `restore-rls-policies.ts`.

---

## Parser TikTok CSV (função pura)

`src/lib/central-envios/ingestao/parser-tiktok-csv.ts`.

### Assinatura

```ts
export type PedidoNormalizadoBruto = {
  canal: 'tiktok_shop';                    // hardcoded — outros canais teriam outros valores
  orderId: string;                         // "Order ID" — string (tem letras + dígitos)
  trackingId: string | null;               // "Tracking ID" — ausente em pedidos sem etiqueta
  sellerSku: string;                       // "Seller SKU" — texto original, sem normalização
  quantidade: number;                      // "Quantity" — inteiro positivo
  buyerUsername: string | null;            // "Buyer Username" — pode vir mascarado
  criadoEm: string;                        // ISO 8601 UTC ("2026-06-05T13:42:00Z"). Convertido de "MM/DD/YYYY HH:MM:SS AM/PM".
  orderStatus: string;                     // texto original (geralmente "A ser enviado" no recorte filtrado)
  orderSubstatus: string | null;
};

export type DescarteMotivo =
  | 'status_diferente_a_ser_enviado'
  | 'linha_vazia'
  | 'colunas_ausentes'
  | 'data_invalida'
  | 'quantidade_invalida';

export type ResultadoParser = {
  pedidos: PedidoNormalizadoBruto[];
  totalLinhas: number;          // linhas de dados (sem header)
  linhasValidas: number;        // = pedidos.length
  linhasDescartadas: number;
  descartesResumo: Record<DescarteMotivo, number>;
};

export function parsearTikTokCsv(
  input: Buffer | string,
  opts?: { filtrarOrderStatus?: string },  // default: "A ser enviado"
): ResultadoParser;
```

### Comportamento

1. **Decodifica** Buffer com UTF-8 (default), fallback Latin-1 se UTF-8 falhar com `Invalid UTF-8`. CSV do TikTok normalmente é UTF-8 with BOM — `csv-parse` lida com BOM nativamente quando `bom: true`.
2. **Limpa `\t` no fim de cada campo** — TikTok adiciona `\t` em alguns campos. Aplicar `.replace(/\t+$/, '')` em todo valor.
3. **Header obrigatório** — primeira linha. Esperar pelo menos as colunas: `Order ID`, `Tracking ID`, `Seller SKU`, `Quantity`, `Buyer Username`, `Created Time`, `Order Status`. `Order Substatus` é opcional. Coluna ausente → throw `Error('colunas_ausentes: ...')` com lista do que faltou. Throw é capturado pelo worker → `erro_codigo='colunas_ausentes'`.
4. **Linhas vazias** (todas as colunas null/empty) → conta como descarte com motivo `linha_vazia` e segue.
5. **Filtro Order Status**: descarta linhas com `orderStatus !== filtrarOrderStatus`. Default `"A ser enviado"`. Conta cada descarte em `descartesResumo`.
6. **Created Time → ISO UTC**:
   - Formato: `MM/DD/YYYY HH:MM:SS AM/PM` (ex.: `06/05/2026 02:42:00 PM`).
   - **Timezone do TikTok BR**: America/Sao_Paulo (UTC-3) sem horário de verão (não tem mais desde 2019). Vamos assumir UTC-3 fixo. Documentar essa premissa explícita no JSDoc da função. Se for descoberto que TikTok manda outro timezone, ajustar e revisitar fixtures.
   - Implementação: parse manual com regex + `new Date(Date.UTC(yyyy, mm-1, dd, hh+3, MM, ss))` (ajusta UTC-3 pra UTC somando 3h). Não usar `new Date('06/05/2026 02:42:00 PM')` direto — ambíguo entre browsers/runtimes.
   - Data inválida → descarte com `data_invalida`.
7. **Quantidade**: `parseInt(string, 10)`. NaN ou ≤ 0 → descarte `quantidade_invalida`.
8. **Sem mutação do `sellerSku`** — texto literal. Normalização vai pra RITM-04.
9. **Idempotência interna**: nenhum side effect. Chamar a função 2x com o mesmo input retorna o mesmo output (testar com `assert.deepEqual`).

### Anti-padrões a evitar

- ❌ `new Date(str)` direto sem parse manual — comportamento depende do runtime.
- ❌ `csv-parse` com `columns: true` + autocorrige header em duplicados — em vez disso, **passar `columns: false`** e mapear índices manualmente, baseado na primeira linha lida. Evita silent corruption se TikTok renomear coluna.
- ❌ Carregar tudo na memória se arquivo for > 50MB — usar `csv-parse` em modo streaming. Limite do worker fica em 50MB de input (Inngest function tem 4GB RAM por padrão, então 50MB processado linha-a-linha é confortável).

### Limites

- Input máximo aceito: **50 MB** (`MAX_INPUT_BYTES = 50 * 1024 * 1024`). Acima disso, `parsearTikTokCsv` joga `Error('arquivo_muito_grande')`. CSVs do TikTok no recorte diário ficam < 1MB.

---

## Infraestrutura Inngest

Setup minimalista — só o suficiente pra rodar 1 função inicialmente.

### Cliente — `src/inngest/client.ts`

```ts
import { Inngest } from 'inngest';

export const inngest = new Inngest({
  id: 'scaleon-erp',
  // Em dev local roda contra dev server (npx inngest-cli@latest dev).
  // Em prod usa Inngest Cloud com signing key.
});

// Catálogo de eventos — type safety em tempo de compilação.
// Cada módulo adiciona seus eventos aqui.
export type Events = {
  'central-envios/parsear-tiktok.solicitado': {
    data: {
      runId: string;
      contaId: string;
      blobUrl: string;
    };
  };
};
```

### Endpoint — `src/app/api/inngest/route.ts`

```ts
import { serve } from 'inngest/next';
import { inngest } from '@/inngest/client';
import { functions } from '@/inngest/functions';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
});
```

### Registro de functions — `src/inngest/functions/index.ts`

```ts
import { parsearTikTokFunction } from './central-envios/parsear-tiktok';

export const functions = [
  parsearTikTokFunction,
] as const;
```

> Outros módulos (Canais, Confecção) adicionam aqui. **Não** criar `/api/inngest/canais/route.ts` paralelo — um endpoint único, lista de functions cresce.

### Env vars

Já existem em `.env.example` (comentário aponta Canais — atualizar pra "compartilhado entre Central de Envios, Canais e outros módulos"):

- `INNGEST_EVENT_KEY` — em prod. Em dev local fica vazio (Inngest dev server não exige).
- `INNGEST_SIGNING_KEY` — em prod.

### Script `inngest:dev`

```json
"inngest:dev": "npx inngest-cli@latest dev -u http://localhost:3009/api/inngest"
```

> Operador roda `npm run dev` num terminal e `npm run inngest:dev` em outro. Inngest dev server fica em `http://localhost:8288` (UI de debug).

---

## Inngest function `central-envios/parsear-tiktok`

`src/inngest/functions/central-envios/parsear-tiktok.ts`.

### Trigger

Evento `central-envios/parsear-tiktok.solicitado` (vide catálogo).

### Lógica

```
1. step.run('marcar-processando'):
     UPDATE ingestao_run
     SET status='processando', started_at=NOW()
     WHERE id={runId} AND status='pendente'
     RETURNING ...
   Se 0 linhas afetadas → step.run loga + returns (run já foi processada ou cancelada).

2. step.run('baixar-blob'):
     fetch(blobUrl, { signal: AbortSignal.timeout(30_000) }) → Buffer
     Se response.status >= 400 → throw Error('download_falhou: status=...')

3. step.run('parsear'):
     try { ResultadoParser = parsearTikTokCsv(buffer) }
     catch (e) → throw Error com erro_codigo inferido da mensagem.

4. step.run('persistir-resultado'):
     Decide entre inline (jsonb) e offload:
       JSON.stringify(resultado.pedidos).length < 1_000_000 → resultado inline
       senão → upload pro Blob, salva URL em resultado_blob_url
     UPDATE ingestao_run
       SET status='concluido',
           finished_at=NOW(),
           total_linhas=...,
           linhas_validas=...,
           linhas_descartadas=...,
           descartes_resumo=...,
           resultado=... | NULL,
           resultado_blob_url=... | NULL
     WHERE id={runId}
```

### Erro / retry

- Inngest tem retry built-in (default 4× com backoff exponencial). **Manter default** — falhas transitórias de Blob/network são automaticamente retentadas.
- Na falha final (`onFailure` handler):

```ts
onFailure: async ({ event, error }) => {
  await withConta(event.data.event.data.contaId, async (tx) => {
    await tx.update(ingestaoRun)
      .set({
        status: 'erro',
        finished_at: new Date(),
        erro: error.message.slice(0, 2000),
        erro_codigo: inferirCodigo(error.message),
      })
      .where(eq(ingestaoRun.id, event.data.event.data.runId));
  });
}
```

- `inferirCodigo(msg)`: helper que mapeia prefixos de mensagem (`'download_falhou:'`, `'arquivo_muito_grande'`, `'colunas_ausentes:'`, …) pra slugs canônicos. Default `'erro_desconhecido'`.

### Tenancy dentro da function

⚠️ Inngest function **não roda dentro de request HTTP**, então `withContaAtiva` não funciona (não tem sessão). Usar `withConta(contaId, fn)` com `contaId` que veio no payload do evento — o `set_config('app.conta_atual', contaId, true)` ainda dispara RLS normalmente.

### Idempotência

- O `UPDATE ... WHERE status='pendente'` no passo 1 garante que retry após sucesso não regrede status. Steps subsequentes só fazem UPDATE no mesmo registro, idempotente por design.
- **Atenção**: Inngest pode invocar `step.run('parsear')` 2× se houver crash entre passos — mas `step.run` cacheia o resultado por id determinístico. Garantir que os step ids são determinísticos (strings literais) — feito.

### Concorrência

Não configurar `concurrency` nesta versão. Volume esperado: 5-10 uploads/dia por conta. Quando passar disso, adicionar `concurrency: { limit: 4 }` (Inngest plano grátis cobre até esse volume).

---

## Route handlers

### POST `/api/central-envios/ingestao/tiktok`

Recebe multipart, sobe pro Blob, dispara evento, retorna `runId`.

**Auth/tenancy:** `withContaAtiva`. Bloqueia se sem conta ativa.

**Validação Zod** do form data:

```ts
const Schema = z.object({
  arquivo: z.instanceof(File).refine(
    (f) => f.size > 0 && f.size <= 50 * 1024 * 1024,
    'Arquivo vazio ou maior que 50MB',
  ),
});
```

**Pipeline:**

```
1. Valida sessão + conta + form data.
2. Sobe arquivo pro Vercel Blob:
     const blob = await put(`central-envios/ingestao/${runId}-${arquivo.name}`,
                            arquivo, {
                              access: 'public',
                              addRandomSuffix: false,
                            })
3. INSERT ingestao_run (status='pendente', blob_url=blob.url, ...)
4. await inngest.send({
     name: 'central-envios/parsear-tiktok.solicitado',
     data: { runId, contaId, blobUrl: blob.url },
   })
5. UPDATE ingestao_run SET inngest_event_id = result.ids[0]
6. Return { runId, status: 'pendente' }
```

**Erros:**

- Sem `BLOB_READ_WRITE_TOKEN` → 503 `{ error: 'Storage indisponível' }`.
- Sem `INNGEST_EVENT_KEY` em prod → 503 `{ error: 'Worker indisponível' }`. Em dev local, Inngest dev server aceita evento sem key — só logar warning.
- Blob upload falha → rollback do INSERT (transação? não — INSERT é depois do upload; se INSERT falhar, blob fica órfão. Aceitar e ter um job futuro pra limpar). Pra este RITM: se INSERT falhar após upload, log de error + retorna 500.

### GET `/api/central-envios/ingestao/[runId]`

Polling do frontend.

**Auth/tenancy:** `withContaAtiva` — RLS já garante isolamento, mas check explícito de `usuario_id === contaCtx.userId` previne enumeração entre operadores da mesma conta.

**Resposta:**

```ts
{
  runId: string;
  status: 'pendente' | 'processando' | 'concluido' | 'erro';
  arquivoNome: string;
  totalLinhas: number | null;
  linhasValidas: number | null;
  linhasDescartadas: number | null;
  descartesResumo: Record<string, number> | null;
  resultado: PedidoNormalizadoBruto[] | null;   // se status='concluido' e inline
  resultadoUrl: string | null;                  // se status='concluido' e offloaded
  erro: string | null;
  erroCodigo: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}
```

> Frontend (RITM-08) decide polling rate. Recomendado 1s.

---

## Workflow obrigatório

```bash
# 1. Editar schema.ts
# 2. Gerar migration
npm run db:generate:dev

# 3. Revisar SQL gerado. Adicionar:
#    - ALTER TABLE ingestao_run ENABLE ROW LEVEL SECURITY;
#    - CREATE POLICY tenant_isolation ON ingestao_run ...

# 4. Aplicar local
npm run db:migrate:dev

# 5. Atualizar restore-rls-policies.ts (adicionar "ingestao_run")

# 6. npm install inngest csv-parse

# 7. Implementar parser puro + testes
npm run test src/lib/central-envios/ingestao/parser-tiktok-csv.test.ts

# 8. Implementar Inngest function + cliente + endpoint serve.

# 9. Rodar dev:
#    - Terminal 1: npm run dev
#    - Terminal 2: npm run inngest:dev
#    - Operador: subir CSV via curl e checar UI do Inngest (http://localhost:8288)

# 10. Implementar route handlers POST + GET.

# 11. Testes de DB (RLS, transições).

# 12. Diff prod ANTES do push
npm run db:generate:prod

# 13. Aplicar no Neon
npm run db:migrate:prod
dotenv -e .env.prod -- npx tsx src/lib/db/restore-rls-policies.ts
```

---

## Testes obrigatórios

### Parser puro — `src/lib/central-envios/ingestao/parser-tiktok-csv.test.ts`

Fixtures em `src/lib/central-envios/ingestao/__fixtures__/`. **Não usar exports reais com dados de cliente** — sintetizar.

1. ✅ CSV minimal (header + 1 linha "A ser enviado") → `pedidos.length === 1`, sem descartes.
2. ✅ CSV com 3 linhas: 1 "A ser enviado", 1 "Cancelado", 1 "Em separação" → `linhas_validas === 1`, `linhas_descartadas === 2`, `descartesResumo.status_diferente_a_ser_enviado === 2`.
3. ✅ CSV com `\t` no fim de campos (sintetizar) → parser strip-a, `orderId` vem limpo.
4. ✅ CSV com BOM no início → parser ignora BOM, header reconhecido.
5. ✅ Coluna `Tracking ID` vazia em algumas linhas → `trackingId === null` nessas.
6. ✅ Coluna obrigatória ausente (`Order ID` removida) → throw `Error('colunas_ausentes: Order ID')`.
7. ✅ `Created Time = '06/05/2026 02:42:00 PM'` → `criadoEm === '2026-06-05T17:42:00.000Z'` (PM = 14h local SP, +3h = 17h UTC).
8. ✅ `Created Time = '06/05/2026 12:00:00 AM'` (meia-noite) → `criadoEm === '2026-06-05T03:00:00.000Z'`.
9. ✅ `Created Time` malformado → linha descartada com motivo `data_invalida`.
10. ✅ `Quantity = '0'` ou `'-1'` ou `'abc'` → descarte `quantidade_invalida`.
11. ✅ 1.000 linhas geradas em loop → parse em < 500ms, `pedidos.length === 1000` (sem descartes nas válidas).
12. ✅ Filtro custom: `parsearTikTokCsv(csv, { filtrarOrderStatus: 'Em separação' })` → só passa linhas "Em separação".
13. ✅ Idempotência: 2 chamadas com mesmo Buffer → `assert.deepStrictEqual` dos resultados.
14. ✅ Input > 50MB → throw `Error('arquivo_muito_grande')`.

### Tabela `ingestao_run` — `src/lib/db/ingestao-run.test.ts`

Mesmo padrão do `central-envios-cadastros.test.ts` (TEST_ROLE, `FORCE ROW LEVEL SECURITY`).

1. ✅ INSERT com conta A → SET app.conta_atual=B → SELECT retorna 0 linhas (RLS).
2. ✅ INSERT sem `usuario_id` → falha NOT NULL.
3. ✅ INSERT com `tipo='tiktok_csv'`, `status` default `'pendente'`.
4. ✅ UPDATE `status='processando'` + `started_at=NOW()` permitido sob mesma conta.
5. ✅ UPDATE `status='concluido'` + `resultado=[...]` aceita jsonb shape qualquer (não validado no banco).
6. ✅ Delete da conta → cascade dropa `ingestao_run`.
7. ✅ Tentar valor inválido no enum (`status='processando2'`) → erro Postgres.
8. ✅ Índice `idx_ingestao_run_status` é parcial — query `WHERE status IN ('pendente','processando')` usa o índice (verificar via EXPLAIN).

### Route handlers (opcional este RITM — recomendado integrar no RITM-08)

Smoke test manual:

```bash
# 1. Logar no app, abrir DevTools, copiar cookie de sessão.
# 2. Subir fixture via curl:
curl -X POST http://localhost:3009/api/central-envios/ingestao/tiktok \
  -H "Cookie: <cookie>" \
  -F "arquivo=@src/lib/central-envios/ingestao/__fixtures__/tiktok-basico.csv"
# → { runId: "ce-ing-...", status: "pendente" }

# 3. Polling até status=concluido
curl http://localhost:3009/api/central-envios/ingestao/<runId> -H "Cookie: ..."
```

---

## Critérios de aceitação

- [ ] Schema Drizzle: tabela `ingestao_run` + 2 enums novos, no padrão do arquivo
- [ ] Migration gerada e aplicada em dev sem erro
- [ ] RLS habilitado e policy criada (test 1 passa)
- [ ] Types TypeScript exportados (3)
- [ ] `restore-rls-policies.ts` atualizado com `ingestao_run`
- [ ] `inngest` + `csv-parse` instalados; `npm run check` (tsc) passa
- [ ] Inngest client + endpoint serve + function registrada
- [ ] `inngest:dev` script funciona; dev server lista a function em `http://localhost:8288`
- [ ] Parser puro implementado; **14 testes** passam
- [ ] Testes de DB de `ingestao_run` (8) passam
- [ ] POST `/ingestao/tiktok` aceita CSV de 5KB e retorna `runId` em < 1s
- [ ] Inngest function processa o evento end-to-end: status pendente → processando → concluido
- [ ] GET `/ingestao/[runId]` devolve resultado quando status=concluido
- [ ] Erro de Blob ausente → 503 (não 500 silencioso)
- [ ] Sem `INNGEST_EVENT_KEY` em prod, POST retorna 503; em dev local, dispara warning mas funciona
- [ ] **Sweep de hardcode tenant-specific**: `grep -i -E 'LUA|NBA|BALA|BOB|SOL|CJ| AZ | PT | CZ | EGG '` em arquivos do RITM → 0 hits
- [ ] **Validado local antes de tocar em prod**
- [ ] Aplicado no Neon: migration + restore-rls
- [ ] Doc de arquitetura (§10, §15) atualizado mencionando estado pós-RITM-02

---

## Dúvidas (resolvidas)

| # | Pergunta | Resposta |
|---|---|---|
| 1 | Inngest endpoint único ou por módulo? | **Único.** `/api/inngest/route.ts` registra a lista de functions de todos os módulos. Reduz overhead e deploy. Conflito de domínio? Não — eventos têm namespace por módulo no nome (`central-envios/*`, `canais/*`, `confeccao/*`). |
| 2 | Parser dentro do route handler ou Inngest? | **Inngest.** Decisão do user no início do RITM-02. Route handler só faz upload + dispatch. |
| 3 | `csv-parse` ou `papaparse`? | **`csv-parse`.** Native Node, sem deps, streaming. Papaparse é overkill (built pra browser). |
| 4 | Onde guardar resultado parseado? | **Inline em `ingestao_run.resultado` (jsonb)** quando < 1MB, **offload pro Blob** quando ≥ 1MB. Frontend lida com ambos. CSVs típicos do TikTok BR caem confortáveis no inline. |
| 5 | Polling rate do frontend? | **Decisão do RITM-08.** Recomendação: 1s nos primeiros 10s, depois 3s. |
| 6 | Inngest tem custo? | **Plano grátis cobre 50k steps/mês** (5 steps/function × 10k uploads/mês). Acima disso, $20/mês. Confortável pra MVP. |
| 7 | Vai dar pra reusar isso pro ML XLSX (RITM-03)? | **Sim.** A diferença é só o parser (xlsx vs csv-parse) e o `tipo='ml_xlsx'`. Schema da `ingestao_run` é genérico. |
| 8 | E se Inngest cair? | Eventos ficam enfileirados no Inngest Cloud (24h retention no grátis). `ingestao_run` continua em `pendente` no banco — frontend mostra "processando" enquanto isso. Quando Inngest volta, retoma. Sem perda. |

---

## Dúvidas em aberto

1. **Timezone do `Created Time` do TikTok**: assumimos `America/Sao_Paulo` UTC-3. Validar com export real de TikTok Shop BR — comparar `Created Time` no CSV vs timestamp no painel da TikTok. Se for diferente (UTC, por ex.), ajustar parser + fixture #7 e #8.
2. **`addRandomSuffix: false` no `put` do Blob**: usamos `runId` como prefixo pra evitar colisão. Se dois uploads simultâneos da mesma conta mandarem mesmo `arquivo.name`, runIds diferentes evitam colisão. Validar se `put` rejeita pathname duplicado (deveria — Vercel doc diz que sim).
3. **Limpeza de Blobs órfãos**: se INSERT do `ingestao_run` falhar pós-upload, o Blob fica órfão. Pra MVP aceitamos — Vercel cobra por GB-mês, custo desprezível. Futuro: cron semanal que cruza Blobs em `central-envios/ingestao/` com `ingestao_run.arquivo_blob_url`. Não escopo deste RITM.
4. **Multi-arquivo no mesmo upload**: arquitetura prevê (§7). Este RITM aceita só **1 arquivo por POST**. RITM-08 (UI) pode disparar N POSTs em paralelo — cada um gera 1 `runId`. RITM-07 (sessão) consolida.
