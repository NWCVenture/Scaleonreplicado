// GET    /api/confeccao/tipos-tecido/[id]
// PATCH  /api/confeccao/tipos-tecido/[id] — admin
// DELETE /api/confeccao/tipos-tecido/[id] — admin (soft default)

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withContaAtiva, requireAdminAtivo } from "@/lib/tenancy";
import {
  confeccaoFornecedorTecidoPreco,
  confeccaoTipoTecido,
} from "@/lib/db/schema";
import { AtualizarTipoTecidoSchema } from "@/lib/confeccao/schemas/cadastros";

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
        .from(confeccaoTipoTecido)
        .where(
          and(
            eq(confeccaoTipoTecido.id, id),
            eq(confeccaoTipoTecido.contaId, contaId),
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
    const parsed = AtualizarTipoTecidoSchema.parse(await request.json());

    const updated = await withContaAtiva(async (tx, contaId) => {
      const [row] = await tx
        .update(confeccaoTipoTecido)
        .set({
          ...(parsed.nome !== undefined ? { nome: parsed.nome } : {}),
          ...(parsed.ativo !== undefined ? { ativo: parsed.ativo } : {}),
        })
        .where(
          and(
            eq(confeccaoTipoTecido.id, id),
            eq(confeccaoTipoTecido.contaId, contaId),
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
        { error: "Tipo de tecido com este nome já existe" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "Erro ao atualizar tipo de tecido" },
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
        // Bloqueia se há precos referenciando
        const [preco] = await tx
          .select({ id: confeccaoFornecedorTecidoPreco.id })
          .from(confeccaoFornecedorTecidoPreco)
          .where(eq(confeccaoFornecedorTecidoPreco.tipoTecidoId, id))
          .limit(1);
        if (preco) {
          return { blocked: true as const };
        }
        const deleted = await tx
          .delete(confeccaoTipoTecido)
          .where(
            and(
              eq(confeccaoTipoTecido.id, id),
              eq(confeccaoTipoTecido.contaId, contaId),
            ),
          )
          .returning();
        return { ok: deleted.length > 0, mode: "hard" as const };
      }
      const updated = await tx
        .update(confeccaoTipoTecido)
        .set({ ativo: false })
        .where(
          and(
            eq(confeccaoTipoTecido.id, id),
            eq(confeccaoTipoTecido.contaId, contaId),
          ),
        )
        .returning();
      return { ok: updated.length > 0, mode: "soft" as const };
    });

    if ("blocked" in result && result.blocked) {
      return NextResponse.json(
        {
          error:
            "Tipo de tecido referenciado em preços — desative em vez de deletar",
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
      { error: "Erro ao deletar tipo de tecido" },
      { status: 500 },
    );
  }
}
