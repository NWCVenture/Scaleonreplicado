# RITM-03 — Parser Mercado Livre XLSX + ingestão via Inngest

> **Bloqueia:** RITM-04 (normalização consome output do parser ML também), RITM-07 (sessão merge multi-arquivo cruza TikTok + ML).
> **Depende de:** RITM-02 aplicado (Inngest setup, `ingestao_run`, route GET `[runId]`).
> **Dependência externa:** nenhuma — `xlsx` já está no `package.json` desde antes.

---

## Princípio inegociável: reuso de infra + dedup intra-arquivo apenas

- Toda infra de RITM-02 fica intocada: `ingestao_run` recebe `tipo='ml_xlsx'`, mesmo endpoint Inngest, mesmo padrão de polling, mesmo GET `[runId]`.
- **Dedup intra-arquivo** (mesmo `N.º de venda` aparece N vezes dentro do mesmo XLSX → mantém primeiro, descarta repetições) é escopo deste RITM.
- **Dedup transversal entre múltiplos uploads** (operador subiu 2 XLSX da mesma conta no mesmo dia) é escopo de RITM-07 (sessão merge). Aqui só processamos um arquivo de cada vez.
- **Sem normalização de SKU/variação/cor/tamanho**: campos vão literais pro `resultado`. RITM-04 normaliza.

---

## Objetivo

Aceitar upload de XLSX exportado pelo painel do Mercado Livre Brasil ("Vendas BR") e devolver no `ingestao_run.resultado` uma lista de `PedidoMlBruto[]` com dedup intra-arquivo aplicado.

**Não inclui:**
- Extração de prazo a partir do campo "Estado" (regex `coleta do dia X de Y`) — RITM-06.
- Normalização de SKU/cor/tamanho — RITM-04.
- Conflito entre arquivos / merge de sessão — RITM-07.
- UI de upload — RITM-08.

---

## Arquivos a criar / modificar

| Arquivo | Mudança |
|---|---|
| `src/lib/central-envios/ingestao/parser-ml-xlsx.ts` | **Novo** — função pura `parsearMlXlsx(input)`. |
| `src/lib/central-envios/ingestao/parser-ml-xlsx.test.ts` | **Novo** — testes node:test com fixtures geradas via `XLSX.utils.aoa_to_sheet`. |
| `src/inngest/functions/central-envios/parsear-ml.ts` | **Novo** — Inngest function que reage a `central-envios/parsear-ml.solicitado`. Mesma estrutura de `parsear-tiktok.ts`. |
| `src/inngest/functions/index.ts` | Adicionar `parsearMlFunction` ao array `functions`. |
| `src/app/api/central-envios/ingestao/mercado-livre/route.ts` | **Novo** — POST: upload XLSX + enfileira. Mesma estrutura do route TikTok. |
| `docs/arquitetura/modulo-central-envios.md` | Atualizar §10.2 e §15 (marcar feito). |
| `src/lib/db/schema.ts` | **Sem mudança.** `ingestao_run_tipo` já tem `'ml_xlsx'` desde RITM-02. |

> Schema, RLS, Inngest infra, GET `[runId]` ficam intactos.

---

## Especificação do parser

`src/lib/central-envios/ingestao/parser-ml-xlsx.ts`.

### Formato do arquivo ML

- **Nome típico:** `AAAAMMDD_Vendas_BR_Mercado_Libre_y_Mercado_Shops_AAAA-MM-DD_HH-MMhs_<CONTA>.xlsx`. **Não validamos o nome** — operador pode renomear ou subir export antigo.
- **Sheet:** a primeira. Não confiar em nome (`Vendas`, `Sheet1` variam por export).
- **Linhas 1-5 (índices 0-4):** metadata do export (título, período, conta) — **descartamos**.
- **Linha 6 (índice 5):** header com nomes das colunas.
- **Linhas 7+ (índice 6+):** dados.

### Colunas

Obrigatórias no header (case-sensitive, espaço incluído):

- `N.º de venda` — PK do pedido (usado pra dedup)
- `Data da venda` — timestamp da venda
- `SKU` — código (texto livre, pode ter espaço, vírgula, kit, etc.)
- `Unidades` — quantidade do item

Opcionais (mas geralmente presentes):

- `Variação` — texto livre que descreve a variação (ex.: "Cor: PT / Tamanho: G"). Útil pra desambiguação humana.
- `Estado` — campo que contém prazo no formato `coleta do dia X de Y`. **Não parseamos aqui** — RITM-06 extrai.
- `Comprador` — username/identificação do comprador (privado, pode vir mascarado).
- `N.º de envio` — equivalente ao tracking ID do TikTok.

Coluna obrigatória ausente → `ParserError('colunas_ausentes', ...)`.

> ⚠️ Notação **"N.º"** usa o caractere `º` (ordinal masculino, U+00BA). Header literal do export. Não confundir com `N.°` (degree sign, U+00B0).

### Linhas a ignorar (e contabilizar como descarte)

| Motivo | Detecção | `descartesResumo` |
|---|---|---|
| Linha de "pacote diversos" / "Pacote de N produtos" | Coluna `SKU` casa `/^Pacote de \d+ produtos?$/i` ou está em coluna SKU contendo apenas a descrição | `pacote_diversos` |
| Linha completamente vazia (`SKU`, `N.º de venda`, `Unidades` todos null/empty) | Inspeção das 3 colunas | `linha_vazia` |
| Repetição de `N.º de venda` (dedup intra-arquivo) | Segundo+ ocorrência do mesmo valor; mantém primeiro | `dedup_intra_arquivo` |
| `Unidades` ≤ 0, NaN ou não-numérico | parseInt(string) | `quantidade_invalida` |
| `N.º de venda` vazio | Tudo vazio nessa coluna | `numero_venda_vazio` |

### Tipo de saída

```ts
export type PedidoMlBruto = {
  canal: 'mercado_livre';
  numeroVenda: string;               // PK
  numeroEnvio: string | null;        // null se sem etiqueta ainda
  sku: string;                       // raw, sem normalização
  variacao: string | null;           // texto livre, ajuda humano
  estado: string | null;             // contém prazo via regex (RITM-06)
  unidades: number;                  // > 0, inteiro
  comprador: string | null;
  dataVendaIso: string | null;       // ISO UTC quando conseguiu parsear; null caso contrário
  dataVendaRaw: string;              // como veio (Date.toString() ou texto literal)
};

export type DescarteMotivoMl =
  | 'pacote_diversos'
  | 'linha_vazia'
  | 'dedup_intra_arquivo'
  | 'quantidade_invalida'
  | 'numero_venda_vazio';

export type ResultadoMlParser = {
  pedidos: PedidoMlBruto[];
  totalLinhas: number;
  linhasValidas: number;
  linhasDescartadas: number;
  descartesResumo: Record<DescarteMotivoMl, number>;
};

export function parsearMlXlsx(input: Buffer | string): ResultadoMlParser;
```

> `dataVendaIso` é optimistic: tenta `cellDates:true` do xlsx (que produz Date) → ISO direto. Se vier como string ("05/06/2026 14:42:00"), tenta parse pt-BR (DD/MM/YYYY HH:MM:SS) assumindo TZ `America/Sao_Paulo`. Se nada bater → `null` e o `dataVendaRaw` fica como única referência.
>
> RITM-06 usa `Estado` pra extrair o prazo de coleta — `dataVendaIso` é só metadata aqui. Se ML mudar formato e quebrar, não cai o pipeline.

### Decodificação

- `XLSX.read(input, { type: 'buffer', cellDates: true })` quando Buffer. String entra como `type: 'string'` (CSV-like, mas ML não exporta XLSX assim — improvável na prática).
- `XLSX.utils.sheet_to_json(sheet, { header: 1, range: 5, defval: null, raw: true, blankrows: false })`.
  - `header: 1` retorna arrays.
  - `range: 5` começa no índice 5 (linha 6 — header).
  - `defval: null` preenche vazios com null em vez de skip.
  - `raw: true` preserva Date objects e números.
  - `blankrows: false` pula linhas totalmente vazias (mas linhas com tudo `null` ainda chegam — filtrar redundante).

### Limites

- Input máximo: **50 MB** (mesmo `MAX_INPUT_BYTES` do TikTok parser). Reusar constante via import direto se não quiser duplicar — ok também duplicar pra independência.
- Tempo: 50k linhas ML típicas processam em ~5s. Pode ser otimizado depois se necessário.

### Anti-padrões a evitar

- ❌ `XLSX.readFile(...)` — opera em disco, não funciona com Buffer da rede.
- ❌ `sheet_to_json` com `header: A` ou sem `range` — ignora o offset de linhas e retorna metadata como dado.
- ❌ Confiar em ordem de colunas — usar `indexPorColuna` map a partir do header (como TikTok parser).
- ❌ `cellDates: false` + `raw: false` — perde tipo do Date; fica string formatada local-dependent.

---

## Especificação da Inngest function

`src/inngest/functions/central-envios/parsear-ml.ts`. Mesma estrutura de `parsear-tiktok.ts`. Diferenças:

| Aspecto | TikTok (existente) | ML (novo) |
|---|---|---|
| Evento | `central-envios/parsear-tiktok.solicitado` | `central-envios/parsear-ml.solicitado` |
| Function ID | `central-envios-parsear-tiktok` | `central-envios-parsear-ml` |
| Function name | `Central de Envios — Parser TikTok CSV` | `Central de Envios — Parser ML XLSX` |
| Parser chamado | `parsearTikTokCsv` | `parsearMlXlsx` |
| Tipo no `ingestao_run` | `'tiktok_csv'` | `'ml_xlsx'` |

Lifecycle, retry, idempotência, onFailure, persistência inline vs offload — **idênticos** ao RITM-02. Reutilizar a função `inferirCodigoErro` ou duplicar? **Duplicar** (cópia barata, mantém domínios isolados; se vira > 3 functions, extrair pra `src/inngest/lib/inferir-codigo.ts`).

Registro: adicionar à lista em `src/inngest/functions/index.ts`:

```ts
import { parsearTikTokFunction } from "./central-envios/parsear-tiktok";
import { parsearMlFunction } from "./central-envios/parsear-ml";

export const functions = [parsearTikTokFunction, parsearMlFunction];
```

---

## Especificação do route handler

`POST /api/central-envios/ingestao/mercado-livre`.

Mesma forma do TikTok route, com 2 diferenças:

1. Pathname do Blob: `central-envios/ingestao/mercado-livre/${runId}-${arquivo.name}`.
2. `tipo: 'ml_xlsx'` no INSERT.
3. Validação adicional Zod: `arquivo.size > 0`, `<= 50MB`. Aceitar qualquer MIME (alguns browsers mandam `application/octet-stream` pra .xlsx — não bloquear). Conferir extensão `.xlsx`/`.xls` no nome opcionalmente, com warning não-bloqueante.

Evento Inngest disparado:

```ts
await inngest.send({
  name: EVENTO_PARSEAR_ML,
  data: { runId, contaId, blobUrl: blob.url },
});
```

GET `/api/central-envios/ingestao/[runId]` continua o mesmo — agnóstico de `tipo`.

---

## Workflow obrigatório

```bash
# Sem migration neste RITM — schema do RITM-02 já cobre.

# 1. Implementar parser puro + testes
npm run test src/lib/central-envios/ingestao/parser-ml-xlsx.test.ts

# 2. Implementar Inngest function + registrar em index.

# 3. Implementar route handler.

# 4. Rodar tudo:
npm test
npm run check

# 5. Sweep tenant-specific:
grep -i -E '\b(LUA|NBA|BALA|BOB|SOL|CJ)\b' src/lib/central-envios src/inngest src/app/api/central-envios

# 6. Commit
```

> **Sem prod push neste RITM** — schema não mudou. Vercel deploy pega o código novo no próximo push pra main.

---

## Testes obrigatórios

`src/lib/central-envios/ingestao/parser-ml-xlsx.test.ts`. Fixtures geradas em código com `XLSX.utils.aoa_to_sheet` + `XLSX.write(...)` pra Buffer — não checar XLSX binário no git (corrompe diff e bloat).

1. ✅ XLSX básico (2 linhas válidas) → `pedidos.length === 2`, sem descartes.
2. ✅ Metadata nas linhas 1-5 + header na linha 6 → não é interpretada como dado.
3. ✅ Linha "Pacote de 3 produtos" no SKU → descarte `pacote_diversos`.
4. ✅ 2 linhas com mesmo `N.º de venda` → mantém primeiro, segundo vira `dedup_intra_arquivo`.
5. ✅ `N.º de venda` vazio → descarte `numero_venda_vazio`.
6. ✅ `Unidades = 0`, `Unidades = -1`, `Unidades = 'abc'` → todos descarte `quantidade_invalida`.
7. ✅ Coluna obrigatória ausente (`SKU` removida) → `ParserError('colunas_ausentes', ...)`.
8. ✅ `Variação`/`Estado`/`Comprador`/`N.º de envio` opcionais ausentes → parser funciona, campos `null`.
9. ✅ `Data da venda` como Date (cellDates) → `dataVendaIso` é ISO UTC.
10. ✅ `Data da venda` como string "05/06/2026 14:42:00" → tenta parse pt-BR, retorna ISO assumindo SP UTC-3.
11. ✅ `Data da venda` em formato desconhecido → `dataVendaIso === null`, `dataVendaRaw` preservado.
12. ✅ 1000 linhas → parse < 3s.
13. ✅ Idempotência: 2 chamadas com mesmo Buffer → `deepStrictEqual`.
14. ✅ Input > 50MB → `ParserError('arquivo_muito_grande', ...)`.
15. ✅ Campo `Estado` com `coleta do dia 5 de junho` → vem literal no `pedido.estado` (parser NÃO extrai prazo, isso é RITM-06).
16. ✅ Coluna `N.º` com caractere `º` (U+00BA) é reconhecida (sanity check de encoding).

---

## Critérios de aceitação

- [ ] `xlsx` library funcional para Buffer de upload (lê + `sheet_to_json` com `range: 5`)
- [ ] Parser puro implementado; **16 testes** passam
- [ ] Tipo `PedidoMlBruto` exportado com discriminador `canal: 'mercado_livre'`
- [ ] Inngest function `parsear-ml` registrada em `functions/index.ts` e visível em `http://localhost:8288` quando `inngest:dev` rodando
- [ ] POST `/ingestao/mercado-livre` aceita XLSX de 50KB e retorna `runId` em < 1s (HTTP 202)
- [ ] Inngest function processa fixture end-to-end: pendente → processando → concluido, com `tipo='ml_xlsx'`
- [ ] GET `/ingestao/[runId]` (do RITM-02, sem mudança) devolve resultado quando status=concluido
- [ ] Sweep tenant-specific (`grep -i -E '\b(LUA|NBA|BALA|BOB|SOL|CJ)\b'`) → 0 hits nos arquivos do RITM
- [ ] `npm test` 100% verde; `npm run check` 0 erros
- [ ] Doc de arquitetura (§10.2 e §15) atualizado pra ✅ feito

---

## Dúvidas (resolvidas)

| # | Pergunta | Resposta |
|---|---|---|
| 1 | Schema novo? | **Não.** RITM-02 já criou `ingestao_run` com `tipo='ml_xlsx'` no enum. |
| 2 | `xlsx` vs SheetJS Pro? | **xlsx (CE).** Já no package.json. Suficiente pra MVP. |
| 3 | Dedup transversal multi-arquivo? | **Não.** Escopo é intra-arquivo só. Cross-file é RITM-07 (sessão merge). |
| 4 | Parsear `Estado` agora? | **Não.** RITM-06. Aqui só preserva o texto raw. |
| 5 | Validar nome de arquivo? | **Não.** Operador pode renomear ou subir export antigo. |
| 6 | Header em outra linha? | **Manter 6 (índice 5).** Estrutura estável do export ML há anos. Se mudar, falha em `colunas_ausentes` — fácil de diagnosticar. |
| 7 | Aceitar `.xls` (legado)? | **Sim.** `xlsx` lib lida com ambos. Validar só extensão como warning, não bloqueante. |
| 8 | Validar timezone da data? | **Assumir SP UTC-3 fixo** (mesmo do TikTok). Documentar. |

---

## Dúvidas em aberto

1. **Formato real do "Data da venda"**: até obter um export real, testes cobrem 2 hipóteses (Date nativo via `cellDates:true` + string pt-BR `DD/MM/YYYY HH:MM:SS`). Se for outro formato, ajustar `parseDateField` e adicionar fixture.
2. **Múltiplas contas no mesmo XLSX**: o nome do arquivo inclui a `<CONTA>`, então normalmente cada XLSX é de uma conta. Se um operador consolidar manualmente, dedup por `N.º de venda` ainda funciona pra eliminar linhas idênticas — mas se o mesmo número existir em 2 contas reais (improvável, mas possível), o segundo vira descarte. Aceitável pra MVP.
3. **Variação parseável**: alguns exports trazem `Cor: PT / Tamanho: G`, outros `PT - G`. RITM-04 vai precisar lidar — fora de escopo aqui.
