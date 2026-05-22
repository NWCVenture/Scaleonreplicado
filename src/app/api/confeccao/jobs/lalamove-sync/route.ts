// POST /api/confeccao/jobs/lalamove-sync — RITM-27
//
// Cron handler invocado pela Vercel Cron a cada 5min.
//
// Duas responsabilidades:
//   1. Processa eventos pendentes (processado=false) — cobre after() do
//      webhook que falhou silenciosamente.
//   2. Re-sincroniza lalamoves API ativos cuja updated_at está estagnada
//      (> 10min sem update), chamando GET /v3/orders/{id} e construindo
//      eventos sintéticos pra reusar o processor.
//
// Auth: header `Authorization: Bearer ${CRON_SECRET}` obrigatório.

import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { withConta } from "@/lib/tenancy";
import {
  conta,
  confeccaoLalamove,
  confeccaoLalamoveWebhookEvent,
} from "@/lib/db/schema";
import { generateId } from "@/lib/utils";
import { lalamoveFlagHabilitada } from "@/lib/confeccao/lalamove/config";
import {
  lalamoveRequest,
  LalamoveApiError,
} from "@/lib/confeccao/lalamove/client";
import { processarWebhookEvent } from "@/lib/confeccao/lalamove/webhook-processor";
import {
  sincronizarLocalizacaoMotoristas,
  type SyncLocationResult,
} from "@/lib/confeccao/lalamove/driver-location";

// Status "ativos" no nosso lado — vale a pena sincronizar.
const STATUS_ATIVOS = [
  "procurando_motorista",
  "motorista_designado",
  "a_caminho_coleta",
  "coletado",
] as const;

const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10min — arquitetura

interface Resultado {
  eventosProcessados: number;
  eventosComErro: number;
  lalamovesSyncados: number;
  lalamovesComErroApi: number;
  driverLocation: SyncLocationResult;
}

interface OrderApiResponse {
  orderId: string;
  status?: string;
  driverId?: string | null;
  shareLink?: string;
  priceBreakdown?: Record<string, unknown>;
  stops?: Array<{ stopId: string }>;
}

export async function POST(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[lalamove-sync] CRON_SECRET não configurado");
    return NextResponse.json(
      { error: "servidor mal configurado" },
      { status: 500 },
    );
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }

  if (!lalamoveFlagHabilitada()) {
    // Sem feature flag, cron é noop — não erro.
    return NextResponse.json(
      { ok: true, mensagem: "feature flag off, nada a fazer" },
      { status: 200 },
    );
  }

  const resultado: Resultado = {
    eventosProcessados: 0,
    eventosComErro: 0,
    lalamovesSyncados: 0,
    lalamovesComErroApi: 0,
    driverLocation: {
      consultados: 0,
      atualizados: 0,
      semDriverDisponivel: 0,
      erros: 0,
    },
  };

  // ─── 1. Eventos pendentes ──────────────────────────────────────────────
  // Limit pra cap por execução — se acumular muito, próxima janela varre o resto.
  const eventosPendentes = await db
    .select({
      id: confeccaoLalamoveWebhookEvent.id,
      contaId: confeccaoLalamoveWebhookEvent.contaId,
    })
    .from(confeccaoLalamoveWebhookEvent)
    .where(eq(confeccaoLalamoveWebhookEvent.processado, false))
    .limit(100);

  for (const evt of eventosPendentes) {
    try {
      if (!evt.contaId) {
        // contaId NULL → resolve dentro da tx do processor (lookup do orderIdApi)
        // mas precisamos de uma sessão de tenancy pra rodar. Usa a primeira conta
        // ativa que tenha esse orderIdApi.
        await db.transaction((tx) =>
          processarWebhookEvent(tx, { eventoId: evt.id }),
        );
      } else {
        await withConta(evt.contaId, (tx) =>
          processarWebhookEvent(tx, { eventoId: evt.id }),
        );
      }
      resultado.eventosProcessados++;
    } catch (err) {
      console.error("[lalamove-sync] falha processando evento", evt.id, err);
      resultado.eventosComErro++;
    }
  }

  // ─── 2. Lalamoves estagnados ───────────────────────────────────────────
  // Lista direto do db (sem withConta) — precisamos varrer todas as contas.
  // Operações de UPDATE depois vão sob withConta da conta dona.
  const limiteStale = new Date(Date.now() - STALE_THRESHOLD_MS);
  const lalamovesEstagnados = await db
    .select({
      id: confeccaoLalamove.id,
      contaId: confeccaoLalamove.contaId,
      orderIdApi: confeccaoLalamove.orderIdApi,
      status: confeccaoLalamove.status,
    })
    .from(confeccaoLalamove)
    .where(
      and(
        eq(confeccaoLalamove.origemSolicitacao, "api"),
        inArray(confeccaoLalamove.status, STATUS_ATIVOS),
        lt(confeccaoLalamove.updatedAt, limiteStale),
        sql`${confeccaoLalamove.orderIdApi} IS NOT NULL`,
      ),
    )
    .limit(50);

  for (const lm of lalamovesEstagnados) {
    try {
      const response = await lalamoveRequest<OrderApiResponse>({
        method: "GET",
        path: `/v3/orders/${lm.orderIdApi}`,
      });
      const data = response.data;

      // Injeta evento sintético com o status atual e processa via mesmo pipeline
      const eventoSintetico = await db
        .insert(confeccaoLalamoveWebhookEvent)
        .values({
          id: generateId(),
          lalamoveId: lm.id,
          contaId: lm.contaId,
          evento: "ORDER_STATUS_CHANGED",
          orderIdApi: lm.orderIdApi!,
          payload: {
            event: "ORDER_STATUS_CHANGED",
            source: "polling_sync",
            data: {
              orderId: data.orderId,
              status: data.status,
              timestamp: new Date().toISOString(),
            },
          } as unknown as Record<string, unknown>,
        })
        .returning({ id: confeccaoLalamoveWebhookEvent.id });

      await withConta(lm.contaId, (tx) =>
        processarWebhookEvent(tx, { eventoId: eventoSintetico[0].id }),
      );

      // Se a API retornou driver e não tínhamos ainda, gera segundo evento.
      if (data.driverId) {
        const eventoDriver = await db
          .insert(confeccaoLalamoveWebhookEvent)
          .values({
            id: generateId(),
            lalamoveId: lm.id,
            contaId: lm.contaId,
            evento: "DRIVER_ASSIGNED",
            orderIdApi: lm.orderIdApi!,
            payload: {
              event: "DRIVER_ASSIGNED",
              source: "polling_sync",
              data: {
                orderId: data.orderId,
                driverId: data.driverId,
                timestamp: new Date().toISOString(),
              },
            } as unknown as Record<string, unknown>,
          })
          .returning({ id: confeccaoLalamoveWebhookEvent.id });
        await withConta(lm.contaId, (tx) =>
          processarWebhookEvent(tx, { eventoId: eventoDriver[0].id }),
        );
      }

      resultado.lalamovesSyncados++;
    } catch (err) {
      if (err instanceof LalamoveApiError) {
        console.warn(
          `[lalamove-sync] API erro pra ${lm.orderIdApi}:`,
          err.message,
        );
      } else {
        console.error(
          `[lalamove-sync] erro inesperado pra ${lm.orderIdApi}:`,
          err,
        );
      }
      resultado.lalamovesComErroApi++;
    }
  }

  // ─── 3. Polling de localização dos motoristas (RITM-28) ───────────────
  try {
    resultado.driverLocation = await sincronizarLocalizacaoMotoristas();
  } catch (err) {
    console.error("[lalamove-sync] falha no polling de driver location:", err);
  }

  console.log("[lalamove-sync] resultado:", resultado);
  return NextResponse.json({ ok: true, ...resultado }, { status: 200 });
}

// Silencia warning de import não usado quando outras rotinas precisarem do tipo conta
void conta;
