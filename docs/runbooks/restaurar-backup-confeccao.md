# Runbook — Restaurar backup do Confecção

Procedimento manual para restaurar um backup gerado pelo workflow
`.github/workflows/backup-confeccao.yml`. Pressuponha que algo deu
errado (corrupção, migração quebrada, drop acidental de tabela) e o
PITR de 6h do Neon free tier **não cobre** o incidente.

> ⚠️ Restore é manual e auditado. Não automatizamos porque o cenário é
> raro e o blast radius de um restore errado é grande. Alguém precisa
> estar na cadeia.

---

## 1. Identificar o backup correto

Liste os blobs no prefixo `backups/confeccao/`:

```bash
# Via API REST (recomendado se o app já tem o token):
curl -s "https://blob.vercel-storage.com/?prefix=backups/confeccao/" \
  -H "Authorization: Bearer $BLOB_READ_WRITE_TOKEN" | jq '.blobs'
```

Ou abra o painel da Vercel → Storage → Blob → procure pelo prefixo.

Estrutura esperada:

```
backups/confeccao/2026/2026-05-17.dump
backups/confeccao/2026/2026-05-10.dump
backups/confeccao/2025/2025-12-07.dump  (mensal histórico)
```

Anote a URL do blob escolhido — é o que vamos baixar.

## 2. Baixar o dump

```bash
# URL pública do blob (resultado do passo anterior)
BLOB_URL="https://<id>.public.blob.vercel-storage.com/backups/confeccao/2026/2026-05-17.dump"

curl -L -o /tmp/restore.dump "$BLOB_URL"

# Sanity: tamanho > 0 e mime bate
ls -lh /tmp/restore.dump
file /tmp/restore.dump   # esperado: "PostgreSQL custom database dump"
```

## 3. Criar um banco temporário no Neon (branch)

**Nunca** restaure direto em prod. Use uma branch do Neon como sandbox.

1. Console do Neon → projeto → Branches → "Create branch"
2. Origem: branch `main` (prod), no momento atual
3. Nome: `restore-test-<data>` (ex: `restore-test-2026-05-17`)
4. Anote a connection string da nova branch

```bash
export RESTORE_DB_URL="postgresql://...@<host-branch>/<db>?sslmode=require"
```

## 4. Restaurar no banco temporário

```bash
# pg_restore mesma major version do pg_dump usado (PostgreSQL 17)
pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  --dbname "$RESTORE_DB_URL" \
  /tmp/restore.dump
```

Flags:

- `--clean --if-exists`: dropa objetos antes de recriar (necessário porque
  a branch já tem o schema atual; queremos sobrescrever).
- `--no-owner --no-acl`: portável entre roles. RLS é recriada via passo 6.

> Erros de `permission denied for schema public` no Neon: rodar uma vez
> `GRANT ALL ON SCHEMA public TO <role_branch>;` antes do `pg_restore`.

## 5. Validar no banco temporário

Conectar via `psql` ou Drizzle Studio (`db:studio:dev` apontado pra branch):

Checklist mínima:

```sql
-- Contagens críticas — comparar com o que se espera do dump
SELECT COUNT(*) FROM confeccao_ordem_producao;
SELECT COUNT(*) FROM confeccao_subtask;
SELECT COUNT(*) FROM confeccao_anexo;
SELECT MAX(numero) FROM confeccao_ordem_producao;

-- Última OP que deveria existir antes do incidente
SELECT * FROM confeccao_ordem_producao
ORDER BY created_at DESC LIMIT 5;

-- Tabelas com RLS ativa
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename LIKE 'confeccao_%'
ORDER BY tablename;
```

Se algo está zerado/ausente que não deveria, **pare aqui**. Re-investigue
o blob escolhido — talvez seja necessário voltar pra um backup mais antigo.

## 6. Restaurar policies RLS

`pg_restore` recria as tabelas mas **NÃO** recria as RLS policies do nosso
módulo (elas vivem em migrations específicas — ver `AGENTS.md`).

```bash
# Aponta o script pra branch de teste:
DATABASE_URL="$RESTORE_DB_URL" npx tsx src/lib/db/restore-rls-policies.ts
```

Validar que ficou:

```sql
SELECT schemaname, tablename, policyname
FROM pg_policies
WHERE tablename LIKE 'confeccao_%'
ORDER BY tablename, policyname;
```

## 7. Decisão: promover branch ou aplicar em prod?

**Opção A — Promover a branch (recomendado)**

Se a branch já tem todos os dados certos:

1. Console do Neon → branch → "Promote to primary"
2. Atualizar `DATABASE_URL` no Vercel pra apontar pra branch promovida
   (ela vira o novo `main` do Neon)
3. A branch antiga (com o estado quebrado) fica disponível pra forense

Vantagem: zero downtime, rollback fácil (basta despromover).

**Opção B — Restaurar direto em prod (último recurso)**

Só fazer se a Opção A não for viável (ex: branch atingiu limite de
storage do free tier):

1. Comunicar a equipe — vai ter janela de indisponibilidade
2. Pausar o app no Vercel (ou colocar manutenção)
3. `pg_restore --clean --if-exists --no-owner --no-acl --dbname $PROD_DB_URL /tmp/restore.dump`
4. Rodar `restore-rls-policies.ts` apontado pra prod
5. Validar com o mesmo checklist do passo 5
6. Reativar o app

## 8. Pós-restore

- Postar no canal de comunicação o que foi restaurado, quando e por quê
- Abrir RITM/issue documentando o incidente (causa raiz, blast radius,
  mitigação)
- Deletar a branch antiga **somente após 1 semana** — pode ser útil pra
  forense

## Apêndice — Erros comuns

| Sintoma | Causa provável | Mitigação |
|---------|----------------|-----------|
| `pg_restore: error: input file appears to be a text format dump` | Dump corrompido ou era `--format=plain` | Verificar `file` no dump; re-baixar |
| `permission denied for schema public` | Role da branch sem grant | `GRANT ALL ON SCHEMA public TO <role>;` |
| Contagens menores que o esperado | Backup mais antigo do que se pensava | Listar blobs ordenados por data, escolher mais novo |
| Erros de RLS após restore | `restore-rls-policies.ts` não foi rodado | Rodar passo 6 |
| App não conecta após promote | `DATABASE_URL` no Vercel não foi atualizado | Atualizar e redeployar |
