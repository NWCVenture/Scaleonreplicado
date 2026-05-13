// GET/POST /api/confeccao/templates-whatsapp

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { generateId } from "@/lib/utils";
import { requireAdminAtivo, withContaAtiva } from "@/lib/tenancy";
import { confeccaoTemplateWhatsapp } from "@/lib/db/schema";
import { CriarTemplateWhatsappSchema } from "@/lib/confeccao/schemas/template-whatsapp";
import { ConfeccaoFornecedorCategoriaSchema } from "@/lib/confeccao/schemas/cadastros";

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
    const categoria = sp.get("categoria");
    const incluirInativos = sp.get("incluirInativos") === "true";
    const categoriaParsed = categoria
      ? ConfeccaoFornecedorCategoriaSchema.parse(categoria)
      : null;

    const items = await withContaAtiva(async (tx, contaId) => {
      const conds = [eq(confeccaoTemplateWhatsapp.contaId, contaId)];
      if (categoriaParsed)
        conds.push(eq(confeccaoTemplateWhatsapp.categoria, categoriaParsed));
      if (!incluirInativos)
        conds.push(eq(confeccaoTemplateWhatsapp.ativo, true));
      return tx
        .select()
        .from(confeccaoTemplateWhatsapp)
        .where(and(...conds))
        .orderBy(asc(confeccaoTemplateWhatsapp.nome));
    });
    return NextResponse.json({ items });
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
    return NextResponse.json(
      { error: "Erro ao listar templates" },
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
    const parsed = CriarTemplateWhatsappSchema.parse(await request.json());
    const created = await withContaAtiva(async (tx, contaId) => {
      const [row] = await tx
        .insert(confeccaoTemplateWhatsapp)
        .values({
          id: generateId(),
          contaId,
          nome: parsed.nome,
          categoria: parsed.categoria,
          corpo: parsed.corpo,
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
        { error: "Template com este nome já existe" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "Erro ao criar template" },
      { status: 500 },
    );
  }
}
