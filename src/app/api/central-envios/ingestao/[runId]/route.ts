// GET /api/central-envios/ingestao/[runId]
//
// Polling endpoint pro frontend acompanhar o processamento de um upload.
// Retorna estado completo do ingestao_run + resultado quando concluído.
//
// Quando o resultado está em Blob (offload por tamanho > 1MB), retorna
// `resultadoUrl` em vez de `resultado` inline — cliente baixa direto.
//
// Tenancy: RLS já isola por conta, mas re-checamos usuario_id pra evitar
// que operador A enumere/leia runs de operador B na mesma conta.

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withContaAtiva } from "@/lib/tenancy";
import { ingestaoRun, type IngestaoRun } from "@/lib/db/schema";
import { auth } from "@/lib/auth";

type RouteParams = { params: Promise<{ runId: string }> };

function serializar(row: IngestaoRun) {
  return {
    runId: row.id,
    status: row.status,
    tipo: row.tipo,
    arquivoNome: row.arquivoNome,
    arquivoTamanhoBytes: row.arquivoTamanhoBytes,
    totalLinhas: row.totalLinhas,
    linhasValidas: row.linhasValidas,
    linhasDescartadas: row.linhasDescartadas,
    descartesResumo: row.descartesResumo,
    resultado: row.resultado,
    resultadoUrl: row.resultadoBlobUrl,
    erro: row.erro,
    erroCodigo: row.erroCodigo,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { runId } = await params;

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }
  const usuarioId = session.user.id;

  try {
    return await withContaAtiva(async (tx) => {
      const rows = await tx
        .select()
        .from(ingestaoRun)
        .where(
          and(eq(ingestaoRun.id, runId), eq(ingestaoRun.usuarioId, usuarioId)),
        )
        .limit(1);

      if (rows.length === 0) {
        return NextResponse.json(
          { error: "Run não encontrado" },
          { status: 404 },
        );
      }
      return NextResponse.json(serializar(rows[0]));
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "Nenhuma conta ativa selecionada.") {
      return NextResponse.json({ error: msg }, { status: 403 });
    }
    console.error("[ingestao/[runId]] erro:", err);
    return NextResponse.json(
      { error: "Falha ao buscar run" },
      { status: 500 },
    );
  }
}
