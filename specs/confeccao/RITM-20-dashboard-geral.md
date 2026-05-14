# RITM-20 — Dashboard Geral

Implementa o Dashboard Geral do módulo Confecção (arquitetura §15.1).
Acesso: admins/owners ativos da conta. Rota nova `/confeccao/dashboard`.

## Conteúdo

### KPIs (top)

- **OPs abertas** — `status = 'em_andamento'`
- **OPs em atraso** — pelo menos uma subtask `OPSEW`/`OPCOR` com
  oficina cuja `prazoProducao < now()` e `statusInterno != 'finalizada'`
- **OPs concluídas no mês** — `status = 'concluida'` AND
  `concluidaEm >= primeiro dia do mês corrente (zona local)`

### Painéis

1. **OPs por etapa** — bar chart (recharts) com a contagem de OPs em
   andamento agrupadas pela subtask atual em status `em_andamento` ou
   `pendente`. Eixo X: OPBUY, OPRIS, OPCOR, OPVIE, OPSEW, OPCONF.
2. **Mapa de Lalamoves ativos** — leaflet + OpenStreetMap, renderiza
   pontos coloridos pelo status quando há lat/lng no Lalamove. Modo
   manual normalmente fica vazio (esperado).
3. **Lista resumida de OPs em andamento** — top 10 mais recentes,
   tabela compacta com número/produto/atribuído/% progresso + link
   para detalhe.

### Alertas

- **Lalamove com tempo alto** — `status = 'procurando_motorista'` e
  `data_solicitacao < now() - 30min`
- **Oficinas em atraso** — agrupado por subtask: lista oficinas com
  prazo vencido ainda não finalizadas
- **Conferências divergentes** — `divergencia_confirmada = true` em
  subconferências não concluídas

### Filtros

- **Período** (início / fim) — afeta KPI de "OPs concluídas no período"
- **Produto** — selecionar produto da OP
- **Fornecedor** — qualquer fornecedor citado em alguma subtask da OP

Filtros aplicam ao escopo de OPs base de todas as métricas, exceto
"OPs concluídas no mês" que respeita o filtro de período (overrides
o "mês corrente").

## Backend

`GET /api/confeccao/dashboard` (admin/owner only). Query params:

- `de`, `ate` (ISO date)
- `produtoId`
- `fornecedorId`

Retorna:

```ts
{
  kpis: { opsAbertas, opsEmAtraso, opsConcluidasMes },
  opsPorEtapa: Array<{ prefixo, label, total }>,
  lalamovesAtivos: Array<LalamoveMapItem>,
  opsAtivas: Array<OpListaResumida>,
  alertas: {
    lalamoveTempoAlto: Array<...>,
    oficinasEmAtraso: Array<...>,
    conferenciasDivergentes: Array<...>
  }
}
```

Service `montarDashboard` em `src/lib/confeccao/dashboard.ts`
encapsula as queries + cálculos. Lógica de "em atraso" e
"em_andamento por etapa" é determinística sobre os payloads
existentes (sem nova coluna).

## UI

Página `/confeccao/dashboard/page.tsx`:

- Header com filtros (Datepicker de range + selects)
- 3 KPI cards
- Grid 2-col: Chart à esquerda, lista resumida à direita
- Mapa em row própria abaixo (h-96)
- Cards de alertas em baixo

Componentes em `src/components/confeccao/dashboard/`:
- `kpi-card.tsx`
- `ops-por-etapa-chart.tsx` (recharts BarChart)
- `lalamoves-mapa.tsx` (leaflet via dynamic import, `ssr: false`)
- `alertas-panel.tsx`

Sidebar: novo link "Dashboard" antes de "Ordens de Produção" em
`confeccaoItems` no layout dashboard.

## Deps novas

- `leaflet` + `@types/leaflet`
- `react-leaflet`

CSS do leaflet importado dentro do componente do mapa (lazy).

## Critérios de aceitação

1. Rota `/confeccao/dashboard` exige admin/owner ativo; outros papéis
   recebem redirect para `/confeccao`.
2. Endpoint responde 403 para não admin, 200 com agregados para admin.
3. KPI "OPs em atraso" só conta OPs onde tem oficina com prazo vencido
   e não finalizada.
4. Filtros aplicam corretamente (produto, fornecedor, período).
5. Lalamove cancelado nunca aparece no mapa nem em alerta.
6. Lint, typecheck, testes unit do `montarDashboard` (≥ 6 cenários).
