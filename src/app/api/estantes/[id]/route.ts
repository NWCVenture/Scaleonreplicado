import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { estante, estanteFardo } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    const { id } = await params;

    const [found] = await db
      .select()
      .from(estante)
      .where(eq(estante.id, id));

    if (!found) {
      return NextResponse.json(
        { error: "Estante nao encontrada" },
        { status: 404 }
      );
    }

    const fardos = await db
      .select()
      .from(estanteFardo)
      .where(eq(estanteFardo.estanteId, id))
      .orderBy(desc(estanteFardo.createdAt));

    return NextResponse.json({ estante: found, fardos });
  } catch (error) {
    console.error("Error fetching estante:", error);
    return NextResponse.json(
      { error: "Erro ao buscar estante" },
      { status: 500 }
    );
  }
}

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

    await db.delete(estante).where(eq(estante.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting estante:", error);
    return NextResponse.json(
      { error: "Erro ao remover estante" },
      { status: 500 }
    );
  }
}
