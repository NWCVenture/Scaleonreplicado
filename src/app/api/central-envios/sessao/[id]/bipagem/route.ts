// POST / GET /api/central-envios/sessao/[id]/bipagem
//
// POST: adiciona um bipe. Classifica via RITM-16, persiste se não-bloqueante,
// detecta duplicação cross-session e cria notificações nas outras sessões.
// CANCELADO bloqueante NÃO é persistido — espera decisão via /decidir-cancelado.
//
// GET: lista bipes da sessão ordenados por bipado_em DESC.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { withContaAtiva } from "@/lib/tenancy";
import {
  centralEnviosBipagemPacote,
  sessaoCentralEnvios,
} from "@/lib/db/schema";
import {
  classificarBipe,
  classificarBipeRastreador,
} from "@/lib/central-envios/bipagem/classificador";
import { montarContextoClassificacao } from "@/lib/central-envios/bipagem/contexto";
import {
  persistirBipe,
  persistirRastreador,
} from "@/lib/central-envios/bipagem/persistir";
import type { PedidoEnriquecido } from "@/lib/central-envios/sessao/types";
import type {
  ResultadoClassificacao,
  ResultadoRastreador,
} from "@/lib/central-envios/bipagem/types";

const BodySchema = z.object({
  codigoBipado: z.string().min(1).max(200),
  modo: z.enum(["NORMAL", "RASTREADOR"]).optional(),
  // Lista de trackings pendentes de localização (modo rastreador).
  // Cliente envia porque é derivado do estado da UI.
  pendentesLocalizar: z.array(z.string()).optional(),
});

type Ctx = { params: Promise<{ id: string }> };

function resumoPedido(p: PedidoEnriquecido | null) {
  if (!p) return null;
  return {
    orderId: p.orderId,
    trackingId: p.trackingId,
    canal: p.canal,
    comprador: p.comprador,
    criadoEmIso: p.criadoEmIso,
    camposExtras: p.camposExtras,
    parsed: p.parsed,
    prazo: p.prazo,
  };
}

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

  const modo = parsed.data.modo ?? "NORMAL";
  const pendentesLocalizar = new Set(parsed.data.pendentesLocalizar ?? []);

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
      if (!row) return { notFound: true } as const;

      // dados da sessão (inline ou blob)
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

      type RespostaBipe = Awaited<ReturnType<typeof formatarResposta>>;
      type RespostaRastreador = Awaited<
        ReturnType<typeof formatarRespostaRastreador>
      >;
      const resultados: Array<RespostaBipe | RespostaRastreador> = [];

      if (modo === "RASTREADOR") {
        const classificados = classificarBipeRastreador(
          parsed.data.codigoBipado,
          ctx,
          pendentesLocalizar,
        );
        for (const r of classificados) {
          const pers = await persistirRastreador({
            tx,
            contaId,
            sessaoId: id,
            usuarioId: session.user.id,
            resultado: r,
          });
          resultados.push(await formatarRespostaRastreador(r, pers));
        }
      } else {
        const classificados = classificarBipe(parsed.data.codigoBipado, ctx);
        for (const r of classificados) {
          const pers = await persistirBipe({
            tx,
            contaId,
            sessaoId: id,
            usuarioId: session.user.id,
            resultado: r,
          });
          resultados.push(await formatarResposta(r, pers));
        }
      }

      await tx
        .update(sessaoCentralEnvios)
        .set({ ultimaAtividadeEm: new Date() })
        .where(eq(sessaoCentralEnvios.id, id));

      return { notFound: false, resultados } as const;
    });

    if (out.notFound) {
      return NextResponse.json(
        { error: "Sessão não encontrada ou não está ativa" },
        { status: 404 },
      );
    }
    return NextResponse.json({ resultados: out.resultados });
  } catch (err) {
    console.error("[central-envios/sessao/[id]/bipagem] POST:", err);
    return NextResponse.json(
      { error: (err as Error).message ?? "Erro interno" },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest, { params }: Ctx) {
  const { id } = await params;

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  try {
    const bipes = await withContaAtiva(async (tx, contaId) => {
      // Confirma a sessão pertence à conta (RLS já filtra, mas garante 404 limpo)
      const [s] = await tx
        .select({ id: sessaoCentralEnvios.id })
        .from(sessaoCentralEnvios)
        .where(
          and(
            eq(sessaoCentralEnvios.id, id),
            eq(sessaoCentralEnvios.contaId, contaId),
          ),
        )
        .limit(1);
      if (!s) return null;

      return tx
        .select({
          id: centralEnviosBipagemPacote.id,
          codigoBipado: centralEnviosBipagemPacote.codigoBipado,
          trackingId: centralEnviosBipagemPacote.trackingId,
          orderId: centralEnviosBipagemPacote.orderId,
          canal: centralEnviosBipagemPacote.canal,
          categoria: centralEnviosBipagemPacote.categoria,
          transportadora: centralEnviosBipagemPacote.transportadora,
          acaoCancelado: centralEnviosBipagemPacote.acaoCancelado,
          bipadoEm: centralEnviosBipagemPacote.bipadoEm,
        })
        .from(centralEnviosBipagemPacote)
        .where(eq(centralEnviosBipagemPacote.sessaoId, id))
        .orderBy(desc(centralEnviosBipagemPacote.bipadoEm));
    });

    if (bipes === null) {
      return NextResponse.json(
        { error: "Sessão não encontrada" },
        { status: 404 },
      );
    }
    return NextResponse.json({ bipes });
  } catch (err) {
    console.error("[central-envios/sessao/[id]/bipagem] GET:", err);
    return NextResponse.json(
      { error: (err as Error).message ?? "Erro interno" },
      { status: 500 },
    );
  }
}

async function formatarResposta(
  r: ResultadoClassificacao,
  pers: Awaited<ReturnType<typeof persistirBipe>>,
) {
  return {
    bipagemId: pers.bipagemId,
    persistido: pers.persistido,
    categoria: r.categoria,
    codigoBipado: r.codigoBipado,
    trackingId: r.trackingId,
    orderId: r.orderId,
    pedido: resumoPedido(r.pedido),
    transportadora: r.transportadora,
    bloqueante: r.bloqueante,
    duplicacoesCrossSessao: pers.duplicacoesCrossSessao,
  };
}

async function formatarRespostaRastreador(
  r: ResultadoRastreador,
  pers: Awaited<ReturnType<typeof persistirRastreador>>,
) {
  return {
    bipagemId: pers.bipagemId,
    persistido: pers.persistido,
    categoria: r.categoria,
    codigoBipado: r.codigoBipado,
    trackingId: r.trackingId,
    orderId: r.pedido?.orderId ?? null,
    pedido: resumoPedido(r.pedido),
    transportadora: r.transportadora,
    bloqueante: false,
    duplicacoesCrossSessao: pers.duplicacoesCrossSessao,
  };
}
