// GET  /api/confeccao/fornecedores/[id]/precos — lista preços (fornecedor × tipo de tecido)
// POST /api/confeccao/fornecedores/[id]/precos — admin

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { generateId } from "@/lib/utils";
import { withContaAtiva, requireAdminAtivo } from "@/lib/tenancy";
import {
  confeccaoFornecedor,
  confeccaoFornecedorTecidoPreco,
  confeccaoTipoTecido,
} from "@/lib/db/schema";
import { CriarFornecedorTecidoPrecoSchema } from "@/lib/confeccao/schemas/cadastros";

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
    const items = await withContaAtiva(async (tx, contaId) => {
      // Confirma fornecedor existe na conta
      const [forn] = await tx
        .select({ id: confeccaoFornecedor.id })
        .from(confeccaoFornecedor)
        .where(
          and(
            eq(confeccaoFornecedor.id, id),
            eq(confeccaoFornecedor.contaId, contaId),
          ),
        );
      if (!forn) return null;

      return await tx
        .select({
          id: confeccaoFornecedorTecidoPreco.id,
          fornecedorId: confeccaoFornecedorTecidoPreco.fornecedorId,
          tipoTecidoId: confeccaoFornecedorTecidoPreco.tipoTecidoId,
          tipoTecidoNome: confeccaoTipoTecido.nome,
          precoKgSugerido: confeccaoFornecedorTecidoPreco.precoKgSugerido,
          createdAt: confeccaoFornecedorTecidoPreco.createdAt,
          updatedAt: confeccaoFornecedorTecidoPreco.updatedAt,
        })
        .from(confeccaoFornecedorTecidoPreco)
        .innerJoin(
          confeccaoTipoTecido,
          eq(
            confeccaoTipoTecido.id,
            confeccaoFornecedorTecidoPreco.tipoTecidoId,
          ),
        )
        .where(eq(confeccaoFornecedorTecidoPreco.fornecedorId, id));
    });

    if (items === null) {
      return NextResponse.json(
        { error: "Fornecedor não encontrado" },
        { status: 404 },
      );
    }
    return NextResponse.json({ items });
  } catch (err) {
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    return NextResponse.json({ error: "Erro ao listar preços" }, { status: 500 });
  }
}

export async function POST(
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
    const parsed = CriarFornecedorTecidoPrecoSchema.parse(
      await request.json(),
    );

    const result = await withContaAtiva(async (tx, contaId) => {
      // Valida que fornecedor e tipoTecido pertencem à conta
      const [forn] = await tx
        .select({ id: confeccaoFornecedor.id })
        .from(confeccaoFornecedor)
        .where(
          and(
            eq(confeccaoFornecedor.id, id),
            eq(confeccaoFornecedor.contaId, contaId),
          ),
        );
      if (!forn) return { notFoundFornecedor: true as const };

      const [tt] = await tx
        .select({ id: confeccaoTipoTecido.id })
        .from(confeccaoTipoTecido)
        .where(
          and(
            eq(confeccaoTipoTecido.id, parsed.tipoTecidoId),
            eq(confeccaoTipoTecido.contaId, contaId),
          ),
        );
      if (!tt) return { notFoundTipoTecido: true as const };

      const [row] = await tx
        .insert(confeccaoFornecedorTecidoPreco)
        .values({
          id: generateId(),
          contaId,
          fornecedorId: id,
          tipoTecidoId: parsed.tipoTecidoId,
          precoKgSugerido: parsed.precoKgSugerido,
        })
        .returning();
      return { ok: true as const, item: row };
    });

    if ("notFoundFornecedor" in result) {
      return NextResponse.json(
        { error: "Fornecedor não encontrado" },
        { status: 404 },
      );
    }
    if ("notFoundTipoTecido" in result) {
      return NextResponse.json(
        { error: "Tipo de tecido não encontrado" },
        { status: 404 },
      );
    }
    return NextResponse.json({ item: result.item }, { status: 201 });
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
        {
          error:
            "Já existe preço para este fornecedor + tipo de tecido (use PATCH)",
        },
        { status: 409 },
      );
    }
    console.error("Erro ao criar preço:", err);
    return NextResponse.json({ error: "Erro ao criar preço" }, { status: 500 });
  }
}
