// GET  /api/webhooks/lalamove — health check / verificação de URL pelo
//   Partner Portal da Lalamove. Sempre 200.
//
// POST /api/webhooks/lalamove — recebe eventos da Lalamove (RITM-27).
//
// Política de assinatura (descoberta durante setup): a doc oficial da
// Lalamove v3 NÃO documenta secret de webhook nem header de assinatura
// — só pede que o endpoint retorne 200. Implementação atual:
//   - LALAMOVE_WEBHOOK_SECRET ausente → processa sem validar assinatura.
//     Logamos todos os headers do request pra a gente descobrir, no
//     primeiro webhook real, se a Lalamove está enviando algum header
//     de auth não documentado.
//   - LALAMOVE_WEBHOOK_SECRET presente → exige assinatura HMAC válida.
//     Caminho seguro pra quando confirmarmos que Lalamove de fato assina.
//
// Fluxo:
//   1. Lê body cru.
//   2. Se SECRET presente: valida assinatura, 401 se inválida.
//      Se SECRET ausente: pula validação + log headers (modo investigação).
//   3. Parse JSON. Sem orderId → 200 + log.
//   4. INSERT em confeccao_lalamove_webhook_event (processado=false).
//   5. Agenda processamento via `after()` (Next 16).
//   6. Retorna 200 em < 1s.

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

// Health check / verificação de reachability pelo Partner Portal.
// Lalamove (e outras integrações) podem testar a URL com GET antes de
// permitir o cadastro do webhook. Sempre 200.
export function GET() {
  return NextResponse.json(
    { ok: true, endpoint: "lalamove-webhook" },
    { status: 200 },
  );
}

export async function POST(request: NextRequest) {
  const secret = process.env.LALAMOVE_WEBHOOK_SECRET;
  const bodyRaw = await request.text();
  const assinatura =
    HEADERS_ASSINATURA.map((h) => request.headers.get(h)).find(
      (v) => v && v.length > 0,
    ) ?? null;

  if (secret) {
    // Caminho seguro: secret cadastrado → exige assinatura válida.
    if (!verificarAssinaturaWebhook({ bodyRaw, assinatura, secret })) {
      console.warn("[webhook lalamove] assinatura inválida");
      return NextResponse.json(
        { error: "assinatura inválida" },
        { status: 401 },
      );
    }
  } else {
    // Modo investigação: a doc da Lalamove v3 não documenta assinatura.
    // Logamos todos os headers do primeiro webhook real pra confirmar se
    // a Lalamove envia algum header de auth não documentado. Quando
    // descobrirmos, cadastramos LALAMOVE_WEBHOOK_SECRET e o caminho
    // seguro acima passa a valer.
    const headerEntries: Record<string, string> = {};
    request.headers.forEach((v, k) => {
      // Filtra headers de infra pra reduzir ruído nos logs
      if (
        !k.startsWith("x-vercel-") &&
        !k.startsWith("x-forwarded-") &&
        !["host", "connection", "accept-encoding"].includes(k)
      ) {
        headerEntries[k] = v;
      }
    });
    console.warn(
      "[webhook lalamove] sem LALAMOVE_WEBHOOK_SECRET — processando sem validar. Headers recebidos:",
      JSON.stringify(headerEntries),
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
