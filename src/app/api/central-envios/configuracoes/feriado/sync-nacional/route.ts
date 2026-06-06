// POST /api/central-envios/configuracoes/feriado/sync-nacional
//
// Sincroniza feriados nacionais da BrasilAPI pra um ou mais anos.
// Default: ano corrente + próximo ano (cobre casos onde a operadora
// programa envios próximos da virada do ano).
//
// Requer admin: muda config global da conta.
// Idempotente: rodar 2× pro mesmo ano não duplica registros.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminAtivo } from "@/lib/tenancy";
import { withConta } from "@/lib/tenancy";
import {
  sincronizarFeriadosNacionais,
  type ResultadoSyncFeriados,
} from "@/lib/central-envios/prazo/sincronizar-feriados";
import { hojeIsoSP } from "@/lib/central-envios/prazo/dias-uteis";

const BodySchema = z
  .object({
    anos: z.array(z.number().int().min(2000).max(2100)).optional(),
  })
  .optional();

export async function POST(request: NextRequest) {
  let admin;
  try {
    admin = await requireAdminAtivo();
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 403 },
    );
  }

  let body: { anos?: number[] } | undefined;
  try {
    const json = (await request.json().catch(() => ({}))) as unknown;
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Body inválido" },
        { status: 400 },
      );
    }
    body = parsed.data;
  } catch {
    body = undefined;
  }

  const anoAtual = Number(hojeIsoSP().slice(0, 4));
  const anos = body?.anos?.length
    ? Array.from(new Set(body.anos)).sort((a, b) => a - b)
    : [anoAtual, anoAtual + 1];

  const resultados: ResultadoSyncFeriados[] = [];
  try {
    await withConta(admin.contaId, async (tx) => {
      for (const ano of anos) {
        const r = await sincronizarFeriadosNacionais(tx, admin.contaId, ano);
        resultados.push(r);
      }
    });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg, resultadosParciais: resultados },
      { status: msg.startsWith("sync_falhou") ? 502 : 500 },
    );
  }

  return NextResponse.json({ resultados });
}
