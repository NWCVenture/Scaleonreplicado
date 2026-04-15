import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { estanteMovimentacao, user } from "@/lib/db/schema";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";

const VALID_TIPOS = [
  "ENTRADA",
  "SAIDA",
  "BIPAGEM_SEMANAL",
  "IMPORTACAO",
  "BALANCO",
] as const;

export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const tipo = searchParams.get("tipo");
    const data = searchParams.get("data");
    const limit = Math.min(
      Math.max(parseInt(searchParams.get("limit") ?? "200", 10) || 200, 1),
      1000
    );

    const conditions = [];

    if (tipo) {
      if (!VALID_TIPOS.includes(tipo as (typeof VALID_TIPOS)[number])) {
        return NextResponse.json(
          { error: "Tipo de movimentacao invalido" },
          { status: 400 }
        );
      }
      conditions.push(
        eq(
          estanteMovimentacao.tipo,
          tipo as (typeof VALID_TIPOS)[number]
        )
      );
    }

    if (data) {
      const date = new Date(data);
      if (isNaN(date.getTime())) {
        return NextResponse.json(
          { error: "Data invalida" },
          { status: 400 }
        );
      }
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      conditions.push(gte(estanteMovimentacao.createdAt, startOfDay));
      conditions.push(lte(estanteMovimentacao.createdAt, endOfDay));
    }

    const whereClause =
      conditions.length > 0 ? and(...conditions) : undefined;

    const movimentacoes = await db
      .select({
        id: estanteMovimentacao.id,
        estanteId: estanteMovimentacao.estanteId,
        estanteNome: estanteMovimentacao.estanteNome,
        tipo: estanteMovimentacao.tipo,
        fardoSku: estanteMovimentacao.fardoSku,
        fardoLote: estanteMovimentacao.fardoLote,
        fardoQuantidade: estanteMovimentacao.fardoQuantidade,
        totalAntes: estanteMovimentacao.totalAntes,
        totalDepois: estanteMovimentacao.totalDepois,
        totalPecas: estanteMovimentacao.totalPecas,
        usuarioId: estanteMovimentacao.usuarioId,
        createdAt: estanteMovimentacao.createdAt,
        usuarioNome: user.name,
      })
      .from(estanteMovimentacao)
      .leftJoin(user, eq(estanteMovimentacao.usuarioId, user.id))
      .where(whereClause)
      .orderBy(desc(estanteMovimentacao.createdAt))
      .limit(limit);

    return NextResponse.json({ movimentacoes });
  } catch (error) {
    console.error("Error fetching movimentacoes:", error);
    return NextResponse.json(
      { error: "Erro ao buscar movimentacoes" },
      { status: 500 }
    );
  }
}
