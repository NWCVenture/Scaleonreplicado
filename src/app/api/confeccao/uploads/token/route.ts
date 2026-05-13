// POST /api/confeccao/uploads/token
//
// Emite token de upload pro Vercel Blob (cliente sobe direto, contornando
// o limite de ~4.5MB do body de Functions). Padrão `handleUpload` —
// idêntico ao usado em /api/expedicao-diaria/historico/upload-url.
//
// Validação no `onBeforeGenerateToken`:
//   - clientPayload tem categoria + pelo menos uma FK
//   - cada FK passada (op/subtask/lalamove) pertence à conta ativa
//
// Não cria registro em `confeccao_anexo` aqui — o cliente chama
// POST /api/confeccao/uploads/confirm após o upload bem-sucedido.

import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { withConta } from "@/lib/tenancy";
import {
  confeccaoOrdemProducao,
  confeccaoSubtask,
  confeccaoLalamove,
} from "@/lib/db/schema";
import {
  ClientUploadPayloadSchema,
  ALLOWED_MIME_TYPES,
  MAX_UPLOAD_BYTES,
} from "@/lib/confeccao/schemas/anexo";

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }
  const contaId = (session.session as { contaAtivaId?: string | null })
    .contaAtivaId;
  if (!contaId) {
    return NextResponse.json(
      { error: "Conta ativa não definida" },
      { status: 403 },
    );
  }

  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        const parsed = ClientUploadPayloadSchema.parse(
          JSON.parse(clientPayload ?? "{}"),
        );

        // Valida que cada FK pertence à conta atual (RLS já protege,
        // mas fail-fast aqui retorna erro limpo em vez de 500 misterioso).
        await withConta(contaId, async (tx) => {
          if (parsed.ordemProducaoId) {
            const rows = await tx
              .select({ id: confeccaoOrdemProducao.id })
              .from(confeccaoOrdemProducao)
              .where(
                and(
                  eq(confeccaoOrdemProducao.id, parsed.ordemProducaoId),
                  eq(confeccaoOrdemProducao.contaId, contaId),
                ),
              );
            if (rows.length === 0) throw new Error("OP não encontrada");
          }
          if (parsed.subtaskId) {
            const rows = await tx
              .select({ id: confeccaoSubtask.id })
              .from(confeccaoSubtask)
              .where(
                and(
                  eq(confeccaoSubtask.id, parsed.subtaskId),
                  eq(confeccaoSubtask.contaId, contaId),
                ),
              );
            if (rows.length === 0) throw new Error("Subtask não encontrada");
          }
          if (parsed.lalamoveId) {
            const rows = await tx
              .select({ id: confeccaoLalamove.id })
              .from(confeccaoLalamove)
              .where(
                and(
                  eq(confeccaoLalamove.id, parsed.lalamoveId),
                  eq(confeccaoLalamove.contaId, contaId),
                ),
              );
            if (rows.length === 0) throw new Error("Lalamove não encontrado");
          }
        });

        return {
          allowedContentTypes: [...ALLOWED_MIME_TYPES],
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          // Evita colisão de pathname quando 2 arquivos têm mesmo nome
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({
            ...parsed,
            usuarioId: session.user.id,
            contaId,
          }),
        };
      },
      // Registro em confeccao_anexo é feito no POST /confirm subsequente
      // (padrão do projeto, ver expedicao-diaria/historico).
      onUploadCompleted: async () => {},
    });

    return NextResponse.json(jsonResponse);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message ?? "Erro ao gerar token de upload" },
      { status: 400 },
    );
  }
}
