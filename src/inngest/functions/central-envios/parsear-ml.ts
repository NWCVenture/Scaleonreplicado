// Inngest function que processa um upload de Mercado Livre XLSX.
//
// Mesma estrutura de parsear-tiktok.ts — só muda parser, evento e tipo.
// Reusa toda a infra de ingestao_run (status, blob URL, descartes,
// resultado inline/offload).
//
// Tenancy: roda fora de request HTTP — usa withConta(contaId, ...) com
// contaId do payload do evento.

import { eventType, staticSchema, NonRetriableError } from "inngest";
import { put } from "@vercel/blob";
import { and, eq } from "drizzle-orm";
import { inngest } from "../../client";
import { withConta } from "@/lib/tenancy";
import { ingestaoRun } from "@/lib/db/schema";
import {
  parsearMlXlsx,
  ParserError,
} from "@/lib/central-envios/ingestao/parser-ml-xlsx";

export const EVENTO_PARSEAR_ML =
  "central-envios/parsear-ml.solicitado" as const;

type EventoPayload = {
  runId: string;
  contaId: string;
  blobUrl: string;
};

const parsearMlTrigger = eventType(EVENTO_PARSEAR_ML, {
  schema: staticSchema<EventoPayload>(),
});

const TAMANHO_MAX_INLINE = 1_000_000;
const TIMEOUT_DOWNLOAD_MS = 30_000;

function inferirCodigoErro(msg: string): string {
  if (msg.startsWith("arquivo_muito_grande")) return "arquivo_muito_grande";
  if (msg.startsWith("xlsx_invalido")) return "xlsx_invalido";
  if (msg.startsWith("xlsx_sem_sheets")) return "xlsx_sem_sheets";
  if (msg.startsWith("xlsx_sheet_vazio")) return "xlsx_sheet_vazio";
  if (msg.startsWith("xlsx_sem_dados")) return "xlsx_sem_dados";
  if (msg.startsWith("colunas_ausentes")) return "colunas_ausentes";
  if (msg.startsWith("download_falhou")) return "download_falhou";
  return "erro_desconhecido";
}

export const parsearMlFunction = inngest.createFunction(
  {
    id: "central-envios-parsear-ml",
    name: "Central de Envios — Parser ML XLSX",
    triggers: [parsearMlTrigger],
    onFailure: async ({ event }) => {
      const originalData = (
        event.data as { event: { data: EventoPayload } }
      ).event.data;
      const erroMsg =
        (event.data as { error?: { message?: string } }).error?.message ??
        "Falha desconhecida";

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

    const resumo = await step.run("baixar-e-parsear", async () => {
      const response = await fetch(blobUrl, {
        signal: AbortSignal.timeout(TIMEOUT_DOWNLOAD_MS),
      });
      if (!response.ok) {
        throw new Error(`download_falhou: status=${response.status}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());

      try {
        const r = parsearMlXlsx(buffer);
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
