import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { produtoAvariado } from "@/lib/db/schema";
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

    await db.delete(produtoAvariado).where(eq(produtoAvariado.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting produto avariado:", error);
    return NextResponse.json(
      { error: "Erro ao remover produto avariado" },
      { status: 500 }
    );
  }
}
