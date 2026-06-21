# RITM-32 — Modal de planejamento de distribuição multi-oficina na Compra

> **Bloqueia:** RITM-33 (Corte lê distribuição), RITM-34 (matching usa oficinas).
> **Depende de:** RITM-29 (schema Compra v2).
> **Dependência externa:** nenhuma.

---

## Princípio inegociável: a Compra é onde se decide o destino físico dos rolos

Hoje a Compra tem `destinatarioCorteId: string` — **uma única oficina** pra toda a compra (`compra.ts:37`, `subtask-compra.tsx:140`). A distribuição multi-oficina existe **só no Corte** (`corte.ts:36-43`, `rolosEnviadosPorCor`), e o operador só decide o split depois que a Compra está concluída.

Na operação real, a decisão "rolo X vai pra oficina Y" acontece **junto com a compra**: assim que o romaneio do fornecedor chega, o operador já sabe quantos rolos de cada cor vão pra cada oficina (capacidade da oficina, lote planejado, prazo). É o equivalente direto do **"Plano de corte (S4:W8)"** do `OP TEMPLATE.xlsm` (seção 3.4 do `OP TEMPLATE.md`): uma matriz **cor × oficina** com qtd de rolos.

Este RITM move a distribuição **pra Compra**: substitui `destinatarioCorteId` por `distribuicaoOficinas[]` e oferece um **modal "Planejamento de distribuição"** com matriz cor × oficina + saldo bloqueante.

---

## Objetivo

1. **Schema:** novo array `distribuicaoOficinas: [{oficinaId, rolosPorCor: Record<corId, number>}]` no payload da Compra. Remove `destinatarioCorteId` (mas mantém em paralelo durante 1 ciclo pra migration — ver "Migration").
2. **UI:** botão "Planejar distribuição" no header da Compra abre **modal**. Dentro: 1 linha por cor contratada (agregada cross-fornecedor) × N colunas dinâmicas (uma por oficina). Cada célula é um input numérico de rolos.
3. **Saldo:** por cor, soma de rolos atribuídos a oficinas deve igualar a qtd contratada daquela cor. Diferença em destaque (vermelho se sobra/falta). Modal não fecha sem zerar saldo (a menos que usuário salve rascunho — "Salvar parcial").
4. **Multi-oficina:** botão "+ Oficina" adiciona coluna. Pode haver 1, 2, 3, N oficinas.
5. **Conclusão**: validar saldo zerado por cor + ao menos 1 oficina + cada oficina recebendo ao menos 1 rolo total.

**Não inclui:**

- Auto-balanceamento (split automático "divide igual entre oficinas") — operador decide.
- Reordenação de oficinas — ordem de adição é mantida.
- Distribuição por kg (em vez de rolos) — o usuário pediu rolos explicitamente.
- Distribuição parcial granular por rolo individual (rolo R1 → oficina X, R2 → oficina Y). Distribuição é por **contagem** de rolos por cor; matching de qual rolo físico vai pra qual oficina é feito on-the-fly por menor-diff (RITM-34).
- Alterar o cadastro de oficinas (continua via `/cadastros/fornecedores` com categoria `"corte"`).

---

## Schema novo

`src/lib/confeccao/schemas/payloads/compra.ts`:

```ts
export const DistribuicaoOficinaSchema = z.object({
  oficinaId: z.string().min(1),
  // Mapa corId → qtd rolos atribuídos a esta oficina
  rolosPorCor: z.record(z.string(), z.number().int().nonnegative()),
});
export type DistribuicaoOficina = z.infer<typeof DistribuicaoOficinaSchema>;

export const SubtaskCompraPayloadSchema = z.object({
  fornecedores: z.array(FornecedorCompraSchema).optional(),
  // NOVO — substitui destinatarioCorteId
  distribuicaoOficinas: z.array(DistribuicaoOficinaSchema).optional(),
  // DEPRECATED — mantido por compat enquanto migration roda
  destinatarioCorteId: z.string().min(1).optional(),
  tipoTecidoId: z.string().min(1).optional(),
  gramaturaGM2: z.number().positive().finite().optional(),
  larguraRoloCm: z.number().positive().finite().max(500).optional(),
  observacoes: z.string().max(2000).optional(),
});
```

### Helpers novos

```ts
/** Soma rolos atribuídos por cor (cross-oficinas). */
export function agruparRolosAtribuidosPorCor(
  payload: SubtaskCompraPayload | null | undefined,
): Map<string, number>;

/** Para cada cor, devolve {contratado, atribuido, saldo}. saldo < 0 = excesso. */
export function calcularSaldoDistribuicao(
  payload: SubtaskCompraPayload | null | undefined,
): Map<string, { contratado: number; atribuido: number; saldo: number }>;
```

### Conclusão (`ConcluirSubtaskCompraSchema`)

Acrescentar:
- `distribuicaoOficinas: z.array(DistribuicaoOficinaSchema).min(1)` (obrigatório, ≥ 1 oficina).
- Remover `destinatarioCorteId` da conclusão (não é mais obrigatório).
- `superRefine`:
  - Para cada cor contratada: `atribuido === contratado` (saldo zerado).
  - Sem `oficinaId` duplicada em `distribuicaoOficinas`.
  - Cada oficina deve ter ao menos 1 cor com `rolosPorCor[cor] > 0` (não permite oficina-fantasma).

---

## Migration v2 → v3

Script `src/lib/db/migrate-compra-payload-v3.ts`:

```
Para cada confeccao_subtask WHERE prefixo='OPBUY' E payload->'distribuicaoOficinas' IS NULL:
  destinatario = payload->>'destinatarioCorteId'
  fornecedores = payload->'fornecedores'
  
  Se destinatario IS NULL OU fornecedores IS NULL/empty:
    # nada a migrar (payload vazio ou sem destino) — pula
    continue
  
  # 1 oficina recebe TODOS os rolos contratados
  rolosPorCor = agruparRolosContratadosPorCor(payload)
  
  novoPayload = payload + {
    distribuicaoOficinas: [{
      oficinaId: destinatario,
      rolosPorCor: Object.fromEntries(rolosPorCor),
    }]
  }
  # mantém destinatarioCorteId no payload por enquanto (compat leitura)
  
  UPDATE subtask SET payload = novoPayload

Idempotente: detecta distribuicaoOficinas e pula.
```

**Atenção schema/RLS:** `payload` é JSONB; mudança é só nos dados, não na coluna. Sem `drizzle-kit` envolvido.

Rodar local primeiro (`tsx src/lib/db/migrate-compra-payload-v3.ts`), validar contra OPs existentes, depois prod.

---

## UI: header da Compra

Adicionar botão "Planejar distribuição" no header da subtask, ao lado de "Concluir":

```
┌─ Compra OPBUY0042 ─────────────────────────────────────────┐
│ Status: em_andamento                                       │
│ [Planejar distribuição  ⚠ 12 rolos sem destino] [Concluir] │
└────────────────────────────────────────────────────────────┘
```

Texto do badge:
- `✓ Distribuição completa` (verde) quando saldo zerado em todas as cores
- `⚠ 12 rolos sem destino` (amarelo) quando há saldo positivo
- `⚠ 5 rolos excedentes` (vermelho) quando há saldo negativo
- `Planejar distribuição` (neutro) quando ainda não há nenhuma oficina

Botão "Concluir" fica `disabled` enquanto saldo ≠ 0 em qualquer cor.

### Remove o lookup atual `destinatarioCorteId`

Remover o bloco `Label "Destinatário (oficina de corte)" + LookupComCadastroInline` (linhas ~618-641 de `subtask-compra.tsx`). A configuração de oficinas migra inteira pro modal.

---

## UI: Modal "Planejamento de distribuição"

Componente novo: `src/components/confeccao/modal-distribuicao-compra.tsx`.

```
┌─ Planejamento de distribuição ──────────────────── [X] ─┐
│                                                          │
│ Cor       │ Contratado │ Oficina A │ Oficina B │ Saldo  │
│ ──────────┼────────────┼───────────┼───────────┼─────── │
│ Azul      │ 30 rolos   │ [  18  ]  │ [  12  ]  │ ✓ 0    │
│ Branco    │ 25 rolos   │ [  15  ]  │ [  10  ]  │ ✓ 0    │
│ Preto     │ 10 rolos   │ [   8  ]  │ [   0  ]  │ ⚠ -2   │
│ ──────────┴────────────┴───────────┴───────────┴─────── │
│ Total: 65/65 rolos                          ⚠ 2 saldo   │
│                                                          │
│ [+ Oficina]                                              │
│                                                          │
│ ┌─ Oficina A ────────────────────────────────────────┐  │
│ │ [▾ Selecione fornecedor — categoria: corte]       │  │
│ │ [Remover oficina]                                  │  │
│ └────────────────────────────────────────────────────┘  │
│                                                          │
│ ┌─ Oficina B ────────────────────────────────────────┐  │
│ │ [▾ Cortes XYZ Ltda]                                │  │
│ │ [Remover oficina]                                  │  │
│ └────────────────────────────────────────────────────┘  │
│                                                          │
│                              [Cancelar] [Salvar]        │
└──────────────────────────────────────────────────────────┘
```

Detalhes:
- **Linhas de cor** são derivadas de `agruparRolosContratadosPorCor(payload)` — só aparecem cores que têm `qtdRolosContratados > 0`.
- **Colunas de oficina** são dinâmicas (1..N).
- **Cabeçalho de coluna** mostra nome da oficina (ou "Oficina A" se ainda não selecionada). Cabeçalho é clicável → abre dropdown de seleção da oficina (mesmo `LookupComCadastroInline` com `categoria=corte` que existe hoje).
- **Saldo por linha**: ✓ verde se 0, ⚠ vermelho/amarelo se ≠ 0.
- **Total**: soma de rolos atribuídos / soma de rolos contratados.
- **Salvar** persiste `distribuicaoOficinas` no payload (mesmo PATCH `/api/confeccao/subtasks/[id]/payload` que já existe). Não exige saldo zerado pra salvar rascunho — só pra concluir a subtask.
- **Cancelar** descarta mudanças locais (volta ao estado salvo).

### Edge cases

- Cores adicionadas/removidas na Compra depois do modal salvo: ao abrir modal, recalcular linhas e preservar valores existentes nas células de cor que sobreviveram. Cores novas entram com `0` em todas as oficinas.
- Oficinas removidas no cadastro (fornecedor desativado): exibir nome em cinza + flag "(desativada)"; permitir remover do plano.
- Mesma oficina selecionada 2× em colunas diferentes: validação inline ("Oficina duplicada — selecione outra").
- Nenhuma oficina adicionada ainda: tabela mostra só `Cor | Contratado | Saldo` (saldo = -contratado em vermelho). Estado vazio: "Adicione ao menos uma oficina pra distribuir".

### Navegação por teclado (estilo RITM-31)

- **Enter** na célula de uma cor avança pra próxima cor (mesma coluna).
- **Tab** funciona nativamente (próxima coluna, mesma cor).
- Auto-select on focus.

---

## Compatibilidade leitor (Corte, dashboard)

- O Corte é tratado no **RITM-33** — ele substitui `OficinaCorteSchema.rolosEnviadosPorCor` por leitura de `distribuicaoOficinas` da Compra.
- Dashboard / saldos: nenhuma derivação atual usa `destinatarioCorteId` em valor (só em status display). Grep antes de implementar pra confirmar:
  ```
  grep -r "destinatarioCorteId" src/
  ```
  Se houver consumidor além do `subtask-compra.tsx` e tela de detalhe da OP, atualizar pra ler o nome da **primeira** oficina de `distribuicaoOficinas[0].oficinaId` (display fallback até o RITM-33 expor multi-oficina no header).

---

## Arquivos a tocar

| Arquivo | Mudança |
|---|---|
| `src/lib/confeccao/schemas/payloads/compra.ts` | + `DistribuicaoOficinaSchema`, + `distribuicaoOficinas` opcional no payload, helpers `agruparRolosAtribuidosPorCor`/`calcularSaldoDistribuicao`, conclusão exige distribuição zerada e ≥ 1 oficina |
| `src/lib/confeccao/schemas/payloads/compra.test.ts` | + fixtures de payload com distribuição válida/inválida; testes do `calcularSaldoDistribuicao` |
| `src/components/confeccao/subtask-compra.tsx` | remover bloco `Destinatário (oficina de corte)`, adicionar botão "Planejar distribuição" + badge de saldo no header, passar payload pro modal |
| `src/components/confeccao/modal-distribuicao-compra.tsx` | **NOVO** — modal completo com matriz cor × oficina, saldo live, add/remove oficina |
| `src/lib/db/migrate-compra-payload-v3.ts` | **NOVO** — migration v2→v3 (destinatarioCorteId → distribuicaoOficinas[0]) |
| `src/app/api/confeccao/subtasks/[id]/concluir/route.ts` | nada além de pegar o schema atualizado (re-import) |
| `src/app/(dashboard)/confeccao/ops/[numero]/page.tsx` | se exibe `destinatarioCorteId`, trocar por leitura da primeira oficina (fallback display) |

---

## Critérios de aceitação

1. **`tsc --noEmit`** sem erros novos.
2. **Schema aceita payload novo**: parse com `distribuicaoOficinas: [{oficinaId, rolosPorCor: {azul:18, branco:12}}]` é válido.
3. **Schema rejeita oficina duplicada**: duas entries com mesmo `oficinaId` → erro.
4. **Conclusão exige saldo zerado**: cor contratada=30, atribuído=28 → erro Zod com mensagem clara `"Cor Azul: 2 rolos sem destino (contratado 30, distribuído 28)"`.
5. **Conclusão exige ≥ 1 oficina** e cada oficina com ao menos 1 rolo: oficina-fantasma rejeitada.
6. **Migration v3 idempotente**: OPBUY com `destinatarioCorteId="X"` + cores `[{azul,30}, {branco,25}]` vira `distribuicaoOficinas: [{oficinaId:"X", rolosPorCor:{azul:30, branco:25}}]`. Rodar 2× não duplica.
7. **Modal renderiza vazio sem crash**: payload sem `distribuicaoOficinas` → modal abre, mostra linhas de cor com saldo vermelho, "Adicione oficina".
8. **+ Oficina adiciona coluna**: clicar adiciona coluna sem oficina selecionada; selecionar oficina via lookup; remover volta tabela.
9. **Saldo recalcula live**: digitar `18` em Azul/OficinaA + `12` em Azul/OficinaB com contratado=30 → saldo ✓ 0. Mudar pra `19` → saldo ⚠ -1.
10. **Saldo total no rodapé** atualiza junto.
11. **Botão Concluir desabilitado** enquanto saldo ≠ 0; tooltip indica cor que ainda tem saldo.
12. **Auto-save do modal**: salvar persiste; reabrir modal preserva exatamente os valores.
13. **Nav teclado**: Enter na célula da Cor Azul / Oficina A foca a célula da Cor Branca / Oficina A; Tab vai pra Azul / Oficina B.
14. **Cor adicionada na Compra após modal salvo**: ao reabrir modal, nova cor aparece com `0` em todas as oficinas; valores antigos preservados.

---

## Out-of-scope (próximos RITMs)

- **RITM-33:** Corte (OPCOR) lê `distribuicaoOficinas` da Compra como plano definitivo (pré-popula oficinas + `rolosEnviadosPorCor`, ambos read-only).
- **RITM-34:** Input por rolo no Corte (peso cortador + folhas) + view de matching fornecedor↔cortador.
