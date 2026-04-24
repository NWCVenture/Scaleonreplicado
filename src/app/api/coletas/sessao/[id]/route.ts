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

const patchSchema = z.object({
  tipo: z.enum(["FLEX", "COLETA", "DEVOLUCAO", "CANCELADO"]).optional(),
  conta: z.enum(["TIKTOK_SHOP", "MERCADO_LIVRE", "SHOPEE"]).optional(),
  pacotes: z.array(z.string()).optional(),
  devolucoesData: z.record(z.string(), z.unknown()).optional(),
});

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    const { id } = await ctx.params;
    const body = await request.json();
    const data = patchSchema.parse(body);

    const atualizada = await withContaAtiva(async (tx, contaId) => {
      const update: Record<string, unknown> = {
        ultimaAtividadeEm: new Date(),
      };
      if (data.tipo !== undefined) update.tipo = data.tipo;
      if (data.conta !== undefined) update.conta = data.conta;
      if (data.pacotes !== undefined) {
        update.pacotes = data.pacotes;
        update.totalPacotes = data.pacotes.length;
      }
      if (data.devolucoesData !== undefined) {
        update.devolucoesData = data.devolucoesData;
      }

      const [row] = await tx
        .update(sessaoColetas)
        .set(update)
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

    if (!atualizada) {
      return NextResponse.json(
        { error: "Sessão não encontrada ou já encerrada" },
        { status: 404 },
      );
    }

    return NextResponse.json({ sessao: atualizada });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Dados inválidos", details: error.issues },
        { status: 400 },
      );
    }
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    console.error("[coletas/sessao/id] PATCH:", error);
    return NextResponse.json(
      { error: "Erro ao atualizar sessão" },
      { status: 500 },
    );
  }
}
