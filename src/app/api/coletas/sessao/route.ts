import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sessaoColetas } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { generateId } from "@/lib/utils";
import { withContaAtiva } from "@/lib/tenancy";

// TTL: sessões inativas há mais de 8h são marcadas encerradas (motivo=expirada)
// e a API retorna null. Assim o usuário começa limpo ao voltar depois de meio
// expediente / fim de semana sem sessão "fantasma" ativa.
const SESSAO_TTL_MS = 8 * 60 * 60 * 1000;

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
        .from(sessaoColetas)
        .where(
          and(
            eq(sessaoColetas.contaId, contaId),
            eq(sessaoColetas.usuarioId, session.user.id),
            eq(sessaoColetas.status, "ativa"),
          ),
        )
        .orderBy(desc(sessaoColetas.iniciouEm))
        .limit(1);

      if (!row) return null;

      const idade = Date.now() - new Date(row.ultimaAtividadeEm).getTime();
      if (idade > SESSAO_TTL_MS) {
        await tx
          .update(sessaoColetas)
          .set({
            status: "encerrada",
            encerrouEm: new Date(),
            encerradaMotivo: "expirada",
          })
          .where(eq(sessaoColetas.id, row.id));
        return null;
      }

      return row;
    });

    return NextResponse.json({ sessao: ativa });
  } catch (error) {
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    console.error("[coletas/sessao] GET:", error);
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
      const [existente] = await tx
        .select()
        .from(sessaoColetas)
        .where(
          and(
            eq(sessaoColetas.contaId, contaId),
            eq(sessaoColetas.usuarioId, session.user.id),
            eq(sessaoColetas.status, "ativa"),
          ),
        )
        .limit(1);
      if (existente) return existente;

      const [row] = await tx
        .insert(sessaoColetas)
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
    console.error("[coletas/sessao] POST:", error);
    return NextResponse.json(
      { error: "Erro ao iniciar sessão" },
      { status: 500 },
    );
  }
}
