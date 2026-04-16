import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { etiquetaAssociacao } from "@/lib/db/schema";

export async function DELETE(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    await db.delete(etiquetaAssociacao);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting all etiquetas:", error);
    return NextResponse.json(
      { error: "Erro ao remover etiquetas" },
      { status: 500 }
    );
  }
}
