# RITM-04 — Upload de anexos no Vercel Blob + endpoints

> **Bloqueia:** RITM-08, RITM-09, RITM-10, RITM-11, RITM-12, RITM-13 (qualquer subtask que aceita anexo)
> **Depende de:** RITM-02 (tabela `confeccao_anexo` precisa existir)
> **Dependência externa:** `BLOB_READ_WRITE_TOKEN` já configurado no projeto

---

## Objetivo

Implementar o fluxo de upload de anexos do módulo Confecção usando **Vercel Blob** (mesmo padrão usado em `expedicao-diaria/historico` e `modelo-principal/imagem`).

Componentes:

1. **Endpoint `POST /api/confeccao/uploads/token`** — emite token de upload via `handleUpload` (cliente→Blob direto, contorna limite de 4,5MB do Functions body)
2. **Endpoint `POST /api/confeccao/uploads/confirm`** — confirma upload e cria registro em `confeccao_anexo`
3. **Endpoint `DELETE /api/confeccao/anexos/[id]`** — remove do Blob + do banco
4. **Endpoint `GET /api/confeccao/anexos/[id]`** — retorna metadados + URL pra download (URL já é pública)
5. **Componente React `<UploadAnexo>`** reutilizável usando `@vercel/blob/client` `upload()`

> **Decisão:** seguir o padrão `access: "public"` igual aos outros módulos do projeto. URLs são longas e não-guessable; a proteção real está no DB (RLS por `conta_id` em `confeccao_anexo`). Listagem só via API autenticada que respeita RLS.

---

## Arquivos a criar

- `src/app/api/confeccao/uploads/token/route.ts`
- `src/app/api/confeccao/uploads/confirm/route.ts`
- `src/app/api/confeccao/anexos/[id]/route.ts` (GET e DELETE)
- `src/components/confeccao/upload-anexo.tsx`
- `src/lib/confeccao/schemas/anexo.ts` (Zod schemas)

> **Sem helper centralizado.** Seguir o padrão do projeto: importar `put`, `del`, `handleUpload` direto de `@vercel/blob` ou `@vercel/blob/client` no route handler.

---

## Configuração de ambiente

Nenhuma chave nova. O `BLOB_READ_WRITE_TOKEN` que já existe no `.env.local` (raiz do projeto) atende. Em produção, já está configurado no Vercel.

Referência pro time: pegar token novo em **Vercel Dashboard → Project → Storage → blob store → aba .env.local** (se algum dev novo for entrar no projeto).

---

## Referência do padrão existente

Olhar antes de implementar:

- **`src/app/api/expedicao-diaria/historico/upload-url/route.ts`** — padrão `handleUpload` (token + cliente direto)
- **`src/app/api/expedicao-diaria/historico/route.ts`** — confirm pattern (registro DB pós-upload)
- **`src/app/api/modelo-principal/[id]/imagem/route.ts`** — padrão `put()` + `del()` síncrono, com `withContaAtiva` (tenancy)

A confecção segue o **padrão `handleUpload`** porque anexos podem ter até 50MB (NF em PDF, fotos em alta).

---

## Endpoint `POST /api/confeccao/uploads/token`

Emite token pra cliente fazer `upload()` direto no Blob.

### Request (body padrão do `handleUpload`)

O cliente envia o body que o `@vercel/blob/client` `upload()` monta automaticamente — não precisamos definir formato custom; só validar no `onBeforeGenerateToken`.

### Implementação (esqueleto)

```ts
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withContaAtiva } from "@/lib/tenancy";
import { z } from "zod";

const ClientPayloadSchema = z.object({
  ordemProducaoId: z.string().optional(),
  subtaskId: z.string().optional(),
  lalamoveId: z.string().optional(),
  categoria: z.enum([
    "nf_compra", "risco_digital", "foto_papagaio",
    "foto_defeito", "comprovante_lalamove", "outros",
  ]),
  opNumero: z.string(),
  subtaskNumero: z.string().optional(),
}).refine(
  (d) => d.ordemProducaoId || d.subtaskId || d.lalamoveId,
  "Pelo menos uma FK obrigatória",
);

const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
];
const MAX_BYTES = 50 * 1024 * 1024; // 50MB

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const parsed = ClientPayloadSchema.parse(JSON.parse(clientPayload ?? "{}"));

        // Valida que as FKs pertencem à conta ativa (RLS protege, mas fail-fast aqui)
        await withContaAtiva(async (tx, contaId) => {
          if (parsed.ordemProducaoId) {
            const op = await tx.query.confeccaoOrdemProducao.findFirst({
              where: and(
                eq(confeccaoOrdemProducao.id, parsed.ordemProducaoId),
                eq(confeccaoOrdemProducao.contaId, contaId),
              ),
            });
            if (!op) throw new Error("OP não encontrada");
          }
          // mesma validação para subtaskId e lalamoveId
        });

        return {
          allowedContentTypes: ALLOWED_TYPES,
          maximumSizeInBytes: MAX_BYTES,
          addRandomSuffix: true, // evita colisão de pathname
          tokenPayload: JSON.stringify({
            ...parsed,
            usuarioId: session.user.id,
            contaId: session.session.contaAtivaId,
          }),
        };
      },
      // Não criamos confeccao_anexo aqui — o cliente faz POST /confirm
      // depois do upload bem-sucedido. Mantém a transação curta e o
      // padrão consistente com expedicao-diaria/historico.
      onUploadCompleted: async () => {},
    });

    return NextResponse.json(jsonResponse);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message ?? "Erro ao gerar token" },
      { status: 400 },
    );
  }
}
```

### Pathname

O cliente passa o `pathname` na chamada de `upload()`. Padrão:

```
confeccao/{contaId}/op-{opNumero}/subtask-{subtaskNumero}/{nomeArquivoComExt}
```

Ou (sem subtask, anexo direto da OP):

```
confeccao/{contaId}/op-{opNumero}/op-level/{nomeArquivoComExt}
```

O `addRandomSuffix: true` adiciona sufixo aleatório → pathname final fica único mesmo se subir 2 arquivos com mesmo nome.

---

## Endpoint `POST /api/confeccao/uploads/confirm`

Chamado **após** o `upload()` do cliente retornar com sucesso. Cria o registro em `confeccao_anexo`.

### Request

```json
{
  "ordemProducaoId": "abc123",
  "subtaskId": "def456",
  "lalamoveId": null,
  "categoria": "nf_compra",
  "nomeArquivo": "nf-123.pdf",
  "tipoMime": "application/pdf",
  "tamanhoBytes": 234567,
  "blobUrl": "https://<store>.public.blob.vercel-storage.com/confeccao/...",
  "blobPathname": "confeccao/nwc-root/op-OP05260001/subtask-OPBUY0001/nf-123-abc.pdf"
}
```

### Comportamento

```ts
import { head } from "@vercel/blob";

export async function POST(request: NextRequest) {
  // 1. Auth + tenancy
  // 2. Zod validation

  return await withContaAtiva(async (tx, contaId) => {
    // 3. Verificar que o objeto realmente existe no Blob (head)
    try {
      await head(input.blobUrl);
    } catch {
      throw new Error("Blob não encontrado");
    }

    // 4. Anti-replay: blob_url tem UNIQUE constraint; trap 409 limpo
    const existente = await tx.query.confeccaoAnexo.findFirst({
      where: eq(confeccaoAnexo.blobUrl, input.blobUrl),
    });
    if (existente) return NextResponse.json({ error: "Já registrado" }, { status: 409 });

    // 5. INSERT
    const [anexo] = await tx.insert(confeccaoAnexo).values({
      id: nanoid(),
      contaId,
      subtaskId: input.subtaskId,
      ordemProducaoId: input.ordemProducaoId,
      lalamoveId: input.lalamoveId,
      categoria: input.categoria,
      nomeArquivo: input.nomeArquivo,
      tipoMime: input.tipoMime,
      tamanhoBytes: input.tamanhoBytes,
      blobUrl: input.blobUrl,
      blobPathname: input.blobPathname,
      enviadoPorId: session.user.id,
    }).returning();

    // 6. Auditoria automática
    await tx.insert(confeccaoNota).values({
      id: nanoid(),
      contaId,
      subtaskId: input.subtaskId,
      ordemProducaoId: input.ordemProducaoId,
      autorId: null,
      conteudo: `Anexo '${input.nomeArquivo}' enviado por ${session.user.name}`,
      isAuditoria: true,
      isInterna: true,
      metadata: { anexoId: anexo.id, categoria: input.categoria },
    });

    return NextResponse.json({ anexo });
  });
}
```

---

## Endpoint `GET /api/confeccao/anexos/[id]`

Retorna metadados + `blobUrl`. URL é pública (sem expiração); proteção real é não conhecer a URL.

```ts
// Padrão simples: withContaAtiva, SELECT por id, retorna 404 se não pertencer à conta
return { anexo: { id, nomeArquivo, tipoMime, tamanhoBytes, blobUrl, categoria, enviadoPor, criadoEm } };
```

---

## Endpoint `DELETE /api/confeccao/anexos/[id]`

```ts
// 1. Auth + autorização: apenas admin
// 2. SELECT anexo (with RLS)
// 3. Validar que subtask/OP não está concluída — se concluída, exigir edição retroativa (fluxo da RITM-15)
// 4. del(anexo.blobUrl) — best-effort, segue mesmo se falhar
// 5. DELETE em confeccao_anexo
// 6. Nota de auditoria

import { del } from "@vercel/blob";

try { await del(anexo.blobUrl); } catch { /* best-effort */ }
```

Mesmo padrão de `modelo-principal/[id]/imagem` (DELETE).

---

## Componente `<UploadAnexo>`

`src/components/confeccao/upload-anexo.tsx`:

### Props

```ts
interface UploadAnexoProps {
  ordemProducaoId?: string;
  subtaskId?: string;
  lalamoveId?: string;
  opNumero: string;
  subtaskNumero?: string;
  categoria: AnexoCategoria;
  multiple?: boolean;
  accept?: string;  // ex: ".pdf,.jpg,.png"
  onUploaded?: (anexo: ConfeccaoAnexo) => void;
}
```

### Implementação (esqueleto)

```tsx
"use client";
import { upload } from "@vercel/blob/client";

export function UploadAnexo(props: UploadAnexoProps) {
  const handleFileSelect = async (file: File) => {
    // Pathname: confeccao/{contaId}/op-{opNumero}/subtask-{subtaskNumero}/{nome}
    const pathname = props.subtaskNumero
      ? `confeccao/${contaAtiva.id}/op-${props.opNumero}/subtask-${props.subtaskNumero}/${file.name}`
      : `confeccao/${contaAtiva.id}/op-${props.opNumero}/op-level/${file.name}`;

    // 1. Upload direto cliente → Blob via token
    const blob = await upload(pathname, file, {
      access: "public",
      handleUploadUrl: "/api/confeccao/uploads/token",
      clientPayload: JSON.stringify({
        ordemProducaoId: props.ordemProducaoId,
        subtaskId: props.subtaskId,
        lalamoveId: props.lalamoveId,
        categoria: props.categoria,
        opNumero: props.opNumero,
        subtaskNumero: props.subtaskNumero,
      }),
      onUploadProgress: (e) => {
        // atualizar progress bar
      },
    });

    // 2. Confirm — cria confeccao_anexo no DB
    const res = await fetch("/api/confeccao/uploads/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ordemProducaoId: props.ordemProducaoId,
        subtaskId: props.subtaskId,
        lalamoveId: props.lalamoveId,
        categoria: props.categoria,
        nomeArquivo: file.name,
        tipoMime: file.type,
        tamanhoBytes: file.size,
        blobUrl: blob.url,
        blobPathname: blob.pathname,
      }),
    });
    const { anexo } = await res.json();
    props.onUploaded?.(anexo);
  };

  // ... UI: dropzone, progress, lista de já-enviados, botão remover
}
```

### Visual

- Drag-drop + click to browse
- Progress bar real (do `onUploadProgress`)
- Cancelamento durante upload
- Lista embaixo de anexos já enviados com "Visualizar" (abre `blobUrl` em nova aba) e "Remover" (admin only)
- Validação client-side: tipo + tamanho (defesa em profundidade)

Seguir padrão visual do projeto (Tailwind, shadcn se for o caso).

---

## Testes obrigatórios

### Backend

`src/app/api/confeccao/uploads/__tests__/token.test.ts`:

1. ✅ POST sem auth → 401
2. ✅ POST com FK de outra conta → erro no `onBeforeGenerateToken` (fail-fast via tenancy check)
3. ✅ Token gerado tem `allowedContentTypes` e `maximumSizeInBytes` corretos
4. ✅ MIME fora da allowlist → cliente recebe erro do Blob

`src/app/api/confeccao/uploads/__tests__/confirm.test.ts`:

5. ✅ Confirm sem blob real (head 404) → 400
6. ✅ Confirm duplicado (mesma `blob_url`) → 409
7. ✅ Confirm válido → cria `confeccao_anexo` + `confeccao_nota` de auditoria
8. ✅ RLS: confirm com FKs de outra conta → bloqueado

`src/app/api/confeccao/anexos/__tests__/route.test.ts`:

9. ✅ GET anexo de outra conta → 404
10. ✅ DELETE como `funcionario` → 403
11. ✅ DELETE como admin → remove do Blob + banco + cria nota
12. ✅ DELETE em anexo de subtask **concluída** → 400 (precisa fluxo de edição retroativa)

### E2E manual

- [ ] Subir PDF de NF (5MB) → confirma e aparece em `confeccao_anexo` + objeto visível no Blob store
- [ ] Subir arquivo .exe → bloqueado client + backend
- [ ] Subir arquivo 60MB → bloqueado
- [ ] Visualizar anexo → abre no browser
- [ ] Remover anexo como admin → some do Blob e do banco
- [ ] Tentar remover anexo de subtask concluída → bloqueado com mensagem clara

---

## Critérios de aceitação

- [ ] 3 endpoints implementados (`token`, `confirm`, `anexos/[id]`) com Zod + auth + tenancy
- [ ] Padrão do projeto seguido: `@vercel/blob/client` + `withContaAtiva`, sem helper custom
- [ ] Componente `<UploadAnexo>` funcional com progress, cancelamento, validação client
- [ ] Todos os 12 testes passam
- [ ] Validação manual end-to-end conforme checklist
- [ ] `blob_url` único no banco (constraint UNIQUE) → previne dupla confirmação silenciosa
- [ ] Auditoria automática em `confeccao_nota` em cada upload/delete

---

## Pontos críticos

- ❌ **NÃO** subir arquivo direto via `put()` síncrono — cliente→Blob direto via `handleUpload` é obrigatório por causa do limite de 4,5MB do Functions body.
- ❌ **NÃO** chamar `confirm` antes do `upload()` cliente retornar com sucesso. Sem o blob real existir, `head()` falha → 400.
- ❌ **NÃO** confiar só na validação client-side de tamanho/MIME — `onBeforeGenerateToken` valida no server e o Blob também valida via `allowedContentTypes` e `maximumSizeInBytes`.
- ⚠️ **`access: "public"` é decisão consciente** — URLs são longas e não-guessable; isolamento real fica no DB via RLS. Quem listar via API só vê os da conta atual. Documentar isso nas notas técnicas pra futuro auditor.
- ⚠️ DELETE no Blob é **best-effort** — se falhar, ainda removemos do DB e logamos. O Blob fica como orphan; cron periódico de limpeza pode ser adicionado se for um problema.
- ⚠️ **Anexo de subtask concluída só pode ser removido via fluxo de edição retroativa** (RITM-15 implementa). Por ora, bloquear no DELETE com 400 + mensagem clara.

---

## Dúvidas a confirmar

- O projeto tem helper de progress bar reutilizável (visto em `<UploadAnexo>` do modelo-principal ou expedicao-diaria)? Se sim, reusar.
- Padrão de toast/notificação de upload concluído (Sonner? outro?) — usar o mesmo.
- Existe componente "preview de arquivo" (ícone por tipo, miniatura pra imagem) já no projeto? Reusar.
