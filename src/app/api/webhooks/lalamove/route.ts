// POST /api/webhooks/lalamove — recebe eventos da Lalamove (RITM-27).
//
// Fluxo:
//   1. Lê body cru pra validar HMAC.
//   2. Se LALAMOVE_WEBHOOK_SECRET ausente → 503 (config errada nossa).
//   3. Assinatura inválida → 401, sem persistir.
//   4. Parse do JSON. Sem orderId → 200 + log (não bloqueia a Lalamove).
//   5. INSERT em confeccao_lalamove_webhook_event (processado=false),
//      tentando resolver lalamoveId + contaId via orderIdApi.
//   6. Agenda processamento via `after()` (Next 16).
//   7. Retorna 200 em < 1s.

import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { eq } from "drizzle-orm";
import { generateId } from "@/lib/utils";
import { db } from "@/lib/db";
import {
  confeccaoLalamove,
  confeccaoLalamoveWebhookEvent,
  type confeccaoLalamoveWebhookEventoEnum,
} from "@/lib/db/schema";
import { withConta } from "@/lib/tenancy";
import { verificarAssinaturaWebhook } from "@/lib/confeccao/lalamove/webhook-signature";
import { processarWebhookEvent } from "@/lib/confeccao/lalamove/webhook-processor";

// Headers que a Lalamove pode usar pra assinatura (variam por versão).
// Aceitamos o primeiro presente.
const HEADERS_ASSINATURA = [
  "x-lalamove-signature",
  "x-webhook-signature",
  "lalamove-signature",
];

type EventoTipo =
  (typeof confeccaoLalamoveWebhookEventoEnum.enumValues)[number];

function detectarEventoTipo(eventName: unknown): EventoTipo {
  if (typeof eventName !== "string") return "OUTROS";
  const up = eventName.toUpperCase();
  if (up === "ORDER_STATUS_CHANGED") return "ORDER_STATUS_CHANGED";
  if (up === "DRIVER_ASSIGNED") return "DRIVER_ASSIGNED";
  return "OUTROS";
}

export async function POST(request: NextRequest) {
  const secret = process.env.LALAMOVE_WEBHOOK_SECRET;
  if (!secret) {
    // Erro de configuração nossa — retornamos 503 pra que a Lalamove tente
    // de novo. NÃO retorna 2xx aqui senão perdemos o evento permanentemente.
    console.error("[webhook lalamove] LALAMOVE_WEBHOOK_SECRET ausente");
    return NextResponse.json(
      { error: "config ausente" },
      { status: 503 },
    );
  }

  const bodyRaw = await request.text();
  const assinatura =
    HEADERS_ASSINATURA.map((h) => request.headers.get(h)).find(
      (v) => v && v.length > 0,
    ) ?? null;

  if (!verificarAssinaturaWebhook({ bodyRaw, assinatura, secret })) {
    console.warn("[webhook lalamove] assinatura inválida");
    return NextResponse.json(
      { error: "assinatura inválida" },
      { status: 401 },
    );
  }

  let payload: { event?: string; data?: { orderId?: string } };
  try {
    payload = JSON.parse(bodyRaw);
  } catch {
    // Body inválido após assinatura ok é situação anômala — log e 200 pra
    // não suspender o webhook por causa de payload malformado.
    console.error("[webhook lalamove] body JSON inválido após sig ok");
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const orderIdApi = payload?.data?.orderId;
  if (!orderIdApi) {
    console.warn("[webhook lalamove] payload sem data.orderId — ignorado");
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const eventoTipo = detectarEventoTipo(payload.event);

  // Tenta resolver lalamove pelo orderIdApi pra preencher os FKs no INSERT.
  // Sem RLS aqui — webhook é público; busca direto.
  const [lalamove] = await db
    .select({
      id: confeccaoLalamove.id,
      contaId: confeccaoLalamove.contaId,
    })
    .from(confeccaoLalamove)
    .where(eq(confeccaoLalamove.orderIdApi, orderIdApi))
    .limit(1);

  const eventoId = generateId();
  await db.insert(confeccaoLalamoveWebhookEvent).values({
    id: eventoId,
    lalamoveId: lalamove?.id ?? null,
    contaId: lalamove?.contaId ?? null,
    evento: eventoTipo,
    orderIdApi,
    payload: payload as unknown as Record<string, unknown>,
    assinaturaHeader: assinatura,
  });

  // Processa após a resposta. Se a conta é conhecida, roda sob withConta
  // (necessário pro RLS). Se não, o processor não vai achar lalamove e
  // marca como erro — polling fallback resolve no próximo run.
  if (lalamove?.contaId) {
    after(async () => {
      try {
        await withConta(lalamove.contaId, (tx) =>
          processarWebhookEvent(tx, { eventoId }),
        );
      } catch (err) {
        console.error("[webhook lalamove] after() falhou", err);
      }
    });
  }
  // Se contaId NULL, deixa pro polling cron processar (ele já lida com isso).

  return NextResponse.json({ ok: true, eventoId }, { status: 200 });
}
