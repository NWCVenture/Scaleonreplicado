# RITM-11 — Dashboard Mínimo de Observabilidade

> **Bloqueia:** nada (é quality-of-life)
> **Depende de:** RITMs 07, 09, 10 (dados pra mostrar)
> **Dependência externa:** nenhuma

---

## Objetivo

Página simples que mostra estado do módulo de canais: o que foi sincronizado, o que deu erro, webhooks recebidos. Ferramenta de debug e auditoria — não precisa ser bonita, precisa ser útil.

---

## Arquivos a criar

- `src/app/(dashboard)/integracoes/logs/page.tsx`
- `src/app/api/canais/logs/route.ts` — endpoint que alimenta a página
- `src/app/api/canais/webhooks/route.ts` — endpoint de webhooks

---

## Especificação da página

```
┌─ Logs de Integrações ─────────────────────────────────────┐
│                                                           │
│  Últimas 24h                                              │
│  ┌──────────┬──────────┬──────────┬─────────┐             │
│  │ Sucessos │  Erros   │ Webhooks │  Taxa   │             │
│  │   142    │    3     │    28    │  97.9%  │             │
│  └──────────┴──────────┴──────────┴─────────┘             │
│                                                           │
│  Filtrar: [Canal ▼] [Tipo ▼] [Status ▼]   [Atualizar]    │
│                                                           │
│  Últimas 50 operações                                     │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ 14:23:45  AVZ Loja 1  refresh_token  ✓ 340ms       │  │
│  │ 14:23:45  AVZ Loja 2  refresh_token  ✓ 412ms       │  │
│  │ 13:58:12  AVZ Loja 1  oauth_callback ✓ 1.2s        │  │
│  │ 13:12:08  AVZ Loja 2  refresh_token  ✗ 850ms [ver] │  │
│  │ ...                                                 │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                           │
│  Webhooks recentes                                        │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ 14:30:12  ORDER_STATUS_CHANGE  AVZ Loja 1  ✓ válido│  │
│  │ 14:28:45  ORDER_STATUS_CHANGE  AVZ Loja 2  ✓ válido│  │
│  │ 14:15:03  [desconhecido]       -            ✗ inv. │  │
│  └─────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────┘
```

Ao clicar em `[ver]` num log de erro, modal ou expandir mostra payload completo.

---

## Endpoints de API

### `GET /api/canais/logs`

Query params:
- `canalId` (opcional)
- `tipo` (opcional: 'oauth_callback', 'refresh_token', etc)
- `sucesso` (opcional: 'true'|'false')
- `desde` (ISO date, padrão: últimas 24h)
- `limit` (padrão 50, máx 500)

Response:
```json
{
  "metrics": {
    "sucessos24h": 142,
    "erros24h": 3,
    "webhooks24h": 28,
    "taxaSucesso": 0.979
  },
  "logs": [
    {
      "id": 1234,
      "canalVendaId": 1,
      "canalNome": "AVZ Loja 1",
      "tipo": "refresh_token",
      "operacao": "renovarTokens",
      "sucesso": true,
      "statusHttp": 200,
      "duracaoMs": 340,
      "erroMensagem": null,
      "criadoEm": "2026-04-23T14:23:45Z"
    }
  ]
}
```

### `GET /api/canais/webhooks`

Similar. Lista últimos `eventos_webhook_tiktok`.

### Segurança

- Role obrigatória: `owner`, `admin` (o que corresponder no projeto). Operador não vê logs.
- RLS ativa automaticamente (`contaAtivaId` do session)
- Tokens e payloads sensíveis já foram sanitizados na gravação (RITM-05)

---

## Implementação da página

Server component com fetch direto + loading boundaries. Pode usar `refreshInterval` pra auto-atualizar a cada 30s.

---

## Testes obrigatórios

Leves — é dashboard:

1. ✅ Só users com role apropriada acessam (outras veem 403)
2. ✅ Filtros funcionam (canal, tipo, status)
3. ✅ Métricas calculadas corretamente (confere com SQL direto no banco)
4. ✅ Modal de erro mostra payload completo

---

## Critérios de aceitação

- [ ] Página renderiza em menos de 1s com até 10k registros
- [ ] Auto-refresh a cada 30s (ou botão manual)
- [ ] RLS funciona (não vaza log de outra conta)
- [ ] Mostra detalhes de erro de forma útil (não só "erro")
- [ ] Usa UI library do projeto (consistente)

---

## Nota de escopo

Esta é versão mínima. Melhorias futuras (não incluir nesta REQ):
- Gráfico de timeline
- Alertas quando erro X% em 1h
- Export CSV
- Busca por texto nos payloads

Essas virão conforme necessário. Não investir aqui.
