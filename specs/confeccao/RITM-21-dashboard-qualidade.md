# RITM-21 — Dashboard de Qualidade por Oficina

Implementa o Dashboard de Qualidade do módulo Confecção (arquitetura §15.2).
Acesso: admins/owners ativos da conta. Rota nova
`/confeccao/dashboard/qualidade`. Reaproveita o padrão de
`montarDashboard` da RITM-20 (service puro + endpoint + componentes).

> ⚠️ **Escopo reduzido vs. arquitetura §15.2:** a arquitetura fala em
> "Histórico individual ao clicar na ficha do costureiro". O schema atual
> **não modela costureiro individual** dentro de uma oficina (a retirada
> tem `oficina_id`, não `costureiro_id`). O escopo deste RITM é
> **somente por oficina**. Histórico individual por costureiro fica como
> RITM futuro (precisa migration).

## Conteúdo

### KPIs (top)

Agregados sobre o escopo filtrado (todas as oficinas que aparecem em
retiradas/subconferências do período):

- **Oficinas avaliadas** — distinct `oficina_id` com pelo menos uma
  subconferência concluída no período.
- **% aprovação médio** — média ponderada `sum(aprovadas) / sum(aprovadas + reprovadas)`
  sobre todas as subconferências concluídas do período.
- **% pontualidade médio** — `count(retiradas final no prazo) / count(retiradas final)`
  comparando `confeccao_retirada.dataRetirada` com o `prazoProducao` da
  oficina dentro do payload da subtask Costura.

### Painel 1 — Ranking de Oficinas

Tabela ordenável por qualquer coluna:

| Coluna | Cálculo |
|--------|---------|
| Oficina | `confeccao_fornecedor.nome` |
| Peças avaliadas | `sum(aprovadas + reprovadas)` |
| % aprovação | `sum(aprovadas) / sum(aprovadas + reprovadas)` |
| Tempo médio (dias) | `avg(retirada.dataRetirada - subtask_costura.iniciadaEm)` para retiradas tipo `final` |
| % pontualidade | `count(retiradas no prazo) / count(retiradas final)` |
| Divergências confirmadas | `count(subconferencias.divergencia_confirmada = true onde oficina_responsavel_divergencia_id = oficinaId)` |

Default sort: **% aprovação desc**. Empate: peças avaliadas desc.

### Painel 2 — Top Defeitos

Barchart horizontal agrupando `tiposDefeito[]` de subconferências
concluídas no período (todas as oficinas do escopo filtrado).
Cada defeito mostra contagem absoluta e % do total de defeitos.

> Nota: `tiposDefeito` é `enum[]`. Cada subconferência pode marcar
> múltiplos defeitos, então um defeito conta `+1` por subconferência
> que o tem, não por peça reprovada.

### Painel 3 — Detalhe por Oficina

Ao clicar numa linha do ranking, abre painel lateral (`Sheet`) com:

- Header: nome da oficina + total peças avaliadas no período.
- Lista de subconferências concluídas (mais recentes primeiro):
  número, OP, data inspeção, peças aprovadas/reprovadas, defeitos.
- Link "Ver OP" abre `/confeccao/ops/{numero}` em nova aba.

Sem agregação adicional — só lista cronológica. Sem paginação no MVP
(últimas 50 subconferências).

### Filtros

- **Período** (início / fim) — afeta subconferências (via `concluidaEm`)
  e retiradas (via `dataRetirada`). Default: últimos 30 dias.
- **Produto** — `confeccao_ordem_producao.produto_id`.
- **Oficina** — pré-filtra o ranking pra uma única oficina (útil pra
  drill-down direto).

## Backend

`GET /api/confeccao/dashboard/qualidade` (admin/owner only). Query params:

- `de`, `ate` (ISO date, optional, default últimos 30 dias)
- `produtoId` (optional)
- `oficinaId` (optional)

Retorna:

```ts
{
  kpis: {
    oficinasAvaliadas: number;
    aprovacaoMedia: number;          // 0..1
    pontualidadeMedia: number;        // 0..1
  };
  ranking: Array<{
    oficinaId: string;
    oficinaNome: string;
    pecasAvaliadas: number;
    aprovacao: number;                // 0..1
    tempoMedioDias: number | null;    // null se nenhuma retirada final concluída
    pontualidade: number | null;       // null se sem prazo cadastrado em nenhuma retirada
    divergenciasConfirmadas: number;
  }>;
  topDefeitos: Array<{
    tipo: TipoDefeito;
    contagem: number;
    percentual: number;               // 0..1 sobre total de marcações de defeito
  }>;
  detalhePorOficina: Record<string, Array<{
    subconferenciaId: string;
    subconferenciaNumero: string;
    opNumero: string;
    dataInspecao: string;             // ISO
    aprovadas: number;                // soma flat
    reprovadas: number;
    tiposDefeito: TipoDefeito[];
  }>>;
}
```

Service `montarDashboardQualidade` em
`src/lib/confeccao/dashboard-qualidade.ts`. Função pura: recebe arrays
crus (oficinas, subconferências, retiradas, subtasks de costura) +
filtros e retorna o agregado. Mantém o mesmo padrão de `dashboard.ts`
da RITM-20 (testável sem mockar banco).

### Inputs (lidos do banco no route handler)

- **Subconferências** com status `concluida` no período: `id`, `numero`,
  `retiradaId`, `aprovadas`, `reprovadas`, `tiposDefeito`,
  `divergenciaConfirmada`, `oficinaResponsavelDivergenciaId`,
  `concluidaEm`.
- **Retiradas** correspondentes (JOIN via `retiradaId`): `id`,
  `subtaskCosturaId`, `oficinaId`, `tipo`, `dataRetirada`.
- **Subtasks Costura** correspondentes (JOIN via `subtaskCosturaId`):
  `id`, `iniciadaEm`, `payload` (pra extrair `prazoProducao` por oficina).
- **Fornecedores** (JOIN via `oficinaId`): `id`, `nome`. Filtrar só
  categoria `costura`.
- **OPs** (JOIN via `subtask.ordemProducaoId`): `id`, `numero`,
  `produtoId`. Filtra por `produtoId` se passado.

Tudo escopado a `contaId` ativa via `withContaAtiva`.

### Cálculos no service

```
pecasAvaliadas(subconf) = soma flat de aprovadas[tam][cor] + reprovadas[tam][cor]
pecasAprovadas(subconf) = soma flat de aprovadas[tam][cor]
aprovacao(oficina) = sum(aprovadas) / sum(aprovadas + reprovadas)
tempoEntregaDias(retirada final, subtask) = (retirada.dataRetirada - subtask.iniciadaEm) / 86400_000
tempoMedio(oficina) = avg(tempoEntregaDias) sobre retiradas tipo=final dessa oficina
pontual?(retirada final) = retirada.dataRetirada <= prazoProducao(oficina no payload da subtask)
pontualidade(oficina) = count(pontuais) / count(retiradas final com prazo cadastrado)
```

> Edge cases:
> - Oficina sem nenhuma subconferência concluída → não aparece no ranking.
> - Retirada cancelada (`canceladaEm IS NOT NULL`) → ignorada em todos os cálculos.
> - Subconferência sem `aprovadas` ou `reprovadas` (incompleta) → ignorada.
> - Retirada sem `prazoProducao` no payload da oficina → não conta no
>   denominador de pontualidade (não conta como descumprimento nem como cumprimento).

## UI

Página `/confeccao/dashboard/qualidade/page.tsx`:

- Header com filtros (Datepicker de range + select de produto + select
  de oficina). Componente reaproveita o pattern do
  `/confeccao/dashboard` (header + cards).
- 3 KPI cards (reusa `kpi-card.tsx` da RITM-20).
- Painel 1 (Ranking) ocupa row inteira.
- Painel 2 (Top Defeitos) em row separada.
- Sheet lateral (Painel 3) abre on click na linha do ranking.

Componentes em `src/components/confeccao/dashboard/qualidade/`:
- `ranking-oficinas-table.tsx` (sortable; reusa `Table` do shadcn)
- `top-defeitos-chart.tsx` (recharts BarChart horizontal)
- `detalhe-oficina-sheet.tsx` (Sheet com lista de subconferências)

Sidebar: adicionar sub-item "Qualidade" sob "Dashboard" em
`confeccaoItems` no layout do dashboard. Mantém "Dashboard" linkando
pro geral; novo item "Dashboard / Qualidade" pra essa página.

## Deps novas

Nenhuma. Recharts e shadcn já instalados nas RITMs anteriores.

## Critérios de aceitação

1. Rota `/confeccao/dashboard/qualidade` exige admin/owner ativo;
   outros papéis recebem redirect para `/confeccao`.
2. Endpoint responde 403 para não admin, 200 com agregados para admin.
3. Ranking ordenado por % aprovação desc por default; clicar em coluna
   reordena (asc/desc toggle).
4. Subconferência sem `aprovadas`/`reprovadas` preenchidos é ignorada
   em todos os cálculos (não quebra a UI nem zera médias).
5. Retirada cancelada (`canceladaEm IS NOT NULL`) é ignorada em todos
   os cálculos.
6. Pontualidade é `null` (mostrar "—" na UI) pra oficinas onde nenhuma
   retirada final tem `prazoProducao` cadastrado no payload da Costura.
7. Filtros aplicam corretamente (produto, oficina, período).
8. Sheet de detalhe mostra subconferências da oficina ordenadas
   por `concluidaEm desc`, limitado a 50.
9. Lint, typecheck. Testes unit do `montarDashboardQualidade` cobrindo
   no mínimo:
   - Cenário base com 1 oficina e 2 subconferências (cálculo aprovação).
   - Oficina com retirada cancelada (deve ignorar).
   - Oficina sem prazoProducao em nenhuma retirada (pontualidade=null).
   - Subconferência incompleta (sem aprovadas/reprovadas).
   - Divergência confirmada incrementa contador na oficina
     `oficinaResponsavelDivergenciaId` (não na oficina da retirada).
   - Top defeitos: ordenação e cálculo percentual.

## Fora de escopo (RITM futuro)

- Histórico individual por costureiro — exige migration adicionando
  `costureiro_id` em retirada ou subconferência. Documentar como
  RITM-XX (não decidido ainda).
- Comparativos temporais (evolução de % aprovação por oficina ao longo
  do tempo) — útil mas não pedido na arquitetura.
- Export CSV — não pedido.
