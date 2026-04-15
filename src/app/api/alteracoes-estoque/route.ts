import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { alteracaoEstoque, user } from "@/lib/db/schema";
import { and, count, desc, eq, gte, lte } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { generateId } from "@/lib/utils";

export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const dataInicio = searchParams.get("dataInicio");
    const dataFim = searchParams.get("dataFim");
    const revisado = searchParams.get("revisado") || "todos";
    const limit = Math.min(
      parseInt(searchParams.get("limit") || "50", 10) || 50,
      200
    );
    const offset = parseInt(searchParams.get("offset") || "0", 10) || 0;

    const conditions = [];

    if (dataInicio) {
      conditions.push(gte(alteracaoEstoque.createdAt, new Date(dataInicio)));
    }
    if (dataFim) {
      const endOfDay = new Date(dataFim);
      endOfDay.setHours(23, 59, 59, 999);
      conditions.push(lte(alteracaoEstoque.createdAt, endOfDay));
    }
    if (revisado === "revisados") {
      conditions.push(eq(alteracaoEstoque.revisado, true));
    } else if (revisado === "pendentes") {
      conditions.push(eq(alteracaoEstoque.revisado, false));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const revisadoPorUser = alias(user, "revisado_por_user");

    const registros = await db
      .select({
        id: alteracaoEstoque.id,
        saidas: alteracaoEstoque.saidas,
        entradas: alteracaoEstoque.entradas,
        codigoPacote: alteracaoEstoque.codigoPacote,
        usuarioId: alteracaoEstoque.usuarioId,
        usuarioNome: user.name,
        revisado: alteracaoEstoque.revisado,
        revisadoPor: alteracaoEstoque.revisadoPor,
        revisadoPorNome: revisadoPorUser.name,
        revisadoEm: alteracaoEstoque.revisadoEm,
        createdAt: alteracaoEstoque.createdAt,
      })
      .from(alteracaoEstoque)
      .leftJoin(user, eq(alteracaoEstoque.usuarioId, user.id))
      .leftJoin(
        revisadoPorUser,
        eq(alteracaoEstoque.revisadoPor, revisadoPorUser.id)
      )
      .where(whereClause)
      .orderBy(desc(alteracaoEstoque.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db
      .select({ total: count() })
      .from(alteracaoEstoque)
      .where(whereClause);

    return NextResponse.json({ registros, total });
  } catch (error) {
    console.error("Error fetching alteracoes estoque:", error);
    return NextResponse.json(
      { error: "Erro ao buscar alteracoes de estoque" },
      { status: 500 }
    );
  }
}

const createSchema = z.object({
  saidas: z
    .array(
      z.object({
        sku: z.string().min(1),
        quantidade: z.number().int().positive(),
      })
    )
    .min(1),
  entradas: z
    .array(
      z.object({
        sku: z.string().min(1),
        quantidade: z.number().int().positive(),
      })
    )
    .min(1),
  codigoPacote: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const data = createSchema.parse(body);

    const totalSaidas = data.saidas.reduce((sum, s) => sum + s.quantidade, 0);
    const totalEntradas = data.entradas.reduce(
      (sum, e) => sum + e.quantidade,
      0
    );

    if (totalSaidas !== totalEntradas) {
      return NextResponse.json(
        {
          error: `Operacao nao casada! Saida: ${totalSaidas} | Entrada: ${totalEntradas}`,
        },
        { status: 400 }
      );
    }

    const [novo] = await db
      .insert(alteracaoEstoque)
      .values({
        id: generateId(),
        saidas: data.saidas,
        entradas: data.entradas,
        codigoPacote: data.codigoPacote,
        usuarioId: session.user.id,
      })
      .returning();

    return NextResponse.json(novo, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Dados invalidos", details: error.issues },
        { status: 400 }
      );
    }

    console.error("Error creating alteracao estoque:", error);
    return NextResponse.json(
      { error: "Erro ao registrar alteracao de estoque" },
      { status: 500 }
    );
  }
}
