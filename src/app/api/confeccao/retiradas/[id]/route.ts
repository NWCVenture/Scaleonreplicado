// DELETE /api/confeccao/retiradas/[id] — cancela retirada (só se subconferência ainda em_andamento)

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { withContaAtiva } from "@/lib/tenancy";
import { confeccaoRetirada } from "@/lib/db/schema";
import {
  cancelarRetirada,
  RetiradaError,
} from "@/lib/confeccao/criar-retirada";
import {
  assertOpAtivaBySubtask,
  OpCanceladaError,
} from "@/lib/confeccao/assert-op-ativa";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return (
    msg.includes("conta ativa") ||
    msg.includes("Sessão") ||
    msg.includes("Nenhuma")
  );
}

export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    const { id } = await ctx.params;

    await withContaAtiva(async (tx, contaId) => {
      const [r] = await tx
        .select({ subtaskCosturaId: confeccaoRetirada.subtaskCosturaId })
        .from(confeccaoRetirada)
        .where(
          and(
            eq(confeccaoRetirada.id, id),
            eq(confeccaoRetirada.contaId, contaId),
          ),
        );
      if (r) {
        await assertOpAtivaBySubtask(tx, contaId, r.subtaskCosturaId);
      }
      return cancelarRetirada(tx, {
        contaId,
        retiradaId: id,
        usuarioId: session.user.id,
      });
    });

    return NextResponse.json({ deleted: true });
  } catch (err) {
    if (err instanceof OpCanceladaError) {
      return NextResponse.json(
        { error: err.message, code: "op_cancelada" },
        { status: 409 },
      );
    }
    if (err instanceof RetiradaError) {
      const status = err.code === "retirada_nao_encontrada" ? 404 : 400;
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status },
      );
    }
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Erro ao cancelar retirada" },
      { status: 500 },
    );
  }
}
