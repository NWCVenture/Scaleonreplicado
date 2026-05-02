import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { trackingIdImpresso, user } from "@/lib/db/schema";
import { and, desc, eq, gt, inArray, lt } from "drizzle-orm";
import { withContaAtiva } from "@/lib/tenancy";
import type { db as dbType } from "@/lib/db";

type Tx = Parameters<Parameters<typeof dbType.transaction>[0]>[0];

// Tipo compartilhado: o front importa via `import type` e usa pra construir
// `printedTrackingDupsByTid: Map<string, TrackingIdDuplicate>`.
export type TrackingIdDuplicate = {
  trackingId: string;
  impressoEm: string; // ISO
  groupLabel: string;
  historicoId: string;
  reimpressao: boolean;
  impressoPor: { nome: string | null; email: string } | null;
};

const MAX_TRACKINGS_POR_REQUEST = 2000;

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return msg.includes("conta ativa") || msg.includes("Sessão");
}

// Cleanup oportunístico — remove linhas com expira_em < now() na conta atual.
// Roda antes da query pra evitar falso-positivo na fronteira da janela.
async function cleanupExpired(tx: Tx, contaId: string): Promise<void> {
  await tx
    .delete(trackingIdImpresso)
    .where(
      and(
        eq(trackingIdImpresso.contaId, contaId),
        lt(trackingIdImpresso.expiraEm, new Date()),
      ),
    );
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as {
      trackingIds?: unknown;
    } | null;

    const rawList = Array.isArray(body?.trackingIds) ? body!.trackingIds : [];
    const trackingIds = Array.from(
      new Set(
        rawList
          .map((v) => String(v).trim())
          .filter((v) => v.length > 0),
      ),
    );

    if (trackingIds.length === 0) {
      return NextResponse.json({ duplicados: [] });
    }
    if (trackingIds.length > MAX_TRACKINGS_POR_REQUEST) {
      return NextResponse.json(
        {
          error: `Máximo de ${MAX_TRACKINGS_POR_REQUEST} tracking IDs por requisição`,
        },
        { status: 413 },
      );
    }

    const duplicados = await withContaAtiva(async (tx, contaId) => {
      await cleanupExpired(tx, contaId);

      const rows = await tx
        .select({
          trackingId: trackingIdImpresso.trackingId,
          impressoEm: trackingIdImpresso.impressoEm,
          groupLabel: trackingIdImpresso.groupLabel,
          historicoId: trackingIdImpresso.historicoId,
          reimpressao: trackingIdImpresso.reimpressao,
          nome: user.name,
          email: user.email,
        })
        .from(trackingIdImpresso)
        .leftJoin(user, eq(trackingIdImpresso.usuarioId, user.id))
        .where(
          and(
            eq(trackingIdImpresso.contaId, contaId),
            inArray(trackingIdImpresso.trackingId, trackingIds),
            gt(trackingIdImpresso.expiraEm, new Date()),
          ),
        )
        .orderBy(desc(trackingIdImpresso.impressoEm));

      // Reduz pra mais recente por trackingId (linhas vêm desc por impressoEm,
      // primeiro hit é o mais recente).
      const seen = new Set<string>();
      const out: TrackingIdDuplicate[] = [];
      for (const r of rows) {
        if (seen.has(r.trackingId)) continue;
        seen.add(r.trackingId);
        out.push({
          trackingId: r.trackingId,
          impressoEm: r.impressoEm.toISOString(),
          groupLabel: r.groupLabel,
          historicoId: r.historicoId,
          reimpressao: r.reimpressao,
          impressoPor: r.email
            ? { nome: r.nome, email: r.email }
            : null,
        });
      }
      return out;
    });

    return NextResponse.json({ duplicados });
  } catch (error) {
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    console.error("Erro no check de tracking IDs:", error);
    return NextResponse.json(
      { error: "Erro ao verificar tracking IDs" },
      { status: 500 },
    );
  }
}
