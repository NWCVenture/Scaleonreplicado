import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  estante,
  estanteFardo,
  estanteMovimentacao,
} from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { generateId } from "@/lib/utils";
import { withContaAtiva } from "@/lib/tenancy";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return msg.includes("conta ativa") || msg.includes("Sessão");
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; fardoId: string }> }
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    const { id, fardoId } = await params;

    const result = await withContaAtiva(async (tx, contaId) => {
      const [parentEstante] = await tx
        .select({ nome: estante.nome })
        .from(estante)
        .where(and(eq(estante.contaId, contaId), eq(estante.id, id)));

      if (!parentEstante) {
        return null;
      }

      const [fardo] = await tx
        .select()
        .from(estanteFardo)
        .where(
          and(
            eq(estanteFardo.contaId, contaId),
            eq(estanteFardo.id, fardoId),
            eq(estanteFardo.estanteId, id)
          )
        );

      if (!fardo) {
        return null;
      }

      const [{ count: totalAntes }] = await tx
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(estanteFardo)
        .where(
          and(
            eq(estanteFardo.contaId, contaId),
            eq(estanteFardo.estanteId, id)
          )
        );

      await tx
        .delete(estanteFardo)
        .where(
          and(
            eq(estanteFardo.contaId, contaId),
            eq(estanteFardo.id, fardoId),
            eq(estanteFardo.estanteId, id)
          )
        );

      const [{ count: totalDepois }] = await tx
        .select({ count: sql<number>`cast(count(*) as int)` })
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
        estanteNome: parentEstante.nome,
        tipo: "SAIDA",
        fardoSku: fardo.sku,
        fardoLote: fardo.lote,
        fardoQuantidade: fardo.quantidade,
        totalAntes,
        totalDepois,
        totalPecas: null,
        usuarioId: session.user.id,
        contaId,
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
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }
    console.error("Error deleting fardo:", error);
    return NextResponse.json(
      { error: "Erro ao remover fardo" },
      { status: 500 }
    );
  }
}
