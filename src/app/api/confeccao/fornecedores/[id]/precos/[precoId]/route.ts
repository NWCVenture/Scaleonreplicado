// PATCH  /api/confeccao/fornecedores/[id]/precos/[precoId] — admin
// DELETE /api/confeccao/fornecedores/[id]/precos/[precoId] — admin (hard, sem soft-delete)

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withContaAtiva, requireAdminAtivo } from "@/lib/tenancy";
import { confeccaoFornecedorTecidoPreco } from "@/lib/db/schema";
import { AtualizarFornecedorTecidoPrecoSchema } from "@/lib/confeccao/schemas/cadastros";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return (
    msg.includes("conta ativa") ||
    msg.includes("Sessão") ||
    msg.includes("Nenhuma")
  );
}

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string; precoId: string }> },
) {
  try {
    try {
      await requireAdminAtivo();
    } catch {
      return NextResponse.json(
        { error: "Acesso negado — requer admin" },
        { status: 403 },
      );
    }
    const { id: fornecedorId, precoId } = await ctx.params;
    const parsed = AtualizarFornecedorTecidoPrecoSchema.parse(
      await request.json(),
    );

    const updated = await withContaAtiva(async (tx, contaId) => {
      const [row] = await tx
        .update(confeccaoFornecedorTecidoPreco)
        .set({
          precoKgSugerido: parsed.precoKgSugerido,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(confeccaoFornecedorTecidoPreco.id, precoId),
            eq(confeccaoFornecedorTecidoPreco.fornecedorId, fornecedorId),
            eq(confeccaoFornecedorTecidoPreco.contaId, contaId),
          ),
        )
        .returning();
      return row ?? null;
    });

    if (!updated) {
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    }
    return NextResponse.json({ item: updated });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Dados inválidos", details: err.issues },
        { status: 400 },
      );
    }
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Erro ao atualizar preço" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string; precoId: string }> },
) {
  try {
    try {
      await requireAdminAtivo();
    } catch {
      return NextResponse.json(
        { error: "Acesso negado — requer admin" },
        { status: 403 },
      );
    }
    const { id: fornecedorId, precoId } = await ctx.params;

    const result = await withContaAtiva(async (tx, contaId) => {
      const deleted = await tx
        .delete(confeccaoFornecedorTecidoPreco)
        .where(
          and(
            eq(confeccaoFornecedorTecidoPreco.id, precoId),
            eq(confeccaoFornecedorTecidoPreco.fornecedorId, fornecedorId),
            eq(confeccaoFornecedorTecidoPreco.contaId, contaId),
          ),
        )
        .returning();
      return deleted.length > 0;
    });

    if (!result) {
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    }
    return NextResponse.json({ deleted: true });
  } catch (err) {
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Erro ao deletar preço" },
      { status: 500 },
    );
  }
}
