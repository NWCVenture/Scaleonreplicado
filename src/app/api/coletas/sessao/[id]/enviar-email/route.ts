import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sessaoColetas } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { withContaAtiva } from "@/lib/tenancy";
import { enviarRelatorioColetas } from "@/lib/coletas-sessao-relatorio";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return msg.includes("conta ativa") || msg.includes("Sessão");
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    const { id } = await ctx.params;

    const sessao = await withContaAtiva(async (tx, contaId) => {
      const [row] = await tx
        .select()
        .from(sessaoColetas)
        .where(
          and(
            eq(sessaoColetas.id, id),
            eq(sessaoColetas.contaId, contaId),
            eq(sessaoColetas.usuarioId, session.user.id),
          ),
        )
        .limit(1);
      return row ?? null;
    });

    if (!sessao) {
      return NextResponse.json(
        { error: "Sessão não encontrada" },
        { status: 404 },
      );
    }

    const pacotes = (sessao.pacotes ?? []) as string[];
    if (pacotes.length === 0) {
      return NextResponse.json(
        { error: "Sessão sem pacotes — nada para enviar" },
        { status: 400 },
      );
    }

    const result = await enviarRelatorioColetas(sessao);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    console.error("[coletas/sessao/enviar-email]:", error);
    return NextResponse.json(
      { error: "Erro ao enviar relatório por email" },
      { status: 500 },
    );
  }
}
