// GET    /api/confeccao/produtos/[id]
// PATCH  /api/confeccao/produtos/[id] — admin
// DELETE /api/confeccao/produtos/[id] — admin (soft por default, ?hard=true)

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withContaAtiva, requireAdminAtivo } from "@/lib/tenancy";
import { confeccaoOrdemProducao, confeccaoProduto } from "@/lib/db/schema";
import { AtualizarProdutoSchema } from "@/lib/confeccao/schemas/cadastros";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return (
    msg.includes("conta ativa") ||
    msg.includes("Sessão") ||
    msg.includes("Nenhuma")
  );
}

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const item = await withContaAtiva(async (tx, contaId) => {
      const rows = await tx
        .select()
        .from(confeccaoProduto)
        .where(
          and(
            eq(confeccaoProduto.id, id),
            eq(confeccaoProduto.contaId, contaId),
          ),
        );
      return rows[0] ?? null;
    });
    if (!item) {
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    }
    return NextResponse.json({ item });
  } catch (err) {
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    return NextResponse.json({ error: "Erro ao buscar" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
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

    const { id } = await ctx.params;
    const parsed = AtualizarProdutoSchema.parse(await request.json());

    const updated = await withContaAtiva(async (tx, contaId) => {
      const [row] = await tx
        .update(confeccaoProduto)
        .set({
          ...(parsed.nome !== undefined ? { nome: parsed.nome } : {}),
          ...(parsed.descricao !== undefined
            ? { descricao: parsed.descricao ?? null }
            : {}),
          ...(parsed.ativo !== undefined ? { ativo: parsed.ativo } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(confeccaoProduto.id, id),
            eq(confeccaoProduto.contaId, contaId),
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
    const pgCode = (err as { code?: string }).code;
    if (pgCode === "23505") {
      return NextResponse.json(
        { error: "Produto com este nome já existe nesta conta" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "Erro ao atualizar produto" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
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
    const { id } = await ctx.params;
    const hard = request.nextUrl.searchParams.get("hard") === "true";

    const result = await withContaAtiva(async (tx, contaId) => {
      if (hard) {
        // Hard delete só se não houver OP referenciando esse produto
        const [op] = await tx
          .select({ id: confeccaoOrdemProducao.id })
          .from(confeccaoOrdemProducao)
          .where(eq(confeccaoOrdemProducao.produtoId, id))
          .limit(1);
        if (op) {
          return { blocked: true as const };
        }
        const deleted = await tx
          .delete(confeccaoProduto)
          .where(
            and(
              eq(confeccaoProduto.id, id),
              eq(confeccaoProduto.contaId, contaId),
            ),
          )
          .returning();
        return { ok: deleted.length > 0, mode: "hard" as const };
      }
      // Soft delete: ativo=false
      const updated = await tx
        .update(confeccaoProduto)
        .set({ ativo: false, updatedAt: new Date() })
        .where(
          and(
            eq(confeccaoProduto.id, id),
            eq(confeccaoProduto.contaId, contaId),
          ),
        )
        .returning();
      return { ok: updated.length > 0, mode: "soft" as const };
    });

    if ("blocked" in result && result.blocked) {
      return NextResponse.json(
        {
          error:
            "Produto referenciado em OP existente — desative em vez de deletar",
        },
        { status: 409 },
      );
    }
    if (!result.ok) {
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    }
    return NextResponse.json({ deleted: true, mode: result.mode });
  } catch (err) {
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Erro ao deletar produto" },
      { status: 500 },
    );
  }
}
