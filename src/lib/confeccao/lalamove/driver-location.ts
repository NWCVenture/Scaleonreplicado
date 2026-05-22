// RITM-28 — polling de localização dos motoristas.
//
// Lista lalamoves API ativos com driverIdApi preenchido, busca
// `GET /v3/orders/{orderId}/drivers/{driverId}/location` pra cada um e
// atualiza last_driver_lat/lng/location_at. Roda dentro do cron
// `lalamove-sync` (a cada 5min via GH Actions).
//
// Decisão: sem nota de auditoria por update — localização muda muito,
// viraria spam. Só logs estruturados no servidor.

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { confeccaoLalamove } from "@/lib/db/schema";
import { lalamoveFlagHabilitada } from "./config";
import { lalamoveRequest, LalamoveApiError } from "./client";

const STATUS_COM_DRIVER = [
  "motorista_designado",
  "a_caminho_coleta",
  "coletado",
] as const;

const DEFAULT_LIMIT = 50;

export interface SyncLocationResult {
  consultados: number;
  atualizados: number;
  semDriverDisponivel: number;
  erros: number;
}

interface DriverLocationResponse {
  lat?: string;
  lng?: string;
  // Algumas versões mandam aninhado em coordinates {lat, lng}
  coordinates?: { lat?: string; lng?: string };
  updatedAt?: string;
}

export async function sincronizarLocalizacaoMotoristas(args?: {
  httpRequest?: typeof lalamoveRequest;
  limit?: number;
}): Promise<SyncLocationResult> {
  const result: SyncLocationResult = {
    consultados: 0,
    atualizados: 0,
    semDriverDisponivel: 0,
    erros: 0,
  };

  if (!lalamoveFlagHabilitada()) {
    return result;
  }

  const limit = args?.limit ?? DEFAULT_LIMIT;
  const httpRequest = args?.httpRequest ?? lalamoveRequest;

  const lalamoves = await db
    .select({
      id: confeccaoLalamove.id,
      orderIdApi: confeccaoLalamove.orderIdApi,
      driverIdApi: confeccaoLalamove.driverIdApi,
    })
    .from(confeccaoLalamove)
    .where(
      and(
        eq(confeccaoLalamove.origemSolicitacao, "api"),
        inArray(confeccaoLalamove.status, STATUS_COM_DRIVER),
        sql`${confeccaoLalamove.orderIdApi} IS NOT NULL`,
        sql`${confeccaoLalamove.driverIdApi} IS NOT NULL`,
      ),
    )
    .orderBy(
      sql`${confeccaoLalamove.lastDriverLocationAt} ASC NULLS FIRST`,
    )
    .limit(limit);

  for (const lm of lalamoves) {
    result.consultados++;
    try {
      const res = await httpRequest<DriverLocationResponse>({
        method: "GET",
        path: `/v3/orders/${lm.orderIdApi}/drivers/${lm.driverIdApi}/location`,
      });

      const lat = res.data?.lat ?? res.data?.coordinates?.lat ?? null;
      const lng = res.data?.lng ?? res.data?.coordinates?.lng ?? null;

      if (!lat || !lng) {
        result.semDriverDisponivel++;
        continue;
      }

      await db
        .update(confeccaoLalamove)
        .set({
          lastDriverLat: lat,
          lastDriverLng: lng,
          lastDriverLocationAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(confeccaoLalamove.id, lm.id));
      result.atualizados++;
    } catch (err) {
      if (err instanceof LalamoveApiError) {
        if (err.status === 404) {
          // Driver ainda não reportou location — não é erro real.
          result.semDriverDisponivel++;
          continue;
        }
        console.warn(
          `[driver-location] erro API pra lalamove ${lm.id} (orderId=${lm.orderIdApi}):`,
          err.message,
        );
      } else {
        console.error(
          `[driver-location] erro inesperado pra lalamove ${lm.id}:`,
          err,
        );
      }
      result.erros++;
    }
  }

  return result;
}
