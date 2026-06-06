// GET /api/central-envios/configuracoes/categoria-sku
//
// Lista categorias ativas (regras de classificação do extrator).
// CRUD completo (POST/PUT/DELETE) fica para o RITM-10.

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { withContaAtiva } from "@/lib/tenancy";
import { categoriaSku } from "@/lib/db/schema";

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }
  try {
    const categorias = await withContaAtiva((tx, contaId) =>
      tx
        .select({
          id: categoriaSku.id,
          nome: categoriaSku.nome,
          ordem: categoriaSku.ordem,
          ativo: categoriaSku.ativo,
          regras: categoriaSku.regras,
        })
        .from(categoriaSku)
        .where(
          and(
            eq(categoriaSku.contaId, contaId),
            eq(categoriaSku.ativo, true),
          ),
        )
        .orderBy(asc(categoriaSku.ordem), asc(categoriaSku.nome)),
    );
    return NextResponse.json({ categorias });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("conta ativa") || msg.includes("Sessão")) {
      return NextResponse.json({ error: msg }, { status: 403 });
    }
    console.error("[categoria-sku] GET:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
