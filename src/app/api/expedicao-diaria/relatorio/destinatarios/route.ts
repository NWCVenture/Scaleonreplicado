import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { user, usuarioConta } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { withContaAtiva } from "@/lib/tenancy";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return msg.includes("conta ativa") || msg.includes("Sessão");
}

// Lista usuários ativos da conta com flag isAdmin (owner|admin) — front
// usa pra montar o multi-select de destinatários do relatório,
// pré-marcando admins.
export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const usuarios = await withContaAtiva(async (tx, contaId) => {
      const rows = await tx
        .select({
          id: user.id,
          nome: user.name,
          email: user.email,
          papel: usuarioConta.papel,
        })
        .from(usuarioConta)
        .innerJoin(user, eq(usuarioConta.usuarioId, user.id))
        .where(
          and(
            eq(usuarioConta.contaId, contaId),
            eq(usuarioConta.ativo, true),
          ),
        );
      return rows
        .filter((r) => !!r.email)
        .map((r) => ({
          id: r.id,
          nome: r.nome,
          email: r.email,
          isAdmin: r.papel === "owner" || r.papel === "admin",
          isCurrent: r.id === session.user.id,
        }))
        .sort((a, b) => {
          // current → admins → resto, dentro de cada bloco por nome
          if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
          if (a.isAdmin !== b.isAdmin) return a.isAdmin ? -1 : 1;
          return (a.nome ?? a.email).localeCompare(b.nome ?? b.email);
        });
    });

    return NextResponse.json({ usuarios });
  } catch (error) {
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    console.error("Erro ao listar destinatários:", error);
    return NextResponse.json(
      { error: "Erro ao listar destinatários" },
      { status: 500 },
    );
  }
}
