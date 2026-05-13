# Módulo Confecção — Specs (RITMs)

Implementação do **Módulo Confecção** do ERP, no mesmo nível hierárquico de Dashboard, Expedição e Estante Virtual.

> ⚠️ **Independência total do Módulo de Canais (TikTok Shop).** Este módulo é um domínio separado, com tabelas, código, jobs e webhooks próprios. Nada é compartilhado com `specs/canais/` nem `src/lib/canais/`. Veja `feedback_confeccao_separado_canais` em memory.

## Documentos de referência

- **Arquitetura funcional completa:** [`docs/arquitetura/modulo-confeccao.md`](../../docs/arquitetura/modulo-confeccao.md)
- **Guia técnico (convenções, modelo de dados, regras invioláveis):** [`GUIA-TECNICO.md`](./GUIA-TECNICO.md)
- **Padrão de RITMs:** ver `specs/canais/tiktok/README.md` (mesmo formato, domínio diferente)

## Como executar um RITM

```
Leia CLAUDE.md (aponta pra AGENTS.md), docs/arquitetura/modulo-confeccao.md
e specs/confeccao/GUIA-TECNICO.md. Depois implemente
specs/confeccao/RITM-NN-<nome>.md seguindo a especificação. Execute os
critérios de aceitação no fim do documento antes de considerar done.

Se a spec estiver ambígua ou algo não bater com a realidade do código,
pause e me avise antes de chutar.
```

## Regras

- **Uma RITM por commit/PR.** Não misturar tarefas.
- **Migration sempre primeiro no Docker local**, validar end-to-end, só depois `db:migrate:prod` no Neon.
- **Validações invioláveis precisam estar no backend** — frontend é defesa em profundidade, não a única defesa.
- **Toda mudança em campo de subtask concluída → registro automático em `confeccao_nota` com `is_auditoria = TRUE`.**

## Roadmap completo (24 RITMs no caminho crítico + 4 da fase Lalamove API)

### Fase Base + OP esqueleto (semanas 1-2 do roadmap)

| RITM | Nome | Bloqueia | Depende de |
|------|------|----------|------------|
| 01 | [Schema cadastros](./RITM-01-schema-cadastros.md) | 02, 05, 08-12 | — |
| 02 | [Schema OP + subtasks + numeração](./RITM-02-schema-op-subtasks.md) | 03, 06, 07, 08-13 | 01 |
| 03 | [Schema Lalamove + retiradas + subconferências](./RITM-03-schema-lalamove-retiradas.md) | 12, 13, 18, 25-28 | 02 |
| 04 | [Upload de anexos (Vercel Blob)](./RITM-04-anexos-blob.md) | 08-13 | 02 |
| 05 | [CRUD cadastros (UI + API)](./RITM-05-crud-cadastros-ui.md) | 06 | 01 |
| 06 | [Criação de OP](./RITM-06-criacao-op.md) | 07 | 02, 05 |
| 07 | [Stepper vertical da OP](./RITM-07-stepper-op.md) | 08-13 | 06 |

### Fase Subtasks operacionais (semanas 3-4)

| RITM | Nome | Bloqueia | Depende de |
|------|------|----------|------------|
| 08 | Subtask Compra (OPBUY) | 09 | 07, 04 |
| 09 | Subtask Risco (OPRIS) | 10 | 08 |
| 10 | Subtask Corte (OPCOR) | 11/12 | 09, 14 |
| 11 | Subtask Viés (OPVIE) — condicional | 12 | 10 |
| 12 | Subtask Costura (OPSEW) | 13 | 11 |
| 13 | Subtask Conferência (OPCONF) | 19, 24 | 12 |

### Fase Transversais (semana 5)

| RITM | Nome |
|------|------|
| 14 | Sistema de saldos bloqueante |
| 15 | Auditoria automática em notas |
| 16 | Templates WhatsApp + envio via `wa.me` |
| 17 | Notificações por email (provider: **Resend**) |
| 18 | Cancelamento de OP (com dupla autorização) |

### Fase Dashboards + Estante Virtual (semanas 6-7)

| RITM | Nome |
|------|------|
| 19 | Aba Evidências de Pagamento + cálculo de custos |
| 20 | Dashboard Geral |
| 21 | Dashboard Qualidade por Oficina |
| 22 | Alertas de atraso |
| 23 | Backup semanal (`pg_dump` → Vercel Blob) |
| 24 | Integração com Estante Virtual (campo OP/Lote no QR) |

### Fase Lalamove API (semanas 8+, deferido)

| RITM | Nome |
|------|------|
| 25 | Lalamove API — cotação assistida |
| 26 | Lalamove API — pedido automatizado |
| 27 | Lalamove API — webhook em produção |
| 28 | Lalamove API — mapa em tempo real |

> Esta fase fica deferida intencionalmente — o MVP inteiro roda no modo manual. A modelagem do banco já contempla os campos da API desde a RITM-03, então a ativação não exige migration estrutural.

## Pré-requisitos antes de começar a RITM-01

- [x] Vercel Blob — `BLOB_READ_WRITE_TOKEN` já configurado no projeto (mesmo store usado por Expedição Diária, Coletas e Modelo Principal)
- [x] Resend — `RESEND_API_KEY` já configurado no `.env.example` do projeto
- [ ] Lalamove: sandbox account criada (só necessário a partir da RITM-25 — pode esperar)

## Decisões já tomadas (não revisitar sem alinhar)

- **Storage de anexos:** Vercel Blob (mesmo store já em uso por Expedição Diária, Coletas e Modelo Principal — segue padrão do projeto, sem infra nova)
- **Produtos:** tabela própria `confeccao_produto`, separada de `sku_catalogo` existente. Vínculo SKU ↔ produto da confecção fica como roadmap futuro (não escopo do MVP)
- **Provider de email:** Resend
- **Prefixo de tabelas do módulo:** `confeccao_` (mesmo para cadastros tipo fornecedor/cor/tipo_tecido — diferencia da `cor_catalogo` que já existe pra SKU)
- **Multi-tenant:** todas as tabelas levam `conta_id` (segue padrão existente do projeto)
- **IDs:** `text("id").primaryKey()` com IDs gerados pela app (nanoid/cuid — seguir o padrão do projeto, não UUID nativo)
- **RLS:** ativada em todas as tabelas com policy `conta_id = current_setting('app.conta_id', true)::text`. Adicionar manualmente no SQL gerado (Drizzle não suporta nativo) e documentar no script `restore-rls-policies.ts`.

## Pontos abertos

- **Webhook Lalamove (RITM-27):** URL precisa ser registrada no Partner Portal — confirmar se vai em subdomínio próprio ou na app principal
- **service_type default da Lalamove (RITM-25):** confirmar com testes no sandbox — provavelmente `MOTORCYCLE` pra peças leves e `VAN` pra rolos
