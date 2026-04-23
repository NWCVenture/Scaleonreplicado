import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { skuCatalogo, stockItem } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
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
        .update(skuCatalogo)
        .set({ ativo })
        .where(and(eq(skuCatalogo.id, id), eq(skuCatalogo.contaId, contaId)))
        .returning();
      return row;
    });

    if (!updated) {
      return NextResponse.json(
        { error: "SKU nao encontrado" },
        { status: 404 },
      );
    }
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating SKU:", error);
    const msg = error instanceof Error ? error.message : "Erro ao atualizar SKU";
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
    const result = await withContaAtiva(async (tx, contaId) => {
      const [sku] = await tx
        .select()
        .from(skuCatalogo)
        .where(and(eq(skuCatalogo.id, id), eq(skuCatalogo.contaId, contaId)));
      if (!sku) return { notFound: true as const };

      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(stockItem)
        .where(
          and(
            eq(stockItem.contaId, contaId),
            eq(stockItem.sku, sku.codigo),
          ),
        );

      // Soft delete (preserves history; SKU pode ser reativado)
      await tx
        .update(skuCatalogo)
        .set({ ativo: false })
        .where(and(eq(skuCatalogo.id, id), eq(skuCatalogo.contaId, contaId)));

      return { notFound: false as const, stockCount: count };
    });

    if (result.notFound) {
      return NextResponse.json(
        { error: "SKU nao encontrado" },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, stockItemsAffected: result.stockCount });
  } catch (error) {
    console.error("Error deleting SKU:", error);
    const msg = error instanceof Error ? error.message : "Erro ao excluir SKU";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
