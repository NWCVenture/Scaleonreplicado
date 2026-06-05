# RITM-05 — Pipeline de explosão de SKU

> **Bloqueia:** RITM-07 (sessão usa `LinhaExplodida` agregada), RITM-08 (UI consome agregações por dia/cor/tamanho).
> **Depende de:** RITM-04 (`SkuParsed` é o input), RITM-01 (`sku_kit_regra` + `sku_kit_componente` + `modelo_principal.corMixDefault`).
> **Dependência externa:** nenhuma.

---

## Princípio inegociável: função pura sobre `SkuParsed`

- A explosão é uma **função pura** `explodirSku(parsed, contexto)` — sem DB, sem efeito colateral.
- O **lookup nominal** (sku_kit_regra) precede o paramétrico. Se o operador cadastrou explicitamente uma composição (ex.: KIT BALA LUA → 1 BALA PT M + 1 LUA PT M), respeitamos sem nenhuma heurística.
- Para MIX, a resolução das cores é cadastro-driven: `corMixDefault[N]` se cadastrado, senão top-N de `modelo.cores` em ordem alfabética. Zero hardcode.
- O contexto de explosão é carregado **1× por upload** (mesmo lifecycle do contexto de normalização).

Consequências:

- ❌ Nenhum if `modelo === 'BALA'` ou cores nominais no código.
- ❌ Sem chamada de DB dentro de `explodirSku` — N pedidos × 1 query = death by 1000 cuts.
- ✅ AVULSO/KIT_*/MIX/AMBIGUO dispatcham por discriminador. Fácil estender.
- ✅ Se um componente de `sku_kit_regra` é AMBIGUO, propaga erro com motivo claro — não chuta.

---

## Objetivo

Transformar cada `SkuParsed` (do RITM-04) numa lista de **linhas explodidas** `{modeloCodigo, cor, tamanho, qtd}`, levando em conta:

1. Match nominal em `sku_kit_regra` por **canonical string** (pré-canonicalizada via `parsearSku` no load).
2. Padrão paramétrico: AVULSO, KIT_COR_UNICA, KIT_CORES_LISTADAS, KIT_DISTRIBUICAO.
3. MIX: usa `corMixDefault[N]` se cadastrado; senão top-N de `modelo.cores` (alfa).

Ao fim do RITM:

- `explodirSku(parsed, ctx)` retorna `LinhasExplodidas` ou `ExplosaoErro`.
- `carregarContextoExplosao(tx, contextoCadastro)` carrega `sku_kit_regra` + `sku_kit_componente`, canonicaliza cada regra, monta `Map<canonical, KitRegraSnapshot>`.
- Componentes que falham a canonicalização são **logados como aviso** mas não derrubam o load (resilient: cadastros velhos / mal-formados não bloqueiam upload).

**Não inclui:**

- Cálculo de prazo / SLA — RITM-06.
- Persistência das linhas explodidas em sessão — RITM-07.
- UI de cadastro de kits — RITM-10 (UI de coletas já tem em `/coletas/configuracoes/kit-rules`).

---

## Arquivos a criar

| Arquivo | Mudança |
|---|---|
| `src/lib/central-envios/explosao/types.ts` | Tipos `LinhaExplodida`, `ResultadoExplosao`, `ExplosaoErro`, `MotivoExplosaoErro`, `ContextoExplosao`, `KitRegraSnapshot`. |
| `src/lib/central-envios/explosao/carregar-contexto-explosao.ts` | Loader: lê `sku_kit_regra` + `sku_kit_componente`, canonicaliza via `parsearSku`. |
| `src/lib/central-envios/explosao/explodir-sku.ts` | Função pública `explodirSku(parsed, ctx)`. |
| `src/lib/central-envios/explosao/explodir-sku.test.ts` | Testes do dispatcher + cada kind. |
| `src/lib/central-envios/explosao/carregar-contexto-explosao.test.ts` | Smoke do loader (kit regra canonicalizada → entra no Map). |
| `docs/arquitetura/modulo-central-envios.md` | Atualizar §5 e §15 (✅ feito). |

Sem schema novo. Sem migration.

---

## Tipos

```ts
export type LinhaExplodida = {
  modeloCodigo: string;
  cor: string;
  tamanho: string;
  qtd: number;
};

export type MotivoExplosaoErro =
  | 'componente_ambiguo'           // componente cadastrado em sku_kit_regra é AMBIGUO
  | 'componente_nao_avulso'        // componente parseado mas não é AVULSO (nested kit é V2)
  | 'mix_cores_insuficientes'      // MIX N e modelo.cores tem < N
  | 'mix_modelo_sem_cores'         // MIX N e modelo.cores está vazio (e sem corMixDefault[N])
  | 'sku_kind_nao_suportado';      // defensivo: kind inesperado

export type ExplosaoErro = {
  kind: 'EXPLOSAO_ERRO';
  motivo: MotivoExplosaoErro;
  detalhes: string;
  parsed: SkuParsed;               // input que falhou
};

export type LinhasExplodidas = {
  kind: 'LINHAS';
  linhas: LinhaExplodida[];
  origem: 'nominal' | 'parametrico';  // como veio
  canonical: string;                  // canonical do parsed (pra correlação)
};

export type ResultadoExplosao = LinhasExplodidas | ExplosaoErro;

export type KitRegraSnapshot = {
  id: string;
  kitSku: string;             // texto original
  canonical: string;          // forma canônica pra lookup
  componentes: Array<{
    componenteSku: string;    // texto original
    componenteCanonical: string;
    quantidade: number;
    modeloCodigo: string;
    cor: string;
    tamanho: string;
  }>;
};

export type ContextoExplosao = {
  cadastro: ContextoCadastro;
  kitRegrasPorCanonical: Map<string, KitRegraSnapshot>;
  kitRegrasComProblema: Array<{
    kitRegraId: string;
    kitSku: string;
    motivo: 'kit_sku_ambiguo' | 'componente_ambiguo' | 'componente_nao_avulso';
    detalhes: string;
  }>;
};
```

> `kitRegrasComProblema` é informativo — quem chamar pode logar/exibir avisos. Carregar não falha.

---

## Loader — `carregarContextoExplosao`

```ts
export async function carregarContextoExplosao(
  tx: Tx,
  cadastro: ContextoCadastro,  // já carregado em RITM-04
): Promise<ContextoExplosao>;
```

Pipeline:

1. `SELECT * FROM sku_kit_regra` + `SELECT * FROM sku_kit_componente` em paralelo.
2. Agrupa componentes por `kitRegraId`.
3. Para cada `sku_kit_regra`:
   a. Parseia `kitSku` via `parsearSku(kitSku, cadastro)`. Se AMBIGUO → registra em `kitRegrasComProblema(kit_sku_ambiguo)` e pula.
   b. Para cada componente, parseia `componente.sku`. Se AMBIGUO → registra (componente_ambiguo) e pula a regra inteira.
   c. Se componente parseado mas kind !== AVULSO → registra (componente_nao_avulso) e pula.
      - Decisão V1: componentes precisam ser AVULSO. Nested kits são V2.
   d. Caso contrário, popula `KitRegraSnapshot` com componentes resolvidos.
4. Retorna `ContextoExplosao`.

> Performance: cadastros típicos têm < 100 kit_regras. O canonicalize é puro JS (~ms cada). Total < 200ms.

---

## Função `explodirSku`

```ts
export function explodirSku(
  parsed: SkuParsed,
  ctx: ContextoExplosao,
): ResultadoExplosao;
```

Pipeline:

1. **Lookup nominal**: se `ctx.kitRegrasPorCanonical.has(parsed.canonical)`:
   - Pega `regra.componentes`. Para cada componente, emite linha `{modeloCodigo, cor, tamanho, qtd: componente.quantidade * parsed.qtdKit}`.
   - Retorna `LinhasExplodidas` com `origem: 'nominal'`.
   - Observação: `parsed.qtdKit` multiplica. Se SKU original é `KIT 2` e a regra define componentes pra 1 unidade, multiplica por 2. (Decisão padrão; documentado.)

2. **Paramétrico**: dispatcha por `parsed.kind`:
   - **AVULSO**: 1 linha `{modeloCodigo, cor=cores[0].cor, tamanho, qtd=cores[0].qtd}` (qtd geralmente 1).
   - **KIT_COR_UNICA**: 1 linha `{modeloCodigo, cor=cores[0].cor, tamanho, qtd=cores[0].qtd}` (já agregado por cor única).
   - **KIT_CORES_LISTADAS**: N linhas, 1 por cor; cada `{modeloCodigo, cor=cores[i].cor, tamanho, qtd=cores[i].qtd}` (qtd geralmente 1).
   - **KIT_DISTRIBUICAO**: N linhas, 1 por cor com `qtd=cores[i].qtd`.
   - **MIX**: resolve cores via:
     - Se `modelo.corMixDefault[String(qtdKit)]` existe → usa essa lista.
     - Senão → top-`qtdKit` de `modelo.cores` (já sorted alfa).
     - Se a lista resolvida tem `< qtdKit` cores → `ExplosaoErro(mix_cores_insuficientes)`.
     - Senão → `qtdKit` linhas, 1 por cor, `qtd=1` cada.

3. Em qualquer caso, agrega linhas idênticas `(modeloCodigo, cor, tamanho)` somando `qtd`. Sort estável por (cor, tamanho) pra determinismo.

---

## Edge cases tratados (com testes)

| Caso | Resultado |
|---|---|
| AVULSO simples | 1 linha qtd=1 |
| KIT_COR_UNICA N=2 | 1 linha qtd=2 |
| KIT_CORES_LISTADAS N=3 (cores A,B,C) | 3 linhas qtd=1 cada |
| KIT_DISTRIBUICAO (2A + 1B) | 2 linhas: A qtd=2, B qtd=1 |
| MIX N=4, modelo.cores=[A,B,C,D,E], sem corMixDefault | 4 primeiras alfa: A,B,C,D |
| MIX N=4, modelo.corMixDefault[4]=[B,C,D,E] | usa exatamente [B,C,D,E] |
| MIX N=3, modelo.cores tem 2 cores, sem corMixDefault | ExplosaoErro(mix_cores_insuficientes) |
| MIX N=2, modelo.cores=[], modelo.corMixDefault[2]=[X,Y] | usa [X,Y] (override mesmo sem cores) |
| Match nominal: parsed.canonical bate `kit_regra.canonical` | Usa componentes, origem='nominal' |
| Match nominal com KIT 2 multiplicando regra | qtd dos componentes × parsed.qtdKit |
| KitRegra cadastrado com kitSku ambíguo | Não entra no Map; cai no paramétrico (se aplicável) |
| Componente do kit é AMBIGUO | KitRegra excluída do Map + listada em kitRegrasComProblema |

---

## Workflow

```bash
# Sem migration. Pura JS/TS.

# 1. Implementar types + loader
# 2. Implementar explodirSku
# 3. Testar:
npm test src/lib/central-envios/explosao/

# 4. Suite completa:
npm test
npm run check

# 5. Sweep tenant-specific (deve ser ZERO):
grep -i -E '\b(LUA|NBA|BALA|BOB|SOL|CJ|AZ|PT|CZ|EGG|EXG|PRETO|AZUL)\b' \
  src/lib/central-envios/explosao/

# 6. Commit
```

---

## Testes obrigatórios

### `explodir-sku.test.ts` (~18 testes)

Fixtures sintéticas: mesmo contexto base do RITM-04 (MOD1/MOD2/MOD3, COR1-4, CORP, TAM1-3) + 1 kit regra cadastrada `MOD1 COR1 TAM1` (canonical) com 2 componentes hipotéticos.

1. AVULSO → 1 linha
2. KIT_COR_UNICA N=2 → 1 linha qtd=2
3. KIT_CORES_LISTADAS → N linhas qtd=1
4. KIT_DISTRIBUICAO → N linhas com qtds corretas
5. MIX com corMixDefault[N] → usa lista exata
6. MIX sem corMixDefault → top-N de modelo.cores (alfa)
7. MIX cores insuficientes → ExplosaoErro(mix_cores_insuficientes)
8. MIX modelo sem cores + sem corMixDefault → ExplosaoErro(mix_modelo_sem_cores)
9. Match nominal: parsed.canonical bate → usa componentes
10. Match nominal com KIT 2 multiplicador → qtd dos componentes ×2
11. Sem match nominal → fallback paramétrico
12. Agregação: KIT_CORES_LISTADAS com cores duplicadas (impossível pelo parser mas defensivo)
13. Sort estável: linhas por (cor, tamanho)
14. AVULSO com modelo sem grade (tamanho=UNICO) → 1 linha tamanho=UNICO
15. Idempotência: 2 chamadas → deepEqual
16. KitRegra cuja kitSku é ambígua → não interfere; paramétrico funciona
17. KitRegra com componente parseado mas não-AVULSO → não entra no Map
18. KitRegra com componente AMBIGUO → não entra no Map, registra problema

### `carregar-contexto-explosao.test.ts` (~3 testes)

1. Insere kit_regra com kitSku canônico + 2 componentes válidos → Map contém canonical correto.
2. Insere kit_regra com kitSku ambíguo → kitRegrasComProblema registra.
3. Insere kit_regra com componente ambíguo → kitRegrasComProblema registra (componente_ambiguo).

---

## Critérios de aceitação

- [ ] 4 arquivos criados em `src/lib/central-envios/explosao/`
- [ ] Types exportados (6+): `LinhaExplodida`, `LinhasExplodidas`, `ExplosaoErro`, `MotivoExplosaoErro`, `KitRegraSnapshot`, `ContextoExplosao`, `ResultadoExplosao`
- [ ] `explodirSku(parsed, ctx)` é função pura (sem `await`, sem `import` de `db`)
- [ ] Loader canonicaliza kit_regra via `parsearSku` e separa problemas em `kitRegrasComProblema`
- [ ] 18+ testes do explodir + 3 do loader passam
- [ ] Sweep tenant-specific zero em `src/lib/central-envios/explosao/`
- [ ] `npm test` 100% verde, `npm run check` zero erros
- [ ] Doc de arquitetura (§5 e §15) atualizado

---

## Dúvidas (resolvidas)

| # | Pergunta | Resposta |
|---|---|---|
| 1 | Componente do kit pode ser outro kit (nested)? | **Não em V1.** Componentes precisam ser AVULSO. Se não, kit é excluído com problema. Nested fica pra V2 (precisa decidir profundidade max + ciclo). |
| 2 | Lookup nominal multiplica por `qtdKit`? | **Sim.** Se o parser disse KIT 2 e a regra define 1 unidade, somos respeitosos do N declarado pelo SKU. |
| 3 | MIX com cores insuficientes no cadastro → erro ou degraded? | **Erro.** Sinal claro pro operador ajustar cadastro. Degraded silencioso esconde bugs. |
| 4 | Agregar linhas duplicadas? | **Sim** — `(modelo, cor, tamanho)` igual soma `qtd`. Determinismo + UI mais limpa. |
| 5 | `corMixDefault[N]` quando lista tem != N cores? | **Loader valida no RITM-10 (UI)** que tamanho da lista = N. Aqui assumimos consistente; se vier inconsistente, usa a lista como está (pode passar com mais linhas que N). |
| 6 | Performance: 10k SKUs? | Cada `explodirSku` é O(componentes) com Map lookup. < 0.1ms por SKU em dev. Total < 1s pra 10k. Confortável. |

---

## Dúvidas em aberto

1. **Kit aninhado (V2)**: cadastrar kit cujo componente é outro kit. Demanda profundidade máxima + detecção de ciclo (DFS com visited Set). Não escopo agora.
2. **Variação livre** (ex.: "PT pintada"): componentes nominais com cores fora do cadastro. Quem usa? Documentar e revisitar se aparecer demanda real.
3. **Tag de origem na `LinhaExplodida`** (qual SKU original gerou): útil pra debug. Hoje sai do return (`origem` + `canonical` no `LinhasExplodidas`); se cair caso de uso, anexar ao LinhaExplodida.
