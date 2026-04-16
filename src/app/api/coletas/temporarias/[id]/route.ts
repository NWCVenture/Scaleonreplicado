import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { coletaBipagemTemporaria } from "@/lib/db/schema";
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

    const [record] = await db
      .select()
      .from(coletaBipagemTemporaria)
      .where(eq(coletaBipagemTemporaria.id, id));

    if (!record) {
      return NextResponse.json(
        { error: "Bipagem temporaria nao encontrada" },
        { status: 404 }
      );
    }

    if (record.usuarioId !== session.user.id) {
      return NextResponse.json(
        { error: "Sem permissao para remover esta bipagem" },
        { status: 403 }
      );
    }

    await db
      .delete(coletaBipagemTemporaria)
      .where(eq(coletaBipagemTemporaria.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting temporaria:", error);
    return NextResponse.json(
      { error: "Erro ao remover bipagem temporaria" },
      { status: 500 }
    );
  }
}
