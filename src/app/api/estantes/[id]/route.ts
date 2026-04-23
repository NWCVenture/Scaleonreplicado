import { NextRequest, NextResponse } from "next/server";
import { estante, estanteFardo } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { withContaAtiva } from "@/lib/tenancy";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return msg.includes("conta ativa") || msg.includes("Sessão");
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const result = await withContaAtiva(async (tx, contaId) => {
      const [found] = await tx
        .select()
        .from(estante)
        .where(and(eq(estante.contaId, contaId), eq(estante.id, id)));

      if (!found) {
        return null;
      }

      const fardos = await tx
        .select()
        .from(estanteFardo)
        .where(
          and(
            eq(estanteFardo.contaId, contaId),
            eq(estanteFardo.estanteId, id)
          )
        )
        .orderBy(desc(estanteFardo.createdAt));

      return { estante: found, fardos };
    });

    if (!result) {
      return NextResponse.json(
        { error: "Estante nao encontrada" },
        { status: 404 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }
    console.error("Error fetching estante:", error);
    return NextResponse.json(
      { error: "Erro ao buscar estante" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const deleted = await withContaAtiva(async (tx, contaId) => {
      const [existing] = await tx
        .select({ id: estante.id })
        .from(estante)
        .where(and(eq(estante.contaId, contaId), eq(estante.id, id)));

      if (!existing) {
        return false;
      }

      await tx
        .delete(estante)
        .where(and(eq(estante.contaId, contaId), eq(estante.id, id)));

      return true;
    });

    if (!deleted) {
      return NextResponse.json(
        { error: "Estante nao encontrada" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }
    console.error("Error deleting estante:", error);
    return NextResponse.json(
      { error: "Erro ao remover estante" },
      { status: 500 }
    );
  }
}
