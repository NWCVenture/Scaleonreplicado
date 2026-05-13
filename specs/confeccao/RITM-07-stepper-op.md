# RITM-07 — Tela da OP com header fixo + stepper vertical de subtasks

> **Bloqueia:** RITM-08, RITM-09, RITM-10, RITM-11, RITM-12, RITM-13 (todas as UIs de subtasks dependem do container)
> **Depende de:** RITM-06 (OP existe com 6 subtasks geradas)
> **Dependência externa:** nenhuma

---

## Objetivo

Implementar a tela `/confeccao/ops/[numero]` — o **container visual** que agrega header da OP + stepper vertical com cards expansíveis de cada subtask. Cada subtask tem URL própria (`/confeccao/ops/[numero]/subtasks/[prefixo]`) pra permitir abertura em nova aba e múltiplas subtasks abertas em paralelo.

> ⚠️ **Esta RITM não implementa o conteúdo das subtasks** — só o container, navegação, estados visuais, edição de atribuído e botões do header. O conteúdo de cada subtask vem nas RITMs 08–13.

---

## Arquivos a criar/modificar

### API

- `src/app/api/confeccao/ops/[numero]/route.ts` — GET (detalhe completo), PATCH (editar atribuição, observações)
- `src/app/api/confeccao/ops/[numero]/notas/route.ts` — GET e POST (notas manuais)
- `src/app/api/confeccao/subtasks/[id]/route.ts` — GET (detalhe), PATCH (atribuído, status) — placeholder, payload nas RITMs específicas

### UI

- `src/app/(dashboard)/confeccao/ops/[numero]/page.tsx` — container principal
- `src/app/(dashboard)/confeccao/ops/[numero]/subtasks/[prefixo]/page.tsx` — wrapper pra abrir uma subtask em URL própria (renderiza só o card daquela subtask em layout full)
- `src/components/confeccao/op-header.tsx`
- `src/components/confeccao/subtask-card.tsx` — card expansível, estados visuais, slot pra conteúdo (preenchido por componente específico do tipo de subtask)
- `src/components/confeccao/subtask-status-badge.tsx`
- `src/components/confeccao/notas-op.tsx` — lista + form de notas da OP

---

## Endpoint `GET /api/confeccao/ops/[numero]`

Retorna OP completa com subtasks e relacionamentos.

### Response

```json
{
  "op": {
    "id": "...",
    "numero": "OP05260001",
    "status": "em_andamento",
    "temVies": true,
    "observacoes": "...",
    "produto": { "id": "...", "nome": "..." },
    "criadaPor": { "id": "...", "name": "..." },
    "atribuidoA": { "id": "...", "name": "..." },
    "criadaEm": "2026-05-12T...",
    "atualizadaEm": "..."
  },
  "subtasks": [
    {
      "id": "...",
      "numero": "OPBUY0001",
      "idInterno": "OPBUY-0526-0001",
      "prefixo": "OPBUY",
      "ordemSequencial": 1,
      "status": "em_andamento",
      "atribuidoA": { "id": "...", "name": "..." },
      "iniciadaEm": "...",
      "concluidaEm": null,
      "valorServico": null,
      "payload": {}  // schema específico por prefixo, validado no app
    },
    // ... outras subtasks
  ],
  "progresso": {
    "subtasksConcluidas": 1,
    "subtasksTotal": 6,
    "percentual": 16.67
  }
}
```

### Comportamento

- Autenticação: sessão ativa
- Autorização: qualquer membro da conta vê
- RLS isola por `conta_id`
- 404 se número não encontrado na conta

---

## Endpoint `PATCH /api/confeccao/ops/[numero]`

Edita campos editáveis da OP: `atribuidoAId`, `observacoes`. **NÃO** permite alterar `temVies` (regra crítica) nem `produtoId` (clone seria via "Reordens" no V2).

### Comportamento

- Autorização: admin para `atribuidoAId`; admin ou atribuído atual para `observacoes`
- Mudança de `atribuidoAId` → cria nota automática de auditoria + email pro novo e antigo atribuído (RITM-17)
- Validação Zod

---

## Endpoint `GET/POST /api/confeccao/ops/[numero]/notas`

### GET

Lista notas da OP (não inclui notas das subtasks — essas são listadas no endpoint específico da subtask).

Query params:
- `?incluirSubtasks=true` — inclui notas de todas as subtasks da OP (pra visão consolidada de "Histórico")
- `?apenasAuditoria=true` — só auditoria

### POST

Cria nota manual.

```json
{ "conteudo": "string" }
```

- Autorização: qualquer membro da conta
- `autorId` = sessão atual
- `isAuditoria` = false
- `isInterna` = true (sempre por enquanto; toggle público é V2)

---

## UI — Página `/confeccao/ops/[numero]`

### Layout

```
┌─────────────────────────────────────────────────┐
│ <OPHeader>                                       │  (fixo no topo)
│  OP05260001 • Camiseta Polo • SKU XYZ           │
│  ▓▓▓▓▓░░░░░░ 16% (1/6 concluídas)               │
│  Criada por João • Atribuída a Maria             │
│  [Editar atribuição] [Imprimir] [Histórico]     │
│  [Evidências de Pagamento] [Cancelar OP]        │
├─────────────────────────────────────────────────┤
│ ◉ Subtask 1 — Compra de Tecido (OPBUY0001)      │
│   ✓ Concluída • atribuída a João • 10/05/2026   │
│   ▼ Expandir                                     │
│   ──────────────────────────────────────         │
│ ◐ Subtask 2 — Risco (OPRIS0001)                  │
│   Em andamento • atribuída a Pedro              │
│   ▼ Expandir   [↗ Abrir em nova aba]            │
│   ──────────────────────────────────────         │
│ ○ Subtask 3 — Corte (OPCOR0001)                  │
│   Pendente                                       │
│   ─────────────                                  │
│ ⊘ Subtask 4 — Viés (OPVIE0001)                   │
│   Bloqueada                                      │
│   ─────────────                                  │
│ ⊘ Subtask 5 — Costura (OPSEW0001)                │
│   Bloqueada                                      │
│   ─────────────                                  │
│ ⊘ Subtask 6 — Conferência (OPCONF0001)           │
│   Bloqueada                                      │
└─────────────────────────────────────────────────┘
```

### Comportamento

- Cards expansíveis inline (accordion). Click no card abre o conteúdo daquela subtask **inline na página**.
- Botão `↗ Abrir em nova aba` em cada card → navega pra `/confeccao/ops/[numero]/subtasks/[prefixo]` numa aba separada (`target="_blank"`)
- Permite múltiplas subtasks expandidas simultaneamente
- Indicador visual de status conforme tabela do `GUIA-TECNICO.md` §UI/UX:

| Status | Cor (Tailwind class) | Ícone |
|---|---|---|
| Bloqueada | `text-slate-400` | ⊘ |
| Pendente | `text-amber-500` | ○ |
| Em andamento | `text-blue-500` | ◐ |
| Concluída | `text-emerald-500` | ✓ |
| Cancelada | `text-red-500` | ✗ |

- **Conteúdo da subtask** é renderizado por um componente específico (ex: `<SubtaskCompra>` da RITM-08, `<SubtaskRisco>` da RITM-09, ...). Pra essa RITM, usar **placeholder**:

```tsx
<div className="p-4 text-sm text-slate-500">
  Conteúdo da subtask {prefixo} será implementado em RITM-XX
</div>
```

Cada `<SubtaskCard>` recebe `prefixo`, e usa `switch` pra escolher o componente específico (ou placeholder se ainda não implementado). O switch fica em arquivo único `src/components/confeccao/subtask-conteudo-router.tsx` pra facilitar adição posterior.

---

## UI — Página `/confeccao/ops/[numero]/subtasks/[prefixo]`

Renderiza **apenas aquela subtask em layout full-screen**, com:

- Mini-header da OP no topo (link "← Voltar à OP" → `/confeccao/ops/[numero]`)
- Card da subtask expandido por padrão
- Mesmas ações disponíveis

Mesmo wrapper de roteamento que a tela principal, mas só renderiza um card.

---

## Componente `<OPHeader>`

`src/components/confeccao/op-header.tsx`:

### Props

```ts
interface OPHeaderProps {
  op: ConfeccaoOrdemProducao & { produto: ConfeccaoProduto; criadaPor: User; atribuidoA: User };
  progresso: { subtasksConcluidas: number; subtasksTotal: number };
  podeEditar: boolean;  // true se role=admin
  onEditarAtribuicao: () => void;
}
```

### Comportamento

- Sticky no topo
- Barra de progresso visual (Tailwind `progress` ou implementação custom)
- Botões:
  - **Editar atribuição** → modal com `<LookupUsuarioConta>` (admin only)
  - **Imprimir** → versão print da OP (TODO/stub — implementação completa em outra RITM se necessário)
  - **Histórico** → modal/drawer com notas + auditoria
  - **Evidências de Pagamento** → navega pra `/confeccao/ops/[numero]/evidencias` (RITM-19)
  - **Cancelar OP** → modal com fluxo de cancelamento (RITM-18; nessa RITM, deixar botão desabilitado com tooltip "Em breve")

---

## Componente `<SubtaskCard>`

`src/components/confeccao/subtask-card.tsx`:

### Props

```ts
interface SubtaskCardProps {
  subtask: ConfeccaoSubtask & { atribuidoA?: User };
  opNumero: string;
  expandido?: boolean;
  onToggle: () => void;
  children?: ReactNode;  // conteúdo específico do tipo de subtask
}
```

### Estados visuais

- **Bloqueada:** card cinza, opacity reduzida, sem ação de expandir (apenas tooltip "Aguardando conclusão da subtask anterior")
- **Pendente:** card normal, expansão liberada
- **Em andamento:** card destacado (borda azul), expansão liberada
- **Concluída:** card com check verde, expansão liberada (read-only por padrão; admin tem botão "Editar informações" — fluxo da RITM-15)
- **Cancelada:** card vermelho, read-only

---

## Componente `<NotasOP>`

`src/components/confeccao/notas-op.tsx`:

- Lista cronológica reversa de notas
- Distingue visualmente notas manuais (avatar do autor) vs auditoria (ícone de sistema, italic)
- Formulário simples no fim pra adicionar nota manual
- Reload via React Query mutation invalidation

---

## Testes obrigatórios

`src/app/api/confeccao/ops/__tests__/detalhe.test.ts`:

1. ✅ GET retorna OP + 6 subtasks ordenadas por `ordem_sequencial`
2. ✅ GET de OP de outra conta → 404 (RLS)
3. ✅ PATCH `atribuidoAId` por admin → 200 + nota de auditoria criada
4. ✅ PATCH `atribuidoAId` por funcionario → 403
5. ✅ PATCH `temVies` (tentativa) → 400 (campo bloqueado)

`src/app/api/confeccao/ops/__tests__/notas.test.ts`:

6. ✅ GET notas retorna em ordem cronológica reversa
7. ✅ GET com `?incluirSubtasks=true` retorna notas de subtasks junto
8. ✅ POST nota manual → 201 + autor = sessão

### E2E manual

9. ✅ Navegar pra `/confeccao/ops/[numero]` mostra header + 6 cards
10. ✅ Subtasks bloqueadas têm visual distinto e não expandem
11. ✅ Clicar "Abrir em nova aba" abre URL própria
12. ✅ Editar atribuição como admin → toast de sucesso + nota nova aparece no histórico
13. ✅ Adicionar nota manual aparece imediatamente após submit

---

## Critérios de aceitação

- [ ] Endpoints GET/PATCH OP e GET/POST notas implementados
- [ ] Página `/confeccao/ops/[numero]` renderiza header fixo + stepper com 6 cards
- [ ] URLs próprias por subtask funcionam (`?[prefixo]` rota)
- [ ] Estados visuais corretos em cada status
- [ ] Modal de edição de atribuição funcional (admin)
- [ ] Modal/drawer de histórico mostra notas + auditoria
- [ ] Botão "Cancelar OP" presente mas desabilitado (com tooltip explicativo)
- [ ] Componente `<SubtaskCard>` aceita `children` slot pra conteúdo específico (preparação pras RITMs 08–13)
- [ ] `<NotasOP>` permite adicionar nota manual
- [ ] Todos os 13 testes passam
- [ ] Validação manual end-to-end
- [ ] Múltiplas subtasks podem ficar abertas simultaneamente em abas diferentes sem conflito

---

## Pontos críticos

- ⚠️ **URL própria por subtask é requisito do guia** — `/confeccao/ops/[numero]/subtasks/[prefixo]`. Sem isso, abrir em nova aba não funciona corretamente.
- ⚠️ **Não confiar no `subtask.status` calculado no client** pra liberar expansão — a regra "bloqueada não expande" é UI; o status real vem do banco. Admin pode forçar via reabertura (RITM futura).
- ⚠️ Conteúdo específico de cada subtask vem das RITMs seguintes — manter o `<SubtaskCard>` agnóstico, recebendo `children` ou usando um router de componentes (`<SubtaskConteudoRouter prefixo={...} />`).
- ❌ **NÃO** carregar dados de todas as subtasks expandidas em paralelo no carregamento da OP (pode ser pesado quando elas tiverem payload grande). Lazy-load ao expandir.
- ⚠️ Print view (botão "Imprimir") é placeholder nessa RITM. Implementação real fica como subitem da RITM-19 ou separada — registrar TODO.
- ⚠️ Botão "Cancelar OP" só fica funcional na RITM-18.

---

## Dúvidas a confirmar

- O projeto usa shadcn/ui? Se sim, usar `Accordion`, `Dialog`, `Drawer`, `Progress` padronizados.
- Helper de print/PDF já existe (Estante Virtual tem QR codes — provavelmente)?
- Padronização de toasts (Sonner? react-hot-toast?) — usar o mesmo do resto do app.
