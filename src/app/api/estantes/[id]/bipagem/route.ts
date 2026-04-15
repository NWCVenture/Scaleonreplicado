import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { estante, estanteFardo, estanteMovimentacao } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { generateId } from "@/lib/utils";

const bipagemSchema = z.object({
  scannedCount: z.number().int().nonnegative(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    bipagemSchema.parse(body);

    const now = new Date();

    const result = await db.transaction(async (tx) => {
      const [found] = await tx
        .select({ nome: estante.nome })
        .from(estante)
        .where(eq(estante.id, id));

      if (!found) {
        return null;
      }

      const [{ count: fardoCount }] = await tx
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(estanteFardo)
        .where(eq(estanteFardo.estanteId, id));

      await tx
        .update(estante)
        .set({
          ultimaBipagem: now,
          ultimaBipagemPor: session.user.id,
        })
        .where(eq(estante.id, id));

      await tx.insert(estanteMovimentacao).values({
        id: generateId(),
        estanteId: id,
        estanteNome: found.nome,
        tipo: "BIPAGEM_SEMANAL",
        totalAntes: fardoCount,
        totalDepois: fardoCount,
        totalPecas: null,
        usuarioId: session.user.id,
      });

      return { success: true, ultimaBipagem: now.toISOString() };
    });

    if (!result) {
      return NextResponse.json(
        { error: "Estante nao encontrada" },
        { status: 404 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Dados invalidos", details: error.issues },
        { status: 400 }
      );
    }

    console.error("Error confirming bipagem:", error);
    return NextResponse.json(
      { error: "Erro ao confirmar bipagem" },
      { status: 500 }
    );
  }
}
