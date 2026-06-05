// Inngest function que processa um upload de TikTok CSV.
//
// Lifecycle:
//   1. Recebe evento "central-envios/parsear-tiktok.solicitado" com
//      { runId, contaId, blobUrl }.
//   2. Atomic UPDATE ingestao_run: pendente → processando (idempotente).
//   3. Baixa o arquivo do Blob, parseia.
//   4. Persiste resultado em ingestao_run (inline jsonb < 1MB; offload
//      pro Blob acima).
//
// Falha final cai no onFailure handler que grava status='erro' +
// erro_codigo. Inngest tenta automaticamente até 4× com backoff
// exponencial — para erros não retentáveis (formato de arquivo
// inválido), levantamos NonRetriableError pra pular o retry.
//
// Tenancy: roda fora de request HTTP, então usa `withConta(contaId, ...)`
// direto com o contaId do payload — não `withContaAtiva()`.

import { eventType, staticSchema, NonRetriableError } from "inngest";
import { put } from "@vercel/blob";
import { and, eq } from "drizzle-orm";
import { inngest } from "../../client";
import { withConta } from "@/lib/tenancy";
import { ingestaoRun } from "@/lib/db/schema";
import {
  parsearTikTokCsv,
  ParserError,
} from "@/lib/central-envios/ingestao/parser-tiktok-csv";

// ----- Trigger ------------------------------------------------------------

export const EVENTO_PARSEAR_TIKTOK =
  "central-envios/parsear-tiktok.solicitado" as const;

type EventoPayload = {
  runId: string;
  contaId: string;
  blobUrl: string;
};

const parsearTikTokTrigger = eventType(EVENTO_PARSEAR_TIKTOK, {
  schema: staticSchema<EventoPayload>(),
});

// Limite pra inline em jsonb. Acima disso, offload pro Blob.
const TAMANHO_MAX_INLINE = 1_000_000; // 1 MB de JSON serializado

// Timeout do fetch do Blob. CSV típico < 1MB → < 1s. Conservador.
const TIMEOUT_DOWNLOAD_MS = 30_000;

// Mapeia mensagens de erro → erro_codigo canônico pra UI consumir.
function inferirCodigoErro(msg: string): string {
  if (msg.startsWith("arquivo_muito_grande")) return "arquivo_muito_grande";
  if (msg.startsWith("csv_invalido")) return "csv_invalido";
  if (msg.startsWith("csv_vazio")) return "csv_vazio";
  if (msg.startsWith("colunas_ausentes")) return "colunas_ausentes";
  if (msg.startsWith("download_falhou")) return "download_falhou";
  return "erro_desconhecido";
}

// ----- Function -----------------------------------------------------------

export const parsearTikTokFunction = inngest.createFunction(
  {
    id: "central-envios-parsear-tiktok",
    name: "Central de Envios — Parser TikTok CSV",
    triggers: [parsearTikTokTrigger],
    onFailure: async ({ event }) => {
      // event.data.event.data tem o payload original.
      // Casting porque o tipo do evento failure não é o nosso.
      const originalData = (
        event.data as { event: { data: EventoPayload } }
      ).event.data;
      const erroMsg = (event.data as { error?: { message?: string } }).error
        ?.message ?? "Falha desconhecida";

      await withConta(originalData.contaId, async (tx) => {
        await tx
          .update(ingestaoRun)
          .set({
            status: "erro",
            finishedAt: new Date(),
            erro: erroMsg.slice(0, 2000),
            erroCodigo: inferirCodigoErro(erroMsg),
          })
          .where(eq(ingestaoRun.id, originalData.runId));
      });
    },
  },
  async ({ event, step }) => {
    const { runId, contaId, blobUrl } = event.data;

    // ---- Passo 1: marcar como processando (idempotente) -----------------
    //
    // UPDATE ... WHERE status='pendente' garante que retry após sucesso
    // não regrede o estado. Se 0 linhas afetadas → já processou OU não
    // existe → NonRetriableError (sem retry).
    const marcado = await step.run("marcar-processando", async () => {
      return withConta(contaId, async (tx) => {
        const r = await tx
          .update(ingestaoRun)
          .set({ status: "processando", startedAt: new Date() })
          .where(
            and(eq(ingestaoRun.id, runId), eq(ingestaoRun.status, "pendente")),
          )
          .returning({ id: ingestaoRun.id });
        return { afetado: r.length === 1 };
      });
    });

    if (!marcado.afetado) {
      throw new NonRetriableError(
        `Run ${runId} não está em status='pendente' — pulando processamento`,
      );
    }

    // ---- Passo 2: baixar + parsear (fundidos pra evitar transferir
    // Buffer grande entre steps) -----------------------------------------
    //
    // Falhas de rede/HTTP são retentáveis (Inngest re-roda step inteiro).
    // ParserError indica problema no arquivo do usuário — não-retentável.
    const resumo = await step.run("baixar-e-parsear", async () => {
      const response = await fetch(blobUrl, {
        signal: AbortSignal.timeout(TIMEOUT_DOWNLOAD_MS),
      });
      if (!response.ok) {
        throw new Error(`download_falhou: status=${response.status}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());

      try {
        const r = parsearTikTokCsv(buffer);
        return {
          pedidos: r.pedidos,
          totalLinhas: r.totalLinhas,
          linhasValidas: r.linhasValidas,
          linhasDescartadas: r.linhasDescartadas,
          descartesResumo: r.descartesResumo as Record<string, number>,
        };
      } catch (err) {
        if (err instanceof ParserError) {
          throw new NonRetriableError(`${err.codigo}: ${err.message}`);
        }
        throw err;
      }
    });

    // ---- Passo 3: persistir (inline vs offload) ------------------------
    await step.run("persistir-resultado", async () => {
      const serializado = JSON.stringify(resumo.pedidos);
      let resultadoInline: unknown = null;
      let resultadoBlobUrl: string | null = null;

      if (serializado.length < TAMANHO_MAX_INLINE) {
        resultadoInline = resumo.pedidos;
      } else {
        const blob = await put(
          `central-envios/ingestao/resultado/${runId}.json`,
          serializado,
          {
            access: "public",
            addRandomSuffix: false,
            contentType: "application/json",
          },
        );
        resultadoBlobUrl = blob.url;
      }

      await withConta(contaId, async (tx) => {
        await tx
          .update(ingestaoRun)
          .set({
            status: "concluido",
            finishedAt: new Date(),
            totalLinhas: resumo.totalLinhas,
            linhasValidas: resumo.linhasValidas,
            linhasDescartadas: resumo.linhasDescartadas,
            descartesResumo: resumo.descartesResumo,
            resultado: resultadoInline,
            resultadoBlobUrl,
          })
          .where(eq(ingestaoRun.id, runId));
      });
    });

    return { runId, status: "concluido" as const };
  },
);
