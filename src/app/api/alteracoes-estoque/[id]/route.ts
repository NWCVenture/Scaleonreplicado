import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { alteracaoEstoque } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    const { id } = await params;

    await db
      .delete(alteracaoEstoque)
      .where(eq(alteracaoEstoque.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting alteracao estoque:", error);
    return NextResponse.json(
      { error: "Erro ao remover alteracao de estoque" },
      { status: 500 }
    );
  }
}
