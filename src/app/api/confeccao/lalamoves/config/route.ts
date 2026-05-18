// GET /api/confeccao/lalamoves/config
//
// Expõe estado da feature flag pra UI decidir se mostra botões da API.
// NÃO retorna apiKey/apiSecret — apenas habilitada + market.

import { NextResponse } from "next/server";
import { requireContaAtiva } from "@/lib/tenancy";
import { getLalamoveConfig } from "@/lib/confeccao/lalamove/config";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return (
    msg.includes("conta ativa") ||
    msg.includes("Sessão") ||
    msg.includes("Nenhuma")
  );
}

export async function GET() {
  try {
    await requireContaAtiva();
  } catch (err) {
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    throw err;
  }

  const cfg = getLalamoveConfig();
  return NextResponse.json({
    flagHabilitada: cfg !== null,
    market: cfg?.market ?? null,
    sandbox: cfg?.host.includes("sandbox") ?? null,
  });
}
