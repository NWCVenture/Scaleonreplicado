# RITM-06 — Cálculo de prazo de envio + sync de feriados nacionais

> **Bloqueia:** RITM-07 (sessão agrega pedidos por prazo), RITM-08 (UI Cronograma + Dashboard precisam da data calculada).
> **Depende de:** RITM-01 (`canal_regra_prazo`, `feriado`), RITM-02/03 (parsers fornecem `criadoEm` e campos do pedido).
> **Dependência externa:** BrasilAPI (`https://brasilapi.com.br/api/feriados/v1/{ano}`) — público, sem chave.

---

## Princípio inegociável: cálculo puro + sync explícito

- `calcularPrazo(entrada, contexto)` é **função pura**. Dia útil/feriado/regex parsing operam sobre estruturas em memória, não consultam DB.
- Sync de feriados nacionais é **explícito**: operador clica botão na UI → POST endpoint → fetch BrasilAPI → upsert idempotente. Nunca automático no boot da app.
- Toda a base temporal vive em `America/Sao_Paulo` UTC-3 fixo (consistente com RITM-02/03).
- "Prazo" é representado como **data civil** `YYYY-MM-DD` (sem hora). O recorte HOJE/ATRASADO/NO_PRAZO é feito comparando contra a data civil do "hoje" SP, não contra o UTC do servidor.

Consequências:

- ❌ Nenhuma referência a TikTok/ML/Shopee no cálculo — só `plataforma` do enum, vindo da regra do canal.
- ❌ Sem `console.log` da resposta do BrasilAPI no path; usar log estruturado.
- ❌ Sem chamada de DB dentro de `calcularPrazo` — N pedidos × 1 query mata performance.
- ✅ Carrega contexto 1× por upload; processa N pedidos com lookups em memória.
- ✅ Sync BrasilAPI é idempotente: rodar 2× pra o mesmo ano não duplica.

---

## Objetivo

Dado um pedido normalizado (saída de RITM-02/03) + a regra de prazo da plataforma/canal, calcular a **data de prazo** (`YYYY-MM-DD`) ou retornar status `SEM_DATA`.

Ao fim do RITM:

- `calcularPrazo(entrada, ctx)` retorna `ResultadoCalculoPrazo`.
- 3 estratégias suportadas: `DIAS_UTEIS_POS_VENDA`, `CAMPO_EXPLICITO`, `HIBRIDO`.
- `adicionarDiasUteis(base, n, feriados)` é função pura, testável extensivamente.
- `parsePrazoExplicito(texto, regex, anoBase)` extrai data via regex pt-BR (`coleta do dia X de Y`).
- `carregarContextoPrazo(tx)` monta o snapshot: regras + feriados do ano atual + próximo ano.
- `sincronizarFeriadosNacionais(tx, contaId, ano)` faz fetch BrasilAPI + upsert em `feriado`.
- Endpoint `POST /api/central-envios/configuracoes/feriado/sync-nacional` chama o sync.

**Não inclui:**

- CRUD UI de feriados (cadastro manual via modal calendário) — RITM-10.
- CRUD UI de `canal_regra_prazo` — RITM-10.
- Agregação por dia / "atrasado vs hoje" no dashboard — RITM-07/08.
- GitHub Actions / cron de sync semanal — V2.

---

## Arquivos a criar

| Arquivo | Mudança |
|---|---|
| `src/lib/central-envios/prazo/types.ts` | `EntradaCalculoPrazo`, `ResultadoCalculoPrazo`, `StatusPrazo`, `ContextoPrazo`, `RegraPrazoSnapshot`. |
| `src/lib/central-envios/prazo/dias-uteis.ts` | `adicionarDiasUteis(base, n, feriadosSet)` + `ajustarParaDiaUtil` (puxa para próximo dia útil) + helpers de data civil. |
| `src/lib/central-envios/prazo/parse-prazo-explicito.ts` | `parsePrazoExplicito(texto, regex, anoBase)` — extrai dd/mês pt-BR. |
| `src/lib/central-envios/prazo/calcular-prazo.ts` | `calcularPrazo(entrada, ctx)` — dispatcher principal. |
| `src/lib/central-envios/prazo/carregar-contexto-prazo.ts` | Loader: 2 queries (feriado + canal_regra_prazo). |
| `src/lib/central-envios/prazo/sincronizar-feriados.ts` | `sincronizarFeriadosNacionais(tx, contaId, ano)` — fetch BrasilAPI + upsert. |
| `src/lib/central-envios/prazo/*.test.ts` | Testes node:test (puros + DB smoke + sync com fetch mockado). |
| `src/app/api/central-envios/configuracoes/feriado/sync-nacional/route.ts` | POST: aciona sync (ano atual + próximo). |
| `docs/arquitetura/modulo-central-envios.md` | Atualizar §6 e §15 (✅ feito). |

Sem schema novo. Sem migration.

---

## Tipos

```ts
export type StatusPrazo = 'CALCULADO' | 'HOJE' | 'SEM_DATA';

export type OrigemPrazo =
  | 'campo_explicito'
  | 'dias_uteis_pos_venda'
  | 'fallback_hoje';

export type EntradaCalculoPrazo = {
  plataforma: PlataformaCanal;          // chave de lookup da regra
  canalVendaId: string | null;          // null = usa regra default da plataforma
  criadoEmIso: string | null;           // ISO UTC; null se desconhecido
  // Mapa key→value pra CAMPO_EXPLICITO ler. Key tipicamente vem de
  // RegraPrazoSnapshot.campoPrazo (ex.: 'Estado'); value é o texto raw
  // do pedido (ex.: 'coleta do dia 7 de junho').
  camposExtras: Record<string, string | null>;
};

export type ResultadoCalculoPrazo = {
  status: StatusPrazo;
  prazoIso: string | null;              // YYYY-MM-DD (data civil SP). null se SEM_DATA.
  origem: OrigemPrazo | null;           // null se SEM_DATA
  detalhes: string;                     // debug humano
};

export type RegraPrazoSnapshot = {
  id: string;
  plataforma: PlataformaCanal;
  canalVendaId: string | null;
  estrategia: 'DIAS_UTEIS_POS_VENDA' | 'CAMPO_EXPLICITO' | 'HIBRIDO';
  diasUteis: number | null;
  campoPrazo: string | null;
  regexPrazo: string | null;
  fallbackHoje: boolean;
  ativo: boolean;
};

export type ContextoPrazo = {
  // Lookup: (plataforma, canalVendaId|null). Canal específico tem
  // precedência sobre default da plataforma.
  regrasPorCanal: Map<string, RegraPrazoSnapshot>;
  regrasDefaultPorPlataforma: Map<PlataformaCanal, RegraPrazoSnapshot>;
  // Set de feriados como YYYY-MM-DD pra lookup O(1) durante o cálculo.
  feriadosSet: Set<string>;
  // "Hoje" SP — usado pra fallbackHoje e comparação ATRASADO/HOJE/NO_PRAZO.
  // Calculado uma vez no load pra estabilidade durante o batch.
  hojeIso: string;
};
```

---

## Pure functions

### `dias-uteis.ts`

```ts
export function dataCivilSP(iso: string): string;           // ISO UTC → YYYY-MM-DD em SP
export function adicionarDiasUteis(
  baseYmd: string,
  n: number,
  feriadosSet: Set<string>,
): string;
export function ajustarParaDiaUtil(
  ymd: string,
  feriadosSet: Set<string>,
): string;
export function ehDiaUtil(ymd: string, feriadosSet: Set<string>): boolean;
```

Regras:

- `dataCivilSP(iso)` converte UTC → SP (UTC-3 fixo) → `'YYYY-MM-DD'`. Implementação manual sem `Intl` (evita issue de runtime).
- `ehDiaUtil(ymd, feriados)`: dia da semana ≠ 0 (dom) e ≠ 6 (sáb) e `!feriados.has(ymd)`.
- `ajustarParaDiaUtil(ymd, feriados)`: se `ehDiaUtil(ymd)`, retorna `ymd`; senão soma +1 dia até cair em dia útil.
- `adicionarDiasUteis(base, n, feriados)`: a partir de `base`, soma `n` dias úteis. Se base é dia útil, conta a partir dela; se não, primeiro ajusta. Caso `n=0`, retorna `ajustarParaDiaUtil(base)`.

### `parse-prazo-explicito.ts`

```ts
export function parsePrazoExplicito(
  texto: string,
  regex: string,            // regex string vinda de canal_regra_prazo.regexPrazo
  anoBase: number,          // ano corrente (ou de criadoEm) pra preencher
): string | null;            // YYYY-MM-DD ou null
```

Regras:

- Cria `new RegExp(regex, 'i')` — case-insensitive.
- Match groups esperados: `[1]` = dia (número), `[2]` = mês (nome pt-BR).
- Mapa de meses pt-BR (`janeiro`...`dezembro`, suportando abreviações comuns: `jan`, `fev`, etc.). Mês inválido → `null`.
- Se o mês resolvido < mês atual em SP, assume ano seguinte (compra em dezembro com prazo em janeiro). Threshold: se `mes - mesAtual < -3`, assume +1 ano.
- Output: `YYYY-MM-DD` em formato civil.
- Regex inválida → `null` + log warning.

### `calcular-prazo.ts`

```ts
export function calcularPrazo(
  entrada: EntradaCalculoPrazo,
  ctx: ContextoPrazo,
): ResultadoCalculoPrazo;
```

Pipeline:

```
1. Resolve regra:
   - lookup específico (plataforma, canalVendaId) primeiro
   - fallback pro default da plataforma
   - se não achou: SEM_DATA, detalhes='regra não cadastrada'

2. estrategia = regra.estrategia:

   DIAS_UTEIS_POS_VENDA:
     - precisa de criadoEmIso e regra.diasUteis
     - base = dataCivilSP(criadoEmIso)
     - prazo = adicionarDiasUteis(base, diasUteis, feriadosSet)
     - status = comparaComHoje(prazo, ctx.hojeIso)
     - origem = 'dias_uteis_pos_venda'

   CAMPO_EXPLICITO:
     - precisa de regra.campoPrazo e regra.regexPrazo
     - texto = entrada.camposExtras[campoPrazo]
     - anoBase = ano de criadoEmIso (ou ano de hoje)
     - prazoRaw = parsePrazoExplicito(texto, regexPrazo, anoBase)
     - se conseguiu: ajusta para dia útil, retorna CALCULADO
     - se não: aplica fallback:
       - se regra.fallbackHoje: retorna HOJE com origem='fallback_hoje'
       - senão: SEM_DATA

   HIBRIDO:
     - tenta CAMPO_EXPLICITO primeiro
     - se falhou: cai em DIAS_UTEIS_POS_VENDA
     - se ambos falharem: aplica regra.fallbackHoje

3. comparaComHoje(prazoIso, hojeIso):
   - prazo < hoje → CALCULADO (UI categoriza como ATRASADO)
   - prazo === hoje → CALCULADO (UI categoriza como HOJE)
   - prazo > hoje → CALCULADO (UI categoriza como NO_PRAZO)
   Aqui só retornamos CALCULADO; o status ATRASADO/HOJE/NO_PRAZO é
   calculado na UI (RITM-08) comparando prazoIso com hojeIso.
```

---

## Loader `carregarContextoPrazo`

```ts
export async function carregarContextoPrazo(tx: Tx): Promise<ContextoPrazo>;
```

Pipeline:

1. Calcula `hojeIso` = data civil SP.
2. Em paralelo:
   - `SELECT * FROM canal_regra_prazo WHERE ativo = true`
   - `SELECT data FROM feriado WHERE data BETWEEN <ano_atual_01_01> AND <ano_seguinte_12_31>`
3. Monta `regrasDefaultPorPlataforma` (`canal_venda_id IS NULL`) e `regrasPorCanal` (`canal_venda_id NOT NULL`, key = `${plataforma}:${canalVendaId}`).
4. Monta `feriadosSet` com strings `YYYY-MM-DD`.
5. Retorna `ContextoPrazo`.

---

## BrasilAPI sync

```ts
export type ResultadoSyncFeriados = {
  ano: number;
  inseridos: number;
  atualizados: number;
  pulados: number;
  detalhes: string;
};

export async function sincronizarFeriadosNacionais(
  tx: Tx,
  contaId: string,
  ano: number,
): Promise<ResultadoSyncFeriados>;
```

Pipeline:

1. `fetch('https://brasilapi.com.br/api/feriados/v1/' + ano, { signal: AbortSignal.timeout(15_000) })`.
2. Valida resposta com Zod: array de `{ date: string YYYY-MM-DD, name: string, type?: string }`.
3. Para cada feriado:
   - `referenciaExterna = slugify(name)` (slug determinístico pra idempotência).
   - Upsert em `feriado` `(contaId, data)`: se já existe com `fonte='manual'` → pula (preserva manual); se já existe com `fonte='nacional_api'` → atualiza apenas `descricao`.
   - Se não existe → INSERT com `fonte='nacional_api'`.
4. Retorna estatísticas.

Decisões:
- **Não deletar** feriados que não vieram do BrasilAPI — operador pode ter cadastrado manualmente coisas que não são oficiais (eventos da empresa, paradas de operação).
- **Não tocar** em entries `fonte='manual'` — só `nacional_api`.
- Idempotente: rodar 2× pro mesmo ano resulta em 0 inseridos da 2ª vez.

### Endpoint

`POST /api/central-envios/configuracoes/feriado/sync-nacional`:

- Auth: requer admin (`requireAdminAtivo`).
- Body: `{ ano?: number }` (default: ano corrente + próximo ano).
- Chama `sincronizarFeriadosNacionais` em loop pelos anos.
- Retorna `{ resultados: ResultadoSyncFeriados[] }`.

---

## Edge cases tratados (com testes)

| Caso | Resultado |
|---|---|
| DIAS_UTEIS_POS_VENDA: criado quarta + 2 dias úteis | sexta |
| DIAS_UTEIS_POS_VENDA: criado sexta + 2 dias úteis | terça |
| DIAS_UTEIS_POS_VENDA pulando feriado | data + feriados extras |
| DIAS_UTEIS com base no fim de semana → ajusta pra segunda primeiro | n=0 sex 22h → segunda |
| CAMPO_EXPLICITO: 'coleta do dia 7 de junho', anoBase=2026 | '2026-06-07' (ajustado dia útil) |
| CAMPO_EXPLICITO: 'coleta do dia 7 de jan', anoBase=2025 (mês atual=set) | '2026-01-07' (assume próximo ano) |
| CAMPO_EXPLICITO: campo texto null | fallbackHoje true → HOJE; false → SEM_DATA |
| CAMPO_EXPLICITO: regex não casa | mesma queda no fallback |
| CAMPO_EXPLICITO com mês inválido ('fevreio') | fallback aplicado |
| HIBRIDO: campo presente → CAMPO_EXPLICITO usado | CALCULADO |
| HIBRIDO: campo ausente → DIAS_UTEIS_POS_VENDA | CALCULADO |
| HIBRIDO: ambos falham + fallbackHoje=false | SEM_DATA |
| Regra inexistente pra (plataforma, canalVendaId) → tenta default | usa default |
| Default também ausente | SEM_DATA |
| BrasilAPI sync ok | rows inseridas |
| BrasilAPI sync 2x no mesmo ano | 0 novos |
| BrasilAPI sync mexe em manual | NÃO toca em fonte='manual' |
| BrasilAPI fetch 503 | rejeita com `sync_falhou` (UI retry) |

---

## Workflow

```bash
# Sem migration. Sem deps novas. (fetch nativo, Zod já existe.)

# 1. Implementar types + dias-uteis + parse-prazo + calcular-prazo
# 2. Implementar carregar-contexto-prazo
# 3. Implementar sincronizar-feriados (com fetch mockado em testes)
# 4. Implementar endpoint /sync-nacional
# 5. Testar:
npm test src/lib/central-envios/prazo/

# 6. Suite completa:
npm test
npm run check

# 7. Sweep tenant (deve ser ZERO):
grep -i -E '\b(LUA|NBA|BALA|BOB|SOL|CJ|AZ|PT|CZ|EGG|EXG|PRETO|AZUL)\b' \
  src/lib/central-envios/prazo/ \
  src/app/api/central-envios/configuracoes/feriado/

# 8. Commit
```

---

## Testes obrigatórios

### `dias-uteis.test.ts` (~10)

1. `dataCivilSP('2026-06-05T17:42:00.000Z')` → '2026-06-05'
2. `dataCivilSP('2026-06-05T02:00:00.000Z')` → '2026-06-04' (cruza meia-noite SP)
3. `ehDiaUtil('2026-06-06', empty)` → false (sábado)
4. `ehDiaUtil('2026-06-08', empty)` → true (segunda)
5. `ehDiaUtil('2026-01-01', {'2026-01-01'})` → false (feriado)
6. `ajustarParaDiaUtil('2026-06-06', empty)` → '2026-06-08'
7. `adicionarDiasUteis('2026-06-03', 2, empty)` → '2026-06-05' (qua+2=sex)
8. `adicionarDiasUteis('2026-06-05', 2, empty)` → '2026-06-09' (sex+2=ter)
9. `adicionarDiasUteis('2026-06-03', 2, {'2026-06-04'})` → '2026-06-08' (pula feriado qui)
10. `adicionarDiasUteis(base, 0, ...)` → ajusta sem somar

### `parse-prazo-explicito.test.ts` (~7)

1. 'coleta do dia 7 de junho', 2026 → '2026-06-07'
2. 'coleta do dia 31 de dezembro', 2026 → '2026-12-31'
3. 'coleta do dia 5 de jan', 2026 (mês atual >> jan) → '2027-01-05'
4. Mês inválido → null
5. Texto sem match → null
6. Regex inválida → null
7. Day > 31 → null

### `calcular-prazo.test.ts` (~12)

Combina estratégias + ambos os parsers fornecendo entrada.

### `carregar-contexto-prazo.test.ts` (~3)

DB smoke: insere regras, feriados; valida shape do snapshot.

### `sincronizar-feriados.test.ts` (~5)

Mock global.fetch:

1. Resposta válida → INSERTs
2. 2ª chamada com mesmos dados → 0 inseridos
3. Linha manual existente → não tocada
4. Linha nacional_api existente → descrição atualizada
5. fetch 503 → erro

---

## Critérios de aceitação

- [ ] 6 arquivos lib + 1 route + testes criados
- [ ] `calcularPrazo` é função pura (sem `await`, sem `import` de `db`)
- [ ] Loader faz 2 queries paralelas; `hojeIso` calculado uma vez
- [ ] Sync BrasilAPI idempotente; preserva manual
- [ ] Endpoint requer admin; retorna estatísticas
- [ ] 35+ testes passam
- [ ] Sweep tenant zero em `src/lib/central-envios/prazo/`
- [ ] `npm test` 100%, `npm run check` 0
- [ ] Doc §6 e §15 atualizado

---

## Dúvidas (resolvidas)

| # | Pergunta | Resposta |
|---|---|---|
| 1 | Cache do contexto? | Não. Loader é leve. |
| 2 | HIBRIDO ordem de tentativa? | CAMPO_EXPLICITO primeiro, depois DIAS_UTEIS. |
| 3 | Sync apaga feriados que sumiram do BrasilAPI? | **Não.** Operador pode ter cadastrado eventos próprios. |
| 4 | `hojeIso` muda durante o batch? | **Não.** Snapshot fixo no load. Garante consistência mesmo perto da meia-noite. |
| 5 | Endpoint público ou admin? | **Admin** (`requireAdminAtivo`). Sync mexe em config global da conta. |
| 6 | BrasilAPI rate limit? | Endpoint público sem limite documentado; timeout 15s e propagação de erro são suficientes. |

---

## Dúvidas em aberto

1. **Cobertura de meses pt-BR abreviados**: incluir `jan`, `fev`, ..., `dez`? Sim, pela prática real. Documentar lista exata no parse.
2. **Threshold ano-seguinte no parse explícito**: hoje `(mes - mesAtual < -3)`. Validar com payloads reais; ajustar se gerar falso positivo.
3. **GitHub Actions cron de sync semanal**: V2. Hoje operador clica botão.
