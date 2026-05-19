// POST /api/confeccao/lalamoves/[id]/cotar
//
// Cria uma cotação via API Lalamove (POST /v3/quotations) e persiste.
// Operador ainda cria pedido manualmente — fase 8A só estima.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireContaAtiva, withContaAtiva } from "@/lib/tenancy";
import { lalamoveFlagHabilitada } from "@/lib/confeccao/lalamove/config";
import {
  cotarLalamove,
  CotacaoError,
} from "@/lib/confeccao/lalamove/cotacao";

const BodySchema = z.object({
  serviceType: z.string().min(1).max(40),
  cityLocode: z.string().max(20).optional(),
  language: z.string().max(10).optional(),
  item: z
    .object({
      quantity: z.string().max(10).optional(),
      weight: z
        .enum(["LESS_THAN_3_KG", "3_KG_TO_10_KG", "MORE_THAN_10_KG"])
        .optional(),
      categories: z.array(z.string().max(40)).optional(),
    })
    .optional(),
});

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return (
    msg.includes("conta ativa") ||
    msg.includes("Sessão") ||
    msg.includes("Nenhuma")
  );
}

const STATUS_POR_CODE: Record<CotacaoError["code"], number> = {
  feature_flag_off: 503,
  lalamove_nao_encontrado: 404,
  lalamove_estado_invalido: 422,
  endereco_sem_coordenadas: 400,
  service_type_invalido: 400,
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
    parsed = BodySchema.parse(await request.json());
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
      cotarLalamove(tx, {
        contaId,
        lalamoveId: id,
        criadaPorId: userId,
        serviceType: parsed.serviceType,
        cityLocode: parsed.cityLocode,
        language: parsed.language,
        item: parsed.item,
      }),
    );

    return NextResponse.json(
      {
        cotacaoId: result.cotacaoId,
        quotationIdApi: result.quotationIdApi,
        valorCotado: result.valorCotado,
        moeda: result.moeda,
        expiraEm: result.expiraEm.toISOString(),
        distanciaMetros: result.distanciaMetros,
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof CotacaoError) {
      return NextResponse.json(
        { error: err.message, code: err.code, ...err.extra },
        { status: STATUS_POR_CODE[err.code] ?? 400 },
      );
    }
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    console.error("Erro ao cotar Lalamove:", err);
    return NextResponse.json(
      { error: "Erro ao cotar" },
      { status: 500 },
    );
  }
}
