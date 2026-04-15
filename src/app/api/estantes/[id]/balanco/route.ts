import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { estante, estanteFardo, estanteMovimentacao } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { generateId } from "@/lib/utils";

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

      const [{ total: totalPecas }] = await tx
        .select({
          total: sql<number>`coalesce(cast(sum(${estanteFardo.quantidade}) as int), 0)`,
        })
        .from(estanteFardo)
        .where(eq(estanteFardo.estanteId, id));

      await tx.insert(estanteMovimentacao).values({
        id: generateId(),
        estanteId: id,
        estanteNome: found.nome,
        tipo: "BALANCO",
        totalAntes: fardoCount,
        totalDepois: fardoCount,
        totalPecas,
        usuarioId: session.user.id,
      });

      return { success: true, totalFardos: fardoCount, totalPecas };
    });

    if (!result) {
      return NextResponse.json(
        { error: "Estante nao encontrada" },
        { status: 404 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error creating balanco:", error);
    return NextResponse.json(
      { error: "Erro ao criar balanco" },
      { status: 500 }
    );
  }
}
