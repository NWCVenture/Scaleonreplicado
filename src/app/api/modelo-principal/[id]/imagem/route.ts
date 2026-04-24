import { NextRequest, NextResponse } from "next/server";
import { modeloPrincipal } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { withContaAtiva } from "@/lib/tenancy";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return msg.includes("conta ativa") || msg.includes("Sessão");
}

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg"]);
const MAX_BYTES = 2 * 1024 * 1024; // 2MB — suficiente para o ícone da etiqueta

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof Blob)) {
      return NextResponse.json(
        { error: "Arquivo ausente" },
        { status: 400 },
      );
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: "Formato inválido. Use PNG ou JPEG." },
        { status: 400 },
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "Arquivo maior que 2MB" },
        { status: 400 },
      );
    }

    const updated = await withContaAtiva(async (tx, contaId) => {
      const [modelo] = await tx
        .select()
        .from(modeloPrincipal)
        .where(
          and(eq(modeloPrincipal.id, id), eq(modeloPrincipal.contaId, contaId)),
        );
      if (!modelo) return null;

      // Se já existir imagem, remove a antiga
      if (modelo.etiquetaImagemUrl) {
        try {
          const { del } = await import("@vercel/blob");
          await del(modelo.etiquetaImagemUrl);
        } catch {
          // best-effort
        }
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const ext = file.type === "image/png" ? "png" : "jpg";
      const { put } = await import("@vercel/blob");
      const blob = await put(
        `modelo-principal/${contaId}/${id}/etiqueta.${ext}`,
        buffer,
        { access: "public", allowOverwrite: true },
      );

      const [row] = await tx
        .update(modeloPrincipal)
        .set({
          etiquetaImagemUrl: blob.url,
          etiquetaImagemAtualizadaEm: new Date(),
        })
        .where(eq(modeloPrincipal.id, id))
        .returning();
      return row;
    });

    if (!updated) {
      return NextResponse.json(
        { error: "Modelo não encontrado" },
        { status: 404 },
      );
    }
    return NextResponse.json(updated);
  } catch (error) {
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    console.error("Erro ao subir imagem:", error);
    const msg = error instanceof Error ? error.message : "Erro ao subir imagem";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;

    const updated = await withContaAtiva(async (tx, contaId) => {
      const [modelo] = await tx
        .select()
        .from(modeloPrincipal)
        .where(
          and(eq(modeloPrincipal.id, id), eq(modeloPrincipal.contaId, contaId)),
        );
      if (!modelo) return null;

      if (modelo.etiquetaImagemUrl) {
        try {
          const { del } = await import("@vercel/blob");
          await del(modelo.etiquetaImagemUrl);
        } catch {
          // best-effort
        }
      }

      const [row] = await tx
        .update(modeloPrincipal)
        .set({
          etiquetaImagemUrl: null,
          etiquetaImagemAtualizadaEm: null,
        })
        .where(eq(modeloPrincipal.id, id))
        .returning();
      return row;
    });

    if (!updated) {
      return NextResponse.json(
        { error: "Modelo não encontrado" },
        { status: 404 },
      );
    }
    return NextResponse.json(updated);
  } catch (error) {
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    console.error("Erro ao remover imagem:", error);
    return NextResponse.json(
      { error: "Erro ao remover imagem" },
      { status: 500 },
    );
  }
}
