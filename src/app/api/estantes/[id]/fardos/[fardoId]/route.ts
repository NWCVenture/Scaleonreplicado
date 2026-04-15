import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  estante,
  estanteFardo,
  estanteMovimentacao,
} from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { generateId } from "@/lib/utils";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; fardoId: string }> }
) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    const { id, fardoId } = await params;

    const result = await db.transaction(async (tx) => {
      const [fardo] = await tx
        .select()
        .from(estanteFardo)
        .where(
          and(eq(estanteFardo.id, fardoId), eq(estanteFardo.estanteId, id))
        );

      if (!fardo) {
        return null;
      }

      const [{ count: totalAntes }] = await tx
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(estanteFardo)
        .where(eq(estanteFardo.estanteId, id));

      await tx
        .delete(estanteFardo)
        .where(
          and(eq(estanteFardo.id, fardoId), eq(estanteFardo.estanteId, id))
        );

      const [{ count: totalDepois }] = await tx
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(estanteFardo)
        .where(eq(estanteFardo.estanteId, id));

      const [found] = await tx
        .select({ nome: estante.nome })
        .from(estante)
        .where(eq(estante.id, id));

      await tx.insert(estanteMovimentacao).values({
        id: generateId(),
        estanteId: id,
        estanteNome: found.nome,
        tipo: "SAIDA",
        fardoSku: fardo.sku,
        fardoLote: fardo.lote,
        fardoQuantidade: fardo.quantidade,
        totalAntes,
        totalDepois,
        totalPecas: null,
        usuarioId: session.user.id,
      });

      return { success: true };
    });

    if (!result) {
      return NextResponse.json(
        { error: "Fardo nao encontrado" },
        { status: 404 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error deleting fardo:", error);
    return NextResponse.json(
      { error: "Erro ao remover fardo" },
      { status: 500 }
    );
  }
}
