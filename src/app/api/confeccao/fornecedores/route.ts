// GET  /api/confeccao/fornecedores — lista paginada com search + categoria
// POST /api/confeccao/fornecedores — admin

import { NextRequest, NextResponse } from "next/server";
import { and, asc, count, eq, ilike, sql } from "drizzle-orm";
import { z } from "zod";
import { generateId } from "@/lib/utils";
import { withContaAtiva, requireAdminAtivo } from "@/lib/tenancy";
import { confeccaoFornecedor } from "@/lib/db/schema";
import {
  ConfeccaoFornecedorCategoriaSchema,
  CriarFornecedorSchema,
  PaginacaoSchema,
} from "@/lib/confeccao/schemas/cadastros";
import { agendarGeocoding } from "@/lib/confeccao/geocoding-job";

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
    const categoria = sp.get("categoria");
    const categoriaParsed = categoria
      ? ConfeccaoFornecedorCategoriaSchema.parse(categoria)
      : null;

    const result = await withContaAtiva(async (tx, contaId) => {
      const conditions = [eq(confeccaoFornecedor.contaId, contaId)];
      if (search)
        conditions.push(ilike(confeccaoFornecedor.nome, `%${search}%`));
      if (!incluirInativos)
        conditions.push(eq(confeccaoFornecedor.ativo, true));
      // Filtro de categoria via operador de array Postgres (=ANY)
      if (categoriaParsed) {
        conditions.push(
          sql`${categoriaParsed} = ANY(${confeccaoFornecedor.categorias})`,
        );
      }

      const where = and(...conditions);

      const items = await tx
        .select()
        .from(confeccaoFornecedor)
        .where(where)
        .orderBy(asc(confeccaoFornecedor.nome))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const [{ total }] = await tx
        .select({ total: count() })
        .from(confeccaoFornecedor)
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
    console.error("Erro ao listar fornecedores:", err);
    return NextResponse.json(
      { error: "Erro ao listar fornecedores" },
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
    const parsed = CriarFornecedorSchema.parse(await request.json());

    const created = await withContaAtiva(async (tx, contaId) => {
      const [row] = await tx
        .insert(confeccaoFornecedor)
        .values({
          id: generateId(),
          contaId,
          nome: parsed.nome,
          categorias: parsed.categorias,
          whatsapp: parsed.whatsapp,
          telefoneE164: parsed.telefoneE164 ?? null,
          enderecoRua: parsed.enderecoRua,
          enderecoNumero: parsed.enderecoNumero,
          enderecoComplemento: parsed.enderecoComplemento ?? null,
          enderecoBairro: parsed.enderecoBairro,
          enderecoCep: parsed.enderecoCep,
          enderecoCidade: parsed.enderecoCidade,
          enderecoEstado: parsed.enderecoEstado,
          contatoNome: parsed.contatoNome ?? null,
          observacoes: parsed.observacoes ?? null,
        })
        .returning();
      return row;
    });

    // Geocoding background (fire-and-forget) — só dispara quando o endereço
    // mínimo está preenchido. Cadastro rápido (só nome + WhatsApp) pula essa
    // etapa; o usuário roda geocoding manual depois ao completar o endereço.
    if (
      created.enderecoRua &&
      created.enderecoCidade &&
      created.enderecoEstado
    ) {
      agendarGeocoding(created.id, created.contaId, {
        rua: created.enderecoRua,
        numero: created.enderecoNumero,
        bairro: created.enderecoBairro,
        cidade: created.enderecoCidade,
        estado: created.enderecoEstado,
        cep: created.enderecoCep,
      });
    }

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
    console.error("Erro ao criar fornecedor:", err);
    return NextResponse.json(
      { error: "Erro ao criar fornecedor" },
      { status: 500 },
    );
  }
}
