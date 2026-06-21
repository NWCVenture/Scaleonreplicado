# RITM-31 — Pesos de rolos em linhas (Excel-like) com navegação por teclado

> **Bloqueia:** nenhum.
> **Depende de:** RITM-29 (schema multi-fornecedor + spill), RITM-30 (paste Excel).
> **Dependência externa:** nenhuma.

---

## Princípio inegociável: digitar peso de rolo deve ser igual ao Excel

Hoje os pesos de rolos vivem num grid `grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-6` (`src/components/confeccao/subtask-compra.tsx:1089`). Para preencher 30 pesos, o operador clica de quadradinho em quadradinho — Tab funciona, mas a ordem visual é uma matriz, não uma coluna. Visualmente fica desorganizado e o foco "pula linha" sem dica visual clara.

No Excel, o operador digita um peso, dá **Enter**, foco vai pro próximo rolo, repete. É a referência cognitiva — toda a planilha `OP TEMPLATE.xlsm` (seção 2.3 do `OP TEMPLATE.md`) preenche `C17:C…` (uma coluna de pesos) dessa forma.

Este RITM converte o grid em **lista vertical, 1 input por linha**, com nav por teclado igual ao Excel.

---

## Objetivo

Refatorar o bloco "Pesos dos rolos" dentro de cada `CardFornecedor`:

1. **Layout em lista vertical** (1 rolo por linha, label `R1`/`R2`/…/`R30` à esquerda, input à direita).
2. **Enter** no input do rolo *k* foca o rolo *k+1* (último rolo: foca o input do **próximo bloco de cor** dentro do mesmo fornecedor, se houver; senão `blur()`).
3. **Setas ↑ / ↓** navegam vertical (mesma cor). Em cima/embaixo da lista de uma cor: pula pro bloco da cor anterior/seguinte.
4. **Shift+Enter** = inverso de Enter (volta).
5. **Tab** mantém comportamento nativo (próximo elemento focável do form — *não* substitui Enter).
6. Paste do Excel (RITM-30) continua funcionando — handler é o mesmo, só a posição visual dos inputs muda.

**Não inclui:**

- Mover nav teclado pra outros inputs da Compra (kgsContratados, qtdRolos, precoPorKg). Esses ficam por conta do Tab nativo.
- Nav teclado em matrizes cor×tamanho de outras subtasks (Costura/Conferência) — fica pro RITM próprio.
- Reordenação de rolos por drag — nunca foi pedido.
- Tornar a label `R1`/`R2`/… editável (continua sequencial automática).

---

## UI

### Antes (`subtask-compra.tsx:1089-1123`)

```
┌─ Pesos dos rolos · Azul · 30 rolos ────────────────────┐
│ R1 [13,4] R2 [13,2] R3 [13,1] R4 [_] R5 [_] R6 [_]    │
│ R7 [_]   R8 [_]   R9 [_]  R10 [_] R11 [_] R12 [_]    │
│ R13 [_]  R14 [_]  R15 [_] R16 [_] R17 [_] R18 [_]    │
│ ...                                                    │
└────────────────────────────────────────────────────────┘
```

### Depois

```
┌─ Pesos dos rolos · Azul · 30 rolos ────────────────────┐
│  Dica: Enter avança · ↑/↓ navega · Ctrl+V cola coluna  │
│  ┌──────────────────────────────────┐                  │
│  │ R1   [   13,4 kg ]               │                  │
│  │ R2   [   13,2 kg ]               │                  │
│  │ R3   [   13,1 kg ]               │                  │
│  │ R4   [        kg ] ← foco        │                  │
│  │ R5   [        kg ]               │                  │
│  │ ...                              │                  │
│  │ R30  [        kg ]               │                  │
│  └──────────────────────────────────┘                  │
│  Soma parcial: 39,7 kg (3/30 rolos preenchidos)        │
└────────────────────────────────────────────────────────┘
```

Largura do input fixa (~120-140px), label `R{n}` com largura tabular, input alinhado à direita.

### Indicador visual de progresso

No header do bloco de cor, mostrar `{preenchidos}/{total}` e soma corrente. Hoje já existe `c.pesosRolos.length` rolos mas sem contagem de preenchidos vs vazios.

### Refatoração mínima do JSX

Trocar:

```tsx
<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-6 gap-2">
  {c.pesosRolos.map((p, idxR) => (
    <div key={idxR} className="flex items-center gap-1">
      <span ...>R{idxR + 1}</span>
      <Input ... />
    </div>
  ))}
</div>
```

Por:

```tsx
<div className="flex flex-col gap-1 max-w-xs" role="list">
  {c.pesosRolos.map((p, idxR) => (
    <div key={idxR} className="flex items-center gap-2" role="listitem">
      <span className="text-xs text-muted-foreground tabular-nums w-10 text-right">
        R{idxR + 1}
      </span>
      <Input
        ref={inputRefs[idxF]?.[idxC]?.[idxR]}
        type="number"
        step="0.01"
        inputMode="decimal"
        value={p}
        onChange={(e) => onAtualizarPesoRolo(idxC, idxR, e.target.value)}
        onPaste={(e) => { /* mesmo do RITM-30 */ }}
        onKeyDown={(e) => onPesoKeyDown(e, idxF, idxC, idxR)}
        disabled={!podeEditar}
        placeholder="kg"
        className="h-8 text-sm text-right tabular-nums w-28"
      />
    </div>
  ))}
</div>
```

---

## Comportamento do teclado

### Refs organizadas por (fornecedor, cor, rolo)

No componente top-level (`SubtaskCompra`), manter um `inputRefs.current: Map<string, HTMLInputElement | null>` indexado por `"${idxF}-${idxC}-${idxR}"`. Cada `Input` registra/desregistra no mount/unmount.

> Não usar array 3D porque indexes mudam quando cor é removida. Map por chave string é estável.

### Handler `onPesoKeyDown`

```ts
function onPesoKeyDown(
  e: React.KeyboardEvent<HTMLInputElement>,
  idxF: number,
  idxC: number,
  idxR: number,
) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    focarProximo(idxF, idxC, idxR, +1);
  } else if (e.key === "Enter" && e.shiftKey) {
    e.preventDefault();
    focarProximo(idxF, idxC, idxR, -1);
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    focarProximo(idxF, idxC, idxR, +1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    focarProximo(idxF, idxC, idxR, -1);
  }
  // Tab cai no handler nativo (não interceptamos)
}
```

### `focarProximo(idxF, idxC, idxR, direcao)`

Algoritmo (pseudo):

```
rolosDaCor = fornecedores[idxF].cores[idxC].pesosRolos.length
if (idxR + direcao está dentro de [0, rolosDaCor - 1]):
  → focar (idxF, idxC, idxR + direcao)
else:
  // saiu pra cima ou pra baixo
  proximoIdxC = idxC + direcao
  while (proximoIdxC existe na lista de cores deste fornecedor):
    if (fornecedores[idxF].cores[proximoIdxC].pesosRolos.length > 0):
      idxRolo = direcao === +1 ? 0 : pesosRolos.length - 1
      → focar (idxF, proximoIdxC, idxRolo)
      return
    proximoIdxC += direcao
  // não há mais cor com rolos: pula pro próximo fornecedor com cores
  // (se direcao === +1) ou anterior (se direcao === -1).
  // Se não houver: blur() — fim da entrada
```

### Auto-select on focus

Quando foco entra num input que tem valor não-vazio, **selecionar todo o conteúdo** (`e.target.select()` no `onFocus`). Comportamento Excel: digitar substitui valor sem precisar apagar. Já cobre o caso comum (releitura de balança que mudou).

---

## Soma parcial no header do bloco

Substituir o header atual `Pesos dos rolos · Azul · 30 rolos` por:

```
Pesos dos rolos · Azul · 5/30 rolos preenchidos · 64,1 kg
```

Onde:
- `5/30` = `pesosRolos.filter(p => p.trim() !== "").length` / `pesosRolos.length`
- `64,1 kg` = soma dos valores não-vazios (já calculado em `c.pesosRolos.reduce` que existe na linha 944).

Atualização live (mesmo estado React, sem hook novo).

---

## Arquivos a tocar

| Arquivo | Mudança |
|---|---|
| `src/components/confeccao/subtask-compra.tsx` | refatorar bloco "Pesos dos rolos" (linhas ~1069-1127) → lista vertical + refs + `onPesoKeyDown` + auto-select on focus + soma parcial no header |

Sem mudança em schema, API ou DB.

---

## Critérios de aceitação

1. **`tsc --noEmit`** sem erros novos.
2. **Layout vertical**: cada rolo em sua própria linha, label `R{n}` à esquerda, input à direita, soma parcial no header da cor.
3. **Enter avança**: digito `13,4` em R1, dou Enter, foco vai pra R2 (sem submit do form). Em R30 da Azul, Enter foca R1 da próxima cor com rolos (Branco, se houver).
4. **Shift+Enter volta**: em R5, Shift+Enter foca R4.
5. **Setas ↑/↓ navegam vertical**: ↓ em R3 = R4, ↑ em R1 = última cor anterior ou blur se não houver.
6. **Tab nativo preservado**: Tab em R1 vai pro próximo elemento focável do form (input qtdRolos da próxima cor ou botão), *não* pro R2.
7. **Auto-select no focus**: foco entra em R3 que tem `13,4` → texto fica selecionado; digitar `12,9` substitui sem precisar apagar.
8. **Paste do Excel preservado**: Ctrl+V em R5 com 10 valores no clipboard cola R5..R14 (idêntico ao RITM-30, sem regressão).
9. **Soma + contador no header live**: digito valores em 3 rolos → header mostra `3/30 rolos preenchidos · X,X kg`. Apaga R2 → contador volta a `2/30`.
10. **Remover cor não quebra foco**: se foco está em R3 da cor Azul e usuário remove a cor Azul, foco não chama ref morto (não joga exception no console).
11. **Mobile**: layout continua usável em viewport estreita (lista vertical é naturalmente mobile-friendly).

---

## Out-of-scope (próximos RITMs)

- **RITM-32:** Modal de planejamento de distribuição multi-oficina na Compra.
- **RITM-33:** Corte consome distribuição da Compra.
- **RITM-34:** Input por rolo no Corte (peso cortador + folhas) + matching fornecedor↔cortador.
