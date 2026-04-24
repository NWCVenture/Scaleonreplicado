import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sessaoExpedicao } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { generateId } from "@/lib/utils";
import { withContaAtiva } from "@/lib/tenancy";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return msg.includes("conta ativa") || msg.includes("Sessão");
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const ativa = await withContaAtiva(async (tx, contaId) => {
      const [row] = await tx
        .select()
        .from(sessaoExpedicao)
        .where(
          and(
            eq(sessaoExpedicao.contaId, contaId),
            eq(sessaoExpedicao.usuarioId, session.user.id),
            eq(sessaoExpedicao.status, "ativa"),
          ),
        )
        .orderBy(desc(sessaoExpedicao.iniciouEm))
        .limit(1);
      return row ?? null;
    });

    return NextResponse.json({ sessao: ativa });
  } catch (error) {
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    console.error("Erro ao buscar sessão ativa:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const nova = await withContaAtiva(async (tx, contaId) => {
      // Se já houver sessão ativa pro usuário, retorna ela (unique index
      // garante que não há duplicatas, mas o POST é idempotente)
      const [existente] = await tx
        .select()
        .from(sessaoExpedicao)
        .where(
          and(
            eq(sessaoExpedicao.contaId, contaId),
            eq(sessaoExpedicao.usuarioId, session.user.id),
            eq(sessaoExpedicao.status, "ativa"),
          ),
        )
        .limit(1);
      if (existente) return existente;

      const [row] = await tx
        .insert(sessaoExpedicao)
        .values({
          id: generateId(),
          contaId,
          usuarioId: session.user.id,
        })
        .returning();
      return row;
    });

    return NextResponse.json(nova, { status: 201 });
  } catch (error) {
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    console.error("Erro ao iniciar sessão:", error);
    return NextResponse.json(
      { error: "Erro ao iniciar sessão" },
      { status: 500 },
    );
  }
}
