# RITM-07 — Sessão server-side + composer + auto-save

> **Bloqueia:** RITM-08 (UI principal lê `sessao_central_envios`), RITM-09 (UI Extrator), RITM-11 (arquivamento snapshota a sessão).
> **Depende de:** RITM-02/03 (`ingestao_run` produzem o input), RITM-04 (`parsearSku`), RITM-05 (`explodirSku`), RITM-06 (`calcularPrazo`).
> **Dependência externa:** nenhuma.

---

## Princípio inegociável: 1 sessão ativa por usuário + composer puro de domínio

- **Unique partial index** garante 1 sessão `status='ativa'` por usuário (mesmo padrão de `sessao_coletas`). 2 POSTs simultâneos não podem criar 2 sessões.
- O **composer** é a única peça que conhece como ligar RITM-02..06: dado `runIds`, busca `ingestao_run.resultado` (inline ou Blob), aplica `parsearSku` → `explodirSku` → `calcularPrazo` e produz `PedidoEnriquecido[]` + estatísticas. A função core é determinística e testável com fixtures sintéticas.
- **Snapshot grande** (`dados` jsonb) é capado em 2MB inline; acima disso, offload pro Vercel Blob com URL na tabela (mesmo padrão de RITM-02).
- **Sem hardcode tenant** em código ou testes (continuidade do princípio dos RITMs anteriores).

Consequências:

- ❌ Nenhum REST handler conhece detalhe de parser, explosão ou prazo — só chama o composer.
- ❌ Sem fetch de `ingestao_run.resultado_blob_url` no route handler — o composer trata isso internamente.
- ❌ TTL não roda em background — é "lazy" no GET, como `sessao_coletas`.
- ✅ Frontend pode chamar `/processar` várias vezes com runIds diferentes; composer faz merge + dedup por `(canal, orderId)`.
- ✅ Auto-save (PATCH) só atualiza filtros/aba — não toca em `dados` (snapshot só muda via `/processar`).

---

## Objetivo

Fechar o pipeline backend da Central de Envios: uma sessão por usuário, com snapshot do que foi ingerido + enriquecido (normalizado, explodido, com prazo) + filtros de UI, persistido com auto-save e TTL.

Ao fim do RITM:

- Tabela `sessao_central_envios` + 2 enums + RLS aplicados em dev e prod.
- Composer `processarSessao(tx, sessaoId, runIds, ctxs)` retorna `ResultadoComposer` mesclado com snapshot atual.
- 5 endpoints HTTP:
  - `GET /api/central-envios/sessao`
  - `POST /api/central-envios/sessao`
  - `PATCH /api/central-envios/sessao/[id]`
  - `POST /api/central-envios/sessao/[id]/processar`
  - `POST /api/central-envios/sessao/[id]/encerrar`
- Testes cobrem RLS, unique partial, TTL, composer com fixtures multi-run.

**Não inclui:**

- `planejamento_envios` (arquivamento) — RITM-11.
- UI / `useCentralEnviosPlanejamento` hook — RITM-08.
- Email do resumo — RITM-11.
- Inngest pra composição (decisão: composição roda inline; 10k pedidos em < 2s é confortável).

---

## Schema (1 tabela + 2 enums)

### Enums

```sql
sessao_central_envios_status        : 'ativa' | 'encerrada'
sessao_central_envios_motivo_encerro: 'finalizada' | 'forcada' | 'expirada'
```

### Tabela `sessao_central_envios`

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `text` | PK |
| `conta_id` | `text` | NOT NULL, FK → `conta.id` ON DELETE CASCADE |
| `usuario_id` | `text` | NOT NULL, FK → `user.id` ON DELETE RESTRICT |
| `status` | `sessao_central_envios_status` | NOT NULL DEFAULT `'ativa'` |
| `arquivos_ingeridos` | `jsonb` | NOT NULL DEFAULT `'[]'` — `ArquivoIngerido[]` |
| `dados` | `jsonb` | nullable — `PedidoEnriquecido[]` quando inline (< 2MB serializado) |
| `dados_blob_url` | `text` | nullable — URL do blob quando offloaded |
| `estatisticas` | `jsonb` | NOT NULL DEFAULT `'{}'` — `EstatisticasSessao` |
| `filtros_extrator` | `jsonb` | NOT NULL DEFAULT `'{}'` — estado dos filtros (RITM-09) |
| `tipo_visualizacao` | `text` | NOT NULL DEFAULT `'dashboard'` — aba ativa |
| `iniciou_em` | `timestamp` | NOT NULL DEFAULT NOW() |
| `ultima_atividade_em` | `timestamp` | NOT NULL DEFAULT NOW() |
| `encerrou_em` | `timestamp` | nullable |
| `encerrada_motivo` | `sessao_central_envios_motivo_encerro` | nullable |

**Índices:**

- `idx_sessao_ce_conta` em `(conta_id)`
- `idx_sessao_ce_usuario` em `(usuario_id)`
- `uq_sessao_ce_ativa_por_usuario` UNIQUE em `(usuario_id)` WHERE `status = 'ativa'` (mesmo padrão de `sessao_coletas`)

### RLS

```sql
ALTER TABLE sessao_central_envios ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sessao_central_envios
  USING (conta_id = current_setting('app.conta_atual', true))
  WITH CHECK (conta_id = current_setting('app.conta_atual', true));
```

Adicionar `"sessao_central_envios"` ao `TABELAS_PADRAO` em `restore-rls-policies.ts`.

> ⚠️ Unique parcial é dropado por `drizzle-kit push` em alguns casos. Conferir após o push em prod; recriar via supplements se necessário (mesmo problema do RITM-01).

---

## Types

`src/lib/central-envios/sessao/types.ts`:

```ts
export type ArquivoIngerido = {
  runId: string;
  tipo: 'tiktok_csv' | 'ml_xlsx';
  arquivoNome: string;
  totalLinhas: number;
  linhasValidas: number;
  linhasDescartadas: number;
  ingeridoEm: string;  // ISO UTC
  // Estatísticas locais da composição deste run
  processadoEm: string | null;
  ambiguos: number;     // pedidos cujo parser deu AMBIGUO
  comExplosaoErro: number;
  comPrazoSemData: number;
};

export type PrazoStatus = 'CALCULADO' | 'HOJE' | 'SEM_DATA';

export type PedidoEnriquecido = {
  // Identidade
  origemRunId: string;
  canal: 'tiktok_shop' | 'mercado_livre' | 'shopee';
  orderId: string;             // ID universal: orderId TT ou numeroVenda ML
  trackingId: string | null;

  // Raw
  skuRaw: string;
  quantidadeRaw: number;
  criadoEmIso: string | null;
  comprador: string | null;
  camposExtras: Record<string, string | null>;

  // Normalização (RITM-04)
  parsed:
    | { kind: 'OK'; modeloCodigo: string; tamanho: string; qtdKit: number; canonical: string; cores: Array<{cor: string; qtd: number}>; skuKind: 'AVULSO' | 'KIT_COR_UNICA' | 'KIT_CORES_LISTADAS' | 'KIT_DISTRIBUICAO' | 'MIX' }
    | { kind: 'AMBIGUO'; motivo: string; detalhes: string };

  // Explosão (RITM-05) — quando parsed.kind=OK
  linhasExplodidas: Array<{ modeloCodigo: string; cor: string; tamanho: string; qtd: number }>;
  explosaoErro: { motivo: string; detalhes: string } | null;

  // Prazo (RITM-06)
  prazo: {
    status: PrazoStatus;
    prazoIso: string | null;
    origem: string | null;
    detalhes: string;
  };
};

export type EstatisticasSessao = {
  totalPedidos: number;
  totalAmbiguos: number;
  totalAtrasados: number;   // prazoIso < hojeIso
  totalHoje: number;        // prazoIso === hojeIso (ou status='HOJE')
  totalNoPrazo: number;
  totalSemData: number;
  porCanal: Record<string, number>;
  porModelo: Record<string, number>;
  hojeIso: string;          // snapshot do momento da composição
};
```

> `PedidoEnriquecido.parsed` é "achatado": campos OK ficam inline pra UI ler direto; AMBIGUO mantém só motivo/detalhes. Reduz o jsonb e fica autossuficiente sem precisar de re-parse no front.

---

## Composer

`src/lib/central-envios/sessao/composer.ts`:

```ts
export async function processarSessao(args: {
  tx: Tx;
  runIds: string[];
  sessaoAtual: {
    arquivosIngeridos: ArquivoIngerido[];
    dados: PedidoEnriquecido[] | null;
  };
  ctxCadastro: ContextoCadastro;
  ctxExplosao: ContextoExplosao;
  ctxPrazo: ContextoPrazo;
}): Promise<{
  arquivosIngeridos: ArquivoIngerido[];
  dados: PedidoEnriquecido[];
  estatisticas: EstatisticasSessao;
}>;
```

Pipeline:

1. Para cada `runId`:
   a. Se já está em `arquivosIngeridos`, pula (idempotência).
   b. SELECT `ingestao_run` por id. Se status != 'concluido', skip + log.
   c. Carrega `resultado` (inline em jsonb) ou `fetch(resultado_blob_url)` se offloaded.
   d. Para cada pedido raw:
      - Constrói `EntradaParsing` (mapeia `sellerSku`/`sku` → input do parser).
      - `parsearSku(input, ctxCadastro)` → SkuParsed | SkuAmbiguo
      - Se AMBIGUO → `parsed.kind='AMBIGUO'`, `linhasExplodidas=[]`.
      - Senão `explodirSku(parsed, ctxExplosao)`:
        - `LinhasExplodidas` → preenche `linhasExplodidas`
        - `ExplosaoErro` → vazio + `explosaoErro` preenchido
      - `calcularPrazo({plataforma, canalVendaId, criadoEmIso, camposExtras}, ctxPrazo)` → preenche `prazo`.
2. Merge com `dados` atual: dedup por `(canal, orderId)` — primeira ocorrência mantida.
3. Anexa novo `ArquivoIngerido` ao array.
4. Re-deriva `EstatisticasSessao` do `dados` final.
5. Retorna `{arquivosIngeridos, dados, estatisticas}`.

> Persistência (UPDATE no banco) fica no caller (route handler `/processar`).

---

## Endpoints

### `GET /api/central-envios/sessao`

- Sessão ativa do usuário, ou `null`.
- TTL 8h sem atividade → marca `expirada` + retorna null.
- Se `dados_blob_url` presente, ainda retorna `dados_blob_url` (frontend baixa) — não inflar response.

### `POST /api/central-envios/sessao`

- Idempotente: se há ativa, devolve; senão cria.
- Body: vazio ou `{}`.

### `PATCH /api/central-envios/sessao/[id]`

- Auto-save de campos leves: `filtrosExtrator`, `tipoVisualizacao`.
- Body Zod-validado: `{ filtrosExtrator?: object, tipoVisualizacao?: string }`.
- **Não** aceita atualização de `dados`/`arquivosIngeridos` aqui.

### `POST /api/central-envios/sessao/[id]/processar`

- Body: `{ runIds: string[] }`.
- Pipeline:
  1. Valida sessão pertence ao usuário (RLS já isola por conta; check explícito de `usuario_id`).
  2. Carrega 3 contextos (`carregarContextoCadastro`, `carregarContextoExplosao`, `carregarContextoPrazo`) em paralelo.
  3. Lê estado atual da sessão (arquivosIngeridos, dados — possivelmente do blob).
  4. Chama `processarSessao(...)`.
  5. Calcula tamanho do `dados`. Se > 2MB:
     - `put('central-envios/sessao/<id>/dados.json', ...)` → URL.
     - UPDATE sessao SET `dados=null`, `dados_blob_url=...`, `arquivosIngeridos`, `estatisticas`, `ultimaAtividadeEm=NOW()`.
  6. Senão UPDATE inline com `dados=...`, `dados_blob_url=null`.
- Retorna `{arquivosIngeridos, estatisticas}` (sem `dados` no payload — frontend buscar separado se quiser).

### `POST /api/central-envios/sessao/[id]/encerrar`

- Body: `{ motivo: 'finalizada' | 'forcada' }` (`expirada` só via TTL).
- UPDATE: `status='encerrada'`, `encerradaMotivo`, `encerrouEm=NOW()`.
- Idempotente: já encerrada → retorna 200 com `noop=true`.

---

## TTL

```
SESSAO_TTL_MS = 8 * 60 * 60 * 1000

No GET:
  Se sessão.status='ativa' AND ultimaAtividadeEm < (NOW - TTL):
    UPDATE SET status='encerrada', encerradaMotivo='expirada', encerrouEm=NOW
    Retorna null (como se não houvesse sessão)
```

Sem job de limpeza dedicado (mesma decisão do RITM `sessao_coletas`).

---

## Workflow

```bash
# 1. Editar schema.ts
# 2. Gerar migration
npm run db:generate:dev

# 3. Revisar SQL gerado. Adicionar:
#    - ALTER TABLE sessao_central_envios ENABLE ROW LEVEL SECURITY
#    - CREATE POLICY tenant_isolation ...
#    - Conferir que o unique partial uq_sessao_ce_ativa_por_usuario veio

# 4. Aplicar local
npm run db:migrate:dev

# 5. Atualizar restore-rls-policies.ts (adicionar "sessao_central_envios")

# 6. Implementar types + composer
# 7. Implementar endpoints
# 8. Testes:
npm test
npm run check

# 9. Sweep tenant zero
grep -i -E '\b(LUA|NBA|BALA|BOB|SOL|CJ|AZ|PT|CZ|EGG|EXG|PRETO|AZUL)\b' \
  src/lib/central-envios/sessao/ src/app/api/central-envios/sessao/

# 10. Diff prod ANTES do push
npm run db:generate:prod

# 11. Aplicar Neon (com aprovação humana)
npm run db:migrate:prod
dotenv -e .env.prod -- npx tsx src/lib/db/restore-rls-policies.ts
```

---

## Testes obrigatórios

### `composer.test.ts` (~10)

Fixtures: cria contextos sintéticos (parser do RITM-04 helper) + ingestao_run inseridos em DB com `resultado` inline.

1. 1 run com 2 pedidos AVULSO → 2 PedidoEnriquecido com kind=OK + linhasExplodidas.
2. 1 pedido com SKU ambíguo (modelo desconhecido) → parsed.kind='AMBIGUO', linhasExplodidas=[].
3. 1 pedido KIT → linhasExplodidas com N linhas.
4. Pedido com prazo CAMPO_EXPLICITO → prazo.status='CALCULADO'.
5. Pedido sem criadoEm + fallback → prazo.status='HOJE'.
6. Merge 2 runs: dedup por (canal, orderId) mantém primeiro.
7. Run já em `arquivosIngeridos` é pulado (idempotência).
8. EstatisticasSessao: totalAmbiguos, totalAtrasados, totalHoje corretos.
9. Sem regra de prazo cadastrada → prazo.status='SEM_DATA'.
10. Pedido com explosão MIX cores insuficientes → explosaoErro preenchido.

### `sessao.test.ts` (~6)

1. RLS: sessão A não visível em B.
2. Unique partial: 2 ativas pro mesmo usuario → 2ª falha.
3. Default status='ativa'.
4. UPDATE para encerrada: aceita.
5. TTL: ultimaAtividade > 8h → handler marca expirada.
6. Cascade conta → sessões da conta apagadas.

### `endpoints.test.ts` (~5) — opcional/smoke

Cobertura básica via fetch local (se já houver harness) ou mock direto.

---

## Critérios de aceitação

- [ ] Schema Drizzle: 1 tabela + 2 enums novos
- [ ] Migration aplicada em dev sem erro
- [ ] RLS funcional + policy criada
- [ ] `restore-rls-policies.ts` atualizado
- [ ] Composer puro (sem DB direto além de SELECTs de `ingestao_run`)
- [ ] 5 endpoints implementados; validação Zod
- [ ] TTL 8h aplicado no GET
- [ ] Offload pro Blob acima de 2MB de `dados` serializado
- [ ] Testes (16+) passam
- [ ] Sweep tenant zero
- [ ] `npm test` 100%, `npm run check` 0
- [ ] Doc §3.2, §7, §15 atualizado
- [ ] Aplicado em prod (Neon) com `restore-rls-policies` rodado

---

## Dúvidas (resolvidas)

| # | Pergunta | Resposta |
|---|---|---|
| 1 | Composer roda em Inngest? | **Não.** Inline. 10k pedidos em < 2s; sem ganho de fila. |
| 2 | Auto-save toca em `dados`? | **Não.** Só filtros/aba. `dados` muda via `/processar`. |
| 3 | Snapshot inline ou Blob? | **Inline** até 2MB serializado; **offload** acima. UI escolhe quando re-buscar. |
| 4 | Dedup transversal conflito? | **Mantém primeiro**; documenta no `arquivosIngeridos[].problemas` se preciso (V2). |
| 5 | TTL job? | **Lazy no GET** — mesmo padrão de `sessao_coletas`. |
| 6 | Encerrar idempotente? | **Sim.** Já encerrada → 200 com `noop=true`. |
| 7 | `processar` re-roda dedup? | **Sim** — dado é re-derivado completo a cada chamada. Idempotência por `runId` em `arquivosIngeridos`. |

---

## Dúvidas em aberto

1. **Conflito CSV/XLSX com mesmo `orderId`**: detectar e marcar pedido como "conflito" em vez de só dedup silencioso (V2).
2. **Stream do snapshot via SSE pra UI**: pra UX em uploads muito grandes (V2).
3. **Pre-compute de aggregations por dia/cor/tamanho** dentro de `dados`: hoje deixamos pro front. Se UI ficar lenta com 5k+ pedidos, mover pro composer.
