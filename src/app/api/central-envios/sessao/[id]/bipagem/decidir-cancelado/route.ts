// POST /api/central-envios/sessao/[id]/bipagem/decidir-cancelado
//
// Persiste a decisão do operador para um bipe que veio como CANCELADO
// bloqueante. Re-classifica antes do INSERT (defesa TOCTOU): se o pedido
// não está mais cancelado no snapshot atual, devolve 409.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { withContaAtiva } from "@/lib/tenancy";
import { sessaoCentralEnvios } from "@/lib/db/schema";
import { classificarBipe } from "@/lib/central-envios/bipagem/classificador";
import { montarContextoClassificacao } from "@/lib/central-envios/bipagem/contexto";
import { persistirDecisaoCancelado } from "@/lib/central-envios/bipagem/persistir";
import type { PedidoEnriquecido } from "@/lib/central-envios/sessao/types";

const BodySchema = z.object({
  codigoBipado: z.string().min(1).max(200),
  acao: z.enum(["RETIRADO", "ENVIADO_MESMO_ASSIM"]),
});

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  const { id } = await params;

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const json = await request.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Body inválido" },
      { status: 400 },
    );
  }

  try {
    const out = await withContaAtiva(async (tx, contaId) => {
      const [row] = await tx
        .select()
        .from(sessaoCentralEnvios)
        .where(
          and(
            eq(sessaoCentralEnvios.id, id),
            eq(sessaoCentralEnvios.contaId, contaId),
            eq(sessaoCentralEnvios.usuarioId, session.user.id),
            eq(sessaoCentralEnvios.status, "ativa"),
          ),
        )
        .limit(1);
      if (!row) return { kind: "notFound" } as const;

      let dados: PedidoEnriquecido[] = [];
      if (Array.isArray(row.dados)) {
        dados = row.dados as PedidoEnriquecido[];
      } else if (row.dadosBlobUrl) {
        const resp = await fetch(row.dadosBlobUrl, {
          signal: AbortSignal.timeout(30_000),
        });
        if (resp.ok) {
          dados = (await resp.json()) as PedidoEnriquecido[];
        }
      }

      const ctx = await montarContextoClassificacao({
        tx,
        contaId,
        sessaoId: id,
        dados,
      });

      // Re-classifica. A entrada pode ter múltiplos IDs — só tratamos
      // o primeiro relevante (a UI envia 1 código por decisão).
      const classificados = classificarBipe(parsed.data.codigoBipado, ctx);
      const cancelado = classificados.find((r) => r.categoria === "CANCELADO");
      if (!cancelado) {
        return {
          kind: "conflict",
          classificacoesAtuais: classificados.map((r) => r.categoria),
        } as const;
      }

      const pers = await persistirDecisaoCancelado({
        tx,
        contaId,
        sessaoId: id,
        usuarioId: session.user.id,
        resultado: cancelado,
        acao: parsed.data.acao,
      });

      await tx
        .update(sessaoCentralEnvios)
        .set({ ultimaAtividadeEm: new Date() })
        .where(eq(sessaoCentralEnvios.id, id));

      return {
        kind: "ok",
        bipagemId: pers.bipagemId,
        categoriaPersistida: pers.categoriaPersistida,
        duplicacoesCrossSessao: pers.duplicacoesCrossSessao,
      } as const;
    });

    if (out.kind === "notFound") {
      return NextResponse.json(
        { error: "Sessão não encontrada ou não está ativa" },
        { status: 404 },
      );
    }
    if (out.kind === "conflict") {
      return NextResponse.json(
        {
          error: "Tracking não está mais cancelado",
          classificacoesAtuais: out.classificacoesAtuais,
        },
        { status: 409 },
      );
    }
    return NextResponse.json({
      bipagemId: out.bipagemId,
      categoriaPersistida: out.categoriaPersistida,
      duplicacoesCrossSessao: out.duplicacoesCrossSessao,
    });
  } catch (err) {
    console.error(
      "[central-envios/sessao/[id]/bipagem/decidir-cancelado] POST:",
      err,
    );
    return NextResponse.json(
      { error: (err as Error).message ?? "Erro interno" },
      { status: 500 },
    );
  }
}
