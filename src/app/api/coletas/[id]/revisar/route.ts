import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { coletaBipagem } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

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

    await db
      .update(coletaBipagem)
      .set({
        revisado: true,
        revisadoPor: session.user.id,
        revisadoEm: new Date(),
      })
      .where(eq(coletaBipagem.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error reviewing coleta bipagem:", error);
    return NextResponse.json(
      { error: "Erro ao revisar coleta" },
      { status: 500 }
    );
  }
}
