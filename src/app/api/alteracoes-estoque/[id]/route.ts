import { NextRequest, NextResponse } from "next/server";
import { alteracaoEstoque } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { withContaAtiva } from "@/lib/tenancy";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    await withContaAtiva(async (tx, contaId) => {
      await tx
        .delete(alteracaoEstoque)
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
    console.error("Error deleting alteracao estoque:", error);
    return NextResponse.json(
      { error: "Erro ao remover alteracao de estoque" },
      { status: 500 }
    );
  }
}
