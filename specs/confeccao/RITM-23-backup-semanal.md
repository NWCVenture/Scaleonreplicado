# RITM-23 — Backup semanal do banco

Implementa **backup automatizado semanal** do Neon (prod) pra Vercel Blob,
conforme arquitetura §17.2. Garante retenção mínima de 4 backups semanais +
12 mensais, suficiente pra recuperação completa caso o PITR de 6h do Neon
free tier não cubra um incidente.

> ⚠️ **Decisão de storage:** a arquitetura original (§17.2) menciona Cloudflare
> R2, mas o projeto consolidou em **Vercel Blob** (RITM-04, README de
> `specs/confeccao/`). Mantemos o padrão e usamos `BLOB_READ_WRITE_TOKEN`
> que já está no projeto.

> ⚠️ **Decisão de execução:** Vercel Functions **não tem `pg_dump`** no
> runtime. O cron precisa rodar onde existe binário PostgreSQL. Decisão
> nesta RITM: **GitHub Actions** (free tier mais que suficiente, binário
> `postgresql-client` apt disponível, secrets já gerenciados pelo repo).
> Vercel Sandbox é alternativa válida (GA em jan/2026) — fica anotada na
> seção "Fora de escopo" pra reabrir se a operação preferir tudo no
> Vercel depois.

## Escopo

| Quando | O quê | Onde |
|--------|-------|------|
| Domingo 06:00 UTC (03:00 BRT) | `pg_dump --format=custom` do Neon prod | GitHub Actions runner |
| Após cada dump | Upload comprimido pra Vercel Blob (pasta `backups/confeccao/`) | Vercel Blob via REST API |
| Após cada upload | Aplicar política de retenção | Vercel Blob delete API |

**Retenção:**

- Últimos **4 dumps semanais** (mês corrente)
- Último dump de cada mês dos **12 meses anteriores**
- Demais dumps deletados

> Política implementada em código, não em metadata do Blob (Blob não tem
> lifecycle nativo). Cada execução do workflow lista os blobs sob
> `backups/confeccao/`, classifica, e remove os que não se encaixam em
> nenhuma janela.

## Estrutura

### Workflow GitHub Actions

`.github/workflows/backup-confeccao.yml` (criação nova):

```yaml
name: Backup semanal Confecção

on:
  schedule:
    # Domingo 06:00 UTC = 03:00 BRT
    - cron: "0 6 * * 0"
  workflow_dispatch:  # permite disparar manualmente pela UI do GitHub

jobs:
  backup:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4

      - name: Instalar postgresql-client-17
        run: |
          sudo sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
          curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo apt-key add -
          sudo apt-get update
          sudo apt-get install -y postgresql-client-17

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: "24"

      - name: Instalar dependências
        run: npm ci

      - name: Executar backup
        env:
          DATABASE_URL: ${{ secrets.NEON_DATABASE_URL_PROD }}
          BLOB_READ_WRITE_TOKEN: ${{ secrets.BLOB_READ_WRITE_TOKEN }}
        run: npx tsx scripts/backup-confeccao.ts
```

> Versão do `postgresql-client` precisa bater com a major do Neon.
> Confirmar versão atual antes de mergear (`SELECT version()` em prod).

### Script de backup

`scripts/backup-confeccao.ts` (criação nova):

```ts
import { execFileSync } from "node:child_process";
import { readFileSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { put, list, del } from "@vercel/blob";

// 1. Roda pg_dump --format=custom (binário, comprimido nativamente)
//    para arquivo temporário.
// 2. Faz upload do arquivo pra Vercel Blob com nome estruturado:
//    backups/confeccao/<YYYY>/<YYYY-MM-DD>.dump
// 3. Aplica política de retenção (ver função aplicarRetencao abaixo).
// 4. Log estruturado: { dump_size_mb, upload_duration_ms, blobs_kept, blobs_deleted }
```

Função pura `classificarParaRetencao(blobs, agora)` testável em isolamento:

- Recebe array `Array<{ pathname: string; uploadedAt: Date }>`
- Retorna `{ manter: string[], remover: string[] }`
- Regra:
  - Manter os 4 mais recentes da janela "mês corrente" (≤ 35 dias)
  - Manter o mais recente de cada mês nos 12 meses anteriores
  - Demais entram em `remover`

> Por que função pura: facilita testar com fixtures sem precisar do Blob real.

### Endpoint de status (opcional pra UI futura)

`GET /api/confeccao/backup/status` em
`src/app/api/confeccao/backup/status/route.ts`:

- Lista os blobs sob `backups/confeccao/` via `@vercel/blob`
- Retorna `{ ultimoBackup: ISO, tamanhoMB, totalBackups, proximaExecucao }`
- Protegido por sessão admin (mesma proteção do dashboard)
- Útil pra colocar widget "Último backup: há N dias" no dashboard depois

> Não-bloqueante pra esta RITM. Implementar apenas se sobrar tempo.
> Critério de aceitação só exige o workflow + script.

### Variáveis e secrets

GitHub Actions secrets (UI do repo, Settings → Secrets):

```
NEON_DATABASE_URL_PROD=postgresql://...@<host>/<db>?sslmode=require
BLOB_READ_WRITE_TOKEN=<mesmo token usado pelo app>
```

> ⚠️ Usar uma **role do Neon dedicada a backup** (read-only no banco). O
> `pg_dump` precisa só de SELECT em todas as tabelas + acesso a metadados.
> Criar via console do Neon: `neon_backup_ro`. Nunca usar a role principal
> do app — em caso de leak do secret do GitHub Actions, blast radius fica
> contido a leitura.

### Restauração (procedimento documentado, não automatizado)

`docs/runbooks/restaurar-backup-confeccao.md` (criação nova):

Conteúdo:

1. Como baixar um blob específico (`@vercel/blob` `get()` ou via URL pública)
2. Comando de restore (`pg_restore --clean --no-owner --no-acl ...`)
3. Como testar em banco temporário do Neon (branch feature) antes de aplicar em prod
4. Checklist pós-restore: validar `restore-rls-policies.ts`, contar linhas críticas,
   conferir que o `last_lalamove_id` etc. não regrediu

> Restauração é **manual e auditada** — automação aumenta risco sem
> benefício pra um sistema com 1-5 OPs/dia. Mantém alguém na cadeia.

## Critérios de aceitação

1. Workflow `.github/workflows/backup-confeccao.yml` versionado e
   sintaticamente válido (`actionlint` ou render no GitHub UI).
2. Secrets `NEON_DATABASE_URL_PROD` e `BLOB_READ_WRITE_TOKEN` cadastrados
   no repo (verificável via `gh secret list`).
3. `workflow_dispatch` executado manualmente pelo menos 1× antes do merge:
   - Dump completa em < 5min
   - Blob aparece em `backups/confeccao/<ano>/<data>.dump`
   - Log do step "Executar backup" mostra `blobs_kept`/`blobs_deleted`
4. Função `classificarParaRetencao` tem testes unit cobrindo:
   - Fixture vazia → `{ manter: [], remover: [] }`
   - 5 backups semanais → mantém 4 mais recentes
   - 18 backups mensais → mantém 12 mais recentes
   - Mix semanal + mensal → mantém combinação correta
   - Backup do mesmo dia (re-run) → não duplica decisão
5. Runbook de restauração existe em `docs/runbooks/restaurar-backup-confeccao.md`.
6. Lint + typecheck limpos.
7. Role `neon_backup_ro` criada no Neon e usada no secret (sem credencial
   da role principal no GitHub).

## Fora de escopo

- **Restore automatizado** — manual via runbook. Reabrir se ficar
  recorrente, mas pra MVP é desperdício.
- **Backup incremental / WAL streaming** — Neon free tier já tem PITR de
  6h. Backup semanal cobre o gap pra além disso.
- **Migração pra Vercel Sandbox** — alternativa pro futuro caso a operação
  prefira concentrar tudo no Vercel. Spec separada se priorizado.
- **Widget "último backup" no Dashboard Geral (RITM-20)** — `GET /api/confeccao/backup/status`
  é só esqueleto. UI fica pra outra RITM se priorizado.
- **Alertas de falha do backup** — depende da política de notificações do
  GitHub Actions (email automático em falha já existe). Email pra
  destinatários custom é fora de escopo.
- **Backup de outros módulos** — esta RITM é especificamente do escopo
  Confecção. Backup global do banco já está coberto pelo PITR do Neon.
