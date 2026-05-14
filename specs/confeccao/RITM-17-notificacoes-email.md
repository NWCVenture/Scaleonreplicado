# RITM-17 — Notificações por email (Resend)

Implementa notificações por email para eventos do módulo Confecção via Resend.
Esta RITM cobre **somente os 6 eventos síncronos** (disparados a partir do
handler de uma request que muda estado). Reminders 24h e digest semanal
ficam para RITM-17b.

## Eventos cobertos

| # | Evento | Endpoint que dispara | Destinatário(s) |
|---|--------|----------------------|-----------------|
| 1 | OP criada | `POST /api/confeccao/ops` | Atribuído da OP |
| 2 | Subtask concluída (transição) | `POST /api/confeccao/subtasks/[id]/concluir` | Atribuído da próxima subtask (se houver) + atribuído da anterior (se diferente do executor) |
| 3 | OP concluída | mesmo endpoint, quando todas subtasks fecham | Todos admins/owners da conta + atribuído da OP |
| 4 | Atribuído de OP alterado | `PATCH /api/confeccao/ops/[numero]` | Novo atribuído + anterior |
| 5 | Atribuído de subtask alterado | `PATCH /api/confeccao/subtasks/[id]` | Novo atribuído + anterior |
| 6 | Retirada parcial criada | `POST /api/confeccao/subtasks/[id]/retiradas` (tipo=parcial) | Atribuído da subtask Conferência (OPCONF) da mesma OP |

> **Cancelamento de OP** (mencionado na arquitetura) **não está nesta RITM** —
> cobertura junto da RITM-18 (cancelamento de OP com dupla autorização).

## Decisões de escopo

- **Sem opt-out por enquanto** — todo usuário com email recebe. Adicionar
  preferências em RITM futura.
- **Templates em TS string puro** (`buildHtmlEmail*` no padrão de
  `buildVerificationEmailHtml` em `src/lib/email.ts`). Sem `@react-email/*`.
- **Fire-and-forget** — endpoint dispara `notificar*()` após o commit da
  transação principal; falhas viram log e não quebram a resposta.
- **Idempotência** — não há controle (se a request é repetida o email é
  reenviado). Aceitável pro MVP.

## Arquivos novos

```
src/lib/confeccao/email/
  ├── index.ts            # re-exports
  ├── destinatarios.ts    # helpers DB (buscarUsuario, buscarAdmins)
  ├── templates.ts        # builders: { subject, html, text }
  ├── eventos.ts          # 6 dispatchers fire-and-forget
  └── templates.test.ts   # asserts em subject/html/text das builders
```

## Arquivos modificados

- `src/app/api/confeccao/ops/route.ts` — POST chama `notificarOpCriada` após sucesso
- `src/app/api/confeccao/subtasks/[id]/concluir/route.ts` — POST chama `notificarSubtaskConcluida` + `notificarOpConcluida` se `proximaDesbloqueada==null` e OP fechou
- `src/app/api/confeccao/ops/[numero]/route.ts` — PATCH chama `notificarAtribuidoOpMudou` se mudou
- `src/app/api/confeccao/subtasks/[id]/route.ts` — PATCH chama `notificarAtribuidoSubtaskMudou` se mudou
- `src/app/api/confeccao/subtasks/[id]/retiradas/route.ts` — POST chama `notificarRetiradaParcial` se `tipo==='parcial'`

## Conteúdo dos emails (resumo)

Cada email contém:
- Header "SCALEON ERP — Confecção"
- Identificação clara: número da OP + número/nome da subtask
- Resumo de 1 frase do que aconteceu
- Botão CTA com link absoluto pra subtask/OP no app
- Texto plain (`text`) com mesmo conteúdo em formato simples

URL base do app: `process.env.NEXT_PUBLIC_APP_URL` (fallback `http://localhost:3000` em dev).

## "Admin" para o evento "OP concluída"

Considera-se admin quem tem `papel in ('owner','admin')` em `usuario_conta`
da conta da OP, com `ativo = true`.

## Critérios de aceitação

1. Tabelas `confeccao_template_whatsapp` etc continuam intactas — nenhuma
   migration nova nesta RITM.
2. Endpoint `/api/confeccao/ops` (POST) retorna 201 mesmo se o disparo
   falhar (Resend down, etc).
3. Quando `RESEND_API_KEY` não está setado, `sendEmail` já registra warning
   e retorna `{ simulated: true }` — comportamento permanece (já é assim
   no `src/lib/email.ts`).
4. Testes unit cobrindo cada builder de template (asserts em subject e
   trechos esperados do html/text).
5. Lint e typecheck limpos nos arquivos novos.
6. Manual smoke: criar uma OP no Docker local, validar nos logs que o
   dispatcher rodou (com `simulated: true` se RESEND_API_KEY ausente).
