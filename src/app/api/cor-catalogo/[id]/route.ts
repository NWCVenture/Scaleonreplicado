import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { corCatalogo } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withContaAtiva } from "@/lib/tenancy";

async function requireSession(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  return session;
}

const patchSchema = z.object({
  ativo: z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession(request);
  if (!session) {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 },
    );
  }

  const { ativo } = parsed.data;
  if (ativo === undefined) {
    return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 });
  }

  try {
    const updated = await withContaAtiva(async (tx, contaId) => {
      const [row] = await tx
        .update(corCatalogo)
        .set({ ativo })
        .where(and(eq(corCatalogo.id, id), eq(corCatalogo.contaId, contaId)))
        .returning();
      return row;
    });

    if (!updated) {
      return NextResponse.json(
        { error: "Cor nao encontrada" },
        { status: 404 },
      );
    }
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating cor:", error);
    const msg = error instanceof Error ? error.message : "Erro ao atualizar cor";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession(request);
  if (!session) {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const updated = await withContaAtiva(async (tx, contaId) => {
      const [row] = await tx
        .update(corCatalogo)
        .set({ ativo: false })
        .where(and(eq(corCatalogo.id, id), eq(corCatalogo.contaId, contaId)))
        .returning();
      return row;
    });

    if (!updated) {
      return NextResponse.json(
        { error: "Cor nao encontrada" },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error deleting cor:", error);
    const msg = error instanceof Error ? error.message : "Erro ao excluir cor";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
