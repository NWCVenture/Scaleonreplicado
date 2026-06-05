# RITM-04 — Pipeline de normalização de SKU (cadastro-driven)

> **Bloqueia:** RITM-05 (explosão consome `SkuParsed`), RITM-07 (sessão merge usa contexto pra ambíguos).
> **Depende de:** RITM-01 (`modelo_principal`, `modelo_cor`, `modelo_tamanho`, `tamanho_alias`, `cor_alias`), RITM-02 e RITM-03 (parsers produzem o input). Migrations aplicadas em dev/prod.
> **Dependência externa:** nenhuma.

---

## Princípio inegociável: parser puro + zero conhecimento de tenant

- A normalização é uma **função pura** `parsearSku(input, contexto)` — sem DB, sem fetch, sem efeito colateral. Testável com fixtures sintéticas.
- **Zero hardcode** de modelo/cor/tamanho/alias. Todo conhecimento vem do `ContextoCadastro` (snapshot do banco). Tenant novo entra sem nenhum código mudar.
- O loader `carregarContextoCadastro(tx, contaId)` faz **uma única passada de queries** por chamada — usado uma vez por upload e cacheado em memória durante a normalização.

Consequências:

- ❌ Nenhuma referência a `LUA`, `NBA`, `BALA`, `PT`, `AZ`, `EGG`, etc. em código ou testes. Fixtures usam `MOD1`, `COR1`, `TAM1`, `ALIAS1`.
- ❌ Não fazer DB call dentro de `parsearSku` — N pedidos × 1 query = death by 1000 cuts.
- ✅ Carrega contexto 1× por upload, parseia N SKUs sem tocar no banco.
- ✅ Para SKUs que não casam com nada, retorna `SkuAmbiguo` com motivo explícito. Não chuta.

---

## Objetivo

Transformar o `sellerSku` (TikTok) ou `sku` (ML) em uma estrutura tipada que descreve o que aquele SKU representa — modelo, cores com quantidades, tamanho — usando aliases e regras de inferência cadastro-driven.

Ao fim do RITM:

- Função pura `parsearSku(input, contexto)` retorna `SkuParsed | SkuAmbiguo`.
- Função `carregarContextoCadastro(tx, contaId)` monta o snapshot do tenant.
- 5 tipos de SKU reconhecidos: `AVULSO`, `KIT_COR_UNICA`, `KIT_CORES_LISTADAS`, `KIT_DISTRIBUICAO`, `MIX`.
- Detecção de 7+ tipos de ambiguidade com motivo machine-readable.
- Forma canônica pra lookup futuro em `sku_kit_regra` (RITM-05).

**Não inclui:**

- Explosão (KIT 2 LUA → 2 unidades) — RITM-05.
- Lookup em `sku_kit_regra` pra composições nominais (KIT BALA LUA) — RITM-05.
- Cálculo de prazo / regras de canal — RITM-06.
- UI de cadastro de aliases — RITM-10.

---

## Arquivos a criar

| Arquivo | Mudança |
|---|---|
| `src/lib/central-envios/normalizacao/types.ts` | Tipos `SkuKind`, `SkuParsed`, `SkuAmbiguo`, `MotivoAmbiguidade`, `ContextoCadastro`, `ModeloSnapshot`. |
| `src/lib/central-envios/normalizacao/carregar-contexto.ts` | Loader from DB: `carregarContextoCadastro(tx, contaId)`. |
| `src/lib/central-envios/normalizacao/aplicar-aliases.ts` | Pré-processamento: uppercase, trim, aplica aliases globais e (opcionalmente) por modelo. |
| `src/lib/central-envios/normalizacao/tokenizar.ts` | Quebra o texto pré-processado em tokens. |
| `src/lib/central-envios/normalizacao/parsear-sku.ts` | Função pública principal `parsearSku(input, ctx)`. |
| `src/lib/central-envios/normalizacao/canonical.ts` | Constrói a forma canônica a partir de `SkuParsed`. |
| `src/lib/central-envios/normalizacao/parsear-sku.test.ts` | Testes do parser (extenso, fixtures genéricas). |
| `src/lib/central-envios/normalizacao/aplicar-aliases.test.ts` | Testes do pré-processamento. |
| `src/lib/central-envios/normalizacao/carregar-contexto.test.ts` | Smoke test do loader contra DB. |
| `docs/arquitetura/modulo-central-envios.md` | Atualizar §4 e §15 (✅ feito). |

Sem schema novo. Sem migration.

---

## Tipos

```ts
export type SkuKind =
  | 'AVULSO'
  | 'KIT_COR_UNICA'
  | 'KIT_CORES_LISTADAS'
  | 'KIT_DISTRIBUICAO'
  | 'MIX';

export type ParCorQtd = { cor: string; qtd: number };

export type SkuParsed = {
  kind: SkuKind;
  modeloCodigo: string;
  cores: ParCorQtd[];        // sempre não-vazio; AVULSO → len=1 qtd=1
  tamanho: string;           // 'UNICO' para modelo.exigeTamanho=false
  qtdKit: number;            // 1 para AVULSO; N para KIT/MIX
  canonical: string;         // forma canônica pra lookup em sku_kit_regra
  input: string;             // input cru
  preprocessado: string;     // após uppercase + trim + alias global
};

export type MotivoAmbiguidade =
  | 'input_vazio'
  | 'modelo_desconhecido'
  | 'cor_desconhecida'
  | 'tamanho_desconhecido'
  | 'kit_sem_n'
  | 'kit_inconsistente'      // qtd ≠ soma das cores
  | 'cor_ausente'            // modelo sem corPadrao + nenhuma cor no SKU
  | 'tamanho_ausente'        // modelo.exigeTamanho=true + nenhum tamanho
  | 'tokens_extras'          // sobrou token sem categoria
  | 'mix_invalido';          // MIX sem N OU sem modelo

export type SkuAmbiguo = {
  kind: 'AMBIGUO';
  input: string;
  preprocessado: string;
  motivo: MotivoAmbiguidade;
  detalhes: string;          // humano
  tokensInterpretados: Array<{
    token: string;
    resolvido: string | null;
    categoria: 'modelo' | 'cor' | 'tamanho' | 'qtd' | 'kit' | 'mix' | 'desconhecido';
  }>;
};

export type ResultadoParsearSku = SkuParsed | SkuAmbiguo;

export type ModeloSnapshot = {
  id: string;
  codigo: string;            // já em UPPERCASE
  corPadrao: string | null;  // UPPERCASE quando não-null
  exigeTamanho: boolean;
  corMixDefault: Record<string, string[]> | null;
  cores: string[];           // UPPERCASE, ordem alfabética
  tamanhos: string[];        // UPPERCASE, ordem do cadastro (ordem ASC)
};

export type ContextoCadastro = {
  modelos: ModeloSnapshot[];                       // só ativos
  modelosPorCodigo: Map<string, ModeloSnapshot>;   // UPPERCASE → snapshot
  coresGlobais: Set<string>;                       // cor_catalogo, UPPERCASE
  tamanhosGlobais: Set<string>;                    // tamanho_catalogo, UPPERCASE
  aliasesGlobais: {
    cor: Map<string, string>;                      // UPPERCASE → UPPERCASE
    tamanho: Map<string, string>;
  };
  aliasesPorModelo: Map<string, {                  // modeloId → ...
    cor: Map<string, string>;
    tamanho: Map<string, string>;
  }>;
};
```

> **Convenção UPPERCASE end-to-end.** O contexto guarda tudo em maiúscula; o pré-processador faz `toUpperCase()` no input. Compara-se sempre maiúscula-vs-maiúscula. Saída do parser também é maiúscula. Documentado no JSDoc dos tipos.

---

## Loader — `carregarContextoCadastro`

```ts
export async function carregarContextoCadastro(
  tx: Tx,                  // transação já dentro de withConta
  contaId: string,         // pra log, RLS já isola
): Promise<ContextoCadastro>;
```

Queries (todas com RLS via `withConta` no caller):

1. `SELECT id, codigo, cor_padrao, exige_tamanho, cor_mix_default FROM modelo_principal WHERE ativo = true`
2. `SELECT modelo_id, codigo FROM modelo_cor WHERE ativo = true`
3. `SELECT modelo_id, codigo FROM modelo_tamanho WHERE ativo = true ORDER BY ordem ASC`
4. `SELECT codigo FROM cor_catalogo`
5. `SELECT codigo FROM tamanho_catalogo`
6. `SELECT modelo_id, codigo_alias, codigo_real FROM tamanho_alias`
7. `SELECT modelo_id, codigo_alias, codigo_real FROM cor_alias`

Tudo em paralelo via `Promise.all`. Total: ~7 queries leves, < 100ms em prod.

Loader **uppercase tudo** no momento de montar o snapshot — não pôr essa responsabilidade no parser.

**Sem cache cross-request neste RITM.** Pode ser adicionado depois (TTL 1min?), mas KISS por agora.

---

## Pipeline do parser

```
input: "kit lua 2 pt 1 az m"
  │
  1. Preprocessamento:
     uppercase + trim
     aplica aliases globais (text replace, word-boundary)
  │
  2. Tokenização: split por espaço, filtra vazios
     tokens: ["KIT", "LUA", "2", "PT", "1", "AZ", "M"]
  │
  3. Detecta "KIT" ou "MIX" no início → kind inicial
  │
  4. Identifica modelo: primeiro token que casa modelo_principal.codigo
     Se não achar → AMBIGUO(modelo_desconhecido)
     Após identificar, aplica aliases por modelo nos tokens restantes
  │
  5. Extrai N (qtdKit):
     KIT: número logo após "KIT" OU soma das qtds OU qtd de cores
     MIX: número logo após "MIX"
     AVULSO: 1
  │
  6. Extrai cores + quantidades + tamanho dos tokens restantes:
     - Detecta sequências [num] cor → distribuição
     - Cores soltas → cores listadas
     - Última (ou única) cor + tamanho separado → cor única
  │
  7. Validação:
     - kind KIT_CORES_LISTADAS → len(cores) === N
     - kind KIT_DISTRIBUICAO  → sum(qtd_i) === N
     - tamanho presente OU modelo.exigeTamanho=false
     - cor presente OU modelo.corPadrao
  │
  8. Constrói canonical:
     AVULSO:                "MODELO COR TAM"
     KIT_COR_UNICA:         "KIT N MODELO COR TAM"
     KIT_CORES_LISTADAS:    "KIT N MODELO COR1 COR2 ... TAM"  (sort cores alfa)
     KIT_DISTRIBUICAO:      "KIT N MODELO Q1 COR1 Q2 COR2 ... TAM"  (sort cor alfa)
     MIX:                   "MIX N MODELO TAM"
```

### Regras de pertencimento

- Um token é **cor** se está em `modelo.cores` OU `coresGlobais` (após resolver aliases do modelo).
- Um token é **tamanho** se está em `modelo.tamanhos` OU `tamanhosGlobais` (após aliases).
- Aliases por modelo têm **precedência** sobre aliases globais (alias global é aplicado no preprocessamento; por-modelo é aplicado token-a-token após identificar o modelo).

### Inferências cadastro-driven

- Modelo sem `corPadrao` + SKU sem cor → `AMBIGUO(cor_ausente)`.
- Modelo com `corPadrao` + SKU sem cor → `cores = [{ cor: corPadrao, qtd: qtdKit }]`.
- Modelo `exigeTamanho=false` + SKU sem tamanho → `tamanho = 'UNICO'`.
- Modelo `exigeTamanho=false` + SKU **com** token de tamanho válido → `AMBIGUO(tokens_extras)`.
  - Decisão pragmática: se o modelo não tem grade, qualquer token a mais é suspeito. Operador pode adicionar alias se for falso positivo.
- Modelo `exigeTamanho=true` + SKU sem tamanho → `AMBIGUO(tamanho_ausente)`.

### Heurísticas pra detectar KIT_DISTRIBUICAO vs KIT_CORES_LISTADAS

```
Após identificar modelo e N:
  Tokens restantes (cores + tamanho):
  - Se algum token é um número > 0 ANTES de uma cor → DISTRIBUICAO.
  - Se todos os tokens não-tamanho são cores (sem números) → CORES_LISTADAS se len > 1, COR_UNICA se len = 1.
```

### N implícito

- `KIT LUA AZ G` (sem N) — `N := número de cores listadas = 1`. Vira `KIT_COR_UNICA` com N=1.
  - Decisão: N=1 KIT é equivalente a AVULSO. **Normalizar pra AVULSO** quando N=1 e kind seria KIT_COR_UNICA. Reduz ambiguidade nos relatórios.
- `KIT 2 LUA AZ G` (cor única + N explícito) → `KIT_COR_UNICA` N=2.

---

## Edge cases tratados (com testes)

| Caso | Resultado |
|---|---|
| Input vazio / só whitespace | `AMBIGUO(input_vazio)` |
| Só modelo (`"LUA"`) + corPadrao + exigeTamanho=false | `AVULSO` com `cores=[{cor:corPadrao,qtd:1}]`, `tamanho='UNICO'` |
| Modelo + tamanho sem cor + corPadrao | `AVULSO` |
| Modelo + cor sem tamanho + exigeTamanho=true | `AMBIGUO(tamanho_ausente)` |
| Modelo + tamanho sem cor + sem corPadrao | `AMBIGUO(cor_ausente)` |
| KIT N com cores listadas onde N ≠ len(cores) | `AMBIGUO(kit_inconsistente)` |
| KIT N com distribuição onde N ≠ sum(qtd_i) | `AMBIGUO(kit_inconsistente)` |
| MIX N e modelo identificado | `MIX` com `cores=[]` (RITM-05 popula via `corMixDefault` ou top-N) |
| MIX sem N | `AMBIGUO(mix_invalido)` |
| MIX sem modelo identificado | `AMBIGUO(modelo_desconhecido)` |
| Token desconhecido após interpretação completa | `AMBIGUO(tokens_extras)` com lista de tokens |
| Cor não está em `modelo.cores` mas está em `coresGlobais` | aceita |
| Alias global cor `PRETO→PT` aplicada no preprocessamento | resolvido transparente |
| Alias por modelo `EXG→EGG` aplicada token-a-token após identificar modelo | resolvido transparente |
| Alias por modelo bate com alias global diferente | por-modelo vence; global ignorado |
| Modelo é case-insensitive (`lua`/`LUA`/`Lua`) | uppercase no preprocessador → matches |

---

## Workflow

```bash
# Sem migration. Sem deps novas. Implementação pura JS/TS + DB query light.

# 1. Implementar types + loader (ler schema RITM-01)
# 2. Implementar aplicar-aliases + tokenizar
# 3. Implementar parsear-sku + canonical
# 4. Testar:
npm test src/lib/central-envios/normalizacao/parsear-sku.test.ts
npm test src/lib/central-envios/normalizacao/aplicar-aliases.test.ts
npm test src/lib/central-envios/normalizacao/carregar-contexto.test.ts

# 5. Suite completa:
npm test
npm run check

# 6. Sweep tenant-specific (deve ser ZERO):
grep -i -E '\b(LUA|NBA|BALA|BOB|SOL|CJ|AZ|PT|CZ|EGG|EXG|PRETO|AZUL)\b' \
  src/lib/central-envios/normalizacao/

# 7. Commit
```

---

## Testes obrigatórios

### `parsear-sku.test.ts` (~25 testes, todos com fixtures sintéticas)

Contexto-fixture genérico (criado por helper `criarContextoFixture`):
- Modelo `MOD1` (corPadrao=`COR_PAD`, exigeTamanho=true, cores=[COR1, COR2, COR3, COR4], tamanhos=[TAM1, TAM2, TAM3])
- Modelo `MOD2` (corPadrao=null, exigeTamanho=false, cores=[], tamanhos=[])
- Modelo `MOD3` (corPadrao=null, exigeTamanho=true, cores=[COR1, COR2], tamanhos=[TAM1], corMixDefault={"3":[COR1,COR2,COR1]})
- Alias global cor `ALIAS_COR1 → COR1`
- Alias global tamanho `ALIAS_TAM1 → TAM1`
- Alias por modelo MOD1 cor `ALIAS_MOD1 → COR2`
- `coresGlobais = { COR1, COR2, COR3, COR4 }`
- `tamanhosGlobais = { TAM1, TAM2, TAM3 }`

Casos:
1. AVULSO: `MOD1 COR1 TAM1` → kind AVULSO, qtdKit=1
2. AVULSO sem cor com corPadrao: `MOD2` → cores=[{cor:'UNICO_cor_padrao_simulado',qtd:1}], tamanho='UNICO' — actually MOD2 has corPadrao=null so revise. Use MOD1 modified: `MOD1 TAM1` (no cor, MOD1.corPadrao='COR_PAD') → cores=[{cor:'COR_PAD',qtd:1}]
3. KIT_COR_UNICA: `KIT 2 MOD1 COR1 TAM1` → kind=KIT_COR_UNICA, qtdKit=2, cores=[{COR1,2}]
4. KIT_CORES_LISTADAS: `KIT 3 MOD1 COR1 COR2 COR3 TAM1` → cores ordenadas
5. KIT_DISTRIBUICAO: `KIT 3 MOD1 2 COR1 1 COR2 TAM1` → sum=3
6. KIT N implícito (N=1) → vira AVULSO
7. MIX: `MIX 4 MOD1 TAM1` → kind=MIX
8. MIX sem N → AMBIGUO(mix_invalido)
9. MIX sem modelo identificado → AMBIGUO(modelo_desconhecido)
10. AMBIGUO(modelo_desconhecido): `XYZ COR1 TAM1`
11. AMBIGUO(cor_desconhecida): `MOD1 COR_ESTRANHA TAM1` (e COR_ESTRANHA não está em coresGlobais)
12. AMBIGUO(tamanho_desconhecido): `MOD1 COR1 TAM_ESTRANHO`
13. AMBIGUO(kit_inconsistente): `KIT 3 MOD1 COR1 COR2 TAM1` (N=3 cores listadas=2)
14. AMBIGUO(kit_inconsistente): `KIT 3 MOD1 2 COR1 2 COR2 TAM1` (soma=4)
15. AMBIGUO(cor_ausente): `MOD3 TAM1` (corPadrao=null)
16. AMBIGUO(tamanho_ausente): `MOD1 COR1`
17. AMBIGUO(tokens_extras): `MOD1 COR1 TAM1 EXTRA`
18. AMBIGUO(tokens_extras): `MOD2 TAM1` (exigeTamanho=false mas TAM1 veio)
19. AMBIGUO(input_vazio): `""`
20. Alias global cor aplicado: `MOD1 ALIAS_COR1 TAM1` → resolvido pra COR1, kind=AVULSO
21. Alias global tamanho aplicado: `MOD1 COR1 ALIAS_TAM1` → kind=AVULSO
22. Alias por modelo: `MOD1 ALIAS_MOD1 TAM1` → resolvido pra COR2 (por-modelo de MOD1)
23. Alias por modelo NÃO se aplica em outro modelo: `MOD2 ALIAS_MOD1 TAM1` → AMBIGUO ou diferente (verifica que o alias de MOD1 não vaza)
24. Idempotência: 2 chamadas com mesmo input + mesmo contexto → deepEqual
25. Canonical correto: `kit 2 mod1 cor1 tam1` → canonical = `"KIT 2 MOD1 COR1 TAM1"`
26. Canonical sort de cores listadas: `KIT 2 MOD1 COR2 COR1 TAM1` (ordem invertida) → canonical = `"KIT 2 MOD1 COR1 COR2 TAM1"` (alfa)

### `aplicar-aliases.test.ts` (~5 testes)

1. Uppercase + trim
2. Alias global aplicado com word-boundary (não pega substring acidental)
3. Múltiplos aliases na mesma string
4. Alias por modelo só aplica depois de identificar modelo (testar separadamente)
5. Quando alias global e por-modelo divergem: por-modelo vence

### `carregar-contexto.test.ts` (~3 testes)

Pequeno smoke test contra DB local:

1. Cria conta tmp + 1 modelo + 1 cor + 1 alias → carregarContextoCadastro retorna snapshot esperado.
2. Modelos `ativo=false` não aparecem no snapshot.
3. Cor `ativo=false` em `modelo_cor` não aparece.

---

## Critérios de aceitação

- [ ] 6 arquivos criados em `src/lib/central-envios/normalizacao/`
- [ ] Types exportados (10): `SkuKind`, `SkuParsed`, `SkuAmbiguo`, `MotivoAmbiguidade`, `ParCorQtd`, `ContextoCadastro`, `ModeloSnapshot`, `ResultadoParsearSku`, …
- [ ] `parsearSku(input, ctx)` é função pura: sem `await`, sem `import` de `db`
- [ ] Loader `carregarContextoCadastro` faz 7 queries paralelas e retorna `ContextoCadastro`
- [ ] 25+ testes do parser, 5 dos aliases, 3 do loader — todos passam
- [ ] Sweep tenant-specific (`LUA|NBA|BALA|BOB|SOL|CJ|AZ|PT|CZ|EGG|EXG|PRETO|AZUL`) → 0 hits em `src/lib/central-envios/normalizacao/`
- [ ] `npm test` 100% verde, `npm run check` zero erros
- [ ] Doc de arquitetura (§4 e §15) atualizado

---

## Dúvidas (resolvidas)

| # | Pergunta | Resposta |
|---|---|---|
| 1 | KIT com N=1 vira AVULSO? | **Sim.** Simplifica relatórios, evita 2 kinds equivalentes. |
| 2 | Aliases por modelo vs global — quem ganha? | **Por modelo.** Aplicado depois de identificar modelo, sobrescreve. |
| 3 | MIX popula cores aqui ou em RITM-05? | **RITM-05.** Aqui MIX retorna `cores=[]`. Resolução da lista (corMixDefault ou top-N) é parte da explosão. |
| 4 | Forma canônica com tamanho? | **Sim** — `MODELO COR TAM`. Inclui tamanho mesmo pra modelo.exigeTamanho=false (`TAM='UNICO'`). |
| 5 | Cache do contexto entre requests? | **Não nesta RITM.** Loader é rápido; se virar gargalo, cache TTL pequeno depois. |
| 6 | E se modelo.codigo tem espaço (ex.: `LUA PLUS`)? | Decisão: **proibir no cadastro** (RITM-10 valida). Aqui assumimos token-único = código. Documentar limitação. |
| 7 | Maiúscula vs minúscula? | **Tudo UPPERCASE** end-to-end. Snapshot upper, input upper, comparação binária. |
| 8 | `KIT_COMPOSTO` (BALA+LUA) está no kind? | **Não — fica para RITM-05.** Aqui o SKU `KIT BALA LUA PT M` provavelmente cai em `AMBIGUO(tokens_extras)` ou `modelo_desconhecido` se tiver 2 modelos — e RITM-05 trata como lookup direto em `sku_kit_regra` antes do parser paramétrico. |

---

## Dúvidas em aberto

1. **Performance**: 10k SKUs × parsearSku. Premissa: cada chamada < 1ms (puro JS, sem regex pesada). Teste de stress no RITM-05 valida.
2. **Alias com espaço**: `'KIT 2' → '2 KIT'` cobre? Hoje aliases são tokens simples. Se aparecer demanda, expandir pra suportar substituição multi-token. Não escopo aqui.
3. **Detecção de `KIT_COMPOSTO`**: hoje delegada pro RITM-05. Se o parser pudesse detectar 2 modelos consecutivos, ajudaria — fica como possível melhoria.
