// POST /api/confeccao/ops/[numero]/cancelar — admin cancela OP (RITM-18).
//
// Body:
//   { justificativa: string, autorizadoPorId?: string }
//
// Dupla autorização: se OP está `concluida`, exige `autorizadoPorId` ≠
// canceladaPorId, e autorizador admin/owner ativo.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminAtivo, withContaAtiva } from "@/lib/tenancy";
import { cancelarOP, CancelarOPError } from "@/lib/confeccao/cancelar-op";
import { notificarOpCancelada } from "@/lib/confeccao/email";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return (
    msg.includes("conta ativa") ||
    msg.includes("Sessão") ||
    msg.includes("Nenhuma")
  );
}

const CancelarOPSchema = z.object({
  justificativa: z.string().min(10).max(2000).trim(),
  autorizadoPorId: z.string().min(1).optional(),
});

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ numero: string }> },
) {
  let adminCtx;
  try {
    adminCtx = await requireAdminAtivo();
  } catch {
    return NextResponse.json(
      { error: "Acesso negado — requer admin" },
      { status: 403 },
    );
  }

  try {
    const { numero } = await ctx.params;
    const parsed = CancelarOPSchema.parse(await request.json());

    const result = await withContaAtiva(async (tx, contaId) =>
      cancelarOP(tx, {
        contaId,
        opNumero: numero,
        canceladaPorId: adminCtx.userId,
        justificativa: parsed.justificativa,
        autorizadoPorId: parsed.autorizadoPorId,
      }),
    );

    notificarOpCancelada({
      opId: result.op.id,
      canceladaPorId: adminCtx.userId,
      canceladaPorNome: result.canceladaPorNome,
      autorizadoPorNome: result.autorizadoPorNome,
      justificativa: parsed.justificativa,
    });

    return NextResponse.json({
      op: result.op,
      canceladaPorNome: result.canceladaPorNome,
      autorizadoPorNome: result.autorizadoPorNome,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Dados inválidos", details: err.issues },
        { status: 400 },
      );
    }
    if (err instanceof CancelarOPError) {
      const status = err.code === "op_nao_encontrada" ? 404 : 400;
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status },
      );
    }
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    console.error("Erro ao cancelar OP:", err);
    return NextResponse.json(
      { error: "Erro ao cancelar OP" },
      { status: 500 },
    );
  }
}
