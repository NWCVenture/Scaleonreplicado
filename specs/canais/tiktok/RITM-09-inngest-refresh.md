# RITM-09 — Inngest: Refresh Automático de Tokens

> **Bloqueia:** operação contínua (sem isso, tokens expiram em 24h e tudo quebra)
> **Depende de:** RITM-01 (crypto), RITM-02 (schema), RITM-05 (renovarTokens)
> **Dependência externa:** conta Inngest criada com `INNGEST_EVENT_KEY` e `INNGEST_SIGNING_KEY`

---

## Objetivo

Criar função Inngest agendada que roda a cada 1 hora, verifica credenciais OAuth cujos `access_token` expiram nas próximas 6 horas, e renova automaticamente. Se falhar, marca a credencial como `falha_reauth`.

Também configurar o endpoint Inngest padrão do Next.js, que vai servir esta e futuras funções.

---

## Arquivos a criar

- `src/inngest/client.ts` — cliente Inngest (primeiro uso no projeto)
- `src/inngest/functions/tiktok-refresh-tokens.ts` — a função
- `src/app/api/inngest/route.ts` — endpoint padrão
- `.env.example` — adicionar envs Inngest

---

## Pré-requisitos

1. Instalar: `npm install inngest`
2. Criar conta em https://www.inngest.com/ (free tier)
3. Criar "App" no Inngest dashboard chamado `erp-<seu-id>` (ou equivalente)
4. Copiar `INNGEST_EVENT_KEY` e `INNGEST_SIGNING_KEY` pro `.env.local`

---

## Especificação

### `src/inngest/client.ts`

```typescript
import { Inngest } from 'inngest';

export const inngest = new Inngest({
  id: 'erp-nwc', // ajustar pro nome real do app
  eventKey: process.env.INNGEST_EVENT_KEY,
});
```

### `src/app/api/inngest/route.ts`

```typescript
import { serve } from 'inngest/next';
import { inngest } from '@/inngest/client';
import { refreshTiktokTokens } from '@/inngest/functions/tiktok-refresh-tokens';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [refreshTiktokTokens],
  signingKey: process.env.INNGEST_SIGNING_KEY,
});
```

### `src/inngest/functions/tiktok-refresh-tokens.ts`

```typescript
import { inngest } from '../client';
import { db } from '@/lib/db';
import { credenciaisOauthTiktok } from '@/lib/db/schema';
import { encrypt, decrypt } from '@/lib/crypto';
import { renovarTokens } from '@/lib/canais/tiktok-shop/oauth';
import { TikTokShopError } from '@/lib/canais/tiktok-shop/errors';
import { and, eq, lte } from 'drizzle-orm';

export const refreshTiktokTokens = inngest.createFunction(
  {
    id: 'tiktok-refresh-tokens',
    name: 'Renovar tokens TikTok Shop',
    retries: 1, // o retry individual por credencial é por step
  },
  { cron: '0 * * * *' }, // toda hora cheia
  async ({ step, logger }) => {
    // Passo 1: listar credenciais expirando em até 6h que estão ativas
    const aRenovar = await step.run('listar-credenciais', async () => {
      const threshold = new Date(Date.now() + 6 * 60 * 60 * 1000);

      // ⚠️ Esta query roda sem RLS (job de sistema).
      // Garantir que o driver/role do Drizzle bypassa RLS aqui.
      // Alternativa: executar `SET LOCAL ROLE <role_sistema>` antes.
      return await db
        .select()
        .from(credenciaisOauthTiktok)
        .where(
          and(
            lte(credenciaisOauthTiktok.accessTokenExpiraEm, threshold),
            eq(credenciaisOauthTiktok.statusRenovacao, 'ativo')
          )
        );
    });

    logger.info(`Credenciais a renovar: ${aRenovar.length}`);

    let sucessos = 0;
    let falhas = 0;

    // Passo 2: renova cada uma como step separado (retry individual)
    for (const cred of aRenovar) {
      try {
        await step.run(`renovar-cred-${cred.id}`, async () => {
          const refreshToken = decrypt(cred.refreshTokenCriptografado);
          const novos = await renovarTokens(refreshToken);

          await db
            .update(credenciaisOauthTiktok)
            .set({
              accessTokenCriptografado: encrypt(novos.accessToken),
              accessTokenExpiraEm: novos.accessTokenExpiraEm,
              refreshTokenCriptografado: encrypt(novos.refreshToken),
              refreshTokenExpiraEm: novos.refreshTokenExpiraEm,
              ultimaRenovacaoEm: new Date(),
              atualizadoEm: new Date(),
            })
            .where(eq(credenciaisOauthTiktok.id, cred.id));
        });
        sucessos++;
      } catch (err) {
        falhas++;
        logger.error(`Falha renovar credencial ${cred.id}`, err);

        // Se erro indica reauth necessário, marca no banco
        const requiresReauth =
          err instanceof TikTokShopError && err.requiresReauth;

        if (requiresReauth) {
          await step.run(`marcar-reauth-${cred.id}`, async () => {
            await db
              .update(credenciaisOauthTiktok)
              .set({
                statusRenovacao: 'falha_reauth',
                atualizadoEm: new Date(),
              })
              .where(eq(credenciaisOauthTiktok.id, cred.id));
          });
        }
        // Não re-throw: queremos processar as outras mesmo com uma falha
      }
    }

    return {
      total: aRenovar.length,
      sucessos,
      falhas,
    };
  }
);
```

---

## Comportamento

### Quando roda
- Cron: **toda hora cheia** (`0 * * * *`)
- Janela de renovação: credenciais expirando nas próximas **6 horas**
- Por que 6h e não 1h: margem de segurança pra falhas temporárias (Inngest pode retry, e a próxima execução ainda tem 5h de gordura)

### Atualização atômica
- `update` em uma única transação: access + refresh + expirações
- Se a atualização falha depois de renovar com sucesso, próxima execução tenta de novo
- TikTok pode devolver novo refresh_token — descartar o antigo e usar o novo

### Tratamento de falha
- Erro de rede/5xx: Inngest retry automático (1 retry)
- `requiresReauth` = true: marca `status_renovacao = 'falha_reauth'` e **não tenta de novo**. UI deve mostrar "Precisa reautorizar" pro usuário.
- Outras falhas: loga e segue processando outras credenciais

---

## Testes obrigatórios

### Unit tests

1. ✅ Função listarCredenciais retorna só credenciais com `status = 'ativo'` e `expira_em < agora+6h`
2. ✅ Após renovar sucesso, campos são atualizados com novos valores encriptados
3. ✅ Ao descriptografar antes e depois de renovar, os tokens são diferentes
4. ✅ Se `renovarTokens` lança `TikTokShopError` com `requiresReauth=true`, credencial é marcada `falha_reauth`
5. ✅ Outras credenciais continuam sendo processadas mesmo se uma falhar

### Testes de integração (opcionais, mas recomendados)

6. ✅ Disparar função manualmente via CLI Inngest com credencial real de homologação e ver renovação acontecer

---

## Testes manuais

### 1. Verificar que o cron está registrado

Após deploy, abrir dashboard Inngest → Apps → seu app → Functions. Deve aparecer `tiktok-refresh-tokens` com schedule `0 * * * *`.

### 2. Disparar manualmente pelo dashboard

Dashboard Inngest → Functions → `tiktok-refresh-tokens` → botão "Invoke" → ver execução rodar.

### 3. Forçar renovação de credencial ativa

```sql
-- Forçar expiração próxima pra credencial existente
UPDATE credenciais_oauth_tiktok
SET access_token_expira_em = NOW() + interval '3 hours'
WHERE id = 1;
```

Disparar função manualmente pelo Inngest dashboard. Verificar:
- Token renovado (expiração agora ~24h)
- `ultima_renovacao_em` atualizado
- No Inngest dashboard, execução aparece verde

### 4. Simular falha de refresh

Adulterar `refresh_token_criptografado` no banco (mudar 1 char). Disparar função. Verificar:
- Step falha
- `status_renovacao` passa pra `falha_reauth`
- Outras credenciais continuam processando

---

## Critérios de aceitação

- [ ] Instalação do Inngest concluída
- [ ] Endpoint `/api/inngest` responde 200 em GET (página de intro do Inngest)
- [ ] Função aparece no dashboard após deploy
- [ ] Todos os testes unitários passam
- [ ] Teste manual #3 funciona (credencial forçada é renovada)
- [ ] Teste manual #4 funciona (credencial adulterada é marcada pra reauth)
- [ ] Envs `INNGEST_EVENT_KEY` e `INNGEST_SIGNING_KEY` documentadas no `.env.example`

---

## Dúvidas pra resolver antes/durante

1. **RLS na query do job:** como o projeto bypassa RLS em queries de sistema? Verificar padrão existente em outros jobs (se houver) ou consultar dev. Opções:
   - Role separada sem RLS
   - `SET LOCAL app.conta_id = -1` + policy permissiva pra `-1`
   - Drizzle com connection pool separado usando role admin

2. **Notificação de falha de reauth:** depois que uma credencial vai pra `falha_reauth`, como notificar o usuário? UI visual já resolve, mas convém email/Slack também? Fica fora desta Onda — adicionar como RITM futuro.
