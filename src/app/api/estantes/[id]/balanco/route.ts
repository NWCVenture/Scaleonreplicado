import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { estante, estanteFardo, estanteMovimentacao } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { generateId } from "@/lib/utils";
import { withContaAtiva } from "@/lib/tenancy";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return msg.includes("conta ativa") || msg.includes("Sessão");
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    const { id } = await params;

    const result = await withContaAtiva(async (tx, contaId) => {
      const [found] = await tx
        .select({ nome: estante.nome })
        .from(estante)
        .where(and(eq(estante.contaId, contaId), eq(estante.id, id)));

      if (!found) {
        return null;
      }

      const [{ count: fardoCount }] = await tx
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(estanteFardo)
        .where(
          and(
            eq(estanteFardo.contaId, contaId),
            eq(estanteFardo.estanteId, id)
          )
        );

      const [{ total: totalPecas }] = await tx
        .select({
          total: sql<number>`coalesce(cast(sum(${estanteFardo.quantidade}) as int), 0)`,
        })
        .from(estanteFardo)
        .where(
          and(
            eq(estanteFardo.contaId, contaId),
            eq(estanteFardo.estanteId, id)
          )
        );

      await tx.insert(estanteMovimentacao).values({
        id: generateId(),
        estanteId: id,
        estanteNome: found.nome,
        tipo: "BALANCO",
        totalAntes: fardoCount,
        totalDepois: fardoCount,
        totalPecas,
        usuarioId: session.user.id,
        contaId,
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
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }
    console.error("Error creating balanco:", error);
    return NextResponse.json(
      { error: "Erro ao criar balanco" },
      { status: 500 }
    );
  }
}
