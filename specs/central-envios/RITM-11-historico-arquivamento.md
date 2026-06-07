# RITM-11 — Histórico/arquivamento (`planejamento_envios`) + email de resumo

> **Bloqueia:** nenhum.
> **Depende de:** RITM-07 (sessão server-side + composer + Blob offload), RITM-08 (botão "Arquivar" no header).
> **Dependência externa:** Resend (já em uso). Vercel Blob (já em uso).

---

## Princípio inegociável: arquivar é imutável

- `planejamento_envios` é **append-only**. Sem PATCH/PUT. Sem soft-delete. Snapshot do que o operador viu naquele momento, com a data civil que era "hoje".
- Mudanças posteriores em regras de prazo / aliases / categorias **não retroagem** sobre o snapshot. O snapshot vale como prova do estado operacional do dia.
- Re-cálculo só acontece se o operador subir os arquivos de novo numa nova sessão.

---

## Princípio inegociável: arquivar ≠ encerrar

- `motivo: 'finalizada'` → encerra sessão **+ cria** `planejamento_envios` **+** (opt-in) dispara email.
- `motivo: 'forcada'` → encerra sessão sem persistir nada (já é o comportamento de RITM-07).
- `motivo: 'expirada'` (TTL) → encerra sessão, **nunca** arquiva (operador não decidiu finalizar).
- Falha ao gravar `planejamento_envios` **bloqueia** o encerramento — operador precisa saber. Sem fallback silencioso.
- Falha ao enviar email **não bloqueia** — email é nice-to-have, planejamento já foi persistido. Loga e segue.

---

## Objetivo

Fechar o ciclo da Central de Envios: depois que o operador termina o planejamento do dia, gerar um registro imutável que serve como histórico/auditoria e, opcionalmente, dispara um resumo por email pra equipe.

Ao fim do RITM:

- Nova tabela `planejamento_envios` (append-only) + migration + RLS.
- Endpoint `POST /sessao/[id]/encerrar` aceita `arquivar: boolean` e `enviarEmailPara: string[]` no body.
- Persistência inline (jsonb) até 2MB; offload pra Vercel Blob acima — mesma estratégia da sessão.
- Endpoints `GET /api/central-envios` (lista) e `GET /api/central-envios/[id]` (detalhe).
- Template HTML do email + função `enviarResumoPlanejamento`.
- UI nova: `/central-envios/historico` (lista) e `/central-envios/historico/[id]` (detalhe read-only reaproveitando os componentes Dashboard/Cronograma/SkuDia/Pedidos).
- Hook do RITM-08 atualizado: dialog opcional pra adicionar emails antes de arquivar; flag default `enviarEmail=false`.
- Link "Histórico" no header da página principal.

**Não inclui:**

- Edição de planejamento arquivado — princípio inegociável.
- Re-envio de email após arquivar — V2 (botão "reenviar resumo" no detalhe).
- Exportação PDF / Excel do planejamento — V2.
- Comparação cruzada entre planejamentos arquivados — V2.

---

## Arquivos a criar / modificar

| Arquivo | Mudança |
|---|---|
| `src/lib/db/schema.ts` | **Adicionar** `planejamento_envios` (+ types). |
| `drizzle/migrations/<timestamp>_planejamento_envios.sql` | Gerado via `db:generate:dev`, RLS adicionada manualmente. |
| `src/lib/db/restore-rls-policies.ts` | Adicionar `planejamento_envios` ao `TABELAS_PADRAO`. |
| `src/app/api/central-envios/route.ts` | **Novo** — `GET` (lista paginada) + tipo da resposta. |
| `src/app/api/central-envios/[id]/route.ts` | **Novo** — `GET` (detalhe). |
| `src/app/api/central-envios/sessao/[id]/encerrar/route.ts` | Modificado — orquestra arquivamento + email opcional quando `arquivar=true`. |
| `src/lib/central-envios/relatorio/build-resumo-html.ts` | **Novo** — template HTML inline (sem react-email). |
| `src/lib/central-envios/relatorio/enviar-resumo.ts` | **Novo** — chama `sendEmail` com payload pronto. |
| `src/lib/central-envios/relatorio/types.ts` | **Novo** — `PlanejamentoSnapshot`, `PlanejamentoResumo`. |
| `src/app/(dashboard)/central-envios/historico/page.tsx` | **Novo** — lista. |
| `src/app/(dashboard)/central-envios/historico/[id]/page.tsx` | **Novo** — detalhe read-only. |
| `src/components/central-envios/arquivar-dialog.tsx` | **Novo** — dialog com checkbox "Enviar resumo por email" + lista de emails. |
| `src/hooks/use-central-envios-planejamento.ts` | Modificado — `encerrarSessao` aceita opts `{ arquivar, emails }`. |
| `src/app/(dashboard)/central-envios/page.tsx` | Modificado — botão "Arquivar" abre dialog em vez de encerrar direto; link "Histórico" no header. |
| `src/types/central-envios.ts` | Modificado — adicionar `PlanejamentoSnapshotCliente`, `PlanejamentoListItem`. |
| `docs/arquitetura/modulo-central-envios.md` | Atualizar §3, §8, §15 (✅ feito). |

Sem deps novas.

---

## Schema

```ts
export const planejamentoEnvios = pgTable(
  "planejamento_envios",
  {
    id: text("id").primaryKey(),
    contaId: text("conta_id")
      .notNull()
      .references(() => conta.id, { onDelete: "cascade" }),
    usuarioId: text("usuario_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    sessaoId: text("sessao_id"),                     // ref nullable — sessão pode ser purgada
    geradoEm: timestamp("gerado_em").notNull().defaultNow(),
    dataReferencia: date("data_referencia", { mode: "string" }).notNull(),  // hoje civil SP
    totalPedidos: integer("total_pedidos").notNull(),
    totalAtrasados: integer("total_atrasados").notNull(),
    totalHoje: integer("total_hoje").notNull(),
    totalAmbiguos: integer("total_ambiguos").notNull(),
    totalArquivos: integer("total_arquivos").notNull(),
    arquivosIngeridos: jsonb("arquivos_ingeridos").notNull(),       // ArquivoIngerido[]
    estatisticas: jsonb("estatisticas").notNull(),                  // EstatisticasSessao
    dados: jsonb("dados"),                                          // PedidoEnriquecido[] inline (< 2MB)
    dadosBlobUrl: text("dados_blob_url"),                           // null se inline
    emailEnviadoPara: jsonb("email_enviado_para").$type<string[]>(),// log dos destinatários
    emailEnviadoEm: timestamp("email_enviado_em"),
  },
  (t) => [
    index("idx_planejamento_envios_conta_gerado")
      .on(t.contaId, t.geradoEm.desc()),
    index("idx_planejamento_envios_usuario").on(t.usuarioId),
  ],
);
```

- **Sem unique** (op pode arquivar 2× num dia — se rodar 2 sessões).
- `sessaoId` é **nullable + sem FK**: a sessão pode ser purgada futuramente sem cascade no planejamento.
- `dataReferencia` é `date` puro (sem TZ) — mesmo padrão do `feriado.data`.
- `dados` segue regra de `sessao_central_envios.dados`: inline se < 2MB, blob URL acima.

Migration vem com RLS:

```sql
ALTER TABLE planejamento_envios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "planejamento_envios"
  USING ("conta_id" = current_setting('app.conta_atual', true))
  WITH CHECK ("conta_id" = current_setting('app.conta_atual', true));
```

Adicionar a tabela em `restore-rls-policies.ts` — `db:migrate:prod` usa `push`, RLS some sem isso.

---

## Endpoint: `POST /api/central-envios/sessao/[id]/encerrar` (modificado)

Body novo (compat com o atual — campos novos opcionais):

```ts
{
  motivo: 'finalizada' | 'forcada',     // já existe
  arquivar?: boolean,                   // default: motivo === 'finalizada'
  enviarEmailPara?: string[],           // default: []
}
```

Fluxo quando `motivo='finalizada' && arquivar=true`:

1. Carrega a sessão (já é o passo do endpoint atual). Se status já é `encerrada` → 200 noop com `planejamentoId` da última se houver.
2. Resolve `dados`: se `dadosBlobUrl` setado, fetch (timeout 30s). Senão usa `dados` inline.
3. Calcula `dataReferencia`: usa `estatisticas.hojeIso` (já existe). Se ausente, fallback `hojeIsoSP()`.
4. Decide inline vs offload do `dados` final do planejamento (mesma regra de 2MB do `processarSessao`).
5. INSERT em `planejamento_envios` (inclui `arquivosIngeridos`, `estatisticas`, totais derivados).
6. UPDATE da sessão pra `encerrada` + `encerrouEm` + `encerradaMotivo = 'finalizada'`.
7. Se `enviarEmailPara.length > 0`: `await enviarResumoPlanejamento({ planejamento, destinatarios })` em try/catch. Sucesso → UPDATE `emailEnviadoPara` + `emailEnviadoEm`. Falha → log + continua.

Tudo dentro de uma única transação Drizzle, **exceto** o send do email (não bloqueia commit).

Validação extra:

- `enviarEmailPara`: até 10 emails, cada um Zod `.email()`. Lista vazia se omitida.
- `arquivar=true` exige `motivo='finalizada'` (no `motivo='forcada'`, ignorar/400).

Resposta:

```ts
{ ok: true, noop: false, planejamentoId?: string, emailEnviado?: boolean }
```

---

## Endpoint: `GET /api/central-envios`

- `withContaAtiva`. Lista paginada.
- Query: `?limit=20&offset=0` (max 100). Default 20.
- Select projeta só os totais + metadata — **não** retorna `dados`/`dadosBlobUrl` (lista deve ser leve).
- Order: `gerado_em DESC`.
- Retorno: `{ planejamentos: PlanejamentoListItem[], total: number, limit, offset }`.

```ts
type PlanejamentoListItem = {
  id: string;
  geradoEm: string;       // ISO
  dataReferencia: string; // YYYY-MM-DD
  usuarioId: string;
  totalPedidos: number;
  totalAtrasados: number;
  totalHoje: number;
  totalAmbiguos: number;
  totalArquivos: number;
  emailEnviadoPara: string[] | null;
  emailEnviadoEm: string | null;
};
```

---

## Endpoint: `GET /api/central-envios/[id]`

- `withContaAtiva`. Detalhe completo de um planejamento.
- Carrega `dados` inline. Se for blob, devolve `dadosBlobUrl` direto — cliente busca (mesma estratégia da sessão).
- 404 se id não pertence à conta.

```ts
type PlanejamentoSnapshotCliente = {
  id: string;
  geradoEm: string;
  dataReferencia: string;
  usuarioId: string;
  arquivosIngeridos: ArquivoIngerido[];
  estatisticas: EstatisticasSessao;
  dados: PedidoEnriquecido[] | null;     // null se offload
  dadosBlobUrl: string | null;
  emailEnviadoPara: string[] | null;
  emailEnviadoEm: string | null;
};
```

---

## Email

### `build-resumo-html.ts`

Template inline (sem react-email — desnecessário pra 1 email). Sections:

1. **Header**: nome da conta + data de referência (`dataReferencia` formatada `dd/MM/yyyy`).
2. **Stats principais** (table): total, atrasados, hoje, ambíguos, sem data, no prazo.
3. **Top 5 modelos** por demanda (a partir de `estatisticas.porModelo`).
4. **Por canal** (a partir de `estatisticas.porCanal`).
5. **Arquivos ingeridos** (lista nome + tipo + linhas).
6. **Footer**: link absoluto pro detalhe (`${process.env.NEXT_PUBLIC_APP_URL}/central-envios/historico/${id}`).

Função: `buildResumoHtml({ planejamento, contaNome })` → string HTML inline-styled. Texto puro também (`text` arg do Resend).

### `enviar-resumo.ts`

```ts
export async function enviarResumoPlanejamento({
  planejamento,
  destinatarios,
  contaNome,
}: {
  planejamento: PlanejamentoSnapshotCliente;
  destinatarios: string[];
  contaNome: string;
}): Promise<{ enviado: boolean; motivo?: string }> {
  // 1. valida lista não vazia (defensivo)
  // 2. monta html + text
  // 3. sendEmail({ to, subject, html, text })
  // 4. propaga erro pra caller decidir log vs persistir
}
```

`sendEmail` (já existe em `src/lib/email.ts`) lida com `RESEND_API_KEY` ausente — retorna `simulated: true` em vez de erro. Comportamento OK pra dev (operador não cadastra API key) — log warning.

Subject: `[Central de Envios] Planejamento ${dataReferencia} — ${totalPedidos} pedidos`.

---

## UI

### `/central-envios/historico/page.tsx`

Lista paginada. Padrão Coletas/Confeccao:

- Header com botão "Voltar" pra `/central-envios`.
- Tabela: Data ref · Gerado em · Pedidos · Atrasados · HOJE · Arquivos · Email · Ações.
- Coluna Email: badge "✓ enviado" (mostrando emails ao hover) ou "—".
- Ações: botão "Ver detalhes" → `/central-envios/historico/[id]`.
- Paginação simples (botões Anterior/Próximo).
- Empty state quando 0 planejamentos.

### `/central-envios/historico/[id]/page.tsx`

Detalhe read-only que reaproveita componentes existentes:

- Header com `dataReferencia` + `geradoEm` + `usuarioId`.
- Stats cards (reusa `<DashboardTab estatisticas={...} />`).
- Tabs: Cronograma (`<CronogramaTab dados={...} />`), SKU × Dia (`<SkuDiaTab>`), Pedidos (`<PedidosTab>`), Ambíguos (`<AmbiguosTab>`).
- **Sem Extrator** — extrator usa categorias/filtros que dependem de estado vivo; histórico é só leitura.
- Aviso na topo: "Snapshot imutável de YYYY-MM-DD".
- Loading: spinner enquanto carrega `dados` (inline ou blob).

### `arquivar-dialog.tsx`

Dialog disparado pelo botão "Arquivar":

- Checkbox: "Enviar resumo por email" (default desmarcado).
- Quando marcado: textarea / input multi-email com tag-like behavior (separar por vírgula). Limita a 10.
- Botões: "Cancelar" / "Arquivar".
- Confirma → chama `encerrarSessao({ arquivar: true, emails })`.

Hook do RITM-08:

```ts
encerrarSessao(opts: { motivo: 'finalizada' | 'forcada', emails?: string[] }) {
  // motivo=finalizada → body inclui arquivar=true + enviarEmailPara=emails
  // motivo=forcada → body só com motivo
}
```

Link "Histórico" no header da page principal (ao lado do gear de configurações).

---

## Workflow

```bash
# 1. Spec (✅)
# 2. Schema + migration + restore-rls
# 3. db:generate:dev → revisar SQL → adicionar RLS manualmente → db:migrate:dev
# 4. Types (server) + types/central-envios.ts (cliente)
# 5. Endpoints (GET lista, GET detalhe, encerrar modificado)
# 6. Email (build-html + enviar-resumo)
# 7. UI (historico/page + historico/[id]/page + arquivar-dialog)
# 8. Hook + page principal (botão histórico + dialog)
# 9. npm run check + ESLint
# 10. Smoke manual (subir CSV → processar → arquivar com email → ver histórico)
# 11. Sweep tenant zero nos arquivos
# 12. Doc §3/§8/§15
# 13. Commit
```

---

## Critérios de aceitação

- [ ] Migration aplicada local (`drizzle/migrations/00XX_*.sql`) com RLS
- [ ] `restore-rls-policies.ts` lista nova tabela
- [ ] Schema: `planejamento_envios` + types exportados
- [ ] `POST /sessao/[id]/encerrar` aceita `arquivar` + `enviarEmailPara`
- [ ] Falha no INSERT do planejamento aborta encerro com 500
- [ ] Falha no email **não** aborta — UPDATE `emailEnviadoPara` fica null
- [ ] `GET /central-envios` lista paginada (default 20, max 100)
- [ ] `GET /central-envios/[id]` retorna snapshot completo (com `dadosBlobUrl` quando offload)
- [ ] Histórico mostra tabela com paginação + empty state
- [ ] Detalhe reaproveita tabs Dashboard/Cronograma/SkuDia/Pedidos/Ambíguos sem extrator
- [ ] Dialog de arquivar tem checkbox email + lista (max 10)
- [ ] Link "Histórico" + "Configurações" visíveis no header da página principal
- [ ] `npm run check` 0; ESLint 0 erros nos arquivos do RITM
- [ ] Doc §3/§8/§15 atualizado

---

## Dúvidas (a confirmar antes da implementação)

| # | Pergunta | Recomendação |
|---|---|---|
| 1 | Persistir `dados` completo ou só estatísticas? | **Completo.** O custo é jsonb/blob, mas o valor de auditoria justifica. Sem dados, "histórico" vira só números agregados — não dá pra responder "qual order ID estava atrasado naquele dia". |
| 2 | Email **opt-in** ou **opt-out**? | **Opt-in.** Default desmarcado; operador escolhe destinatários ativamente. Evita envio acidental + scopa pra escala SaaS futura. |
| 3 | Destinatários: campo livre ou seleção de usuários da conta? | **Campo livre por agora.** Endereços fora da conta podem ser válidos (sócio, contador). V2 — adicionar autocomplete por usuários da conta como sugestão. |
| 4 | Detalhe deve ter Extrator? | **Não.** Extrator depende de categorias mutáveis e gera ações (copy IDs); no histórico isso já é "passado", não há ação possível. Pedidos+Ambíguos dão visibilidade similar. |
| 5 | Indexar `dataReferencia`? | **Não.** Index em `(contaId, geradoEm DESC)` é a query principal. `dataReferencia` é exibição. |
| 6 | Permitir excluir planejamento arquivado? | **Não, por agora.** Append-only é o princípio. Quem quer "limpar" purga via SQL ou aguarda V2 (com auditoria). |
| 7 | Re-enviar email a partir do detalhe? | **V2.** Botão "Reenviar resumo" no detalhe requer endpoint extra. Pra MVP, operador tira print/copia URL. |
| 8 | `usuarioId` mostra nome no histórico? | **Sim, via join com `user`** no GET lista/detalhe. Tela mostra `nome` (fallback `email` ou `id`). Privacy OK — mesma conta. |

---

## Dúvidas em aberto

1. **Retention policy**: hoje sem limite. Daqui 6 meses uma conta ativa pode ter ~200 planejamentos arquivados, cada um com até alguns MB de dados. Decidir entre: (a) deixar crescer; (b) purgar `dados` mantendo só metadados após N dias; (c) sempre offload `dados` pro Blob (custo Vercel, mas DB enxuto). Pra MVP fica no DB; revisita quando a primeira conta passar de 100 entries.
2. **Comparação entre planejamentos**: "este planejamento tem 30% mais atrasados que a média da semana" — V2 dashboard.
3. **Auditoria de quem disparou cada email**: hoje `emailEnviadoPara` é só lista. V2 com tabela separada e timestamps individuais.
4. **PDF/Excel export**: `dados` em blob + endpoint que gera Excel via `xlsx` (já temos lib). V2.
