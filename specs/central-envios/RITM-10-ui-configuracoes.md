# RITM-10 — UI: Configurações (regras prazo + aliases + feriados + categorias)

> **Bloqueia:** nenhum RITM da Central de Envios (UI principal já funciona sem este). Desbloqueia uso real em produção pelo operador (até aqui tudo era seed-only).
> **Depende de:** RITM-01 (todas as tabelas), RITM-06 (sync nacional já existe), RITM-08 (shell da página).
> **Dependência externa:** nenhuma.

---

## Princípio inegociável: escrita só por admin, leitura por qualquer usuário

- GET de qualquer endpoint de configuração: papel mínimo é qualquer vínculo ativo (`withContaAtiva`). Operadores precisam ler regras pra debugar normalização/prazo.
- POST/PATCH/DELETE: **`requireAdminAtivo`** (owner/admin). Mudar uma regra de prazo, alias ou categoria afeta o snapshot de todos os planejamentos futuros da conta — gente errada não mexe.
- O sync nacional de feriados (RITM-06) **já é admin**; estendemos o mesmo padrão pros novos endpoints.
- Regex em `categoria_sku.regras` é validada com `new RegExp()` em try/catch no upsert. Regex inválida → 400 com mensagem clara. Avaliação em runtime (RITM-09 `avaliarCategoria`) já é defensiva — esta camada só impede *gravar* lixo.

---

## Princípio inegociável: zero lógica de domínio na UI de config

- UI é CRUD puro sobre tabelas. Nenhuma normalização, explosão ou cálculo de prazo roda aqui. A UI desenha forms, lista registros e dispara HTTP.
- Validação de payload é **server-side via Zod** (mesma fonte de verdade). UI faz checagem otimista pra UX (botão desabilitado), mas a verdade está no endpoint.
- "Sync feriados nacionais" reusa o endpoint existente `POST /configuracoes/feriado/sync-nacional` — não duplicar.

---

## Objetivo

Tornar a Central de Envios usável por operador real: dar UI pra cadastrar/editar as 5 famílias de configuração que hoje só existem via SQL/seed.

Ao fim do RITM:

- Rota nova `/central-envios/configuracoes` (página standalone, fora das tabs principais — são 5 seções extensas, abafariam o shell).
- 5 sub-componentes (1 por entidade) montados nessa página, cada um com seu CRUD.
- CRUD endpoints completos pra `regras-prazo`, `alias-tamanho`, `alias-cor`, `feriado` (manual) e `categoria-sku`. O único endpoint já existente além do sync (`GET categoria-sku`) ganha POST/PATCH/DELETE; o resto nasce do zero.
- Link "Configurações" no header da Central de Envios (botão de gear ao lado de "Arquivar/Descartar" na page principal).

**Não inclui:**

- Histórico de planejamentos / arquivamento / email — RITM-11.
- UI de cadastro de modelo/cor/tamanho (`modelo_principal`, `modelo_cor`, `modelo_tamanho`) — vive em `/confeccao/cadastros/produtos` (já existe; é onde se gerenciam `corPadrao`, `exigeTamanho`, `corMixDefault`).
- UI de `sku_kit_regra` — já existe em `/coletas` (página de configurações de kit do RITM de Coletas). Adicionar link de atalho do cabeçalho de Configurações da Central de Envios.
- "Editar manualmente" em ambíguos → cria `sku_kit_regra` direto — V2 (vide RITM-09 dúvidas).

---

## Arquivos a criar / modificar

| Arquivo | Mudança |
|---|---|
| `src/app/(dashboard)/central-envios/configuracoes/page.tsx` | **Novo** — shell de Configurações com 5 seções colapsáveis. |
| `src/app/(dashboard)/central-envios/page.tsx` | Modificado — botão "Configurações" no header (`<Link>` ícone gear). |
| `src/components/central-envios/configuracoes/regras-prazo-card.tsx` | **Novo** — CRUD `canal_regra_prazo`. |
| `src/components/central-envios/configuracoes/alias-tamanho-card.tsx` | **Novo** — CRUD `tamanho_alias`. |
| `src/components/central-envios/configuracoes/alias-cor-card.tsx` | **Novo** — CRUD `cor_alias`. |
| `src/components/central-envios/configuracoes/feriado-card.tsx` | **Novo** — CRUD manual + botão "Sincronizar nacionais" (chama endpoint existente). |
| `src/components/central-envios/configuracoes/categoria-sku-card.tsx` | **Novo** — CRUD `categoria_sku` com editor de regras (regex/composição/tag). |
| `src/hooks/use-central-envios-configuracoes.ts` | **Novo** — fetcher + mutators compartilhados (SWR/useState pattern, sem libs novas). |
| `src/app/api/central-envios/configuracoes/regras-prazo/route.ts` | **Novo** — GET/POST/PATCH/DELETE. |
| `src/app/api/central-envios/configuracoes/alias-tamanho/route.ts` | **Novo** — GET/POST/PATCH/DELETE. |
| `src/app/api/central-envios/configuracoes/alias-cor/route.ts` | **Novo** — GET/POST/PATCH/DELETE. |
| `src/app/api/central-envios/configuracoes/feriado/route.ts` | **Novo** — GET/POST/PATCH/DELETE (manual). |
| `src/app/api/central-envios/configuracoes/categoria-sku/route.ts` | Modificado — estender com POST/PATCH/DELETE; manter GET. |
| `src/types/central-envios.ts` | Modificado — adicionar types de payload das mutations. |
| `docs/arquitetura/modulo-central-envios.md` | Atualizar §9 (tab→rota), §15 (✅ feito). |

Sem migration. Sem deps novas.

---

## Layout da página

```
/central-envios/configuracoes
├── Header
│   ├── Breadcrumb: Central de Envios › Configurações
│   └── Botão "Voltar" → /central-envios
│
├── Aviso amarelo (Alert) — só pra non-admin:
│   "Você está em modo leitura. Apenas admins/owners podem editar configurações."
│
└── 5 Cards (cada um colapsável, estado default = aberto)
    ├── Regras de prazo por canal       [regras-prazo-card]
    ├── Aliases de tamanho               [alias-tamanho-card]
    ├── Aliases de cor                   [alias-cor-card]
    ├── Feriados                         [feriado-card]
    └── Categorias do extrator           [categoria-sku-card]

    Footer com atalho:
    "Cadastros de modelo/cor/tamanho ficam em /confeccao/cadastros/produtos.
     Regras de kit ficam em /coletas (Configurações)."
```

Cada card segue o mesmo esqueleto:

```
<Card>
  <CardHeader>Título · contagem · botão "+ Novo"</CardHeader>
  <CardContent>
    <Table>... linhas com botão editar/excluir ...</Table>
    Vazio → empty state.
  </CardContent>
  <Dialog open={editingId !== null}>...form...</Dialog>
</Card>
```

Confirmação destrutiva (delete) usa `AlertDialog` shadcn — mesmo padrão do módulo Confeccao.

---

## Hook `useCentralEnviosConfiguracoes`

Centraliza fetch + cache + mutations. Não usa SWR/React Query — mantém padrão dos outros hooks do módulo (RITM-08/09 usam `useState` + `fetch` cru). Forma:

```ts
type Estado<T> = {
  itens: T[];
  loading: boolean;
  erro: string | null;
};

useCentralEnviosConfiguracoes() => {
  regrasPrazo: Estado<RegraPrazoClient>;
  aliasTamanho: Estado<AliasClient>;
  aliasCor: Estado<AliasClient>;
  feriados: Estado<FeriadoClient>;
  categorias: Estado<CategoriaSkuClient>;

  papel: PapelConta | null;       // pra esconder botões de escrita
  podeEditar: boolean;            // = isAdminPapel(papel)

  carregar(scope?: ScopeKey): Promise<void>;  // GET um ou todos
  upsert(scope: ScopeKey, payload: ...): Promise<void>;  // POST ou PATCH
  remover(scope: ScopeKey, id: string): Promise<void>;   // DELETE
  syncFeriadosNacionais(anos?: number[]): Promise<void>; // POST sync-nacional
};
```

- `papel` vem de um novo GET helper `/api/me` se já existir, ou de adicionar `papel` ao response do GET de cada endpoint (mais simples — server já sabe). Decisão: adicionar `meta.papel` ao GET de cada endpoint (4 bytes a mais, evita round-trip extra).
- Toda mutation: re-`carregar(scope)` após sucesso. Sem otimismo.
- Erros HTTP: `toast.error` com a mensagem do server. Não derruba UI.

---

## Especificação dos endpoints

Padrão comum a todos:

- GET: `withContaAtiva` (qualquer vínculo). Resposta: `{ itens: T[], meta: { papel } }`.
- POST/PATCH/DELETE: `requireAdminAtivo`. 403 quando não admin.
- Auth helper `isTenancyAuthError` (já existe em `/coletas/configuracoes/kit-rules`): copiar inline em cada route (sem extrair util ainda — DRY prematuro).
- Erros do Zod: 400 com `{ error: "Dados inválidos", details: issues }`.
- Erros tenancy: 401 ou 403.
- Erros inesperados: 500 + `console.error("[<scope>] <verb>:", err)`.

### `POST/PATCH/DELETE /api/central-envios/configuracoes/categoria-sku`

(GET já existe — manter inalterado, só envelopar resposta com `meta.papel`.)

- **POST** — cria. Body:
  ```ts
  {
    nome: string (min 1, max 80),
    ordem: number (int, default 0),
    ativo: boolean (default true),
    regras: CategoriaRegra[] (min 1)
  }
  ```
  Validação extra: para cada regra com `tipo: 'regex'`, tentar `new RegExp(pattern, flags ?? 'i')` num try/catch — 400 se falhar. Idem `composicao.qtdMin <= qtdMax`.
  `id = generateId()`. Insert. Retorna `{ categoria }`.

- **PATCH** — edita. Body: `{ id, ...campos parciais }`. Mesma validação de regex. Where: `id = ? AND contaId = ?`. 404 se 0 rows.

- **DELETE** — body `{ id }`. Hard delete. Where idem. Retorna `{ success: true }` ou 404.

### `GET/POST/PATCH/DELETE /api/central-envios/configuracoes/regras-prazo`

- **GET** — lista todas as regras da conta. Join com `canais_venda` pra trazer `canalVenda.nome` (display). `meta.canaisDisponiveis` no payload pra UI montar dropdowns.

- **POST** — Body Zod:
  ```ts
  {
    canalVendaId: string | null,           // null = default da plataforma
    plataforma: PlataformaCanal,
    estrategia: 'DIAS_UTEIS_POS_VENDA' | 'CAMPO_EXPLICITO' | 'HIBRIDO',
    diasUteis: number | null,              // int >= 0; obrigatório se estratégia inclui DIAS_UTEIS
    campoPrazo: string | null,             // obrigatório se estratégia inclui CAMPO_EXPLICITO
    regexPrazo: string | null,             // opcional mesmo em CAMPO_EXPLICITO
    fallbackHoje: boolean (default false),
    ativo: boolean (default true)
  }
  ```
  Validação cruzada:
  - `DIAS_UTEIS_POS_VENDA` exige `diasUteis != null && diasUteis >= 0`.
  - `CAMPO_EXPLICITO` exige `campoPrazo` setado.
  - `HIBRIDO` exige ambos.
  - Se `regexPrazo` setado, tentar `new RegExp(regexPrazo)` em try/catch.
  - Conflito de unique (`uq_canal_regra_prazo_default_plataforma` quando `canalVendaId = null`) → 409 `{ error: "Já existe regra default para esta plataforma" }`.

- **PATCH** — Body `{ id, ...parcial }`. Mesma validação cruzada quando `estrategia` for trocada. 404/409 idem.

- **DELETE** — Body `{ id }`. Hard delete (sem soft-delete; quem quiser preservar histórico desativa via PATCH `ativo: false`).

### `GET/POST/PATCH/DELETE /api/central-envios/configuracoes/alias-tamanho`

- **GET** — lista joinado com `modelo_principal.codigo` pra display (`modeloId IS NULL` → escopo "Global"). `meta.modelosDisponiveis: { id, codigo }[]` pra UI.

- **POST** — Body:
  ```ts
  {
    modeloId: string | null,        // null = alias global
    codigoAlias: string (1..40, uppercase),
    codigoReal: string (1..40, uppercase)
  }
  ```
  Trim + uppercase nos códigos antes de salvar. `codigoAlias === codigoReal` → 400 ("alias inútil").
  Conflito de unique (`(contaId, modeloId, codigoAlias)` com `NULLS NOT DISTINCT`) → 409.

- **PATCH** — `{ id, ...parcial }`. 404 idem.

- **DELETE** — `{ id }`. Hard delete.

### `GET/POST/PATCH/DELETE /api/central-envios/configuracoes/alias-cor`

Idêntico a `alias-tamanho`, trocando a tabela. Lógica espelhada — não consolidar em helper (são 2 instâncias, DRY prematuro). Cada um no seu route file.

### `GET/POST/PATCH/DELETE /api/central-envios/configuracoes/feriado`

(O `POST sync-nacional` em `/feriado/sync-nacional/route.ts` continua intocado.)

- **GET** — query string opcional `?ano=2026` filtra. Default: ano atual + próximo ano. Ordena `data ASC`. Inclui campo `fonte` (`manual` | `nacional_api` | `estadual` | etc.).

- **POST** — Body:
  ```ts
  {
    data: string (ISO `YYYY-MM-DD`),
    descricao: string (1..200),
    fonte: 'manual' (forçado server-side; sync é endpoint separado)
  }
  ```
  Conflito de unique (`(contaId, data)`) → 409 `{ error: "Já existe feriado nesta data" }`. Não dá pra criar dois feriados no mesmo dia mesmo que com origens diferentes — o sync atualiza, não duplica.

- **PATCH** — `{ id, descricao }`. **Só descricao é editável** — data troca = deleta e recria (clarifica intent + evita conflito silencioso). `fonte` muda só via sync (preservada).

- **DELETE** — `{ id }`. Hard delete. (O sync nacional do RITM-06 já preserva `fonte='manual'`; deletar um feriado nacional reinjetado pelo próximo sync é comportamento aceitável e documentado.)

---

## Componentes — comportamentos chave

### `regras-prazo-card.tsx`

- Tabela: Plataforma | Canal específico | Estratégia | Dias úteis | Campo | Regex | Fallback hoje | Ativo | Ações.
- Dialog de criação/edição com `Select` de plataforma → muda campos visíveis (mostra só o que a estratégia escolhida usa).
- Indicador visual: regras default (canal null) com badge "default da plataforma"; específicas com nome do canal.

### `alias-tamanho-card.tsx` / `alias-cor-card.tsx`

- Tabela: Escopo (Global ou nome do modelo) | Alias | → | Real | Ações.
- Filtro topo: dropdown "Modelo" (incluindo "Global" e "Todos").
- Form simples: select de modelo (opcional), 2 inputs de código.

### `feriado-card.tsx`

- Tabela: Data | Descrição | Fonte | Ações.
- Botão extra "Sincronizar nacionais": dispara `POST /sync-nacional` (ano atual + próximo). Mostra contagem `inseridos`, `atualizados` no toast.
- Filtro por ano (default: ano corrente).
- Linhas com `fonte = nacional_api` têm badge azul "BR"; manuais sem badge.

### `categoria-sku-card.tsx`

- Tabela: Nome | Ordem | Ativo | Regras (resumo "regex×N, composição×M") | Ações.
- Form modal com editor de regras: lista de chips com tipo+resumo + botão "+ Adicionar regra".
- Cada regra abre um sub-form por tipo:
  - **regex**: `pattern` + `flags` (default `i`). Validação inline: tenta `new RegExp` no blur, mostra erro vermelho se inválida.
  - **composicao**: select de modelo (vem de `meta.modelosDisponiveis`), `qtdMin`/`qtdMax`.
  - **tag**: hint "Tags ainda não suportadas em runtime — registrar agora para futura V2".
- Salvar manda o array inteiro de regras no payload (POST/PATCH).

---

## Workflow

```bash
# 1. Esta spec (✅)
# 2. Endpoints (POST/PATCH/DELETE) — começar por categoria-sku porque já tem GET
# 3. Hook compartilhado
# 4. 5 componentes (cada um isolado, fácil paralelizar review)
# 5. Page + link no header da page principal
# 6. npm run check + ESLint
# 7. Smoke manual:
#    - logado como admin → CRUD em cada entidade
#    - logado como operador → leitura ok, formulários hidden
#    - tentar criar regra default duplicada → 409 com toast
#    - regex inválida em categoria → 400 com mensagem clara
#    - sync feriados → toast com contagem
# 8. Sweep tenant zero
# 9. Doc §9 e §15
# 10. Commit único
```

---

## Critérios de aceitação

- [ ] 5 novos endpoints (4 routes novos + extensão de categoria-sku) com GET/POST/PATCH/DELETE
- [ ] 5 cards CRUD renderizando + dialog de edição em cada
- [ ] Hook compartilhado expõe `papel`, `podeEditar` + estados+ações para 5 escopos
- [ ] `requireAdminAtivo` em todos POST/PATCH/DELETE — operador comum recebe 403
- [ ] Alert "modo leitura" visível para non-admin
- [ ] Validação cruzada de `canal_regra_prazo` (DIAS_UTEIS/CAMPO_EXPLICITO/HIBRIDO) testada em endpoint + UI
- [ ] Validação de regex (`new RegExp` try/catch) em `categoria-sku` e `canal_regra_prazo.regexPrazo`
- [ ] Conflitos de unique retornam 409 com mensagem human-friendly
- [ ] Botão "Sincronizar feriados nacionais" funciona e reusa endpoint existente
- [ ] Link "Configurações" (ícone gear) visível no header da page principal
- [ ] Footer da página aponta para `/confeccao/cadastros/produtos` e `/coletas` (regras de kit)
- [ ] `npm run check` 0; ESLint 0 erros nos arquivos do RITM
- [ ] Sweep tenant zero
- [ ] Doc §9 e §15 atualizados
- [ ] Testes do módulo continuam passando (sem regressões)

---

## Dúvidas (a confirmar antes da implementação)

| # | Pergunta | Recomendação |
|---|---|---|
| 1 | Configurações como **rota separada** (`/central-envios/configuracoes`) ou **8ª aba** na page principal? | **Rota separada.** São 5 seções extensas; a página principal já tem 7 tabs e o operador entra lá pra produzir, não pra configurar. |
| 2 | Soft-delete (`ativo: false`) ou hard-delete em regras de prazo / categoria? | **Hard-delete + flag `ativo`** já existente. Quem quer "desativar sem perder histórico" usa o toggle; quem deleta sabe que é definitivo. |
| 3 | Validação de regex inválida — fazer também na avaliação em runtime? | **Sim** já feito no RITM-09 (`avaliarCategoria` tem try/catch). Esta camada só impede gravar. |
| 4 | Adicionar SWR / React Query? | **Não.** Mantém padrão dos outros módulos (fetch cru + useState). 5 estados é gerenciável; não justifica nova dep. |
| 5 | Mostrar uso/contagem ao lado de cada item (ex.: "alias EXG → usado em 42 pedidos da última sessão")? | **V2.** Útil mas requer correlação com `sessao_central_envios.dados` por todas as sessões ativas; bom signal pra um dashboard de saúde, não pro CRUD básico. |
| 6 | Excluir endpoint `feriado` PATCH e exigir delete+recriação? | **Manter PATCH só pra descricao.** Editar data dispara conflito UX-feio (chave única); regravar é mais limpo. |
| 7 | Permitir `cor_padrao` / `corMixDefault` / `exigeTamanho` aqui? | **Não.** Essas 3 colunas pertencem ao cadastro de modelo (`modelo_principal`), gerenciado em `/confeccao/cadastros/produtos`. Adicionar link no footer aponta o usuário pra lá. |
| 8 | Auditoria (quem mudou o quê)? | **V2.** Tabela `audit_log` é discussão de plataforma, não de módulo. Por ora, `console.log` da mutation com `userId` na route é o que temos. |

---

## Dúvidas em aberto

1. **Editor visual de regex** (testar pattern contra exemplos antes de salvar): bom UX, mas requer um componente novo. V2 se demanda surgir.
2. **Importar/exportar configurações** (snapshot da conta em JSON): útil pra setup de conta nova. V2.
3. **Aviso quando a regra de prazo muda e há sessão ativa**: hoje a sessão usa o snapshot que foi calculado no momento do upload; mudar a regra agora não afeta a sessão em andamento. Comportamento OK, mas vale um aviso no toast: "Regras alteradas só valem para próximas ingestões." Decidir no review.
4. **Cadastrar fonte estadual/municipal de feriados** (`fonte != 'manual' && != 'nacional_api'`): hoje endpoint força `fonte='manual'` no POST. Se virar requisito, expor `fonte` no payload (com enum allowlist).
