// GET / PATCH / DELETE /api/confeccao/templates-whatsapp/[id]

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdminAtivo, withContaAtiva } from "@/lib/tenancy";
import { confeccaoTemplateWhatsapp } from "@/lib/db/schema";
import { AtualizarTemplateWhatsappSchema } from "@/lib/confeccao/schemas/template-whatsapp";

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
      const [row] = await tx
        .select()
        .from(confeccaoTemplateWhatsapp)
        .where(
          and(
            eq(confeccaoTemplateWhatsapp.id, id),
            eq(confeccaoTemplateWhatsapp.contaId, contaId),
          ),
        );
      return row ?? null;
    });
    if (!item) {
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    }
    return NextResponse.json({ item });
  } catch (err) {
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    return NextResponse.json({ error: "Erro" }, { status: 500 });
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
    const parsed = AtualizarTemplateWhatsappSchema.parse(await request.json());

    const updated = await withContaAtiva(async (tx, contaId) => {
      const setObj: Record<string, unknown> = { updatedAt: new Date() };
      if (parsed.nome !== undefined) setObj.nome = parsed.nome;
      if (parsed.categoria !== undefined) setObj.categoria = parsed.categoria;
      if (parsed.corpo !== undefined) setObj.corpo = parsed.corpo;
      if (parsed.ativo !== undefined) setObj.ativo = parsed.ativo;

      const [row] = await tx
        .update(confeccaoTemplateWhatsapp)
        .set(setObj)
        .where(
          and(
            eq(confeccaoTemplateWhatsapp.id, id),
            eq(confeccaoTemplateWhatsapp.contaId, contaId),
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
        { error: "Template com este nome já existe" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "Erro ao atualizar template" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
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
    const result = await withContaAtiva(async (tx, contaId) => {
      // Soft delete: ativo=false (preserva histórico de auditoria)
      const upd = await tx
        .update(confeccaoTemplateWhatsapp)
        .set({ ativo: false, updatedAt: new Date() })
        .where(
          and(
            eq(confeccaoTemplateWhatsapp.id, id),
            eq(confeccaoTemplateWhatsapp.contaId, contaId),
          ),
        )
        .returning();
      return upd.length > 0;
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
      { error: "Erro ao deletar" },
      { status: 500 },
    );
  }
}
