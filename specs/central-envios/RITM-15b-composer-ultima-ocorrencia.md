# RITM-15b — Composer: "última ocorrência ganha" em campos mutáveis

> **Bloqueia:** RITM-16 (classificador depende de `orderStatus` atualizado pra detectar `CANCELADO`).
> **Depende de:** RITM-07 (composer existe).
> **Dependência externa:** nenhuma.

---

## Princípio inegociável: campos mutáveis se atualizam por re-upload

- O comportamento atual de `mergeComDedup` ("primeira ocorrência ganha") **é incompatível** com o re-upload do CSV no meio da bipagem. Se o operador subir uma planilha mais nova com pedido X agora `Cancelado`, o composer continua reportando o status antigo "A ser enviado" — classificador (RITM-16) nunca detecta o cancelamento.
- **Solução:** separar campos em **imutáveis** (derivações da criação do pedido) e **mutáveis** (estado operacional). Imutáveis ficam da primeira ocorrência; mutáveis se atualizam pela ocorrência mais nova.
- Determinismo: a "ordem" é a ordem temporal dos runs (`ingestao_run.createdAt` ASC). Reprocessar a sessão dá sempre o mesmo resultado.
- Chave de dedup permanece **`(canal, orderId)`**: nos canais suportados (TikTok Shop, Mercado Livre, Shopee), o `orderId`/`numeroVenda` é único globalmente — não há colisão entre seller accounts diferentes. Adicionar `canalVendaId` à chave seria defensivo demais e exigiria que o parser emitisse esse campo, que hoje não vem do CSV.

Consequências:

- ❌ Pedido X em "A ser enviado" no run 14h e "Cancelado" no run 15h: o snapshot da sessão passa a ter `orderStatus = "Cancelado"`. Classificador vê e bloqueia.
- ❌ `trackingId` saiu de `null` (Aguardando RTS) num CSV antigo e veio preenchido num CSV novo: atualiza. Permite bipar agora.
- ✅ `criadoEmIso`, `comprador`, `parsed`, `linhasExplodidas`, `prazo` ficam congelados na primeira ocorrência. Re-derivá-los seria caro e mudaria o cronograma após o operador já ter visto.

---

## Objetivo

Trocar `mergeComDedup` por `mergeUltimaOcorrencia` que, dado `(existentes, novos)`:

1. Ordena tudo em ordem cronológica de inserção (existentes primeiro, novos por `createdAt` ASC).
2. Itera. Quando o `(canal, orderId)` se repete, faz **merge in-place**:
   - Mantém os campos imutáveis do registro original.
   - Substitui os campos mutáveis pelo do registro mais novo.
   - Atualiza `origemRunId` pro run mais novo (rastreabilidade da última atualização).
3. Devolve a lista única.

Ao fim do RITM:

- `composer.ts` usa `mergeUltimaOcorrencia` em vez de `mergeComDedup`.
- `composer.test.ts` cobre 3 cenários novos (status atualiza, tracking aparece, canais distintos não colidem).
- Comportamento equivalente quando NÃO há duplicação: mesma saída de antes (regressão zero).

**Não inclui:**

- Adicionar `canalVendaId` no `PedidoEnriquecido` (futuro, quando o parser emitir).
- Re-classificar bipagens já feitas após re-upload — isso é responsabilidade do RITM-16/17 (classificador roda no momento do bipe; ao re-upar e re-derivar `dados`, o RITM-17 dispara reclassificação dos bipes existentes em paralelo).

---

## Especificação

### Campos imutáveis (mantém da primeira ocorrência)

| Campo | Justificativa |
|---|---|
| `orderId`, `canal` | identidade |
| `criadoEmIso` | momento da criação no marketplace; não muda |
| `comprador` | TikTok pode mudar (raríssimo); manter primeira é seguro |
| `skuRaw`, `quantidadeRaw` | se o SKU mudar entre exports, é caso de suporte manual, não auto-update |
| `parsed`, `linhasExplodidas`, `explosaoErro` | derivações do SKU; mudar daria efeito cascata no cronograma |
| `prazo` | derivado de `criadoEmIso`; mudar seria mover o pedido pra outra coluna do cronograma de forma confusa |

### Campos mutáveis (sobrescritos pela ocorrência mais nova)

| Campo | Justificativa |
|---|---|
| `trackingId` | TikTok emite após RTS — primeira ocorrência pode ser `null`, segunda traz o ID |
| `camposExtras` | carrega `orderStatus`, `orderSubstatus` (TikTok) e `Estado` (ML) — todos podem mudar (cancelamento, mudança de transportadora, etc) |
| `origemRunId` | passa a apontar pro run que produziu a versão mais recente |

### Ordem de merge

```
ordenadosCronologicamente = [
  ...existentes,           // sessão antiga, já está em ordem
  ...novos.ordenado(r => r.createdAtDoRun)  // runs novos por ordem cronológica
]
```

Como `enriquecerPedido` não devolve `createdAt`, o composer precisa rastrear isso. **Solução simples**: anexar `createdAt` ao `PedidoEnriquecido` durante a montagem do batch novo, ou (mais limpo) iterar `runsRows` já ordenado por `createdAt ASC` antes do loop principal. Optei pela 2ª.

### Pseudo-código

```ts
function mergeUltimaOcorrencia(
  existentes: PedidoEnriquecido[],
  novos: PedidoEnriquecido[],   // já em ordem cronológica de run.createdAt
): PedidoEnriquecido[] {
  const porChave = new Map<string, PedidoEnriquecido>();

  // 1) Indexa existentes
  for (const p of existentes) porChave.set(`${p.canal}::${p.orderId}`, p);

  // 2) Para cada novo: merge ou insert
  for (const novo of novos) {
    const k = `${novo.canal}::${novo.orderId}`;
    const antigo = porChave.get(k);
    if (!antigo) {
      porChave.set(k, novo);
      continue;
    }
    // Merge: imutáveis do antigo, mutáveis do novo, origemRunId atualizado
    porChave.set(k, {
      ...antigo,
      trackingId: novo.trackingId,
      camposExtras: { ...antigo.camposExtras, ...novo.camposExtras },
      origemRunId: novo.origemRunId,
    });
  }

  return Array.from(porChave.values());
}
```

> `camposExtras` faz **shallow merge** porque o ML adiciona `Estado` que é o campo de prazo — se o ML mandar `Estado` atualizado, queremos. Já o TikTok manda `orderStatus`/`orderSubstatus` — idem. Não há chave que precise ser "preservada da primeira ocorrência" hoje.

### Ordenação dos runs novos

No `processarSessao`, depois de buscar `runsRows` por `inArray`, ordenar por `createdAt ASC` antes do loop principal. Isso garante determinismo (o Postgres não promete ordem em `inArray`).

```ts
runsRows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
```

---

## Arquivos a tocar

| Arquivo | Mudança |
|---|---|
| `src/lib/central-envios/sessao/composer.ts` | trocar `mergeComDedup` por `mergeUltimaOcorrencia`; ordenar `runsRows` por `createdAt` |
| `src/lib/central-envios/sessao/composer.test.ts` | adicionar 3 testes (status, tracking, dedup) |

Sem mudança de schema. Sem mudança nos types.

---

## Critérios de aceitação

1. **Regressão zero:** todos os testes atuais em `composer.test.ts` continuam passando sem alteração no fixture.
2. **Teste novo 1 — status atualiza:** dois runs para o mesmo `orderId`, primeiro com `orderStatus="A ser enviado"`, segundo com `orderStatus="Cancelado"`. Snapshot final tem `camposExtras.orderStatus === "Cancelado"` e `origemRunId` igual ao do segundo run.
3. **Teste novo 2 — tracking aparece:** dois runs para o mesmo `orderId`, primeiro com `trackingId=null`, segundo com `trackingId="999881..."`. Snapshot tem `trackingId === "999881..."`.
4. **Teste novo 3 — campos imutáveis:** mesmo cenário, mas o segundo run veio com `criadoEmIso` diferente (simulando bug no parser). Snapshot mantém `criadoEmIso`, `parsed`, `prazo` da primeira ocorrência.
5. **Determinismo:** dois runs com `createdAt` invertido na entrada produzem o mesmo snapshot — porque o composer ordena internamente.
6. **`tsc --noEmit`** sem erros novos.

---

## Out-of-scope (próximos RITMs)

- `canalVendaId` no `PedidoEnriquecido` — adicionar quando o parser TikTok emitir (não está claro hoje qual coluna do CSV identifica seller account).
- Notificar UI sobre transições mutáveis (ex.: "pedido X virou Cancelado retroativamente") → RITM-17 (POST de bipagem detecta) + RITM-21 (push pra outras sessões).
- Disparar reclassificação de bipagens existentes ao mudar `orderStatus` → RITM-17.
