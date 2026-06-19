# RITM-30 — Paste do Excel nos pesos de rolos (Compra)

> **Bloqueia:** nenhum.
> **Depende de:** RITM-29 (UI multi-fornecedor + spill rolos).
> **Dependência externa:** nenhuma.

---

## Princípio inegociável: copiar coluna no Excel → colar no peso = funciona

Operador pesa 30 rolos numa balança digital, anota numa coluna do Excel (uma célula por rolo) e quer colar tudo de uma vez no sistema. Hoje, a única opção é digitar 30 valores um por um — fluxo idêntico ao do Excel original (`OP TEMPLATE.xlsm`), exceto que o Excel aceita paste e o sistema não.

Este RITM corrige isso: paste multi-valor em qualquer input de peso preenche os próximos N campos sequencialmente, expandindo `qtdRolosContratados` automaticamente se necessário.

---

## Objetivo

Adicionar `onPaste` handler aos inputs de peso de rolo na `subtask-compra.tsx`:

1. Operador foca um input de peso (qualquer índice — não precisa ser o primeiro).
2. Ctrl+V cola texto do clipboard.
3. Sistema parseia: separa por `\n` ou `\t` (formatos de coluna/linha do Excel), filtra vazios, converte cada valor pra número (aceita vírgula ou ponto).
4. Se N=1 valor parseado → comportamento default do input (paste de string única). Não intercepta.
5. Se N>1 valores parseados → `preventDefault`, chama `colarPesos(idxFornecedor, idxCor, idxRoloInicial, valores)`:
   - Preenche `pesosRolos[idxRoloInicial..idxRoloInicial+N-1]`
   - Se isso passa de `qtdRolosContratados`, **expande** `qtdRolosContratados` pra cobrir e adiciona slots vazios depois (se houver).
   - Toast informativo: "Colados 30 pesos a partir do rolo #1".

**Não inclui:**

- Paste em outros inputs (kgsContratados, qtdRolosContratados, precoPorKg) — 1 valor por linha, não tem ganho.
- Paste de matriz 2D (linhas × colunas) — fora de escopo; operador organiza no Excel antes de copiar coluna.
- Undo de paste — se errou, basta editar valores ou diminuir qtdRolos.
- Validação de formato (ex: rejeitar valores fora de range esperado) — confia no operador; valores absurdos viram alerta no diff vs contratado.

---

## Especificação

### Parser (`parsePesosColados`)

```ts
function parsePesosColados(texto: string): number[];
```

Comportamento:
- Split por `\r\n` ou `\n` ou `\t`.
- Cada token: trim, ignora vazios.
- Converte com `Number(tok.replace(",", "."))`.
- Filtra `NaN`, valores < 0 ou não-finitos.
- Devolve array. Se length === 0 ou length === 1, caller decide o que fazer.

### Handler no input

Em cada `<Input>` de peso:

```tsx
onPaste={(e) => {
  const texto = e.clipboardData.getData("text/plain");
  const valores = parsePesosColados(texto);
  if (valores.length <= 1) return; // default behavior
  e.preventDefault();
  colarPesos(idxFornecedor, idxCor, idxRolo, valores);
  toast.success(
    `Colados ${valores.length} pesos a partir do rolo #${idxRolo + 1}`
  );
}}
```

### Mutador (`colarPesos`)

```ts
function colarPesos(
  idxFornecedor: number,
  idxCor: number,
  idxRoloInicial: number,
  valores: number[],
): void
```

Comportamento:
- Atualiza `pesosRolos` da cor:
  - Para cada `valores[k]`: `pesosRolos[idxRoloInicial + k] = String(valores[k])`
  - Se `idxRoloInicial + k >= pesosRolos.length`: array é expandido (push)
- Atualiza `qtdRolosContratados` se `pesosRolos.length` aumentou:
  - `qtdRolosContratados = String(pesosRolos.length)` (string porque é o estado do input)

### Notas

- Não confirma com o operador antes de colar — é menos friction. Se errou, edita o valor errado ou usa o input qtdRolos pra reduzir.
- Auto-save (debounce 800ms) já persiste depois.

---

## Arquivos a tocar

| Arquivo | Mudança |
|---|---|
| `src/components/confeccao/subtask-compra.tsx` | + `parsePesosColados`, + `colarPesos` mutador, + `onPaste` em cada peso input |

---

## Critérios de aceitação

1. **`tsc --noEmit`** sem erros novos.
2. **Paste 5 valores em rolo #1 vazio (qtdRolos=10):** `pesosRolos[0..4]` preenchidos, `pesosRolos[5..9]` permanecem vazios, qtdRolos = 10 (inalterado).
3. **Paste 5 valores em rolo #3 (qtdRolos=5):** `pesosRolos[2..6]` preenchidos. `pesosRolos.length` cresce pra 7, `qtdRolosContratados` vira `"7"`.
4. **Paste 1 valor único:** comportamento default (input recebe a string crua, sem interceptação).
5. **Paste com vírgula brasileira:** `"12,5\n13,1"` → `[12.5, 13.1]` (válido).
6. **Paste com lixo misturado:** `"12.5\nabc\n13.1\n\n14"` → `[12.5, 13.1, 14]` (NaN filtrado, vazios filtrados).
7. **Paste de coluna copiada do Excel:** Excel copia com `\r\n` entre células — funciona.
8. **Toast informativo:** após paste multi-valor, toast mostra quantos pesos foram colados e a partir de qual rolo.

---

## Out-of-scope (próximos RITMs)

- **RITM-31:** Tally entry + keyboard nav matriz cor×tamanho (Costura/Conferência).
- **RITM-32:** Export XLSX da OP completa (espelhar o template Excel).
- Paste 2D (matriz) em outras subtasks (Costura: cor×tamanho × oficinas).
