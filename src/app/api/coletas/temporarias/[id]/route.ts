import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { coletaBipagemTemporaria } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { withContaAtiva } from "@/lib/tenancy";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return msg.includes("conta ativa") || msg.includes("Sessão");
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

    const outcome = await withContaAtiva(async (tx, contaId) => {
      const [record] = await tx
        .select()
        .from(coletaBipagemTemporaria)
        .where(
          and(
            eq(coletaBipagemTemporaria.id, id),
            eq(coletaBipagemTemporaria.contaId, contaId)
          )
        );

      if (!record) {
        return { status: "notFound" as const };
      }

      if (record.usuarioId !== session.user.id) {
        return { status: "forbidden" as const };
      }

      await tx
        .delete(coletaBipagemTemporaria)
        .where(
          and(
            eq(coletaBipagemTemporaria.id, id),
            eq(coletaBipagemTemporaria.contaId, contaId)
          )
        );

      return { status: "ok" as const };
    });

    if (outcome.status === "notFound") {
      return NextResponse.json(
        { error: "Bipagem temporaria nao encontrada" },
        { status: 404 }
      );
    }
    if (outcome.status === "forbidden") {
      return NextResponse.json(
        { error: "Sem permissao para remover esta bipagem" },
        { status: 403 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }
    console.error("Error deleting temporaria:", error);
    return NextResponse.json(
      { error: "Erro ao remover bipagem temporaria" },
      { status: 500 }
    );
  }
}
