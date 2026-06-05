// POST /api/central-envios/ingestao/tiktok
//
// Recebe upload de CSV TikTok (multipart/form-data, campo "arquivo"),
// sobe pro Vercel Blob, cria registro em ingestao_run (status='pendente')
// e dispara evento Inngest pra processamento assíncrono.
//
// Retorna { runId, status: 'pendente' } em < 1s. O cliente faz polling em
// GET /api/central-envios/ingestao/[runId] pra acompanhar o progresso.
//
// Tenancy: withContaAtiva. Sem conta ativa → 403.

import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { withContaAtiva } from "@/lib/tenancy";
import { ingestaoRun } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";
import { inngest } from "@/inngest/client";
import { EVENTO_PARSEAR_TIKTOK } from "@/inngest/functions/central-envios/parsear-tiktok";
import { MAX_INPUT_BYTES } from "@/lib/central-envios/ingestao/parser-tiktok-csv";
import { auth } from "@/lib/auth";

const FormSchema = z.object({
  arquivo: z
    .instanceof(File, { message: "Campo 'arquivo' ausente ou inválido" })
    .refine((f) => f.size > 0, "Arquivo vazio")
    .refine(
      (f) => f.size <= MAX_INPUT_BYTES,
      `Arquivo excede ${MAX_INPUT_BYTES / (1024 * 1024)}MB`,
    ),
});

export async function POST(request: NextRequest) {
  // Sessão (precisamos do userId pra ingestao_run.usuario_id)
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }
  const usuarioId = session.user.id;

  // Pré-checks de infra
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "Storage indisponível: BLOB_READ_WRITE_TOKEN ausente" },
      { status: 503 },
    );
  }
  if (process.env.NODE_ENV === "production" && !process.env.INNGEST_EVENT_KEY) {
    return NextResponse.json(
      { error: "Worker indisponível: INNGEST_EVENT_KEY ausente" },
      { status: 503 },
    );
  }

  // Form data
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Body inválido (esperado multipart/form-data)" },
      { status: 400 },
    );
  }
  const parsed = FormSchema.safeParse({ arquivo: formData.get("arquivo") });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Form data inválido" },
      { status: 400 },
    );
  }
  const arquivo = parsed.data.arquivo;

  try {
    return await withContaAtiva(async (tx, contaId) => {
      const runId = generateId();

      // Upload pro Blob. Usar `runId` como prefixo evita colisão entre
      // uploads simultâneos.
      const blob = await put(
        `central-envios/ingestao/tiktok/${runId}-${arquivo.name}`,
        arquivo,
        {
          access: "public",
          addRandomSuffix: false,
          contentType: arquivo.type || "text/csv",
        },
      );

      // Insere o run em status='pendente'
      await tx.insert(ingestaoRun).values({
        id: runId,
        contaId,
        usuarioId,
        tipo: "tiktok_csv",
        arquivoNome: arquivo.name,
        arquivoBlobUrl: blob.url,
        arquivoTamanhoBytes: arquivo.size,
        arquivoContentType: arquivo.type || null,
      });

      // Dispara o evento (não usar await dentro da transação seria ideal,
      // mas inngest.send tem timeout próprio e a transação fecha rápido).
      const ev = await inngest.send({
        name: EVENTO_PARSEAR_TIKTOK,
        data: { runId, contaId, blobUrl: blob.url },
      });
      const eventId = ev.ids?.[0] ?? null;
      if (eventId) {
        await tx
          .update(ingestaoRun)
          .set({ inngestEventId: eventId })
          .where(eq(ingestaoRun.id, runId));
      }

      return NextResponse.json(
        { runId, status: "pendente" as const },
        { status: 202 },
      );
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "Nenhuma conta ativa selecionada.") {
      return NextResponse.json({ error: msg }, { status: 403 });
    }
    console.error("[ingestao/tiktok] erro:", err);
    return NextResponse.json(
      { error: "Falha ao processar upload" },
      { status: 500 },
    );
  }
}
