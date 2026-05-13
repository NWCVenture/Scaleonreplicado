// GET  /api/confeccao/produtos — lista paginada com search e incluirInativos
// POST /api/confeccao/produtos — admin only

import { NextRequest, NextResponse } from "next/server";
import { and, asc, count, eq, ilike } from "drizzle-orm";
import { z } from "zod";
import { generateId } from "@/lib/utils";
import { withContaAtiva, requireAdminAtivo } from "@/lib/tenancy";
import { confeccaoProduto } from "@/lib/db/schema";
import {
  CriarProdutoSchema,
  PaginacaoSchema,
} from "@/lib/confeccao/schemas/cadastros";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return (
    msg.includes("conta ativa") ||
    msg.includes("Sessão") ||
    msg.includes("Nenhuma")
  );
}

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const { page, pageSize, search, incluirInativos } = PaginacaoSchema.parse({
      page: sp.get("page") ?? undefined,
      pageSize: sp.get("pageSize") ?? undefined,
      search: sp.get("search") ?? undefined,
      incluirInativos: sp.get("incluirInativos") ?? undefined,
    });

    const result = await withContaAtiva(async (tx, contaId) => {
      const conditions = [eq(confeccaoProduto.contaId, contaId)];
      if (search) conditions.push(ilike(confeccaoProduto.nome, `%${search}%`));
      if (!incluirInativos)
        conditions.push(eq(confeccaoProduto.ativo, true));

      const where = and(...conditions);

      const items = await tx
        .select()
        .from(confeccaoProduto)
        .where(where)
        .orderBy(asc(confeccaoProduto.nome))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const [{ total }] = await tx
        .select({ total: count() })
        .from(confeccaoProduto)
        .where(where);

      return { items, total: Number(total) };
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Parâmetros inválidos", details: err.issues },
        { status: 400 },
      );
    }
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    console.error("Erro ao listar produtos:", err);
    return NextResponse.json(
      { error: "Erro ao listar produtos" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    try {
      await requireAdminAtivo();
    } catch {
      return NextResponse.json(
        { error: "Acesso negado — requer admin" },
        { status: 403 },
      );
    }

    const parsed = CriarProdutoSchema.parse(await request.json());

    const created = await withContaAtiva(async (tx, contaId) => {
      const [row] = await tx
        .insert(confeccaoProduto)
        .values({
          id: generateId(),
          contaId,
          nome: parsed.nome,
          descricao: parsed.descricao ?? null,
        })
        .returning();
      return row;
    });

    return NextResponse.json({ item: created }, { status: 201 });
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
    console.error("Erro ao criar produto:", err);
    return NextResponse.json(
      { error: "Erro ao criar produto" },
      { status: 500 },
    );
  }
}
