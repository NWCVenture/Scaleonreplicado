// POST /api/confeccao/lalamoves/[id]/criar-pedido
//
// Cria pedido na API Lalamove a partir de cotação válida. Se a cotação
// expirou, o service re-cota silenciosamente. Retorna orderIdApi, shareLink
// e (quando aplicável) info da nova cotação.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireContaAtiva, withContaAtiva } from "@/lib/tenancy";
import { lalamoveFlagHabilitada } from "@/lib/confeccao/lalamove/config";
import {
  criarOrderLalamove,
  CriarOrderError,
} from "@/lib/confeccao/lalamove/order";

const ContatoSchema = z.object({
  nome: z.string().trim().min(1).max(50),
  telefoneE164: z
    .string()
    .regex(/^\+\d{10,15}$/, "Telefone precisa estar em E.164 (ex: +5511999999999)"),
});

const BodySchema = z.object({
  contatoOrigem: ContatoSchema.optional(),
  contatoDestino: ContatoSchema.optional(),
  remarksDestino: z.string().max(250).optional(),
  metadata: z.record(z.string(), z.string().max(250)).optional(),
});

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return (
    msg.includes("conta ativa") ||
    msg.includes("Sessão") ||
    msg.includes("Nenhuma")
  );
}

const STATUS_POR_CODE: Record<CriarOrderError["code"], number> = {
  feature_flag_off: 503,
  lalamove_nao_encontrado: 404,
  lalamove_estado_invalido: 422,
  cotacao_ausente: 422,
  contato_incompleto: 400,
  api_erro: 502,
};

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  let userId: string;
  try {
    const { userId: uid } = await requireContaAtiva();
    userId = uid;
  } catch (err) {
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    throw err;
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
      criarOrderLalamove(tx, {
        contaId,
        lalamoveId: id,
        criadaPorId: userId,
        contatoOrigem: parsed.contatoOrigem,
        contatoDestino: parsed.contatoDestino,
        remarksDestino: parsed.remarksDestino,
        metadata: parsed.metadata,
      }),
    );

    return NextResponse.json(
      {
        orderIdApi: result.orderIdApi,
        shareLink: result.shareLink,
        status: result.status,
        priceBreakdown: result.priceBreakdown,
        novaCotacao: result.novaCotacao ?? null,
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof CriarOrderError) {
      return NextResponse.json(
        { error: err.message, code: err.code, ...err.extra },
        { status: STATUS_POR_CODE[err.code] ?? 400 },
      );
    }
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    console.error("Erro ao criar pedido Lalamove:", err);
    return NextResponse.json(
      { error: "Erro ao criar pedido" },
      { status: 500 },
    );
  }
}
