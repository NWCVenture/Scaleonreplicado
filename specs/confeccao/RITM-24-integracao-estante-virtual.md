# RITM-24 — Integração com Estante Virtual

Implementa o ponto de integração entre Confecção e Estante Virtual descrito
na arquitetura §13: ao gerar QR codes no cadastro de fardos, o operador
pode escolher uma **OP de Confecção** como lote, gravando o número da OP
diretamente no QR. Permite rastrear qualquer fardo de estoque até a OP
que o originou.

> **Princípio (arquitetura §13.2):** fluxo é **unidirecional** — o cadastro
> de fardos consome OP, mas a OP não recebe feedback do estoque. Nenhuma
> mudança na tela da OP nesta RITM.

## Escopo

| Mudança | Onde |
|---------|------|
| Lookup de OPs como sugestão de lote | `src/app/(dashboard)/cadastro/page.tsx` |
| FK opcional `ordem_producao_id` em `lote_cadastrado` | Schema + migration |
| Endpoint pra buscar OPs disponíveis | `src/app/api/confeccao/ops/lookup/route.ts` |
| Endpoint pra listar fardos de uma OP | `src/app/api/confeccao/ops/[numero]/fardos/route.ts` |
| Bloco "Fardos no estoque" no header da OP | `src/app/(dashboard)/confeccao/ops/[numero]/page.tsx` |

> ⚠️ A subtask Conferência (RITM-13) **não dispara** automaticamente a
> criação de fardos. A criação continua sendo manual no módulo Estante
> Virtual / Cadastro — esta RITM só facilita a digitação do lote correto.

## Estrutura

### Schema (migration nova)

`lote_cadastrado` ganha FK opcional:

```ts
export const loteCadastrado = pgTable(
  "lote_cadastrado",
  {
    id: text("id").primaryKey(),
    contaId: text("conta_id").notNull().references(...),
    nome: text("nome").notNull(),                              // mantém UPPER, sem espaços extras
    ordemProducaoId: text("ordem_producao_id").references(   // ⬅ NOVO
      () => confeccaoOrdemProducao.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_lote_conta_nome").on(table.contaId, table.nome),
    index("idx_lote_op").on(table.ordemProducaoId),            // ⬅ NOVO
  ],
);
```

> Mantemos a UNIQUE atual de `(contaId, nome)` — o nome é o lote literal
> gravado no QR (ex.: `OP05260001`). A FK serve só pra link de UI / lookup
> bidirecional. Lotes legados sem FK continuam funcionando.

> `ON DELETE SET NULL`: se uma OP for fisicamente apagada do banco no
> futuro, o lote sobrevive (o QR já está fisicamente impresso no fardo).

RLS já existe em `lote_cadastrado` desde a migration 0007; nada a refazer.

### Endpoint de lookup de OPs

`GET /api/confeccao/ops/lookup?q=<termo>&status=<lista>` em
`src/app/api/confeccao/ops/lookup/route.ts`.

- Auth: sessão com conta ativa (mesmo padrão dos outros endpoints
  `/api/confeccao/*`)
- Query params:
  - `q` (opcional): filtra `numero ILIKE '%${q}%'` ou via prefix match
  - `status` (opcional, default `em_andamento,concluida`): CSV de status válidos.
    Default exclui `cancelada` — não faz sentido vincular fardo a OP cancelada.
- Retorna `{ ops: Array<{ id, numero, produtoCodigo, status, concluidaEm }> }`
  ordenado por `concluidaEm DESC NULLS LAST, createdAt DESC`
- Limit fixo de 20 resultados (autocomplete não precisa de mais)

> Endpoint genérico — pode ser reusado por outras telas no futuro
> (relatórios, picking, etc).

### Endpoint de fardos por OP

`GET /api/confeccao/ops/[numero]/fardos` em
`src/app/api/confeccao/ops/[numero]/fardos/route.ts`.

- Auth: sessão com conta ativa
- Resolve OP por `numero`, valida que pertence à conta ativa
- Busca em `estanteFardo` (ou tabela equivalente) `WHERE lote = ${numero}`
  OU `WHERE loteId IN (SELECT id FROM lote_cadastrado WHERE ordem_producao_id = op.id)`
  — cobre lotes vinculados pela FK E lotes vinculados só por nome (legados ou
  digitados manualmente sem passar pelo autocomplete)
- Retorna `{ fardos: Array<{ id, qrCode, sku, quantidade, estanteNome, criadoEm }> }`
- Limit alto (1000) — uma OP grande pode gerar muitos fardos

> ⚠️ Verificar nome exato da tabela de fardos (`estante_fardo`? `fardo`?)
> ao implementar. Pode haver schema split entre fardo e estante.

### UI: cadastro com lookup de OP

`src/app/(dashboard)/cadastro/page.tsx`:

- Substitui o `<select>` simples atual (linha ~713) por um **combobox**
  com 3 modos:
  1. **Estoque padrão** (default) — comportamento atual
  2. **Lote customizado** — comportamento atual (digita nome, salva em `lote_cadastrado` sem FK)
  3. **OP de Confecção** — NOVO — autocomplete chamando `/api/confeccao/ops/lookup`
- Quando escolhe modo "OP de Confecção":
  - Campo vira input com debounce 250ms chamando lookup
  - Resultado mostra `numero — produto — status`
  - Ao selecionar, sistema **upserta** em `lote_cadastrado`:
    `INSERT (nome=op.numero, ordem_producao_id=op.id) ON CONFLICT (conta_id, nome) DO UPDATE SET ordem_producao_id = EXCLUDED.ordem_producao_id`
    (vincula FK em lote legado que coincide com o nome)
  - `lote` (state) recebe `op.numero` — vai pro QR igual antes
- Validação visual: badge "Confecção" ao lado do nome do lote quando
  resolvido com FK preenchida

> Componente reusa `LookupComCadastroInline` se possível (já existe em
> `src/components/confeccao/lookup-com-cadastro-inline.tsx` por RITM-05).
> Verificar se a API bate; senão, criar `LookupOPConfeccao` específico.

### UI: bloco "Fardos no estoque" no header da OP

`src/app/(dashboard)/confeccao/ops/[numero]/page.tsx`:

- Novo bloco logo abaixo do header, expandido por default só se a OP
  tiver `status = 'concluida'`
- Chama `GET /api/confeccao/ops/[numero]/fardos` ao montar
- Tabela: SKU | Qtd | Fardo (codigoFardo) | Estante | Criado em
- Totalizadores rodapé: `total_fardos`, `total_pecas`
- Link em cada linha pra `/estante-virtual?fardo=<id>` (não obrigatório
  agora se a Estante Virtual não tem deep-link; se não, só mostrar texto)

> Visual leve — não é dashboard. Objetivo é "tem fardos? quais?" sem
> sair da OP.

### Service `vincularLoteAOP` (puro, testável)

`src/lib/confeccao/lote-op.ts`:

```ts
export async function vincularLoteAOP(
  tx: Tx,
  args: { contaId: string; opId: string; opNumero: string },
): Promise<{ loteId: string; criado: boolean }> {
  // UPSERT em lote_cadastrado com FK preenchida.
  // Retorna criado=true se INSERT, false se atualizou FK em lote existente.
}
```

Testado em isolamento contra fixtures (mesmo padrão do RITM-22).

## Critérios de aceitação

1. Migration aplicada localmente: coluna `ordem_producao_id` aparece em
   `lote_cadastrado` com FK + index, sem afetar lotes existentes.
2. `GET /api/confeccao/ops/lookup` sem auth → 401.
3. `GET /api/confeccao/ops/lookup?q=OP05` retorna OPs da conta ativa
   ordenadas por mais recente, limit 20.
4. `GET /api/confeccao/ops/lookup?status=cancelada` retorna OPs canceladas
   (override do default explícito).
5. `GET /api/confeccao/ops/[numero]/fardos` retorna fardos vinculados:
   - Pela FK (`lote_cadastrado.ordem_producao_id`)
   - Pelo nome (`estanteFardo.lote = op.numero`), mesmo sem FK
6. Cadastro de fardo via UI:
   - Modo "Estoque padrão" continua funcionando idêntico
   - Modo "Lote customizado" continua funcionando idêntico (sem FK)
   - Modo "OP de Confecção" busca e cria fardo com `lote = OP05260001`
     no QR; `lote_cadastrado` ganha registro com FK preenchida
7. Selecionar OP cuja `lote_cadastrado` já existe (criado manualmente
   antes) faz upsert na FK sem duplicar registro.
8. Header da OP mostra bloco "Fardos no estoque" com lista correta
   (lote vinculado por FK OU por nome).
9. Service `vincularLoteAOP` tem testes unit cobrindo:
   - Lote inexistente → INSERT, retorna `criado: true`
   - Lote já existe sem FK → UPDATE FK, retorna `criado: false`
   - Lote já existe com FK pra outra OP → UPDATE pra OP nova (caso edge:
     alguém vinculou errado e está corrigindo)
10. Lint + typecheck limpos.
11. RLS revalidada com `restore-rls-policies.ts` após migration.

## Fora de escopo

- **Geração automática de QR a partir da Conferência** — arquitetura §13.2
  diz explicitamente que o passo é manual no módulo Estante Virtual. Não
  mexer.
- **Sincronizar quantidade de peças aprovadas da Conferência com fardos**
  — feedback bi-direcional. Roadmap V2.
- **Bipagem de fardo abrindo a OP de origem** — possível com o lote
  no QR + `/confeccao/ops/<lote>`, mas exige mudança na Estante Virtual.
  RITM separada se priorizado.
- **Histórico de movimentações no header da OP** — só mostramos fardos
  atuais. Histórico completo (entradas/saídas) vive na Estante Virtual.
- **Validação de SKU contra produto da OP** — operador pode gerar fardo
  com SKU diferente do produto da OP. Sistema avisa visualmente mas não
  bloqueia. Discussão pra V2 (a definição de "SKU vs produto da OP"
  ainda não foi resolvida — README diz "Vínculo SKU ↔ produto da confecção
  fica como roadmap futuro").
- **Renumeração de OP** — não é cenário previsto; FK com SET NULL cobre
  delete acidental, mas rename de `numero` quebraria QRs já impressos.
  Restrição via UI (numero da OP é read-only após criação) já existe.
