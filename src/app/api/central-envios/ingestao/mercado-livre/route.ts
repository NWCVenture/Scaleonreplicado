// POST /api/central-envios/ingestao/mercado-livre
//
// Recebe upload de XLSX do Mercado Livre (multipart/form-data, campo
// "arquivo"), sobe pro Vercel Blob, cria registro em ingestao_run
// (status='pendente') e dispara evento Inngest pra processamento
// assíncrono.
//
// Mesma estrutura do route TikTok — única diferença é o tipo e o evento
// disparado. Polling fica no GET /ingestao/[runId] genérico.

import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { withContaAtiva } from "@/lib/tenancy";
import { ingestaoRun } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";
import { inngest } from "@/inngest/client";
import { EVENTO_PARSEAR_ML } from "@/inngest/functions/central-envios/parsear-ml";
import { MAX_INPUT_BYTES } from "@/lib/central-envios/ingestao/parser-ml-xlsx";
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
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }
  const usuarioId = session.user.id;

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

  // Aviso suave de extensão — não bloqueante (ML pode mudar default).
  const ext = arquivo.name.toLowerCase().split(".").pop();
  const extOk = ext === "xlsx" || ext === "xls";

  try {
    return await withContaAtiva(async (tx, contaId) => {
      const runId = generateId();

      const blob = await put(
        `central-envios/ingestao/mercado-livre/${runId}-${arquivo.name}`,
        arquivo,
        {
          access: "public",
          addRandomSuffix: false,
          contentType:
            arquivo.type ||
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      );

      await tx.insert(ingestaoRun).values({
        id: runId,
        contaId,
        usuarioId,
        tipo: "ml_xlsx",
        arquivoNome: arquivo.name,
        arquivoBlobUrl: blob.url,
        arquivoTamanhoBytes: arquivo.size,
        arquivoContentType: arquivo.type || null,
      });

      const ev = await inngest.send({
        name: EVENTO_PARSEAR_ML,
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
        {
          runId,
          status: "pendente" as const,
          // Sinaliza extensão inesperada — frontend pode mostrar warning.
          warnings: extOk ? [] : [`Extensão inesperada: .${ext} (esperado xlsx/xls)`],
        },
        { status: 202 },
      );
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "Nenhuma conta ativa selecionada.") {
      return NextResponse.json({ error: msg }, { status: 403 });
    }
    console.error("[ingestao/mercado-livre] erro:", err);
    return NextResponse.json(
      { error: "Falha ao processar upload" },
      { status: 500 },
    );
  }
}
