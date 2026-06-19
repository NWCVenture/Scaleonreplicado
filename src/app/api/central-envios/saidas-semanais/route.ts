// GET /api/central-envios/saidas-semanais
//
// Retorna saídas reais agregadas por DOW da semana corrente, baseadas na
// sessão central-envios ATIVA mais recente da conta. Usado pelos gráficos
// "Saídas reais" na página da estante (planejamento de giro com dados
// reais em vez de média histórica).
//
// Resposta:
//   { semSessao: true } se não houver sessão ativa.
//   { inicioIso, fimIso, totalPorDow, topSkus, outrosPorDow, outrosCount,
//     pedidosConsiderados, totalSkus, fonte: { nome, sessaoId } } caso contrário.

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { withContaAtiva } from "@/lib/tenancy";
import { sessaoCentralEnvios } from "@/lib/db/schema";
import { hojeIsoSP } from "@/lib/central-envios/prazo/dias-uteis";
import { montarAgregacaoProximos7Dias } from "@/lib/central-envios/agregacao-semanal";
import type { PedidoEnriquecido } from "@/lib/central-envios/sessao/types";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return msg.includes("conta ativa") || msg.includes("Sessão");
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const sessao = await withContaAtiva(async (tx, contaId) => {
      // Sessão ativa mais recente da CONTA (qualquer usuário) — a estante é
      // visão global, não pessoal. Permite operador A subir o CSV e B ver
      // o impacto no estoque.
      const [row] = await tx
        .select()
        .from(sessaoCentralEnvios)
        .where(
          and(
            eq(sessaoCentralEnvios.contaId, contaId),
            eq(sessaoCentralEnvios.status, "ativa"),
          ),
        )
        .orderBy(desc(sessaoCentralEnvios.iniciouEm))
        .limit(1);
      return row ?? null;
    });

    if (!sessao) {
      return NextResponse.json({ semSessao: true });
    }

    // Lê dados — pode estar inline ou no blob.
    let dados: PedidoEnriquecido[] = [];
    if (Array.isArray(sessao.dados)) {
      dados = sessao.dados as PedidoEnriquecido[];
    } else if (sessao.dadosBlobUrl) {
      const resp = await fetch(sessao.dadosBlobUrl, { cache: "no-store" });
      if (resp.ok) {
        dados = (await resp.json()) as PedidoEnriquecido[];
      }
    }

    const hojeIso = hojeIsoSP();
    const agregacao = montarAgregacaoProximos7Dias(dados, hojeIso, {
      maxSkus: 40,
    });

    return NextResponse.json({
      ...agregacao,
      totalSkus: agregacao.topSkus.length + agregacao.outrosCount,
      fonte: {
        sessaoId: sessao.id,
        // Nome curto pra UI mostrar contexto. arquivosIngeridos é jsonb;
        // pega o primeiro filename quando disponível.
        nome: extrairNomeFonte(sessao.arquivosIngeridos),
      },
    });
  } catch (err) {
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    console.error("[central-envios/saidas-semanais] GET:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

function extrairNomeFonte(arquivosIngeridos: unknown): string | null {
  if (!Array.isArray(arquivosIngeridos) || arquivosIngeridos.length === 0) {
    return null;
  }
  const nomes = arquivosIngeridos
    .map((a) =>
      a && typeof a === "object" && "arquivoNome" in a
        ? String((a as { arquivoNome: unknown }).arquivoNome)
        : null,
    )
    .filter((n): n is string => n !== null);
  if (nomes.length === 0) return null;
  if (nomes.length === 1) return nomes[0];
  return `${nomes[0]} +${nomes.length - 1}`;
}
