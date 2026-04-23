import { NextRequest, NextResponse } from "next/server";
import { estanteMovimentacao, user } from "@/lib/db/schema";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { withContaAtiva } from "@/lib/tenancy";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return msg.includes("conta ativa") || msg.includes("Sessão");
}

const VALID_TIPOS = [
  "ENTRADA",
  "SAIDA",
  "BIPAGEM_SEMANAL",
  "IMPORTACAO",
  "BALANCO",
] as const;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tipo = searchParams.get("tipo");
    const data = searchParams.get("data");
    const limit = Math.min(
      Math.max(parseInt(searchParams.get("limit") ?? "200", 10) || 200, 1),
      1000
    );

    if (
      tipo &&
      !VALID_TIPOS.includes(tipo as (typeof VALID_TIPOS)[number])
    ) {
      return NextResponse.json(
        { error: "Tipo de movimentacao invalido" },
        { status: 400 }
      );
    }

    let startOfDay: Date | null = null;
    let endOfDay: Date | null = null;
    if (data) {
      const date = new Date(data);
      if (isNaN(date.getTime())) {
        return NextResponse.json(
          { error: "Data invalida" },
          { status: 400 }
        );
      }
      startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);
    }

    const movimentacoes = await withContaAtiva(async (tx, contaId) => {
      const conditions = [eq(estanteMovimentacao.contaId, contaId)];

      if (tipo) {
        conditions.push(
          eq(
            estanteMovimentacao.tipo,
            tipo as (typeof VALID_TIPOS)[number]
          )
        );
      }

      if (startOfDay && endOfDay) {
        conditions.push(gte(estanteMovimentacao.createdAt, startOfDay));
        conditions.push(lte(estanteMovimentacao.createdAt, endOfDay));
      }

      return tx
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
        .where(and(...conditions))
        .orderBy(desc(estanteMovimentacao.createdAt))
        .limit(limit);
    });

    return NextResponse.json({ movimentacoes });
  } catch (error) {
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }
    console.error("Error fetching movimentacoes:", error);
    return NextResponse.json(
      { error: "Erro ao buscar movimentacoes" },
      { status: 500 }
    );
  }
}
