# RITM-08 — UI: Página de Integrações + Botão Conectar

> **Bloqueia:** teste end-to-end da Onda 0
> **Depende de:** RITM-07 (routes)
> **Dependência externa:** nenhuma

---

## Objetivo

Criar interface mínima (funcional, não bonita) pra que Gabriel consiga conectar uma loja TikTok Shop pelo ERP. Lista canais existentes e permite adicionar novos.

---

## Arquivos a criar

- `src/app/(dashboard)/integracoes/page.tsx` — página principal
- `src/components/integracoes/lojas-list.tsx` — componente que lista
- `src/components/integracoes/conectar-tiktok-modal.tsx` — modal de seleção de CNPJ
- Usar os componentes de UI que já existem no projeto (shadcn/ui, MUI, o que for)

---

## Estrutura da página

```
┌─ Integrações de Canais ───────────────────────────────────┐
│                                                           │
│  Conecte marketplaces ao seu ERP                          │
│                                                           │
│  ┌──────────────────────────────────────────────────┐    │
│  │ TikTok Shop                   [+ Conectar loja]  │    │
│  │ ─────────────────────────────────────────────    │    │
│  │                                                  │    │
│  │  📍 AVZ Loja 1                                  │    │
│  │     CNPJ: 12.345.678/0001-90                    │    │
│  │     Status: ● Ativo                             │    │
│  │     Token renova em: 18h 22min                  │    │
│  │     [Desconectar]                               │    │
│  │                                                  │    │
│  │  📍 AVZ Loja 2                                  │    │
│  │     CNPJ: 98.765.432/0001-10                    │    │
│  │     Status: ⚠ Precisa reautorizar              │    │
│  │     [Reconectar] [Desconectar]                  │    │
│  └──────────────────────────────────────────────────┘    │
│                                                           │
│  ┌──────────────────────────────────────────────────┐    │
│  │ Shopee                                  [em breve]│    │
│  └──────────────────────────────────────────────────┘    │
│                                                           │
│  ┌──────────────────────────────────────────────────┐    │
│  │ Mercado Livre                           [em breve]│    │
│  └──────────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────────┘
```

---

## Comportamentos

### Lista de canais

- Fetch em `GET /api/canais` (criado no RITM-07)
- Loading state enquanto carrega
- Empty state se não tiver nenhuma loja conectada ainda
- Auto-refresh quando voltar do callback (via query param `?success=1`)

### Botão "Conectar loja"

1. Clica → abre modal
2. Modal mostra lista de CNPJs da conta ativa (fetch em endpoint existente — criar se não houver, `GET /api/cnpjs`)
3. Usuário seleciona CNPJ → botão "Continuar"
4. Clica "Continuar" → `window.location.href = '/api/canais/tiktok/conectar?cnpjId=X'`
5. Browser redireciona pro TikTok
6. Depois do OAuth, usuário volta pra `/integracoes?success=1` e a lista atualiza

### Status de cada loja

Calcular client-side a partir dos dados retornados:

```typescript
function getStatus(canal) {
  if (!canal.ativo) return { label: 'Inativo', color: 'gray' };
  if (canal.statusRenovacao === 'falha_reauth') {
    return { label: 'Precisa reautorizar', color: 'yellow' };
  }
  const agora = new Date();
  const expira = new Date(canal.accessTokenExpiraEm);
  const horasRestantes = (expira.getTime() - agora.getTime()) / (1000 * 60 * 60);

  if (horasRestantes < 0) return { label: 'Token expirado', color: 'red' };
  if (horasRestantes < 2) return { label: 'Renovando em breve', color: 'yellow' };
  return { label: 'Ativo', color: 'green' };
}
```

### Toasts de feedback

- `?success=1` → toast verde "Loja conectada com sucesso"
- `?error=invalid_state` → toast vermelho "Sessão de autorização expirou, tente novamente"
- `?error=no_shops` → toast vermelho "Nenhuma loja autorizada. Verifique a whitelist do app no Partner Center"
- `?error=internal` → toast vermelho "Erro ao conectar. Contate o suporte"
- Limpar query params após ler (via `router.replace`)

### Ações "Desconectar" e "Reconectar"

Nesta onda, implementação **mínima**:

- **Desconectar**: marca `ativo = false` em `canais_venda`. Não deleta (preserva histórico de pedidos futuros). Chama `DELETE /api/canais/:id` (criar endpoint simples).
- **Reconectar**: apenas chama o mesmo fluxo de conectar com o mesmo `cnpjId`.

Confirmação via modal antes de desconectar.

---

## Acesso

- Rota protegida (require auth do Better-Auth)
- Role: `owner`, `admin` ou `operador` (ajustar conforme roles do projeto). Usuários sem permissão veem "Você não tem acesso a esta página".

---

## Testes obrigatórios

Esta é UI, então testes podem ser mais leves (componentes de apresentação). Pelo menos:

1. ✅ Renderiza lista de canais retornada pela API (mock)
2. ✅ Mostra empty state quando vem array vazio
3. ✅ Status calculado correto pra token expirado, ativo, reauth
4. ✅ Modal de conectar abre/fecha
5. ✅ Modal lista CNPJs retornados pela API
6. ✅ Clicar "continuar" faz redirect (pode mockar `window.location`)

Testes E2E (Playwright/Cypress) ficam pra quando o projeto tiver infra pra isso.

---

## Critérios de aceitação

- [ ] Página acessível em `/integracoes`
- [ ] Lista canais da conta via API
- [ ] Modal de conectar funciona
- [ ] Redirect pro TikTok funciona
- [ ] Toasts aparecem conforme query params
- [ ] Status visual de token correto
- [ ] Responsivo (ao menos funciona em tablet)
- [ ] Role-based access working

---

## Nota de escopo

Esta UI é **mínima** e funcional. Melhorias visuais, transições, micro-interações ficam pra depois. O objetivo é validar o fluxo end-to-end, não ter UI final.

Não investir muito tempo em polimento aqui — a próxima onda (processamento de webhooks + sync de estoque) é mais valiosa.
