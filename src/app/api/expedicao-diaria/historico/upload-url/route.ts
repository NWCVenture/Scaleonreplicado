import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// Emite token de upload pra o cliente subir o PDF direto pro Vercel Blob,
// contornando o limite de ~4,5MB do body das Functions. O registro no
// histórico (DB) é feito num segundo POST pra /historico com o blobUrl.
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
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ["application/pdf"],
        addRandomSuffix: false,
        maximumSizeInBytes: 100 * 1024 * 1024, // 100MB — folga pra grupos grandes
      }),
      // DB insert acontece no POST /historico subsequente, com session do user.
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
