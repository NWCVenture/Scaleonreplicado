// POST /api/confeccao/lalamoves/[id]/cancelar-api
//
// Cancela um pedido na API Lalamove + marca lalamove interno como cancelado.
// Idempotente: chamadas repetidas em lalamove sem orderIdApi ou já cancelado
// retornam 200 com motivo diagnóstico.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminAtivo, withContaAtiva } from "@/lib/tenancy";
import { lalamoveFlagHabilitada } from "@/lib/confeccao/lalamove/config";
import {
  cancelarOrderLalamove,
  CancelarOrderError,
} from "@/lib/confeccao/lalamove/order";

const BodySchema = z.object({
  motivo: z.string().trim().min(1).max(500),
});

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
  let userId: string;
  try {
    const { userId: uid } = await requireAdminAtivo();
    userId = uid;
  } catch (err) {
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Acesso negado — requer admin" },
      { status: 403 },
    );
  }

  if (!lalamoveFlagHabilitada()) {
    return NextResponse.json(
      { error: "Lalamove API desabilitada", code: "feature_flag_off" },
      { status: 503 },
    );
  }

  let parsed: z.infer<typeof BodySchema>;
  try {
    parsed = BodySchema.parse(await request.json().catch(() => ({})));
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Body inválido", details: err.issues },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  try {
    const { id } = await ctx.params;
    const result = await withContaAtiva(async (tx, contaId) =>
      cancelarOrderLalamove(tx, {
        contaId,
        lalamoveId: id,
        canceladaPorId: userId,
        motivo: parsed.motivo,
      }),
    );
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof CancelarOrderError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.code === "lalamove_nao_encontrado" ? 404 : 503 },
      );
    }
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    console.error("Erro ao cancelar pedido Lalamove:", err);
    return NextResponse.json(
      { error: "Erro ao cancelar pedido" },
      { status: 500 },
    );
  }
}
