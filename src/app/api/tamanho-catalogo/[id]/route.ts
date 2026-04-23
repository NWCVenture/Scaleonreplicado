import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { tamanhoCatalogo } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withContaAtiva } from "@/lib/tenancy";

async function requireSession(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  return session;
}

const patchSchema = z.object({
  ativo: z.boolean().optional(),
  ordem: z.number().int().optional(),
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

  const updates: { ativo?: boolean; ordem?: number } = {};
  if (parsed.data.ativo !== undefined) updates.ativo = parsed.data.ativo;
  if (parsed.data.ordem !== undefined) updates.ordem = parsed.data.ordem;
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 });
  }

  try {
    const updated = await withContaAtiva(async (tx, contaId) => {
      const [row] = await tx
        .update(tamanhoCatalogo)
        .set(updates)
        .where(
          and(eq(tamanhoCatalogo.id, id), eq(tamanhoCatalogo.contaId, contaId)),
        )
        .returning();
      return row;
    });

    if (!updated) {
      return NextResponse.json(
        { error: "Tamanho nao encontrado" },
        { status: 404 },
      );
    }
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating tamanho:", error);
    const msg =
      error instanceof Error ? error.message : "Erro ao atualizar tamanho";
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
        .update(tamanhoCatalogo)
        .set({ ativo: false })
        .where(
          and(eq(tamanhoCatalogo.id, id), eq(tamanhoCatalogo.contaId, contaId)),
        )
        .returning();
      return row;
    });

    if (!updated) {
      return NextResponse.json(
        { error: "Tamanho nao encontrado" },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error deleting tamanho:", error);
    const msg =
      error instanceof Error ? error.message : "Erro ao excluir tamanho";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
