# RITM-28 — OP Dashboard ao vivo (header-strip)

> **Bloqueia:** nenhum.
> **Depende de:** RITM-08..14 (payloads das subtasks já existem).
> **Dependência externa:** nenhuma.

---

## Princípio inegociável: o dashboard é derivação pura dos payloads existentes

O Excel `OP TEMPLATE.xlsm` tem uma "Página inicial" que mostra os indicadores chave da OP em uma única tela, derivados via fórmula das demais abas. Operador abre, vê estado da OP em 2 segundos, decide onde clicar.

O sistema hoje exige expandir cada subtask do stepper pra ver os números. O dashboard-strip resolve isso renderizando os mesmos KPIs do Excel **abaixo do `OPHeader`**, **em todas as visitas à página da OP**, sem nenhum cálculo no banco — tudo derivado client-side dos payloads já carregados.

Consequências:

- ❌ Sem novo endpoint, sem nova tabela, sem migration. Dashboard usa exclusivamente o payload já retornado por `GET /api/confeccao/ops/[numero]`.
- ❌ Sem ler retiradas / subconferências / lalamoves nesta iteração. Esses dados existem mas exigem 2-3 fetches extras — entram em RITM-29 (dashboard estendido) quando justificarmos o custo de latência.
- ✅ Derivação 100% testável sem banco (função pura `derivarKpisOp`).
- ✅ Toda atualização da subtask pelo operador re-renderiza o dashboard automaticamente (já chama `onAlterado` → `fetchOp`).

---

## Objetivo

Renderizar 4 seções compactas abaixo do `OPHeader`:

1. **Status das etapas** — chips horizontais por subtask (✓ concluída · ◐ em andamento · ○ pendente · ⊘ bloqueada).
2. **Quantidades** — kg contratado/recebido/diff, rolos, folhas, peças cortadas, peças enviadas à costura.
3. **Rendimento** — % aproveitamento do risco, consumo m²/peça, rendimento esperado vs real do corte.
4. **Financeiro** — custos parciais (tecido, risco, corte, viés, costura), total, custo/peça.

Cada célula mostra `—` (em cinza) quando a subtask de origem ainda não foi preenchida. Operador vê de cara o que falta sem expandir nada.

**Não inclui:**

- Custos de Lalamove (próximo RITM — exige fetch extra).
- Peças aprovadas (próximo RITM — exige fetch das subconferências).
- Edição/clique-pra-expandir nas células (visual-only nesta iteração).
- Export pra Excel (RITM-30 — frente 4 da revisão).
- Atualização em tempo real cross-aba (já temos `onAlterado` síncrono).

---

## Especificação

### Função pura `derivarKpisOp`

`src/lib/confeccao/dashboard-kpis.ts`:

```ts
import type { ConfeccaoSubtask } from "@/lib/db/schema";
import type { SubtaskCompraPayload } from "./schemas/payloads/compra";
import type { SubtaskRiscoPayload } from "./schemas/payloads/risco";
import type { SubtaskCortePayload } from "./schemas/payloads/corte";
import type { SubtaskViesPayload } from "./schemas/payloads/vies";
import type { SubtaskCosturaPayload } from "./schemas/payloads/costura";

export interface KpisStatus {
  compra: "concluida" | "em_andamento" | "pendente" | "bloqueada" | "cancelada";
  risco: KpisStatus["compra"];
  corte: KpisStatus["compra"];
  vies: KpisStatus["compra"] | "ausente";
  costura: KpisStatus["compra"];
  conferencia: KpisStatus["compra"];
}

export interface KpisQuantidades {
  kgContratado: number | null;
  kgRecebido: number | null;
  diffKg: number | null;            // recebido - contratado
  diffPercentual: number | null;     // (diff / contratado), só quando contratado > 0
  rolosTotal: number | null;
  folhasTotal: number | null;
  pecasCortadas: number | null;
  pecasEnviadasCostura: number | null;
}

export interface KpisRendimento {
  aproveitamentoRiscoPercentual: number | null;
  consumoPorPecaM2: number | null;       // derivado: (largura × comprimento × aproveitamento) / pecasPorFolha
  rendimentoEsperadoCorte: number | null; // folhasTotal × pecasPorFolha (do risco)
  rendimentoInformadoCorte: number | null; // pecasCortadas
  pecasPorFolha: number | null;          // sum de proporções do risco
}

export interface KpisFinanceiro {
  custoTecido: number | null;
  custoRisco: number | null;
  custoCorte: number | null;          // sum por oficina (precoPorPeca × rendimentoTotal)
  custoVies: number | null;
  custoCostura: number | null;        // sum por oficina (precoPorPeca × pecasEnviadasTotal)
  custoTotal: number | null;          // sum dos parciais (nulls tratados como 0 mas só calcula se ao menos 1 não-null)
  custoPorPeca: number | null;        // custoTotal / pecasCortadas (quando ambos > 0)
}

export interface KpisOp {
  status: KpisStatus;
  quantidades: KpisQuantidades;
  rendimento: KpisRendimento;
  financeiro: KpisFinanceiro;
}

export interface SubtaskComPayload {
  prefixo: string;
  status: "bloqueada" | "pendente" | "em_andamento" | "concluida" | "cancelada";
  payload: unknown;
}

export function derivarKpisOp(subtasks: SubtaskComPayload[]): KpisOp;
```

**Regras de cálculo:**

- `kgContratado = sum(compra.pre.cores[i].kgsSolicitados)`.
- `kgRecebido = sum(compra.pos.rolosRecebidos[i].pesos)`.
- `rolosTotal = sum(compra.pos.rolosRecebidos[i].pesos.length)`.
- `folhasTotal = sum(corte.oficinas[i].folhasEnfesto)`.
- `pecasCortadas = sum(corte.oficinas[i].rendimentoTotal)`.
- `pecasEnviadasCostura = sum sum (costura.oficinas[i].pecasEnviadasPorTamanhoCor[j].quantidade)`.
- `pecasPorFolha = sum(risco.tamanhos[i].proporcao)`.
- `aproveitamentoRiscoPercentual = risco.rendimentoPercentual`.
- `consumoPorPecaM2 = (risco.larguraCm/100) × risco.comprimentoM × (risco.rendimentoPercentual/100) / pecasPorFolha`.
- `rendimentoEsperadoCorte = folhasTotal × pecasPorFolha`.
- `custoTecido = kgRecebido × compra.pos.precoKgEfetivo`.
- `custoRisco = risco.valorServico`.
- `custoCorte = sum(o.precoPorPeca × o.rendimentoTotal)`.
- `custoVies = vies.precoPorMetro × vies.metragemProduzidaM`.
- `custoCostura = sum(o.precoPorPeca × sum(pecasEnviadasTotal da oficina))`.
- `custoTotal = sum dos parciais (null = 0, mas devolve null se TODOS forem null)`.
- `custoPorPeca = custoTotal / pecasCortadas` quando ambos > 0.

**Status mapping:** copia o `subtask.status` direto. `vies.status = "ausente"` quando a OP não tem viés (não há subtask Viés no array).

---

### Componente `OpDashboardStrip`

`src/components/confeccao/op-dashboard-strip.tsx`:

Renderiza 4 seções em grid responsivo. Cada KPI é uma célula com label pequeno (cinza, uppercase, tracking wider) e valor tabular.

**Visual rules:**

- Status chip por subtask: ícone + nome. Cor: verde (concluída), azul (em andamento), cinza (pendente/bloqueada), vermelho (cancelada).
- Valor `null` → renderiza `—` em `text-muted-foreground`.
- `custoTotal` em destaque (background amarelo claro, equivalente ao "amarelo-claro" do Excel).
- `diffKg` em vermelho quando < 0 (recebeu menos que contratou) ou amarelo quando |%| > 5.
- Strip inteira em `border rounded` abaixo do header, padding compacto.

**Layout** (mobile-first, mas otimizado pra desktop onde o operador realmente vai usar):

```
┌─ Status ────────────────────────────────────────────────────────────────┐
│ [✓ Compra] [✓ Risco] [◐ Corte] [○ Viés] [○ Costura] [○ Conferência]    │
├─ Quantidades ─────────────┬─ Rendimento ──────────────┬─ Financeiro ───┤
│ Kg contratado    30,0     │ Aprov. risco   88%       │ Tecido R$596,00│
│ Kg recebido      29,8     │ Consumo/peça  0,15 m²    │ Risco  R$ —    │
│ Diff            -0,2 kg   │ Rend. esperado  384 pcs  │ Corte  R$ —    │
│ Rolos              8       │ Rend. informado 384 pcs  │ Viés   R$ —    │
│ Folhas            32       │                          │ Costura R$ —   │
│ Peças cortadas   384       │                          │ Total  R$596,00│
│ Peças → costura  —         │                          │ /peça  R$ —    │
└────────────────────────────┴──────────────────────────┴────────────────┘
```

Em mobile vira accordion: 1 seção expandida por vez.

---

### Mount

`src/app/(dashboard)/confeccao/ops/[numero]/page.tsx`:

- Importar `OpDashboardStrip` e `derivarKpisOp`.
- Calcular `kpis = derivarKpisOp(data.subtasks)` em `useMemo`.
- Renderizar `<OpDashboardStrip kpis={kpis} temVies={data.op.temVies} />` entre `<OPHeader />` e `<FardosNoEstoque />`.
- Adicionar prop ao `OPHeader` se necessário pra ajustar margem inferior (sticky top do strip se grudado).

---

## Arquivos a tocar

| Arquivo | Mudança |
|---|---|
| `src/lib/confeccao/dashboard-kpis.ts` | novo: tipos + `derivarKpisOp` |
| `src/lib/confeccao/dashboard-kpis.test.ts` | novo: cobertura por seção |
| `src/components/confeccao/op-dashboard-strip.tsx` | novo: UI das 4 seções |
| `src/app/(dashboard)/confeccao/ops/[numero]/page.tsx` | mount do strip |

---

## Critérios de aceitação

1. **`tsc --noEmit`** sem erros novos.
2. **`derivarKpisOp` puro:** chama sem nenhum I/O (sem `fetch`, sem `db`, sem `Date.now()` exceto se realmente derivar — não usa).
3. **Subtasks vazias:** todas as células retornam `null`; UI mostra `—`.
4. **Compra preenchida:** `kgContratado`, `kgRecebido`, `diffKg`, `rolosTotal` e `custoTecido` derivam corretamente.
5. **Risco preenchido:** `aproveitamentoRiscoPercentual`, `consumoPorPecaM2`, `pecasPorFolha` corretos.
6. **Corte preenchido (1 oficina):** `folhasTotal`, `pecasCortadas`, `rendimentoEsperadoCorte`, `custoCorte`.
7. **Corte preenchido (N oficinas):** soma todas; sem duplicação.
8. **Costura preenchida (N oficinas):** `pecasEnviadasCostura` é soma das matrizes (tamanho × cor) por oficina; `custoCostura` agrega.
9. **Viés ausente vs presente:** quando subtask viés não está no array, `status.vies = "ausente"`, `custoVies = null`. Quando presente e preenchida, calcula.
10. **`custoTotal` e `custoPorPeca`:** somam os parciais não-null. Custo/peça é `null` se `pecasCortadas` é `null` ou 0.
11. **UI renderiza sem crash em OP recém-criada** (todos os payloads vazios) — todas as células mostram `—` e os status chips ficam apropriados.
12. **UI rerender ao salvar subtask:** após `onAlterado` → `fetchOp`, o strip reflete os novos valores.

---

## Out-of-scope (próximos RITMs)

- **RITM-29** Dashboard estendido: incluir Lalamoves (sum via endpoint /evidencias), peças aprovadas (sum via endpoint próprio de subconferências), peças retiradas.
- **RITM-30** Export XLSX da OP (frente 4 da revisão Excel).
- **RITM-31** Tally entry + keyboard nav na matriz cor×tamanho (frente 3).
- **RITM-32** Grid-spill nos rolos + paste do Excel (frente 2).
- **RITM-33** Dashboard click-through (clicar em "Peças cortadas" abre subtask Corte).
