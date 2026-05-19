// GET /api/confeccao/lalamoves/service-types?city=<locode>
//
// Retorna serviceTypes disponíveis (do cache de GET /v3/cities). Quando
// `city` é informada, filtra; caso contrário, agrega todas as cidades
// retornando lista única.

import { NextRequest, NextResponse } from "next/server";
import { requireContaAtiva } from "@/lib/tenancy";
import { lalamoveFlagHabilitada } from "@/lib/confeccao/lalamove/config";
import { listarServiceTypes } from "@/lib/confeccao/lalamove/cities";
import { LalamoveApiError } from "@/lib/confeccao/lalamove/client";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return (
    msg.includes("conta ativa") ||
    msg.includes("Sessão") ||
    msg.includes("Nenhuma")
  );
}

export async function GET(request: NextRequest) {
  try {
    await requireContaAtiva();
  } catch (err) {
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    throw err;
  }

  if (!lalamoveFlagHabilitada()) {
    return NextResponse.json(
      { error: "Lalamove API desabilitada" },
      { status: 503 },
    );
  }

  try {
    const cityLocode = request.nextUrl.searchParams.get("city") ?? undefined;
    const serviceTypes = await listarServiceTypes(
      cityLocode ? { cityLocode } : undefined,
    );
    return NextResponse.json({ serviceTypes });
  } catch (err) {
    if (err instanceof LalamoveApiError) {
      return NextResponse.json(
        { error: err.message, requestId: err.requestId },
        { status: 502 },
      );
    }
    console.error("Erro ao listar serviceTypes:", err);
    return NextResponse.json(
      { error: "Erro ao consultar Lalamove" },
      { status: 500 },
    );
  }
}
