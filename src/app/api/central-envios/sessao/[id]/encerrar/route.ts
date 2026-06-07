// POST /api/central-envios/sessao/[id]/encerrar
//
// Marca a sessão como encerrada. Quando `motivo='finalizada'` e
// `arquivar=true` (default), persiste snapshot em `planejamento_envios`
// e opcionalmente dispara email (lista `enviarEmailPara`).
//
// Falha no INSERT do planejamento aborta o encerro (operador precisa
// saber). Falha no email não bloqueia — registramos só `emailEnviadoPara`
// e `emailEnviadoEm` em caso de sucesso.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { put } from "@vercel/blob";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getContaAtiva, withContaAtiva } from "@/lib/tenancy";
import {
  conta,
  planejamentoEnvios,
  sessaoCentralEnvios,
} from "@/lib/db/schema";
import { generateId } from "@/lib/utils";
import { hojeIsoSP } from "@/lib/central-envios/prazo/dias-uteis";
import { enviarResumoPlanejamento } from "@/lib/central-envios/relatorio/enviar-resumo";
import type {
  ArquivoIngerido,
  EstatisticasSessao,
  PedidoEnriquecido,
} from "@/lib/central-envios/sessao/types";
import type { PlanejamentoSnapshotCliente } from "@/lib/central-envios/relatorio/types";

const TAMANHO_MAX_INLINE = 2_000_000;

const BodySchema = z
  .object({
    motivo: z.enum(["finalizada", "forcada"]),
    arquivar: z.boolean().optional(),
    enviarEmailPara: z
      .array(z.string().email())
      .max(10, "Até 10 destinatários por arquivamento")
      .optional(),
  })
  .refine(
    (b) => !(b.arquivar === true && b.motivo === "forcada"),
    { message: "arquivar=true exige motivo='finalizada'" },
  );

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

  const motivo = parsed.data.motivo;
  // Default: finalizada arquiva; forcada nunca arquiva.
  const arquivar =
    motivo === "forcada"
      ? false
      : parsed.data.arquivar ?? true;
  const destinatarios = parsed.data.enviarEmailPara ?? [];

  try {
    const tx1 = await withContaAtiva(async (tx, contaId) => {
      const [row] = await tx
        .select()
        .from(sessaoCentralEnvios)
        .where(
          and(
            eq(sessaoCentralEnvios.id, id),
            eq(sessaoCentralEnvios.contaId, contaId),
            eq(sessaoCentralEnvios.usuarioId, session.user.id),
          ),
        )
        .limit(1);
      if (!row) return { found: false } as const;
      if (row.status === "encerrada") {
        return { found: true, noop: true } as const;
      }

      // Resolve `dados` antes de qualquer escrita — se for blob e a
      // requisição morrer, queremos saber agora, não depois de marcar
      // a sessão como encerrada.
      let dadosCompletos: PedidoEnriquecido[] = [];
      if (Array.isArray(row.dados)) {
        dadosCompletos = row.dados as PedidoEnriquecido[];
      } else if (row.dadosBlobUrl) {
        const resp = await fetch(row.dadosBlobUrl, {
          signal: AbortSignal.timeout(30_000),
        });
        if (resp.ok) {
          dadosCompletos = (await resp.json()) as PedidoEnriquecido[];
        }
      }

      let planejamentoId: string | null = null;
      let snapshotCliente: PlanejamentoSnapshotCliente | null = null;

      if (arquivar) {
        const estatisticas = (row.estatisticas as EstatisticasSessao | null) ?? null;
        const arquivos = (row.arquivosIngeridos as ArquivoIngerido[]) ?? [];
        const dataReferencia = estatisticas?.hojeIso ?? hojeIsoSP();

        // Persiste dados do snapshot (inline OU blob — mesma regra do composer)
        const serializado = JSON.stringify(dadosCompletos);
        let dadosInline: unknown = null;
        let dadosBlobUrl: string | null = null;
        if (serializado.length < TAMANHO_MAX_INLINE) {
          dadosInline = dadosCompletos;
        } else {
          const novoId = generateId();
          const blob = await put(
            `central-envios/planejamento/${novoId}/dados.json`,
            serializado,
            {
              access: "public",
              addRandomSuffix: false,
              contentType: "application/json",
            },
          );
          dadosBlobUrl = blob.url;
          planejamentoId = novoId;
        }

        const novoId = planejamentoId ?? generateId();
        planejamentoId = novoId;

        const totalPedidos = estatisticas?.totalPedidos ?? dadosCompletos.length;
        const totalAtrasados = estatisticas?.totalAtrasados ?? 0;
        const totalHoje = estatisticas?.totalHoje ?? 0;
        const totalAmbiguos = estatisticas?.totalAmbiguos ?? 0;

        const [inserted] = await tx
          .insert(planejamentoEnvios)
          .values({
            id: novoId,
            contaId,
            usuarioId: session.user.id,
            sessaoId: row.id,
            dataReferencia,
            totalPedidos,
            totalAtrasados,
            totalHoje,
            totalAmbiguos,
            totalArquivos: arquivos.length,
            arquivosIngeridos: arquivos,
            estatisticas: estatisticas ?? {},
            dados: dadosInline,
            dadosBlobUrl,
          })
          .returning();

        snapshotCliente = {
          id: inserted.id,
          geradoEm: inserted.geradoEm.toISOString(),
          dataReferencia: inserted.dataReferencia,
          usuarioId: inserted.usuarioId,
          usuarioNome: null,
          arquivosIngeridos: arquivos,
          estatisticas: estatisticas ?? ({} as EstatisticasSessao),
          totalPedidos,
          totalAtrasados,
          totalHoje,
          totalAmbiguos,
          totalArquivos: arquivos.length,
          dados: dadosBlobUrl ? null : dadosCompletos,
          dadosBlobUrl,
          emailEnviadoPara: null,
          emailEnviadoEm: null,
        };
      }

      // Encerra a sessão *depois* de gravar o planejamento. Se o INSERT
      // acima falhou, a transação aborta e a sessão permanece ativa.
      await tx
        .update(sessaoCentralEnvios)
        .set({
          status: "encerrada",
          encerrouEm: new Date(),
          encerradaMotivo: motivo,
        })
        .where(eq(sessaoCentralEnvios.id, id));

      return {
        found: true,
        noop: false,
        planejamentoId,
        snapshotCliente,
      } as const;
    });

    if (!tx1.found) {
      return NextResponse.json(
        { error: "Sessão não encontrada" },
        { status: 404 },
      );
    }
    if (tx1.noop) {
      return NextResponse.json({ ok: true, noop: true });
    }

    // Email é best-effort. Roda fora da transação principal.
    let emailEnviado = false;
    let emailSimulado = false;
    if (arquivar && tx1.snapshotCliente && destinatarios.length > 0) {
      try {
        const ctx = await getContaAtiva();
        if (!ctx.contaId) throw new Error("sem conta ativa pra resolver nome");
        const [contaRow] = await db
          .select({ nome: conta.nome })
          .from(conta)
          .where(eq(conta.id, ctx.contaId))
          .limit(1);
        const contaNome = contaRow?.nome ?? "";

        const result = await enviarResumoPlanejamento({
          planejamento: tx1.snapshotCliente,
          destinatarios,
          contaNome,
        });
        emailEnviado = result.enviado;
        emailSimulado = result.simulado;

        if (result.enviado && tx1.planejamentoId) {
          // Marca envio. Outra transação curta.
          await withContaAtiva(async (tx, contaId) => {
            await tx
              .update(planejamentoEnvios)
              .set({
                emailEnviadoPara: destinatarios,
                emailEnviadoEm: new Date(),
              })
              .where(
                and(
                  eq(planejamentoEnvios.id, tx1.planejamentoId!),
                  eq(planejamentoEnvios.contaId, contaId),
                ),
              );
          });
        }
      } catch (err) {
        console.error(
          "[central-envios/encerrar] email falhou (planejamento já persistido):",
          err,
        );
      }
    }

    return NextResponse.json({
      ok: true,
      noop: false,
      planejamentoId: tx1.planejamentoId,
      emailEnviado,
      emailSimulado,
    });
  } catch (err) {
    console.error("[central-envios/sessao/[id]/encerrar] POST:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

