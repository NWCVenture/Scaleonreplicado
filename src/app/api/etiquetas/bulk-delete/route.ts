import { NextRequest, NextResponse } from "next/server";
import { etiquetaAssociacao } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { withContaAtiva } from "@/lib/tenancy";

export async function DELETE(_request: NextRequest) {
  try {
    await withContaAtiva(async (tx, contaId) => {
      await tx
        .delete(etiquetaAssociacao)
        .where(eq(etiquetaAssociacao.contaId, contaId));
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

    console.error("Error deleting all etiquetas:", error);
    return NextResponse.json(
      { error: "Erro ao remover etiquetas" },
      { status: 500 }
    );
  }
}
