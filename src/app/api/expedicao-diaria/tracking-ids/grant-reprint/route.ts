import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { trackingIdImpresso } from "@/lib/db/schema";
import { and, eq, gt, inArray } from "drizzle-orm";
import { withContaAtiva } from "@/lib/tenancy";
import {
  signReprintToken,
  validateReprintPassword,
} from "@/lib/expedicao-reprint-token";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return msg.includes("conta ativa") || msg.includes("Sessão");
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    if (!process.env.EXPEDICAO_REPRINT_PASSWORD) {
      return NextResponse.json(
        { error: "Reimpressão indisponível: senha não configurada" },
        { status: 503 },
      );
    }

    const body = (await request.json().catch(() => null)) as {
      password?: unknown;
      trackingIds?: unknown;
    } | null;

    const password = typeof body?.password === "string" ? body.password : "";
    const rawList = Array.isArray(body?.trackingIds) ? body!.trackingIds : [];
    const trackingIds = Array.from(
      new Set(
        rawList
          .map((v) => String(v).trim())
          .filter((v) => v.length > 0),
      ),
    );

    if (trackingIds.length === 0) {
      return NextResponse.json(
        { error: "Lista de tracking IDs vazia" },
        { status: 400 },
      );
    }

    if (!validateReprintPassword(password)) {
      return NextResponse.json(
        { error: "Senha incorreta" },
        { status: 401 },
      );
    }

    // Confere que pelo menos um trackingId está em conflito real — evita
    // emitir token "vazio" (token sem propósito que poderia ser reaproveitado).
    const result = await withContaAtiva(async (tx, contaId) => {
      const conflitos = await tx
        .select({ trackingId: trackingIdImpresso.trackingId })
        .from(trackingIdImpresso)
        .where(
          and(
            eq(trackingIdImpresso.contaId, contaId),
            inArray(trackingIdImpresso.trackingId, trackingIds),
            gt(trackingIdImpresso.expiraEm, new Date()),
          ),
        )
        .limit(1);
      if (conflitos.length === 0) {
        return { conflito: false } as const;
      }
      const signed = signReprintToken({
        contaId,
        usuarioId: session.user.id,
        trackingIds,
      });
      return {
        conflito: true,
        token: signed.token,
        expiresAt: signed.expiresAt.toISOString(),
      } as const;
    });

    if (!result.conflito) {
      return NextResponse.json(
        {
          error:
            "Nenhum dos tracking IDs informados está em conflito ativo — token não emitido",
        },
        { status: 400 },
      );
    }

    return NextResponse.json({
      token: result.token,
      expiresAt: result.expiresAt,
    });
  } catch (error) {
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    console.error("Erro no grant-reprint:", error);
    return NextResponse.json(
      { error: "Erro ao validar senha de reimpressão" },
      { status: 500 },
    );
  }
}
