// GET    /api/confeccao/cores/[id]
// PATCH  /api/confeccao/cores/[id] — admin
// DELETE /api/confeccao/cores/[id] — admin (soft default)

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withContaAtiva, requireAdminAtivo } from "@/lib/tenancy";
import { confeccaoCor } from "@/lib/db/schema";
import { AtualizarCorSchema } from "@/lib/confeccao/schemas/cadastros";

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
        .from(confeccaoCor)
        .where(and(eq(confeccaoCor.id, id), eq(confeccaoCor.contaId, contaId)));
      return rows[0] ?? null;
    });
    if (!item) {
      return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
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
    const parsed = AtualizarCorSchema.parse(await request.json());

    const updated = await withContaAtiva(async (tx, contaId) => {
      const [row] = await tx
        .update(confeccaoCor)
        .set({
          ...(parsed.nome !== undefined ? { nome: parsed.nome } : {}),
          ...(parsed.ativo !== undefined ? { ativo: parsed.ativo } : {}),
        })
        .where(and(eq(confeccaoCor.id, id), eq(confeccaoCor.contaId, contaId)))
        .returning();
      return row ?? null;
    });

    if (!updated) {
      return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
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
        { error: "Cor com este nome já existe" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "Erro ao atualizar cor" },
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
        const deleted = await tx
          .delete(confeccaoCor)
          .where(
            and(eq(confeccaoCor.id, id), eq(confeccaoCor.contaId, contaId)),
          )
          .returning();
        return { ok: deleted.length > 0, mode: "hard" as const };
      }
      const updated = await tx
        .update(confeccaoCor)
        .set({ ativo: false })
        .where(and(eq(confeccaoCor.id, id), eq(confeccaoCor.contaId, contaId)))
        .returning();
      return { ok: updated.length > 0, mode: "soft" as const };
    });

    if (!result.ok) {
      return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
    }
    return NextResponse.json({ deleted: true, mode: result.mode });
  } catch (err) {
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Erro ao deletar cor" },
      { status: 500 },
    );
  }
}
