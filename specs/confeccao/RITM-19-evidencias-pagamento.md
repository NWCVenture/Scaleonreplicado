# RITM-19 — Aba Evidências de Pagamento + cálculo de custos

Implementa a aba "Evidências de Pagamento" acessível pelo header da OP,
exibindo o resumo financeiro, comprovantes anexados e Lalamoves
consolidados. Cálculos a partir dos payloads das subtasks — sem
mutação de estado, sem migration.

## Escopo

- **Service `calcularCustosOP`** (puro): recebe payloads das subtasks +
  lalamoves + subconferências e retorna breakdown completo de custos +
  indicadores.
- **Endpoint** `GET /api/confeccao/ops/[numero]/evidencias`: agrega
  custos + lista de anexos por categoria + lista de lalamoves.
- **UI**: `EvidenciasSheet` aberto pelo botão `ReceiptText` no header
  (atual placeholder).

## Modelo de cálculo

| Componente | Fórmula |
|---|---|
| Tecido | `precoKgEfetivo × sum(rolosRecebidos.pesos)` |
| Risco | `valorServico` (campo único do payload OPRIS) |
| Corte | Σ por oficina: `precoPorPeca × Σ rendimentoPorTamanhoCor.quantidade` |
| Viés | `precoPorMetro × metragemProduzidaM` (somente se temVies) |
| Costura | Σ por oficina: `precoPorPeca × Σ pecasEnviadasPorTamanhoCor.quantidade` |
| Lalamoves | Σ `valor` de todos os Lalamoves da OP **exceto** os cancelados |

**Lalamoves separados em duas listas:**
- `principais` — tipo = `principal`
- `outros` — tipo = `outros` (ex: envio de etiquetas)

Ambos somam no `custoLalamoves` total.

**Indicadores derivados:**
- `pecasProduzidas` = Σ `pecasEnviadasPorTamanhoCor.quantidade` (OPSEW)
- `pecasAprovadas` = Σ `subconferencia.aprovadas` por subconferência concluída
- `custoTotal` = soma dos componentes
- `custoPorPecaProduzida` = `custoTotal / pecasProduzidas` (null se 0)
- `custoPorPecaAprovada` = `custoTotal / pecasAprovadas` (null se 0)
- `perdas` = custo dos rolos descartados em OPCOR =
  `Σ (kgMedioPorRolo × precoKgEfetivo × qtdRolosDescartados)` —
  exibido como indicador separado, NÃO entra em custoTotal

## Endpoint

`GET /api/confeccao/ops/[numero]/evidencias` — autenticado (sem
admin-only — visualização). Retorna:

```ts
{
  op: { id, numero, status, produtoNome, temVies },
  custos: {
    tecido, risco, corte, vies, costura,
    lalamovesPrincipais, lalamovesOutros, lalamovesTotal,
    custoTotal,
    pecasProduzidas, pecasAprovadas,
    custoPorPecaProduzida, custoPorPecaAprovada,
    perdas
  },
  anexos: Array<{
    categoria: string,
    items: Array<{ id, nomeArquivo, blobUrl, tamanhoBytes, createdAt, subtaskNumero }>
  }>,
  lalamoves: {
    principais: Array<LalamoveResumo>,
    outros: Array<LalamoveResumo>
  }
}
```

`LalamoveResumo` inclui id, numero (se houver), tipo, status, valor, origem→destino,
data_solicitacao, subtask vinculada.

## UI

`EvidenciasSheet` (`src/components/confeccao/evidencias-sheet.tsx`):

- 3 seções empilhadas dentro de `SheetContent` lateral wide
- Seção **Resumo Financeiro**: cards com cada componente + total +
  indicadores derivados. Perdas em destaque separado.
- Seção **Comprovantes**: lista agrupada por categoria, cada item com
  link pro blob (target=_blank), tamanho, data, subtask de origem.
- Seção **Lalamoves**: tabela compacta com principais + bloco separado
  "Lalamoves (outros)" quando houver.

Integração no `OPHeader`: bota o botão `ReceiptText` operacional —
remove `disabled` + `title="… RITM-19"`, adiciona handler que abre o
sheet.

Indicação visual quando OP cancelada: badge "OP cancelada" no header
da aba (`Custos preservados para contabilidade`).

## Critérios de aceitação

1. OP recém-criada (todos payloads vazios) → custos zerados, sem erro.
2. OP completa (todas subtasks concluídas) → todos os custos calculam
   corretamente.
3. OP com Viés (temVies=true) inclui custo de viés.
4. OP sem Viés ignora payload OPVIE.
5. Lalamove cancelado **não** soma no total.
6. Perdas calcula corretamente quando há rolos descartados em OPCOR.
7. Anexos agrupados por categoria, com fallback "outros" pra valores
   não conhecidos.
8. Sheet abre/fecha sem regressão no histórico (Sheet vizinho).
9. Lint, typecheck, testes do service ≥ 6 cenários.
