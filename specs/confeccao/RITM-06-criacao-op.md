# RITM-06 — Criação de Ordem de Produção (endpoint + UI de "Nova OP")

> **Bloqueia:** RITM-07 (stepper só faz sentido depois de criar OP)
> **Depende de:** RITM-02 (schema OP+subtasks + helper de numeração), RITM-05 (lookup de produto + atribuído)
> **Dependência externa:** Resend (RITM-17) — opcional nesta RITM; se não estiver pronto, deixar TODO no envio de email

---

## Objetivo

Permitir que admins criem uma nova OP em uma transação que:

1. Gera número da OP (`OPMMAANNNN`) via helper de numeração
2. Cria registro em `confeccao_ordem_producao`
3. **Gera automaticamente as 6 subtasks** (ou 5, se `tem_vies = false`), todas em status correto:
   - `confeccao_subtask` × 5 ou 6: a primeira (`OPBUY`) entra como `pendente`, as demais como `bloqueada`
4. Registra "Criada por" automaticamente com o usuário da sessão
5. Notifica o usuário atribuído por email (via Resend — pode ficar com TODO se RITM-17 não estiver pronto)
6. Cria nota inicial de auditoria na OP: `"OP criada por {usuario}"`
7. Retorna o número da OP recém-criada pra UI redirecionar

---

## Arquivos a criar/modificar

- `src/lib/confeccao/criar-op.ts` — service layer com a lógica transacional
- `src/lib/confeccao/__tests__/criar-op.test.ts`
- `src/app/api/confeccao/ops/route.ts` — POST (create), GET (list paginada das OPs)
- `src/app/(dashboard)/confeccao/page.tsx` — landing do módulo, lista de OPs
- `src/app/(dashboard)/confeccao/nova/page.tsx` — formulário de criar OP
- `src/lib/confeccao/schemas/op.ts` — Zod schema da OP

---

## Schema Zod

`src/lib/confeccao/schemas/op.ts`:

```ts
export const CriarOPSchema = z.object({
  produtoId: z.string().min(1),
  temVies: z.boolean().default(false),
  atribuidoAId: z.string().min(1),
  observacoes: z.string().max(2000).optional(),
});

export type CriarOPInput = z.infer<typeof CriarOPSchema>;
```

---

## Service `criar-op.ts`

### Assinatura

```ts
import { db } from "@/lib/db";

export interface CriarOPResult {
  numero: string;            // ex: "OP05260001"
  id: string;
  subtasks: Array<{ id: string; numero: string; prefixo: ConfeccaoSubtaskPrefixo }>;
}

export async function criarOP(input: {
  contaId: string;
  criadaPorId: string;
  data: CriarOPInput;
}): Promise<CriarOPResult>;
```

### Implementação (pseudo)

```ts
export async function criarOP({ contaId, criadaPorId, data }) {
  return await db.transaction(async (tx) => {
    // 1. Validar que produto existe e é da mesma conta (RLS já protege; este check só pro 404 limpo)
    const produto = await tx.query.confeccaoProduto.findFirst({
      where: and(eq(...id), eq(...conta_id)),
    });
    if (!produto) throw new NotFoundError("Produto não encontrado");

    // 2. Validar atribuido_a — precisa ser membro ativo da conta
    const membro = await tx.query.usuarioConta.findFirst(...);
    if (!membro) throw new ValidationError("Atribuído não pertence à conta");

    // 3. Gerar número da OP (sequencial dedicado, ver RITM-02)
    const { numero, sequencial, mes, ano } = await gerarNumeroOP(tx);

    // 4. Insert da OP
    const [op] = await tx.insert(confeccaoOrdemProducao).values({
      id: nanoid(),
      contaId,
      numero,
      sequencialGlobal: sequencial,
      produtoId: data.produtoId,
      temVies: data.temVies,
      criadaPorId,
      atribuidoAId: data.atribuidoAId,
      observacoes: data.observacoes,
    }).returning();

    // 5. Gerar as 6 (ou 5) subtasks com ordem certa
    const prefixos: ConfeccaoSubtaskPrefixo[] = data.temVies
      ? ["OPBUY", "OPRIS", "OPCOR", "OPVIE", "OPSEW", "OPCONF"]
      : ["OPBUY", "OPRIS", "OPCOR", "OPSEW", "OPCONF"];

    const subtasks = await tx.insert(confeccaoSubtask).values(
      prefixos.map((prefixo, idx) => ({
        id: nanoid(),
        contaId,
        ordemProducaoId: op.id,
        numero: gerarNumeroSubtaskVisivel(prefixo, sequencial),
        idInterno: gerarIdInternoSubtask(prefixo, mes, ano, sequencial),
        prefixo,
        ordemSequencial: idx + 1,
        status: idx === 0 ? "pendente" : "bloqueada",
        payload: {},
      }))
    ).returning();

    // 6. Nota inicial de auditoria
    await tx.insert(confeccaoNota).values({
      id: nanoid(),
      contaId,
      ordemProducaoId: op.id,
      autorId: null,
      conteudo: `OP criada por ${nomeUsuario}. Atribuída a ${nomeAtribuido}.`,
      isAuditoria: true,
      isInterna: true,
      metadata: { criadaPorId, atribuidoAId: data.atribuidoAId, temVies: data.temVies },
    });

    return {
      id: op.id,
      numero: op.numero,
      subtasks: subtasks.map(s => ({ id: s.id, numero: s.numero, prefixo: s.prefixo })),
    };
  });
}

// Depois (FORA da transação), enviar email — RITM-17:
// await enviarEmailOPCriada({ destinatario: atribuido.email, op });
```

> **Importante:** envio de email **NÃO** vai dentro da transação. Se a transação faz rollback, não queremos ter enviado email; se o email falha, não queremos rollback da OP. Pattern: emit event fora da transação (Inngest, queue, ou await direto com try/catch e log no caso de falha).

---

## Endpoint `POST /api/confeccao/ops`

### Request

```json
{
  "produtoId": "abc123",
  "temVies": true,
  "atribuidoAId": "user456",
  "observacoes": "Coleção verão 2026"
}
```

### Comportamento

1. Autenticação: sessão ativa
2. Autorização: **apenas `admin` ou `owner`** podem criar OPs
3. Validação Zod
4. Chama `criarOP({ contaId, criadaPorId: session.user.id, data })`
5. Resposta 201:
   ```json
   {
     "id": "op_xxx",
     "numero": "OP05260001",
     "subtasks": [
       { "id": "st_1", "numero": "OPBUY0001", "prefixo": "OPBUY" },
       ...
     ]
   }
   ```
6. Em paralelo (após response): disparar email pro `atribuidoA` (TODO se RITM-17 não pronto — adicionar nota de TODO comentada e logar `console.warn`)

### Errors

- 400: payload inválido
- 401: não autenticado
- 403: role não permite criar (não-admin)
- 404: produto ou atribuído não encontrado na conta
- 409: número da OP colide (improvável, mas em race condition; client pode retry)

---

## Endpoint `GET /api/confeccao/ops`

Listagem paginada de OPs da conta.

### Query params

- `page=1&pageSize=20`
- `status=em_andamento|concluida|cancelada` (multi via repetição: `?status=em_andamento&status=concluida`)
- `atribuidoA=user_id`
- `search=...` — busca por número da OP ou nome do produto

### Response

```json
{
  "items": [
    {
      "id": "...",
      "numero": "OP05260001",
      "produto": { "id": "...", "nome": "..." },
      "status": "em_andamento",
      "temVies": true,
      "atribuidoA": { "id": "...", "name": "..." },
      "criadaPorNome": "...",
      "progresso": { "subtasksConcluidas": 2, "subtasksTotal": 6 },
      "criadaEm": "2026-05-12T...",
      "atualizadaEm": "2026-05-12T..."
    }
  ],
  "total": 42
}
```

> `progresso` é computado on-the-fly via subquery contando subtasks concluídas. Não materializar por ora.

---

## UI — landing `/confeccao`

`src/app/(dashboard)/confeccao/page.tsx`:

- Header: "Confecção" + botão "+ Nova OP" (visível só pra admins)
- Filtros: status, atribuído, search
- Tabela/lista de OPs (ou kanban simples por status — escolher por densidade de informação; tabela é mais simples pra começar)
- Cada linha clicável → navega pra `/confeccao/ops/[numero]` (que será implementado na RITM-07)
- Indicador visual de progresso (% baseado em subtasks concluídas)
- Indicador de "em atraso" (TODO — RITM-22)

---

## UI — formulário `/confeccao/nova`

`src/app/(dashboard)/confeccao/nova/page.tsx`:

### Campos

| Campo | Componente | Validação |
|---|---|---|
| Produto | `<LookupComCadastroInline entidade="produto">` | obrigatório |
| Incluir Viés? | Checkbox | default false |
| Atribuído a | `<LookupUsuarioConta>` (a criar — lookup de membros da conta atual) | obrigatório |
| Observações gerais | Textarea | opcional, 2000 chars max |

### Comportamento

1. Submit valida com Zod (mesma do backend)
2. `POST /api/confeccao/ops` → se 201, redireciona pra `/confeccao/ops/{numero}` (RITM-07)
3. Toast de sucesso
4. Em erro: mostra mensagem específica (Zod errors, 403, 409 etc)

### Componente novo: `<LookupUsuarioConta>`

`src/components/confeccao/lookup-usuario-conta.tsx`:

- GET `/api/contas/atual/membros` (ou endpoint equivalente que já exista — verificar) lista membros ativos
- Combobox com nome + email + papel
- Filtra por `ativo=true`

> Se já houver lookup de usuários no projeto (provavelmente sim — outras telas atribuem coisas), reusar.

---

## Testes obrigatórios

`src/lib/confeccao/__tests__/criar-op.test.ts`:

1. ✅ Criação com `temVies=false` gera 5 subtasks com prefixos corretos
2. ✅ Criação com `temVies=true` gera 6 subtasks na ordem certa (Viés entre Corte e Costura)
3. ✅ Primeira subtask (`OPBUY`) entra como `pendente`, demais como `bloqueada`
4. ✅ `numero` da OP segue formato `OPMMAANNNN`, sequencial monotônico em 2 criações seguidas
5. ✅ Subtasks têm o mesmo sequencial da OP (ex: OP `OP05260001` → `OPBUY0001`, `OPRIS0001`, etc)
6. ✅ Nota de auditoria criada com `is_auditoria=true` e `metadata` populado
7. ✅ Rollback em qualquer erro → nada fica no banco (transação atomica)
8. ✅ Criação por `funcionario` → erro de autorização

`src/app/api/confeccao/ops/__tests__/route.test.ts`:

9. ✅ POST sem auth → 401
10. ✅ POST como `funcionario` → 403
11. ✅ POST com produto de outra conta → 404
12. ✅ POST com atribuído que não é membro da conta → 400
13. ✅ POST válido → 201 + payload completo
14. ✅ GET paginação funciona
15. ✅ GET filtros (status, search) funcionam

---

## Critérios de aceitação

- [ ] Service `criarOP` implementado com transação atômica e geração das subtasks
- [ ] Endpoint POST e GET implementados com auth + RLS + Zod
- [ ] Componente `<LookupUsuarioConta>` implementado (ou reusado se já existir)
- [ ] Página `/confeccao` lista OPs paginada com filtros
- [ ] Página `/confeccao/nova` cria OP e redireciona pro detalhe (mesmo que detalhe ainda seja stub da RITM-07)
- [ ] Todos os 15 testes passam
- [ ] Validação manual:
  - [ ] Criar OP sem Viés → tem 5 subtasks
  - [ ] Criar OP com Viés → tem 6, na ordem certa
  - [ ] Subtask OPBUY entra `pendente`, demais `bloqueada`
  - [ ] Nota de auditoria visível
  - [ ] Email TODO (ou enviado se RITM-17 já pronto)
- [ ] Stub mínimo de `/confeccao/ops/[numero]` existe (página com header básico, sem stepper ainda — RITM-07 implementa)

---

## Pontos críticos

- ⚠️ **Tudo em uma transação.** OP + 6 subtasks + nota são atômicos. Se qualquer um falha, rollback total.
- ⚠️ **Email fora da transação.** Email failure não deve causar rollback. Tratar com try/catch + log.
- ⚠️ **Sequencial é global.** Garantir atomic via sequence dedicada (ver RITM-02). Sem isso, 2 admins criando ao mesmo tempo podem colidir.
- ❌ **NÃO** permitir mudar `tem_vies` depois de OP criada. Validação no schema da OP no UPDATE (TODO em RITM-08 ou similar, mas registrar aqui também).
- ⚠️ Validar atribuído na criação **e em cada edição posterior** — usuário pode ser removido da conta.
