import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { coletaBipagem } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { withContaAtiva } from "@/lib/tenancy";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return msg.includes("conta ativa") || msg.includes("Sessão");
}

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

    await withContaAtiva(async (tx, contaId) => {
      await tx
        .update(coletaBipagem)
        .set({
          revisado: true,
          revisadoPor: session.user.id,
          revisadoEm: new Date(),
        })
        .where(
          and(eq(coletaBipagem.id, id), eq(coletaBipagem.contaId, contaId))
        );
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }
    console.error("Error reviewing coleta bipagem:", error);
    return NextResponse.json(
      { error: "Erro ao revisar coleta" },
      { status: 500 }
    );
  }
}
