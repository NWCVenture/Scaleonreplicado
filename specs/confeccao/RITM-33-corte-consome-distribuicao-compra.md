# RITM-33 — Corte consome `distribuicaoOficinas` da Compra como plano definitivo

> **Bloqueia:** RITM-34 (input por rolo no Corte).
> **Depende de:** RITM-32 (Compra grava `distribuicaoOficinas`).
> **Dependência externa:** nenhuma.

---

## Princípio inegociável: o plano é decidido uma vez, na Compra

Hoje o Corte (`src/components/confeccao/subtask-corte.tsx`) é onde o operador adiciona oficinas e digita `rolosEnviadosPorCor` por oficina (schema em `corte.ts:36-43`). Isso replica a mesma decisão que ele já tomou (mentalmente, ou no Excel) ao receber o romaneio do fornecedor — duplicação de trabalho e fonte de divergência.

Com o RITM-32, a Compra passa a ser a fonte da verdade do plano de distribuição. Este RITM **propaga essa decisão pro Corte**: a lista de oficinas e a quantidade de rolos por cor por oficina não são mais editáveis na subtask de Corte — vêm da Compra, são read-only, e o operador só preenche o que é genuinamente novo no Corte: o **resultado** (folhas de enfesto, rendimento, descartes, preço/peça).

---

## Objetivo

1. **Adapter na criação da subtask de Corte:** quando a Compra é concluída, criar/atualizar a subtask OPCOR com `oficinas[]` pré-populado a partir de `compraPayload.distribuicaoOficinas`.
2. **UI:** bloco de adicionar/remover oficinas e de digitar `rolosEnviadosPorCor` vira **read-only** no Corte. Visualmente, "vem da Compra · veja Compra pra alterar".
3. **`modoSeparacao`** continua editável por oficina no Corte (não é uma decisão de planejamento, é uma decisão operacional do cortador).
4. **Pós-corte continua editável**: `folhasEnfesto`, `rendimentoPorTamanhoCor`, `rolosDescartados`, `precoPorPeca`, `observacoes`.
5. **Validação `validarSaldoRolos`** vira invariante (já garantido pela Compra) — mantida como defesa em profundidade.

**Não inclui:**

- Sincronização bidirecional (alterar Corte muda Compra) — fluxo one-way Compra→Corte.
- Adicionar/remover oficinas no meio do Corte — se mudar plano, mexe na Compra (ou faz justificativa de edição retroativa via mecanismo já existente).
- Input por rolo no Corte (peso cortador + folhas) — escopo do RITM-34.

---

## Sincronização Compra → Corte

### Quando dispara

1. **Ao concluir a Compra (OPBUY)**: o handler `/api/confeccao/subtasks/[id]/concluir` da Compra, após validar e marcar concluída, dispara a criação/atualização da subtask OPCOR. Hoje o estado de criação das subtasks subsequentes vive em `src/app/api/confeccao/ops/route.ts` (POST OP) — investigar onde a subtask OPCOR é destravada/criada e estender ali.
2. **Edição retroativa da Compra concluída** (admin only — mecanismo já existente): se `distribuicaoOficinas` mudou, atualizar oficinas no Corte preservando dados pós-corte por `oficinaId`. Ver "Reconciliação" abaixo.

### Algoritmo

```ts
function sincronizarCorteComCompra(
  compraPayload: SubtaskCompraPayload,
  cortePayloadAtual: SubtaskCortePayload | null,
): SubtaskCortePayload {
  const distribuicao = compraPayload.distribuicaoOficinas ?? [];
  const oficinasAtuais = new Map(
    (cortePayloadAtual?.oficinas ?? []).map((o) => [o.oficinaId, o]),
  );

  const novasOficinas = distribuicao.map<OficinaCorte>((d) => {
    const existente = oficinasAtuais.get(d.oficinaId);
    return {
      oficinaId: d.oficinaId,
      modoSeparacao: existente?.modoSeparacao ?? "por_cor",
      rolosEnviadosPorCor: { ...d.rolosPorCor }, // <-- vem da Compra
      // Pós-corte: preserva o que existia (operador pode ter preenchido)
      folhasEnfesto: existente?.folhasEnfesto,
      rendimentoTotal: existente?.rendimentoTotal,
      rendimentoPorTamanhoCor: existente?.rendimentoPorTamanhoCor,
      rolosDescartados: existente?.rolosDescartados,
      precoPorPeca: existente?.precoPorPeca,
      observacoes: existente?.observacoes,
    };
  });

  return { oficinas: novasOficinas };
}
```

### Reconciliação em edição retroativa da Compra

Casos:
- **Oficina adicionada na Compra**: aparece no Corte como oficina nova (campos pós-corte vazios).
- **Oficina removida da Compra**: precisa de **confirmação explícita** se ela tinha pós-corte preenchido (perda de dado). Sugestão: bloquear edição retroativa da Compra se o Corte já está concluído ou se há oficina com `folhasEnfesto != null` que sumiria. Mensagem clara apontando qual oficina.
- **`rolosPorCor[cor]` mudado**: aceitar — o pós-corte (folhas etc.) continua o que era. Validação de consistência fica pro Conferência/Matching identificar.

---

## UI: subtask-corte.tsx

### Antes

```
┌─ Corte ────────────────────────────────────────┐
│ [+ Adicionar oficina]                          │
│                                                │
│ ┌─ Oficina A ──────────────────────────────┐  │
│ │ [▾ Selecione oficina]   [Remover]         │  │
│ │ Modo: (•) Por cor  ( ) Sem separação      │  │
│ │ Rolos enviados:                            │  │
│ │   Azul:   [  18 ]                          │  │
│ │   Branco: [  15 ]                          │  │
│ │ ─── pós-corte ──────────────────────────  │  │
│ │ Folhas enfesto: [  ___  ]                  │  │
│ │ Rendimento por tam×cor: [+]                │  │
│ │ ...                                        │  │
│ └────────────────────────────────────────────┘  │
└────────────────────────────────────────────────┘
```

### Depois

```
┌─ Corte ────────────────────────────────────────────────┐
│ ⓘ Plano vem da Compra. Para alterar oficinas ou       │
│   distribuição de rolos: edite a Compra (OPBUY0042).  │
│                                                        │
│ ┌─ Oficina A · Cortes XYZ Ltda ──────────────────────┐ │
│ │ Distribuição (da Compra)         [Ver na Compra →] │ │
│ │   Azul:   18 rolos                                  │ │
│ │   Branco: 15 rolos                                  │ │
│ │                                                     │ │
│ │ Modo separação: (•) Por cor  ( ) Sem separação    │ │
│ │ ─── pós-corte ────────────────────────────────────  │ │
│ │ Folhas enfesto: [  ___  ]                           │ │
│ │ Rendimento por tam×cor: [+]                         │ │
│ │ Rolos descartados: [+]                              │ │
│ │ Preço/peça: [  ___  ]                               │ │
│ │ Observações: [_______________________________]      │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                          │
│ ┌─ Oficina B · ... ───────────────────────────────────┐ │
│ │ ...                                                  │ │
│ └─────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

Mudanças concretas:
- Remover botão `[+ Adicionar oficina]` e `[Remover oficina]` (oficinas vêm da Compra).
- Remover dropdown de seleção de oficina (nome vem `via` JOIN com `confeccao_fornecedor` pelo `oficinaId`).
- Remover inputs editáveis de `rolosEnviadosPorCor` — exibir como texto.
- Manter editáveis: `modoSeparacao`, `folhasEnfesto`, `rendimentoPorTamanhoCor`, `rolosDescartados`, `precoPorPeca`, `observacoes`.
- Adicionar header informativo com link "Ver na Compra →" que navega pra subtask OPBUY da mesma OP.
- Caso `distribuicaoOficinas` esteja vazio (OP antiga não-migrada ou migration pendente): fallback pra UI antiga editável com banner "⚠ Plano de distribuição não disponível na Compra — editando manualmente".

---

## Schema do Corte

Sem mudança estrutural — `OficinaCorteSchema` continua igual. `rolosEnviadosPorCor` ainda existe (é o snapshot replicado). Apenas a **conclusão** ganha um refinement extra:

```ts
// ConcluirSubtaskCorteSchema (em corte.ts):
.superRefine((data, ctx) => {
  // [refinements existentes mantidos]
  
  // Saldo continua bloqueante — invariante: a soma de rolos enviados
  // por cor não pode exceder os rolos comprados (já garantido pela
  // Compra, mas validamos de novo em caso de payload manipulado).
});
```

`validarSaldoRolos(oficinas, rolosCompradosPorCor)` continua sendo chamada no fluxo de conclusão como defesa em profundidade.

---

## Endpoint: criar/atualizar subtask Corte

Hoje a subtask OPCOR é criada com `oficinas: []` (ou nem existe até o operador adicionar a primeira). Investigar:

```
grep -rn "OPCOR\|prefixo.*corte\|SubtaskCortePayload" src/app/api/confeccao/
```

Provavelmente:
- Criação da OP em `src/app/api/confeccao/ops/route.ts` cria a row da subtask Corte com `payload={}` e `status='bloqueada'`.
- Conclusão da Compra em `src/app/api/confeccao/subtasks/[id]/concluir/route.ts` destrava as subtasks subsequentes (Corte vira `em_andamento`).

**Adicionar na conclusão da Compra**: após destravar Corte, ler `compraPayload.distribuicaoOficinas` e UPDATE da row da subtask OPCOR setando `payload = sincronizarCorteComCompra(compraPayload, atual)`.

**Adicionar na edição retroativa da Compra** (admin only — mecanismo já existente em `/api/confeccao/subtasks/[id]/payload` PATCH): se houve mudança em `distribuicaoOficinas`, rodar o mesmo sincronizador. Se houver perda de dado (oficina removida com pós-corte preenchido), rejeitar com 422 e mensagem clara.

---

## Arquivos a tocar

| Arquivo | Mudança |
|---|---|
| `src/lib/confeccao/sincronizar-corte.ts` | **NOVO** — função `sincronizarCorteComCompra(compraPayload, cortePayloadAtual): SubtaskCortePayload` |
| `src/lib/confeccao/sincronizar-corte.test.ts` | **NOVO** — fixtures: criação, oficina adicionada, oficina removida sem pós-corte (ok), oficina removida com pós-corte (erro), `rolosPorCor` mudado preserva pós-corte |
| `src/app/api/confeccao/subtasks/[id]/concluir/route.ts` | quando subtask concluída é OPBUY: chamar sincronizador e atualizar row OPCOR |
| `src/app/api/confeccao/subtasks/[id]/payload/route.ts` | na edição retroativa da Compra, se mudou `distribuicaoOficinas`: chamar sincronizador; rejeitar se perda de dado |
| `src/components/confeccao/subtask-corte.tsx` | remover botões/inputs de oficina e `rolosEnviadosPorCor`; exibir read-only; banner "vem da Compra"; link pra Compra |
| `src/lib/confeccao/schemas/payloads/corte.ts` | nenhuma mudança estrutural — só comentário explicando que `rolosEnviadosPorCor` é snapshot |

Sem migration de dados (a sincronização inicial roda no fluxo natural).

---

## Critérios de aceitação

1. **`tsc --noEmit`** sem erros novos.
2. **Sincronizador cria oficinas a partir da Compra**: payload Corte vazio + Compra com 2 oficinas → resultado tem 2 oficinas com `rolosEnviadosPorCor` espelhando `rolosPorCor` da Compra; `modoSeparacao` default `"por_cor"`; campos pós-corte `undefined`.
3. **Sincronizador preserva pós-corte por oficinaId**: Corte com oficina A já tem `folhasEnfesto=12` + Compra atualiza `rolosPorCor` da A → resultado mantém `folhasEnfesto=12` e atualiza `rolosEnviadosPorCor`.
4. **Sincronizador detecta oficina removida com pós-corte**: Corte com oficina B `folhasEnfesto=10` + Compra remove B → função sinaliza `{tipo: "perda_dado", oficinaId: "B"}` (ou throw). Endpoint deve traduzir em 422.
5. **Concluir Compra dispara sincronização**: cenário e2e via banco local — concluir OPBUY → subtask OPCOR daquela OP tem `oficinas` populado.
6. **UI Corte: bloco oficinas read-only**: render do subtask-corte exibe nome da oficina (JOIN fornecedor), `rolosEnviadosPorCor` como texto (não input), e botão "Ver na Compra →" funcionando.
7. **UI Corte: pós-corte editável**: `folhasEnfesto`, `rendimentoPorTamanhoCor`, etc. continuam editáveis e auto-save.
8. **UI Corte: fallback antigo** quando `distribuicaoOficinas` da Compra está vazia: banner amarelo "⚠ Plano não disponível" + UI legada editável.
9. **`validarSaldoRolos` mantida**: payload Corte direto via API com `rolosEnviadosPorCor` excedendo Compra → rejeitado.
10. **Edição retroativa da Compra sem perda**: admin edita Compra adicionando 5 rolos de uma cor existente em uma oficina → Corte atualiza, pós-corte intacto. Resposta 200.
11. **Edição retroativa com perda**: admin tenta remover oficina B que tem `folhasEnfesto=10` → 422 com mensagem `"Oficina Cortes XYZ tem dados de corte preenchidos — limpe-os ou justifique perda"`.

---

## Out-of-scope (próximos RITMs)

- **RITM-34:** Input por rolo no Corte (peso cortador + folhas) + view de matching fornecedor↔cortador.
