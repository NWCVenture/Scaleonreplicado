# RITM-29 — Compra: multi-fornecedor + spill de rolos + descontinua pré/pós

> **Bloqueia:** RITM-31+ (frente 3 — tally/keyboard nav), RITM-30 (export XLSX) — todas dependem do schema de compra estável.
> **Depende de:** RITM-08 (subtask compra v1 existe).
> **Dependência externa:** nenhuma.

---

## Princípio inegociável: a UI da Compra é uma planilha

O Excel `OP TEMPLATE.xlsm` resolve a Compra com:
- 1 linha por cor (kg contratado, qtd rolos, preço/kg, kg recebido = SUMIFS dos rolos)
- spill de rolos: o número de rolos da cor expande automaticamente as linhas de peso
- soma global em destaque: kg recebido vs kg contratado

A v1 do módulo (RITM-08) divide a subtask em **pré** (fornecedor único + cores+kgs) e **pós** (rolos+pesos+preço). Dois cliques pra ver tudo, dois bloqueios pra avançar, e força fornecedor único. **Não bate com a realidade operacional** — uma OP frequentemente compra de 2-3 fornecedores diferentes, e o operador quer ver tudo em uma tela só desde o início.

Este RITM descontinua `pre`/`pos`, suporta múltiplos fornecedores, e converte o preenchimento de rolos em spill (digito "qtd 5" → 5 inputs de peso aparecem).

---

## Objetivo

Refatorar a subtask Compra (OPBUY) para:

1. **Schema novo:** `fornecedores: [{ id, observacoes?, cores: [{ corId, kgsContratados, qtdRolosContratados, precoPorKg, pesosRolos: [] }] }]` + campos top-level (destinatário, tipo tecido, gramatura, largura).
2. **Sem pré/pós:** subtask abre direto em `em_andamento`, com tudo num único bloco.
3. **Spill de rolos:** input `qtdRolosContratados = N` sincroniza array `pesosRolos` em N entradas (padding ou truncate).
4. **Multi-fornecedor:** botão "+ Fornecedor" adiciona card. Cada card pode ter suas cores.
5. **Preço por cor (dentro do fornecedor):** mesmo fornecedor pode cobrar diferente por cor especial (preto, neon).
6. **Summary live "real vs contratado":** total kg recebido por cor, diff, custo total da OP, atualiza ao digitar.

Migração de payloads existentes via script — 2 OPs em prod, ambas com `pre` apenas, ambas migráveis sem perda.

**Não inclui:**

- Paste de coluna do Excel nos pesos (frente do RITM-32).
- Keyboard navigation tab/setas na grid (RITM-32 também).
- Geocoding/contato Lalamove do fornecedor inline na subtask (a tela de Fornecedor já cobre — RITM-05).
- Cadastro de novo fornecedor inline (já existe via `LookupComCadastroInline` + `FormFornecedorRapido` — reusa).

---

## Schema novo

`src/lib/confeccao/schemas/payloads/compra.ts`:

```ts
import { z } from "zod";

export const CorContratadaSchema = z.object({
  corId: z.string().min(1),
  kgsContratados: z.number().nonnegative().finite(),
  qtdRolosContratados: z.number().int().nonnegative(),
  precoPorKg: z.number().nonnegative().finite(),
  // length idealmente == qtdRolosContratados; UI sincroniza, validar é livre
  // pra MVP (operador pode estar no meio do preenchimento)
  pesosRolos: z.array(z.number().nonnegative().finite()),
});
export type CorContratada = z.infer<typeof CorContratadaSchema>;

export const FornecedorCompraSchema = z.object({
  fornecedorId: z.string().min(1),
  observacoes: z.string().max(2000).optional(),
  cores: z.array(CorContratadaSchema),
});
export type FornecedorCompra = z.infer<typeof FornecedorCompraSchema>;

export const SubtaskCompraPayloadSchema = z.object({
  fornecedores: z.array(FornecedorCompraSchema).optional(),
  destinatarioCorteId: z.string().min(1).optional(),
  tipoTecidoId: z.string().min(1).optional(),
  gramaturaGM2: z.number().positive().finite().optional(),
  larguraRoloCm: z.number().positive().finite().max(500).optional(),
  observacoes: z.string().max(2000).optional(),
});
export type SubtaskCompraPayload = z.infer<typeof SubtaskCompraPayloadSchema>;

// ConcluirSubtaskCompraSchema: tudo obrigatório, com refinements:
//  - >= 1 fornecedor; cada fornecedor >= 1 cor
//  - cada cor: kgsContratados > 0, qtdRolosContratados > 0, precoPorKg > 0,
//    pesosRolos.length === qtdRolosContratados, cada peso > 0
//  - destinatarioCorteId, tipoTecidoId, gramaturaGM2, larguraRoloCm preenchidos
//  - sem cor duplicada DENTRO de um fornecedor (mas pode repetir entre fornecedores)
```

### Helpers

```ts
calcularPesoRealCor(cor: CorContratada): number  // sum pesosRolos
calcularPesoRealFornecedor(f: FornecedorCompra): number
calcularPesoRealTotal(payload): number
calcularPesoContratadoTotal(payload): number
calcularCustoCor(cor): number  // pesoReal × precoPorKg
calcularCustoFornecedor(f): number
calcularCustoTotal(payload): number
agruparPesoRecebidoPorCor(payload): Map<corId, number>  // soma cross-fornecedor
agruparRolosContratadosPorCor(payload): Map<corId, number>
```

---

## Migration de payloads existentes

Script `src/lib/db/migrate-compra-payload-v2.ts`:

```ts
// Para cada confeccao_subtask WHERE prefixo='OPBUY':
//   se payload.pre existe (formato antigo):
//     novoPayload = {
//       fornecedores: [{
//         fornecedorId: payload.pre.fornecedorId,
//         cores: payload.pre.cores.map(c => ({
//           corId: c.corId,
//           kgsContratados: c.kgsSolicitados,
//           qtdRolosContratados: payload.pos?.rolosRecebidos
//             ?.find(r => r.corId === c.corId)?.pesos.length ?? 0,
//           precoPorKg: payload.pos?.precoKgEfetivo ?? 0,
//           pesosRolos: payload.pos?.rolosRecebidos
//             ?.find(r => r.corId === c.corId)?.pesos ?? [],
//         })),
//       }],
//       destinatarioCorteId: payload.pre.destinatarioCorteId,
//       tipoTecidoId: payload.pre.tipoTecidoId,
//       gramaturaGM2: payload.pos?.gramaturaGM2,
//       larguraRoloCm: payload.pos?.larguraRoloCm,
//       observacoes: payload.pre.observacoesPedido,
//     }
//     UPDATE subtask SET payload = novoPayload
//   se payload é {} ou sem pre: mantém vazio
//
// Idempotente: detecta payload novo (tem .fornecedores) e pula.
// Roda local primeiro, depois prod.
```

---

## UI (subtask-compra.tsx)

Estrutura nova:

```
┌─ Tipo de tecido + destinatário do corte + gramatura + largura ─┐
│ [Tipo tecido ▾] [Destinatário corte ▾] [Gram. g/m²] [Larg. cm] │
└────────────────────────────────────────────────────────────────┘

┌─ Fornecedor 1: NOME [editar] [remover] ───────────────────────┐
│  Cor       Kgs contr.   Qtd rolos   R$/kg     Kg real     Diff │
│  Azul     │ 400        │ 30        │ 8,50  │ 398,2 kg │ -0,5% │
│  Branco   │ 400        │ 30        │ 9,00  │   —      │   —    │
│  + Cor                                                          │
│  ─────────── Pesos dos rolos (Azul, 30 rolos) ─────────────── │
│  Rolo 1: [13,4] Rolo 2: [13,2] Rolo 3: [13,1] ... Rolo 30: [_]  │
│  ─────────── Pesos dos rolos (Branco, 30 rolos) ───────────── │
│  Rolo 1: [_] ... Rolo 30: [_]                                  │
└────────────────────────────────────────────────────────────────┘

[+ Fornecedor]

┌─ Summary ───────────────────────────────────────────────────────┐
│ Total contratado: 1.200 kg  ·  Total real: 398,2 kg  ·  -67%   │
│ Custo total: R$ 3.384,70                                       │
└────────────────────────────────────────────────────────────────┘

[Bloco Lalamove, Anexos, Notas, Concluir — sem mudança]
```

Comportamento:
- Mudar `qtdRolosContratados` redimensiona `pesosRolos` (padding com 0; truncate vai pro confirm dialog se valores não-zero perdidos).
- Inputs de peso aceitam decimais com vírgula OU ponto.
- Diff por cor: vermelho se |%| > 5; amarelo se entre 1-5%.
- Botão `Concluir` desabilitado quando há linha de cor com algum requisito faltando — tooltip lista o que falta.
- Sem mais bloco "pré" / "pós" — tudo na mesma tela.

Auto-save por debounce 800ms (mesmo padrão atual).

---

## Endpoint /concluir + creator

- `src/app/api/confeccao/subtasks/[id]/concluir/route.ts`: schema novo (`ConcluirSubtaskCompraSchema`).
- OP creator (`src/app/api/confeccao/ops/route.ts` POST): subtask OPBUY já nasce em `em_andamento` (não `pendente`). As demais ficam `bloqueada` como antes — só destrava ao concluir Compra.

---

## Arquivos a tocar

| Arquivo | Mudança |
|---|---|
| `src/lib/confeccao/schemas/payloads/compra.ts` | reescrever schema + helpers |
| `src/lib/confeccao/schemas/payloads/compra.test.ts` | atualizar fixtures |
| `src/lib/confeccao/saldos.ts` | `calcularSaldosCompra` lê novo formato |
| `src/lib/confeccao/saldos.test.ts` | fixtures |
| `src/lib/confeccao/schemas/payloads/corte.ts` | `rolosCompradosPorCorDeCompra` lê novo formato |
| `src/lib/confeccao/dashboard-kpis.ts` | derivações de Compra (kg contratado/recebido/custoTecido/rolosTotal) |
| `src/lib/confeccao/dashboard-kpis.test.ts` | fixtures |
| `src/lib/db/migrate-compra-payload-v2.ts` | novo: migration de payloads |
| `src/components/confeccao/subtask-compra.tsx` | reescrever (~800 linhas) |
| `src/app/api/confeccao/subtasks/[id]/concluir/route.ts` | trocar schema |
| `src/app/api/confeccao/ops/route.ts` POST | OPBUY nasce em em_andamento |

---

## Critérios de aceitação

1. **`tsc --noEmit`** sem erros novos.
2. **Schema valida payload novo:** parse de `{ fornecedores: [{ fornecedorId, cores: [{ corId, kgsContratados, qtdRolosContratados, precoPorKg, pesosRolos }] }] }` é aceito como `SubtaskCompraPayload`.
3. **Concluir rejeita incompleto:** falta `precoPorKg` em alguma cor → erro Zod com path da cor.
4. **Concluir rejeita pesos.length != qtdRolos:** se operador digitou 5 rolos mas só preencheu 3 pesos → erro.
5. **Cores duplicadas dentro de fornecedor:** rejeitado. Mesma cor entre fornecedores: aceito.
6. **Migration:** script roda em local, OPBUY0001 (vazia) fica `{}`; OPBUY0002 (só pre) vira `{ fornecedores: [{ fornecedorId, cores: [{ corId, kgsContratados=400, qtdRolosContratados=0, precoPorKg=0, pesosRolos: [] }, ...] }], destinatarioCorteId, tipoTecidoId }`. Idempotente: rodar 2× não duplica.
7. **Dashboard-kpis preserva contratos:** OP recém-criada → todos null; OP com 2 fornecedores → kgContratado é soma dos dois.
8. **Saldos:** `calcularSaldosCompra` retorna `rolosPorCor` e `kgsPorCor` agregando cross-fornecedor.
9. **Corte:** `rolosCompradosPorCorDeCompra` lê do formato novo, agrega cross-fornecedor.
10. **UI renderiza OP vazia sem crash:** carrega subtask sem fornecedores → mostra "Adicionar fornecedor" sem nada quebrado.
11. **Spill funciona:** muda qtdRolosContratados de 0 → 5 → cria 5 inputs de peso; muda pra 3 → trunca pros 3 primeiros (com confirm se algum peso não-zero ia ser perdido).
12. **Auto-save:** digita 1 valor, sem submit → PATCH dispara em 800ms; refresh da página preserva.
13. **OPBUY nasce em em_andamento:** criar OP nova → subtask OPBUY já abre como em_andamento; demais bloqueada.

---

## Out-of-scope (próximos RITMs)

- **RITM-30:** Export XLSX da OP completa (espelha o template Excel).
- **RITM-31:** Tally entry + keyboard nav matriz cor×tamanho (Costura/Conferência).
- **RITM-32:** Paste de coluna do Excel nos pesos (Ctrl+V → preenche N inputs).
- **RITM-33:** Custos consolidados no header (lalamoves + outros).
