import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sessaoColetas } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withContaAtiva } from "@/lib/tenancy";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return msg.includes("conta ativa") || msg.includes("Sessão");
}

const bodySchema = z
  .object({
    motivo: z.enum(["finalizada", "forcada", "expirada"]).optional(),
  })
  .optional();

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    const { id } = await ctx.params;
    let motivo: "finalizada" | "forcada" | "expirada" = "forcada";
    try {
      const parsed = bodySchema.parse(await request.json().catch(() => ({})));
      if (parsed?.motivo) motivo = parsed.motivo;
    } catch {
      // body opcional — ignora erro de parse
    }

    const encerrada = await withContaAtiva(async (tx, contaId) => {
      const [row] = await tx
        .update(sessaoColetas)
        .set({
          status: "encerrada",
          encerrouEm: new Date(),
          encerradaMotivo: motivo,
        })
        .where(
          and(
            eq(sessaoColetas.id, id),
            eq(sessaoColetas.contaId, contaId),
            eq(sessaoColetas.usuarioId, session.user.id),
            eq(sessaoColetas.status, "ativa"),
          ),
        )
        .returning();
      return row ?? null;
    });

    if (!encerrada) {
      return NextResponse.json(
        { error: "Sessão não encontrada ou já encerrada" },
        { status: 404 },
      );
    }

    return NextResponse.json({ sessao: encerrada });
  } catch (error) {
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    console.error("[coletas/sessao/encerrar]:", error);
    return NextResponse.json(
      { error: "Erro ao encerrar sessão" },
      { status: 500 },
    );
  }
}
