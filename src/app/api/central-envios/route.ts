// GET /api/central-envios
//
// Lista paginada de planejamentos arquivados da conta ativa.
// Não retorna `dados` nem `dadosBlobUrl` — payload de lista é leve.

import { NextRequest, NextResponse } from "next/server";
import { count, desc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { withContaAtiva } from "@/lib/tenancy";
import { planejamentoEnvios, user } from "@/lib/db/schema";

const LIMIT_DEFAULT = 20;
const LIMIT_MAX = 100;

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return msg.includes("conta ativa") || msg.includes("Sessão");
}

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? LIMIT_DEFAULT);
  const offsetRaw = Number(url.searchParams.get("offset") ?? 0);
  const limit = Math.min(
    Math.max(1, Number.isFinite(limitRaw) ? limitRaw : LIMIT_DEFAULT),
    LIMIT_MAX,
  );
  const offset = Math.max(0, Number.isFinite(offsetRaw) ? offsetRaw : 0);

  try {
    const { planejamentos, total } = await withContaAtiva(async (tx, contaId) => {
      const rows = await tx
        .select({
          id: planejamentoEnvios.id,
          geradoEm: planejamentoEnvios.geradoEm,
          dataReferencia: planejamentoEnvios.dataReferencia,
          usuarioId: planejamentoEnvios.usuarioId,
          usuarioNome: user.name,
          totalPedidos: planejamentoEnvios.totalPedidos,
          totalAtrasados: planejamentoEnvios.totalAtrasados,
          totalHoje: planejamentoEnvios.totalHoje,
          totalAmbiguos: planejamentoEnvios.totalAmbiguos,
          totalArquivos: planejamentoEnvios.totalArquivos,
          emailEnviadoPara: planejamentoEnvios.emailEnviadoPara,
          emailEnviadoEm: planejamentoEnvios.emailEnviadoEm,
        })
        .from(planejamentoEnvios)
        .leftJoin(user, eq(planejamentoEnvios.usuarioId, user.id))
        .where(eq(planejamentoEnvios.contaId, contaId))
        .orderBy(desc(planejamentoEnvios.geradoEm))
        .limit(limit)
        .offset(offset);

      const [{ value: totalCount }] = await tx
        .select({ value: count() })
        .from(planejamentoEnvios)
        .where(eq(planejamentoEnvios.contaId, contaId));

      return {
        planejamentos: rows.map((r) => ({
          ...r,
          geradoEm: r.geradoEm.toISOString(),
          emailEnviadoEm: r.emailEnviadoEm
            ? r.emailEnviadoEm.toISOString()
            : null,
        })),
        total: Number(totalCount),
      };
    });

    return NextResponse.json({ planejamentos, total, limit, offset });
  } catch (err) {
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: (err as Error).message }, { status: 403 });
    }
    console.error("[central-envios] GET:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
