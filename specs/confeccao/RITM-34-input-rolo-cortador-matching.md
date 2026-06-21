# RITM-34 — Input por rolo no Corte + matching fornecedor↔cortador

> **Bloqueia:** nenhum.
> **Depende de:** RITM-32 (`distribuicaoOficinas` na Compra), RITM-33 (Corte conhece oficinas da Compra).
> **Dependência externa:** nenhuma.

---

## Princípio inegociável: rolos não têm identidade física — aproximamos pelo peso

Toda vez que se compra tecido:
1. **Fornecedor envia romaneio** com peso de cada rolo (entra na Compra via `pesosRolos[]` por cor).
2. **Cortador pesa os mesmos rolos** ao descer no enfesto, e anota peso + qtd de folhas rendidas por rolo.

Os rolos **não carregam ID físico** (sem etiqueta única). Para reconciliar "rolo X pesado pelo fornecedor = rolo Y pesado pelo cortador?", a planilha original (`OP TEMPLATE.xlsm` seção 3, doc seção 3.2-3.4) usa **ranking por peso dentro de (cor, lote)**: ordena-se ambas as listas e casa-se por posição. É a melhor aproximação dado que a única assinatura comum é o peso.

Este RITM:
1. Adiciona ao Corte input por rolo (peso do cortador + folhas rendidas) — uma lista por oficina, separada por cor.
2. Cria uma view read-only de **matching fornecedor↔cortador** que, para cada cor, alinha as listas ordenadas e mostra a diferença em kg/% por par. Tolerância configurável marca pares fora de range com ⚠.

---

## Objetivo

1. **Schema:** estender `OficinaCorteSchema` com `rolosRecebidos: Array<{corId, pesoCortador, folhasRendidas}>`. Length por cor deve casar com `rolosEnviadosPorCor[cor]`.
2. **UI do Corte:** dentro de cada oficina, para cada cor que tem rolos, lista de inputs (peso, folhas) — 1 linha por rolo. Nav teclado idêntico ao RITM-31 (Enter avança, Setas, auto-select).
3. **Algoritmo de matching:** por `(corId, oficinaId)`, ordena `pesoFornecedor` e `pesoCortador` ascendente; zip por posição. Diferença por par = `(pesoCortador - pesoFornecedor)` em kg e `%`.
4. **Tela de matching:** página/painel `Matching de Rolos` dentro do detalhe da OP. Read-only. Recalcula on-the-fly (sem persistência).
5. **Tolerância:** configurável por OP no payload da Compra (`toleranciaMatchingPct: number`, default `5`). Pares com `|diff%| > tolerancia` ficam destacados em ⚠.

**Não inclui:**

- Matching cross-oficina (rolo de oficina A casado com rolo enviado pra oficina B). Cada oficina recebeu um subset físico distinto — matching só faz sentido dentro de cada `(cor, oficina)`.
- Edição manual do pareamento (reassociar rolos). Algoritmo determinístico, sem override — view read-only.
- Identidade física por rolo (etiqueta única). Quando/se for adotada, este RITM vira obsoleto e dá lugar a matching por ID.
- Cálculo de "rendimento por rolo" (folhas / kg cortador) — fica como coluna derivada na view de matching mas sem persistência.
- Reaproveitar `rolosDescartados` (já existe no schema do Corte) — fica separado do matching; descarte é decisão do cortador.

---

## Schema novo

`src/lib/confeccao/schemas/payloads/corte.ts`:

```ts
// Cada rolo físico recebido pelo cortador
export const RoloRecebidoSchema = z.object({
  corId: z.string().min(1),
  pesoCortador: z.number().positive().finite(),
  folhasRendidas: z.number().int().nonnegative(),
});
export type RoloRecebido = z.infer<typeof RoloRecebidoSchema>;

export const OficinaCorteSchema = z.object({
  oficinaId: z.string().min(1),
  modoSeparacao: ModoSeparacaoCorteSchema,
  rolosEnviadosPorCor: z.record(z.string(), z.number().int().nonnegative()),
  // NOVO — input por rolo, sem ID físico (matching é por rank)
  rolosRecebidos: z.array(RoloRecebidoSchema).optional(),
  folhasEnfesto: z.number().int().positive().optional(),
  rendimentoTotal: z.number().int().nonnegative().optional(),
  rendimentoPorTamanhoCor: z.array(RendimentoTamanhoCorSchema).optional(),
  rolosDescartados: z.array(RoloDescartadoSchema).optional(),
  precoPorPeca: z.number().nonnegative().finite().optional(),
  observacoes: z.string().max(2000).optional(),
});
```

`src/lib/confeccao/schemas/payloads/compra.ts`:

```ts
export const SubtaskCompraPayloadSchema = z.object({
  // ... existente ...
  // NOVO — tolerância pra view de matching
  toleranciaMatchingPct: z.number().nonnegative().finite().max(100).optional(),
});
```

### Conclusão do Corte

Adicionar refinement em `ConcluirSubtaskCorteSchema`:
- Para cada oficina, para cada cor com `rolosEnviadosPorCor[cor] > 0`: `count(rolosRecebidos com corId=cor) === rolosEnviadosPorCor[cor]`.
- `pesoCortador > 0` e `folhasRendidas >= 0` em todos os rolos recebidos.
- Sem corId em `rolosRecebidos` que não esteja em `rolosEnviadosPorCor` da mesma oficina.

---

## Algoritmo de matching

`src/lib/confeccao/matching-rolos.ts`:

```ts
export interface PareamentoRolo {
  rank: number;            // 1-indexed dentro da (cor, oficina)
  pesoFornecedor: number;
  pesoCortador: number | null;  // null se cortador tem menos rolos que fornecedor
  diffKg: number | null;
  diffPct: number | null;
  forneOrfao: boolean;     // fornecedor sem par (cortador faltando rolos)
  cortOrfao: boolean;      // cortador sem par (cortador devolveu rolo extra inesperado)
  alerta: boolean;         // |diffPct| > tolerancia
}

export interface MatchingCorOficina {
  oficinaId: string;
  corId: string;
  pares: PareamentoRolo[];
  totalForne: number;       // soma pesos fornecedor (essa cor, essa oficina)
  totalCort: number;        // soma pesos cortador
  diffTotalKg: number;
  diffTotalPct: number;
}

export function calcularMatchingRolos(
  compraPayload: SubtaskCompraPayload,
  cortePayload: SubtaskCortePayload,
): MatchingCorOficina[];
```

### Como distribuir pesos do fornecedor por oficina

A Compra tem `pesosRolos: number[]` por cor (cross-fornecedor, agregado), e separadamente `distribuicaoOficinas[].rolosPorCor[cor]` em **contagens**. Não há vínculo explícito "esse peso vai pra essa oficina".

**Política:** ordenar `pesosRolos` da cor em ordem ascendente e distribuir os primeiros `n_A` pesos pra oficina A, próximos `n_B` pra oficina B, etc. (na ordem em que oficinas aparecem em `distribuicaoOficinas`). É a mesma heurística da seção 3.2 da planilha (`R6 = IF(COUNTIF(...) <= XLOOKUP(...T...),1,...)`) — uma escolha de aproximação, não verdade absoluta.

Documentar na tela: *"Pesos do fornecedor são distribuídos por oficina ordenadamente; a planilha original usa a mesma heurística"*.

### Pseudocódigo

```
para cada oficina O em compra.distribuicaoOficinas:
  para cada (cor, n_rolos) em O.rolosPorCor (onde n_rolos > 0):
    # pesos do fornecedor pra essa (cor, oficina)
    todosPesosDaCor = agregarPesosCrossFornecedor(compra, cor).sortAsc()
    inicio = offset acumulado dessa cor pra oficinas anteriores
    pesosForneOficina = todosPesosDaCor.slice(inicio, inicio + n_rolos)
    
    # pesos do cortador pra essa (cor, oficina)
    pesosCortOficina = corte.oficinas.find(o=>o.id==O).rolosRecebidos
                          .filter(r => r.corId == cor)
                          .map(r => r.pesoCortador)
                          .sortAsc()
    
    # zip por rank
    n = max(pesosForneOficina.length, pesosCortOficina.length)
    pares = []
    para i de 0 até n-1:
      forne = pesosForneOficina[i]   # pode ser undefined se cortador tem mais
      cort  = pesosCortOficina[i]    # pode ser undefined se fornecedor tem mais
      diffKg  = (forne && cort) ? cort - forne : null
      diffPct = (forne && cort && forne > 0) ? (cort/forne - 1) * 100 : null
      alerta  = diffPct != null && Math.abs(diffPct) > tolerancia
      pares.push({rank: i+1, pesoForne: forne, pesoCort: cort, diffKg, diffPct,
                  forneOrfao: cort == null, cortOrfao: forne == null, alerta})
    
    emit MatchingCorOficina(O.id, cor, pares, totais...)
```

---

## UI: input por rolo dentro de cada oficina (subtask-corte.tsx)

Dentro de cada `Oficina` (RITM-33 já tornou a distribuição read-only), adicionar bloco **"Rolos recebidos"**:

```
┌─ Oficina A · Cortes XYZ Ltda ──────────────────────────┐
│ Distribuição (da Compra): Azul=18, Branco=15           │
│ Modo separação: [...]                                  │
│                                                         │
│ ─── Rolos recebidos pelo cortador ────────────────────  │
│                                                         │
│ Azul (18 rolos esperados · 12 informados)              │
│   Rolo  │ Peso (kg)        │ Folhas rendidas           │
│   R1    │ [    13,2 ]      │ [    42 ]                 │
│   R2    │ [    13,4 ]      │ [    43 ]                 │
│   R3    │ [    12,8 ]      │ [    41 ]                 │
│   ...                                                   │
│   R12   │ [          ]     │ [        ]                │
│   [...mostrar todos os 18, vazios pra preencher]       │
│                                                         │
│ Branco (15 rolos esperados · 0 informados)             │
│   ...                                                   │
│                                                         │
│ ─── Pós-corte (folhas enfesto, rendimento, etc.) ────   │
│ [campos existentes]                                     │
└─────────────────────────────────────────────────────────┘
```

Detalhes:
- Pra cada cor com `rolosEnviadosPorCor[cor] > 0`, renderizar **exatamente** `rolosEnviadosPorCor[cor]` linhas de input. O array `rolosRecebidos` é mantido sized = soma dos enviados (auto-padding ao mudar a Compra).
- 2 colunas de input por linha: peso, folhas.
- Nav teclado **RITM-31**: Enter no peso avança pra folhas; Enter em folhas avança pro peso do próximo rolo; ↑/↓ navegam vertical em colunas independentes.
- Auto-select on focus.
- Paste do Excel (RITM-30): suportar paste em 1 coluna (peso) ou matriz 2 colunas (peso, folhas separados por Tab).
- Header da cor mostra `{n_preenchidos}/{n_esperados} informados`.
- Botão "Limpar rolos desta cor" remove o que foi preenchido (não remove slots — recria com zeros).

---

## UI: tela de matching

Caminho: `/confeccao/ops/[numero]/matching-rolos` (página nova, read-only, qualquer usuário com acesso à OP).

Layout: tabela hierárquica:

```
┌─ Matching de Rolos · OP 0042 ─────────────────────────────┐
│ Tolerância: 5,0 %         [editar — leva pra Compra]      │
│                                                            │
│ ▾ Oficina A · Cortes XYZ Ltda                              │
│                                                            │
│   ▾ Azul (18 rolos)                                        │
│     #  │ Forne (kg) │ Cort (kg) │ Diff kg │ Diff %  │ ⚠   │
│     1  │   12,80    │   12,75   │ -0,05   │ -0,4%   │     │
│     2  │   13,00    │   12,90   │ -0,10   │ -0,8%   │     │
│     3  │   13,10    │   12,40   │ -0,70   │ -5,3%   │ ⚠   │
│     ...                                                    │
│     ─────────────────────────────────────────────────────  │
│     Totais: 234,5 kg forne · 232,1 kg cort · -2,4 / -1,0%  │
│                                                            │
│   ▾ Branco (15 rolos)                                      │
│     [...]                                                  │
│                                                            │
│ ▾ Oficina B · ...                                          │
│   [...]                                                    │
└────────────────────────────────────────────────────────────┘
```

Comportamento:
- Renderiza pares calculados via `calcularMatchingRolos(compra, corte)`.
- Linhas com `forneOrfao = true` (cortador disse que tem mais rolos que o fornecedor enviou) ou `cortOrfao = true` (faltando informar peso de rolo) destacadas em **amarelo** com mensagem específica.
- Linhas com `alerta = true` (|diff%| > tolerância): borda esquerda **vermelha**.
- Acordeon por oficina e cor, expandido por default.
- "Editar tolerância" leva pra Compra com modal aberto na seção de tolerância (campo simples no header da Compra).

### Link pra tela de matching

Adicionar no detalhe da OP (`/confeccao/ops/[numero]/page.tsx`) um link/botão "Matching de Rolos" quando há ao menos 1 rolo informado pelo cortador (alguma oficina com `rolosRecebidos.length > 0`).

---

## Auto-save e validação parcial

Mesma política das outras subtasks: payload aceita `rolosRecebidos` parcial enquanto subtask está `em_andamento`; conclusão exige `length === rolosEnviados`. Auto-save com debounce 800ms (já existente).

---

## Arquivos a tocar

| Arquivo | Mudança |
|---|---|
| `src/lib/confeccao/schemas/payloads/corte.ts` | + `RoloRecebidoSchema`, + `rolosRecebidos` em `OficinaCorteSchema`, refinements na conclusão (count == enviados, sem corId estranho) |
| `src/lib/confeccao/schemas/payloads/corte.test.ts` | + fixtures válidas/inválidas |
| `src/lib/confeccao/schemas/payloads/compra.ts` | + `toleranciaMatchingPct` opcional no payload |
| `src/lib/confeccao/matching-rolos.ts` | **NOVO** — `calcularMatchingRolos(compra, corte): MatchingCorOficina[]` |
| `src/lib/confeccao/matching-rolos.test.ts` | **NOVO** — fixtures: par perfeito; alerta de tolerância; cortador faltando rolos (forneOrfao); cortador devolvendo extras (cortOrfao); cor presente só em uma oficina |
| `src/components/confeccao/subtask-corte.tsx` | + bloco "Rolos recebidos pelo cortador" dentro de cada oficina (input por rolo, peso + folhas, nav teclado RITM-31, paste) |
| `src/app/(dashboard)/confeccao/ops/[numero]/matching-rolos/page.tsx` | **NOVO** — tela read-only de matching |
| `src/app/(dashboard)/confeccao/ops/[numero]/page.tsx` | + link "Matching de Rolos" quando aplicável |

Sem migration de dados (campos novos são opcionais).

---

## Critérios de aceitação

1. **`tsc --noEmit`** sem erros novos.
2. **Schema aceita rolosRecebidos parcial**: 5 entries com `corId="azul"` enquanto `rolosEnviadosPorCor.azul=10` — payload válido em `em_andamento`.
3. **Schema rejeita corId fora de rolosEnviadosPorCor da oficina**: rolo recebido com `corId="vermelho"` mas oficina só tem azul/branco → erro.
4. **Conclusão exige count match**: `rolosEnviadosPorCor.azul=10` e cortador informou 8 rolos azuis → erro Zod `"Oficina X · Azul: faltam 2 rolos no informe do cortador"`.
5. **Matching simples (5 pares)**: fornecedor pesos `[13.0, 13.1, 13.2, 13.3, 13.4]` cortador `[12.9, 13.0, 13.1, 13.2, 13.3]` → 5 pares com diff = -0.1 kg cada, ≈ -0.77%, todos sem alerta (tol=5%).
6. **Matching com alerta**: 1 rolo com diff 8% → entra em `alerta=true`.
7. **Matching com órfão fornecedor**: forne 5 rolos, cort 3 rolos → pares 1-3 com diff; pares 4-5 com `cortOrfao=true, pesoCort=null`.
8. **Matching com órfão cortador**: forne 3 rolos, cort 5 rolos → pares 1-3 com diff; pares 4-5 com `forneOrfao=true, pesoForne=null`.
9. **Distribuição entre oficinas**: cor azul tem 10 rolos no fornecedor `[13.0..14.0]`, oficinas A=6, B=4 → A recebe os 6 mais leves (13.0-13.5), B recebe os 4 mais pesados (13.6-14.0). Matching de A só considera o subset de A.
10. **Tela renderiza com dados parciais**: cortador informou só algumas oficinas/cores → render mostra o que tem; cores não informadas vazias com mensagem "Aguardando informe".
11. **Tela responde a mudança de tolerância**: editar `toleranciaMatchingPct=2` na Compra → recarregar matching → linhas que antes eram ok com 3% viram alerta.
12. **UI subtask-corte: input por rolo aparece**: oficina A com `rolosEnviadosPorCor.azul=18` → renderiza 18 linhas de input em "Azul"; preencher 3 → contador `3/18 informados`.
13. **Nav teclado nos rolos recebidos**: Enter em peso de R1 → foco em folhas de R1; Enter em folhas de R1 → foco em peso de R2; ↓ em peso navega vertical na coluna peso.
14. **Paste do Excel em peso (1 coluna)**: cola 10 valores em R1 da Azul → preenche R1..R10 da Azul (mesma oficina, mesma cor).
15. **Subtask-corte auto-save**: digitar peso de 3 rolos → PATCH em 800ms → refresh preserva.

---

## Notas de implementação

- **Não persistir** o resultado do matching — recalcular sempre. Sem complexidade de invalidação.
- **Ordem das oficinas** afeta a distribuição de pesos do fornecedor (primeiras oficinas pegam pesos menores). Documentar isso na tela.
- **Edge case "fornecedor enviou em ordem aleatória"**: a heurística de ordenar ambos asc é uma aproximação por rank — não tem como saber qual rolo físico foi enviado pra qual oficina. A planilha original também aceita essa imprecisão.
- **Performance**: até ~200 rolos por OP no pior caso (3 cores × 60 rolos × 3 oficinas) — ordenação O(n log n) por (cor, oficina) é trivial.
