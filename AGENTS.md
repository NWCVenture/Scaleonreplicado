<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Database

## Ambientes

| Ambiente | Host | Porta | Env file |
|----------|------|-------|----------|
| Local (Docker) | `localhost` | `5433` | `.env.local` |
| Produção (Neon) | AWS `sa-east-1` | 5432 | `.env.prod` |

## Workflow de Migrations — SEMPRE local antes de prod

1. Edite o schema em `src/lib/db/schema.ts`
2. `npm run db:generate:dev` — gera o arquivo de migration usando `.env.local`
3. `npm run db:migrate:dev` — aplica a migration no Docker local
4. Teste a feature end-to-end contra o banco local
5. `npm run db:migrate:prod` — aplica no Neon (prod) **somente após validação local**

> **Atenção:** `db:migrate:dev` usa `drizzle-kit migrate` (migrations versionadas).
> `db:migrate:prod` usa `drizzle-kit push` (sync direto do schema no Neon).
> Nunca execute push em prod sem ter passado pelo passo local primeiro.

## Scripts disponíveis

| Script | Descrição |
|--------|-----------|
| `db:generate:dev` | Gera arquivo de migration (`.env.local`) |
| `db:generate:prod` | Gera arquivo de migration (`.env.prod`) |
| `db:migrate:dev` | Aplica migrations no Docker local |
| `db:migrate:prod` | Push do schema para o Neon (prod) |
| `db:studio:dev` | Abre Drizzle Studio contra o banco local |
| `db:studio:prod` | Abre Drizzle Studio contra o banco prod |
| `db:seed:dev` | Seed de dados padrão no banco local |
| `db:seed:prod` | Seed de dados padrão no banco prod |
