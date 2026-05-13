// POST /api/confeccao/subtasks/[id]/iniciar — pendente → em_andamento

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withContaAtiva } from "@/lib/tenancy";
import {
  iniciarSubtask,
  TransicaoSubtaskError,
} from "@/lib/confeccao/transicao-subtask";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return (
    msg.includes("conta ativa") ||
    msg.includes("Sessão") ||
    msg.includes("Nenhuma")
  );
}

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

    const result = await withContaAtiva(async (tx, contaId) =>
      iniciarSubtask(tx, {
        contaId,
        subtaskId: id,
        usuarioId: session.user.id,
      }),
    );

    return NextResponse.json({ subtask: result });
  } catch (err) {
    if (err instanceof TransicaoSubtaskError) {
      const status =
        err.code === "subtask_nao_encontrada" ? 404 : 400;
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status },
      );
    }
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Erro ao iniciar subtask" },
      { status: 500 },
    );
  }
}
