// POST /api/central-envios/sessao/[id]/processar
//
// Aciona o composer: dado um array de runIds (ingestões concluídas),
// carrega contextos cadastro/explosão/prazo, enriquece os pedidos
// e faz merge com a sessão. Persiste em jsonb inline (< 2MB
// serializado) ou offload pro Vercel Blob.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { put } from "@vercel/blob";
import { auth } from "@/lib/auth";
import { withContaAtiva } from "@/lib/tenancy";
import { sessaoCentralEnvios } from "@/lib/db/schema";
import { carregarContextoCadastro } from "@/lib/central-envios/normalizacao/carregar-contexto";
import { carregarContextoExplosao } from "@/lib/central-envios/explosao/carregar-contexto-explosao";
import { carregarContextoPrazo } from "@/lib/central-envios/prazo/carregar-contexto-prazo";
import { processarSessao } from "@/lib/central-envios/sessao/composer";
import type {
  ArquivoIngerido,
  PedidoEnriquecido,
} from "@/lib/central-envios/sessao/types";

const TAMANHO_MAX_INLINE = 2_000_000; // 2MB serializado

const BodySchema = z.object({
  runIds: z.array(z.string().min(1)).min(1, "runIds não pode ser vazio"),
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
    const result = await withContaAtiva(async (tx, contaId) => {
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
      if (!row) return { notFound: true } as const;

      // Carrega contextos em paralelo. Cadastro precede explosão.
      const ctxCadastro = await carregarContextoCadastro(tx);
      const [ctxExplosao, ctxPrazo] = await Promise.all([
        carregarContextoExplosao(tx, ctxCadastro),
        carregarContextoPrazo(tx),
      ]);

      // Estado atual da sessão. `dados` pode estar offload — buscar via
      // dadosBlobUrl se inline for null.
      let dadosAtuais: PedidoEnriquecido[] = [];
      if (Array.isArray(row.dados)) {
        dadosAtuais = row.dados as PedidoEnriquecido[];
      } else if (row.dadosBlobUrl) {
        const resp = await fetch(row.dadosBlobUrl, {
          signal: AbortSignal.timeout(30_000),
        });
        if (resp.ok) {
          dadosAtuais = (await resp.json()) as PedidoEnriquecido[];
        }
      }

      const compRes = await processarSessao({
        tx,
        runIds: parsed.data.runIds,
        sessaoAtual: {
          arquivosIngeridos: (row.arquivosIngeridos as ArquivoIngerido[]) ?? [],
          dados: dadosAtuais,
        },
        ctxCadastro,
        ctxExplosao,
        ctxPrazo,
      });

      // Decide inline vs offload.
      const serializado = JSON.stringify(compRes.dados);
      let dadosInline: unknown = null;
      let dadosBlobUrl: string | null = null;
      if (serializado.length < TAMANHO_MAX_INLINE) {
        dadosInline = compRes.dados;
      } else {
        const blob = await put(
          `central-envios/sessao/${id}/dados.json`,
          serializado,
          {
            access: "public",
            addRandomSuffix: false,
            contentType: "application/json",
          },
        );
        dadosBlobUrl = blob.url;
      }

      await tx
        .update(sessaoCentralEnvios)
        .set({
          arquivosIngeridos: compRes.arquivosIngeridos,
          dados: dadosInline,
          dadosBlobUrl,
          estatisticas: compRes.estatisticas,
          ultimaAtividadeEm: new Date(),
        })
        .where(eq(sessaoCentralEnvios.id, id));

      return {
        notFound: false,
        arquivosIngeridos: compRes.arquivosIngeridos,
        estatisticas: compRes.estatisticas,
        dadosInline: dadosInline != null,
      } as const;
    });

    if (result.notFound) {
      return NextResponse.json(
        { error: "Sessão não encontrada ou não está ativa" },
        { status: 404 },
      );
    }
    return NextResponse.json({
      arquivosIngeridos: result.arquivosIngeridos,
      estatisticas: result.estatisticas,
      dadosInline: result.dadosInline,
    });
  } catch (err) {
    console.error("[central-envios/sessao/[id]/processar] POST:", err);
    return NextResponse.json(
      { error: (err as Error).message ?? "Erro interno" },
      { status: 500 },
    );
  }
}
