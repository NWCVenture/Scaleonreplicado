// GET /api/central-envios/[id]
//
// Detalhe completo de um planejamento arquivado.
// `dados` é devolvido inline OU `dadosBlobUrl` quando offload — cliente
// busca o blob direto (mesma estratégia da sessão).

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { withContaAtiva } from "@/lib/tenancy";
import { planejamentoEnvios, user } from "@/lib/db/schema";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return msg.includes("conta ativa") || msg.includes("Sessão");
}

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }
  try {
    const planejamento = await withContaAtiva(async (tx, contaId) => {
      const [row] = await tx
        .select({
          id: planejamentoEnvios.id,
          geradoEm: planejamentoEnvios.geradoEm,
          dataReferencia: planejamentoEnvios.dataReferencia,
          usuarioId: planejamentoEnvios.usuarioId,
          usuarioNome: user.name,
          arquivosIngeridos: planejamentoEnvios.arquivosIngeridos,
          estatisticas: planejamentoEnvios.estatisticas,
          totalPedidos: planejamentoEnvios.totalPedidos,
          totalAtrasados: planejamentoEnvios.totalAtrasados,
          totalHoje: planejamentoEnvios.totalHoje,
          totalAmbiguos: planejamentoEnvios.totalAmbiguos,
          totalArquivos: planejamentoEnvios.totalArquivos,
          dados: planejamentoEnvios.dados,
          dadosBlobUrl: planejamentoEnvios.dadosBlobUrl,
          emailEnviadoPara: planejamentoEnvios.emailEnviadoPara,
          emailEnviadoEm: planejamentoEnvios.emailEnviadoEm,
        })
        .from(planejamentoEnvios)
        .leftJoin(user, eq(planejamentoEnvios.usuarioId, user.id))
        .where(
          and(
            eq(planejamentoEnvios.id, id),
            eq(planejamentoEnvios.contaId, contaId),
          ),
        )
        .limit(1);
      if (!row) return null;
      return {
        ...row,
        geradoEm: row.geradoEm.toISOString(),
        emailEnviadoEm: row.emailEnviadoEm
          ? row.emailEnviadoEm.toISOString()
          : null,
      };
    });
    if (!planejamento) {
      return NextResponse.json(
        { error: "Planejamento não encontrado" },
        { status: 404 },
      );
    }
    return NextResponse.json({ planejamento });
  } catch (err) {
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: (err as Error).message }, { status: 403 });
    }
    console.error("[central-envios/[id]] GET:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
