// GET /api/confeccao/membros-conta — lista membros ativos da conta ativa
//
// Endpoint auxiliar pra alimentar o lookup de "Atribuído a" (RITM-06) e
// outros lookups de usuário do módulo. Retorna apenas membros ativos.

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, ilike, or } from "drizzle-orm";
import { withContaAtiva } from "@/lib/tenancy";
import { db } from "@/lib/db";
import { user, usuarioConta } from "@/lib/db/schema";

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
    const search = request.nextUrl.searchParams.get("search")?.trim() ?? "";

    // usuario_conta NÃO está sob withContaAtiva (Better-Auth + tenancy tables
    // não usam RLS) — fazemos JOIN filtrado por contaId explicitamente.
    const contaId = await withContaAtiva(async (_tx, id) => id);

    const conditions = [
      eq(usuarioConta.contaId, contaId),
      eq(usuarioConta.ativo, true),
    ];
    if (search) {
      const like = `%${search}%`;
      const orCond = or(
        ilike(user.name, like),
        ilike(user.email, like),
      );
      if (orCond) conditions.push(orCond);
    }

    const items = await db
      .select({
        id: user.id,
        nome: user.name,
        email: user.email,
        papel: usuarioConta.papel,
      })
      .from(usuarioConta)
      .innerJoin(user, eq(user.id, usuarioConta.usuarioId))
      .where(and(...conditions))
      .orderBy(asc(user.name))
      .limit(50);

    return NextResponse.json({ items });
  } catch (err) {
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    console.error("Erro ao listar membros:", err);
    return NextResponse.json(
      { error: "Erro ao listar membros" },
      { status: 500 },
    );
  }
}
