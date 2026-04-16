# Guia de Desenvolvimento — NWC ERP

## Pre-requisitos

- **Node.js** >= 20 (recomendado 20 LTS ou 22 LTS)
- **npm** >= 10 (ou pnpm / yarn compativeis)
- **Docker** + **Docker Compose** (para PostgreSQL local via `docker-compose.yml`)
- **Git**

Banco em producao e Neon (PostgreSQL serverless). Em dev usamos Postgres 16 no Docker.

## Setup local

```bash
# 1. Clonar
git clone <repo-url> nwc-erp
cd nwc-erp

# 2. Instalar dependencias
npm install

# 3. Subir o banco local
npm run docker:up

# 4. Configurar env
cp .env.example .env.local
# editar .env.local: gerar BETTER_AUTH_SECRET, preencher DATABASE_URL se necessario

# 5. Sincronizar schema com o banco
npm run db:push

# 6. Popular usuarios demo
npm run db:seed

# 7. Rodar
npm run dev
# abre em http://localhost:3009
```

Gerar `BETTER_AUTH_SECRET` (exemplo): `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

## Variaveis de ambiente

Arquivo de referencia: `.env.example`.

| Variavel | Obrigatoria | Descricao |
|---|---|---|
| `DATABASE_URL` | sim | String de conexao Postgres. Local: `postgresql://postgres:postgres@localhost:5432/crm_nwc`. Producao (Neon) exige `?sslmode=require` — `src/lib/db/index.ts` ativa SSL quando `NODE_ENV=production` |
| `BETTER_AUTH_SECRET` | sim | Segredo (>= 32 chars) usado pelo Better-Auth para assinar sessoes |
| `BETTER_AUTH_URL` | sim | URL base da app (dev: `http://localhost:3009`; prod: dominio real). Usado em callbacks do Better-Auth |
| `RESEND_API_KEY` | nao | Chave da Resend. Sem ela, `POST /api/coletas/email` apenas simula o envio |
| `RESEND_FROM_EMAIL` | condicional | Remetente (ex.: `estoque@dominio.com`) — obrigatorio se `RESEND_API_KEY` estiver setado |
| `RESEND_TO_EMAILS` | condicional | Destinatarios padrao separados por virgula |
| `NEXT_PUBLIC_APP_NAME` | nao | Default `NWC ERP`. Exposto no client |

Vercel Blob usa `BLOB_READ_WRITE_TOKEN` apenas em producao (configurado automaticamente no deploy Vercel). Nao precisa em dev — uploads sao aceitos mas podem falhar se o token nao existir.

## Scripts npm

| Comando | Descricao |
|---|---|
| `npm run dev` | Dev server Turbopack na porta 3009 |
| `npm run build` | Build de producao (Next.js) |
| `npm run start` | Serve build de producao |
| `npm run lint` | ESLint 9 |
| `npm run check` | TypeScript strict (`tsc --noEmit`) — rodar depois de qualquer mudanca |
| `npm run format` | Prettier em todo o repo |
| `npm run db:push` | Sync do `schema.ts` com o banco (sem migrations versionadas) |
| `npm run db:studio` | Drizzle Studio (UI do banco em `localhost:4983`) |
| `npm run db:seed` | Popula usuarios demo via `src/lib/db/seed.ts` |
| `npm run db:generate` | Gera migrations (nao usado — preferir `db:push`) |
| `npm run db:migrate` | Aplica migrations (nao usado) |
| `npm run docker:up` | Sobe Postgres local (detached) |
| `npm run docker:down` | Derruba containers |

## Como adicionar uma nova pagina

1. Criar `src/app/(dashboard)/<nome-da-rota>/page.tsx`
2. Iniciar com `"use client"` na primeira linha
3. Importar `useSession` de `@/lib/auth-client` (a sessao ja e validada pelo `layout.tsx`, mas e util para exibir nome/role)
4. Usar `PageHeader` de `@/components/layout/page-header`
5. Estado com `useState` e efeitos com `useEffect`
6. Feedback via `toast` de `sonner`
7. Adicionar entrada em `expedicaoItems` ou `outrosItems` de `src/app/(dashboard)/layout.tsx` (com `href`, `label`, `icon` lucide)
8. Se restrito, incluir o href em `restrictedPages`

Exemplo minimo:

```tsx
"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { toast } from "sonner";

type Item = { id: string; nome: string };

export default function MinhaPage() {
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    fetch("/api/minha-rota")
      .then((r) => r.json())
      .then((d) => setItems(d.items))
      .catch(() => toast.error("Erro ao carregar"));
  }, []);

  return (
    <>
      <PageHeader title="Minha pagina" description="Descricao curta" />
      {/* ... */}
    </>
  );
}
```

## Como adicionar uma nova API route

1. Criar `src/app/api/<dominio>/<recurso>/route.ts`
2. Importar `auth` de `@/lib/auth`, `db` de `@/lib/db`, tabelas de `@/lib/db/schema`, `generateId` de `@/lib/utils`
3. Validar sessao com `auth.api.getSession({ headers: request.headers })`
4. Validar body com Zod
5. Executar query Drizzle (usar `db.transaction` em inserts multi-tabela)
6. Retornar JSON com status apropriado
7. Tratar `ZodError` separadamente (400) e erros gerais (500)

Next.js 16 — path params sao `Promise`:

```ts
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  // ...
}
```

Template:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { minhaTabela } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";

const bodySchema = z.object({
  nome: z.string().min(1).max(100),
});

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    const data = bodySchema.parse(await request.json());
    const id = generateId();
    await db.insert(minhaTabela).values({
      id,
      ...data,
      usuarioId: session.user.id,
      createdAt: new Date(),
    });

    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Dados invalidos", details: error.issues },
        { status: 400 }
      );
    }
    console.error(error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
```

## Como adicionar uma nova tabela

1. Abrir `src/lib/db/schema.ts`
2. Criar a tabela com `pgTable("nome", { ... })`
3. Se houver enum novo, adicionar com `pgEnum("nome", [...])`
4. Adicionar indexes com `.on(...)` ou no callback da tabela
5. Definir `relations(tabela, ({ one, many }) => ({ ... }))` quando fizer sentido
6. Rodar `npm run db:push` — aplica direto no banco (sem migrations versionadas)
7. Opcional: atualizar `src/lib/db/seed.ts` com dados demo

```ts
import { pgTable, text, integer, timestamp, index } from "drizzle-orm/pg-core";

export const minhaTabela = pgTable(
  "minha_tabela",
  {
    id: text("id").primaryKey(),
    nome: text("nome").notNull(),
    quantidade: integer("quantidade").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_minha_tabela_nome").on(t.nome)]
);
```

## Convencoes de codigo

### Imports

- Path alias `@/` aponta para `src/` (config em `tsconfig.json`)
- Nunca usar import relativo longo (`../../../`) quando `@/` resolve

### Error handling

- Em API routes: um unico `try { ... } catch (error) { ... }` com `ZodError` tratado antes do fallback
- Mensagens em portugues: `"Nao autorizado"`, `"Dados invalidos"`, `"Nao encontrado"`, `"Erro interno"`
- `console.error` no catch generico — logs aparecem em `vercel logs` em producao

### Autenticacao

- SEMPRE checar sessao na primeira linha do handler
- Usar `session.user.id` como `usuarioId` em inserts
- Nunca confiar em `userId` vindo do body

### Validacao

- Zod schema proximo ao handler (no topo do arquivo)
- Validar TUDO: body, query params, path params
- Prefer `.strict()` quando o shape for fechado

### Banco

- `schema.ts` e a unica fonte da verdade — nao rodar SQL cru
- Usar `eq`, `and`, `or`, `desc`, `asc` de `drizzle-orm`
- Transactions com `db.transaction(async (tx) => { ... })` quando houver inserts em mais de uma tabela relacionada
- NUNCA criar migrations manuais — `npm run db:push` propaga o schema

### UI

- Dark-only (Tailwind v4). Backgrounds `bg-background`, `bg-card`, `bg-muted`. NUNCA adicionar toggle de tema claro
- `cn()` de `@/lib/utils` para merge de classes condicionais
- Icones: `lucide-react`
- Toast: `toast` de `sonner`
- Dialogs: `@/components/ui/dialog` (shadcn)
- NAO criar componentes UI novos quando ja existe o equivalente em `@/components/ui/`

### Client-side

- Sem Server Actions, React Query, SWR, Zustand, Redux — apenas `useState` + `fetch()`
- `"use client"` no topo de toda pagina do dashboard
- `useSession` de `@/lib/auth-client` (nao do `@/lib/auth`)

## Testes

Nao ha suite de testes automatizados. Antes de considerar qualquer mudanca pronta:

1. `npm run check` — sem erros de tipo
2. `npm run build` — build completo sem warnings criticos
3. Teste manual da(s) pagina(s) afetada(s) em `http://localhost:3009` com um dos usuarios demo (ver `src/lib/db/seed.ts`)
4. Para features UI-heavy (coletas, estante-virtual, associar-etiquetas), testar caminho feliz + edge cases (scanner invalido, duplicata, campos vazios)

## Deploy

- **Front + API**: Vercel (reconhece Next.js 16 automaticamente). Conectar o repo e configurar as env vars listadas acima em **Project Settings > Environment Variables**
- **Banco**: Neon (PostgreSQL serverless). Copiar a `DATABASE_URL` com `?sslmode=require` para a env da Vercel
- **Blob**: Vercel Blob — criar store no projeto; Vercel injeta `BLOB_READ_WRITE_TOKEN` automaticamente
- **Email**: Resend — criar API key, configurar dominio de envio
- **Primeira publicacao**: apos primeiro deploy, rodar `npm run db:push` apontando `DATABASE_URL` para o Neon prod (local -> prod), depois `npm run db:seed` para criar os usuarios iniciais

Build da Vercel roda `npm run build`. Nao ha build step customizado.
