import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { alteracaoEstoque } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { withContaAtiva } from "@/lib/tenancy";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    const { id } = await params;

    await withContaAtiva(async (tx, contaId) => {
      await tx
        .update(alteracaoEstoque)
        .set({
          revisado: true,
          revisadoPor: session.user.id,
          revisadoEm: new Date(),
        })
        .where(
          and(
            eq(alteracaoEstoque.id, id),
            eq(alteracaoEstoque.contaId, contaId)
          )
        );
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("conta ativa") ||
        error.message.includes("Sessão"))
    ) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }
    console.error("Error reviewing alteracao estoque:", error);
    return NextResponse.json(
      { error: "Erro ao revisar alteracao de estoque" },
      { status: 500 }
    );
  }
}
