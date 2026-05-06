import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  historicoImpressaoEtiquetas,
  sessaoExpedicao,
  trackingIdImpresso,
  user,
} from "@/lib/db/schema";
import { and, desc, eq, gt, inArray, lt } from "drizzle-orm";
import { generateId } from "@/lib/utils";
import { withContaAtiva } from "@/lib/tenancy";
import type { db as dbType } from "@/lib/db";

type Tx = Parameters<Parameters<typeof dbType.transaction>[0]>[0];

// Retenção do blob (PDF baixado) — 10 dias. Independente da janela de dedup.
const RETENCAO_MS = 10 * 24 * 60 * 60 * 1000;

// Janela de dedup por trackingId — 30 dias. Linhas em `tracking_id_impresso`
// vivem por esse intervalo. POST sem `confirmReprint=true` aborta com 409
// quando há conflito; o cliente reapresenta com a flag pra reimprimir.
const DEDUP_RETENCAO_MS = 30 * 24 * 60 * 60 * 1000;

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return msg.includes("conta ativa") || msg.includes("Sessão");
}

// Limpeza oportunística — deleta blob + marca cleaned_up=true para registros
// expirados. Roda no GET pra não precisar de cron dedicado.
async function cleanupExpired(tx: Tx, contaId: string): Promise<void> {
  const expirados = await tx
    .select({
      id: historicoImpressaoEtiquetas.id,
      blobUrl: historicoImpressaoEtiquetas.blobUrl,
    })
    .from(historicoImpressaoEtiquetas)
    .where(
      and(
        eq(historicoImpressaoEtiquetas.contaId, contaId),
        eq(historicoImpressaoEtiquetas.cleanedUp, false),
        lt(historicoImpressaoEtiquetas.expiresAt, new Date()),
      ),
    );
  if (expirados.length > 0) {
    const { del } = await import("@vercel/blob");
    for (const row of expirados) {
      try {
        await del(row.blobUrl);
      } catch {
        // Blob pode já ter sido removido manualmente — ignora e marca cleaned_up
      }
      await tx
        .update(historicoImpressaoEtiquetas)
        .set({ cleanedUp: true })
        .where(eq(historicoImpressaoEtiquetas.id, row.id));
    }
  }

  // Cleanup da janela de dedup (30d) — independente do blob (10d).
  // Linhas em tracking_id_impresso podem viver depois do blob ter sido
  // removido (cleaned_up=true no histórico).
  await tx
    .delete(trackingIdImpresso)
    .where(
      and(
        eq(trackingIdImpresso.contaId, contaId),
        lt(trackingIdImpresso.expiraEm, new Date()),
      ),
    );
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const result = await withContaAtiva(async (tx, contaId) => {
      await cleanupExpired(tx, contaId);
      return tx
        .select({
          id: historicoImpressaoEtiquetas.id,
          blobUrl: historicoImpressaoEtiquetas.blobUrl,
          fileName: historicoImpressaoEtiquetas.fileName,
          groupLabel: historicoImpressaoEtiquetas.groupLabel,
          subgroupIds: historicoImpressaoEtiquetas.subgroupIds,
          trackingIds: historicoImpressaoEtiquetas.trackingIds,
          pageCount: historicoImpressaoEtiquetas.pageCount,
          expiresAt: historicoImpressaoEtiquetas.expiresAt,
          createdAt: historicoImpressaoEtiquetas.createdAt,
          usuarioNome: user.name,
          usuarioEmail: user.email,
        })
        .from(historicoImpressaoEtiquetas)
        .leftJoin(user, eq(historicoImpressaoEtiquetas.usuarioId, user.id))
        .where(
          and(
            eq(historicoImpressaoEtiquetas.contaId, contaId),
            eq(historicoImpressaoEtiquetas.cleanedUp, false),
            gt(historicoImpressaoEtiquetas.expiresAt, new Date()),
          ),
        )
        .orderBy(desc(historicoImpressaoEtiquetas.createdAt));
    });

    return NextResponse.json({ historico: result });
  } catch (error) {
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    console.error("Erro ao listar histórico:", error);
    return NextResponse.json(
      { error: "Erro ao listar histórico" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    // Body é JSON: o cliente já fez upload direto pro Blob (via
    // /historico/upload-url) e nos passa só a URL + metadata.
    const body = (await request.json().catch(() => null)) as {
      blobUrl?: unknown;
      fileName?: unknown;
      groupLabel?: unknown;
      pageCount?: unknown;
      subgroupIds?: unknown;
      trackingIds?: unknown;
      skusCount?: unknown;
      sessaoId?: unknown;
      confirmReprint?: unknown;
    } | null;

    if (!body || typeof body.blobUrl !== "string" || !body.blobUrl) {
      return NextResponse.json(
        { error: "blobUrl ausente" },
        { status: 400 },
      );
    }

    const blobUrl = body.blobUrl;
    const fileName =
      typeof body.fileName === "string" && body.fileName
        ? body.fileName
        : "etiquetas.pdf";
    const groupLabel =
      typeof body.groupLabel === "string" ? body.groupLabel : "";
    const pageCount =
      typeof body.pageCount === "number" && Number.isFinite(body.pageCount)
        ? Math.max(0, Math.floor(body.pageCount))
        : 0;
    const sessaoId =
      typeof body.sessaoId === "string" && body.sessaoId
        ? body.sessaoId
        : null;

    const subgroupIds: string[] = Array.isArray(body.subgroupIds)
      ? body.subgroupIds.map((v) => String(v))
      : [];

    // Tracking IDs deduplicados e filtrados (descarta vazios).
    const trackingIds: string[] = Array.isArray(body.trackingIds)
      ? Array.from(
          new Set(
            body.trackingIds
              .map((v) => String(v).trim())
              .filter((v) => v.length > 0),
          ),
        )
      : [];

    const skusCount: Record<string, number> = {};
    if (
      body.skusCount &&
      typeof body.skusCount === "object" &&
      !Array.isArray(body.skusCount)
    ) {
      for (const [k, v] of Object.entries(
        body.skusCount as Record<string, unknown>,
      )) {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) skusCount[k] = Math.floor(n);
      }
    }

    const confirmReprint = body.confirmReprint === true;

    const id = generateId();
    const expiresAt = new Date(Date.now() + RETENCAO_MS);
    const dedupExpiraEm = new Date(Date.now() + DEDUP_RETENCAO_MS);

    const result = await withContaAtiva(async (tx, contaId) => {
      // 1. Valida duplicatas server-side. Se algum tracking já estiver na
      // janela de 30d e o cliente não tiver confirmado reimpressão, aborta
      // com 409 — a UI exibe os duplicados e reenvia com confirmReprint=true.
      let conflictingTrackings: string[] = [];
      if (trackingIds.length > 0) {
        const conflicts = await tx
          .select({
            trackingId: trackingIdImpresso.trackingId,
          })
          .from(trackingIdImpresso)
          .where(
            and(
              eq(trackingIdImpresso.contaId, contaId),
              inArray(trackingIdImpresso.trackingId, trackingIds),
              gt(trackingIdImpresso.expiraEm, new Date()),
            ),
          );
        conflictingTrackings = Array.from(
          new Set(conflicts.map((c) => c.trackingId)),
        );
      }

      let isReprint = false;
      if (conflictingTrackings.length > 0) {
        if (!confirmReprint) {
          return {
            kind: "conflict" as const,
            conflicts: conflictingTrackings,
          };
        }
        isReprint = true;
      }

      // 2. Valida que a sessão, se informada, pertence ao usuário e está ativa
      let sessaoIdValida: string | null = null;
      if (sessaoId) {
        const [sessao] = await tx
          .select({ id: sessaoExpedicao.id })
          .from(sessaoExpedicao)
          .where(
            and(
              eq(sessaoExpedicao.id, sessaoId),
              eq(sessaoExpedicao.contaId, contaId),
              eq(sessaoExpedicao.usuarioId, session.user.id),
              eq(sessaoExpedicao.status, "ativa"),
            ),
          )
          .limit(1);
        if (sessao) sessaoIdValida = sessao.id;
      }

      const [row] = await tx
        .insert(historicoImpressaoEtiquetas)
        .values({
          id,
          contaId,
          usuarioId: session.user.id,
          sessaoId: sessaoIdValida,
          blobUrl,
          fileName,
          groupLabel,
          subgroupIds,
          trackingIds,
          skusCount,
          pageCount,
          expiresAt,
        })
        .returning();

      // 3. INSERT batch em tracking_id_impresso — uma linha por tracking,
      // com reimpressao=true se o cliente confirmou reimpressão de duplicado.
      if (trackingIds.length > 0) {
        await tx.insert(trackingIdImpresso).values(
          trackingIds.map((tid) => ({
            id: generateId(),
            contaId,
            trackingId: tid,
            historicoId: id,
            usuarioId: session.user.id,
            groupLabel,
            reimpressao: isReprint,
            expiraEm: dedupExpiraEm,
          })),
        );
      }

      // 4. Atualiza contadores da sessão (atomic: SELECT ... FOR UPDATE + UPDATE)
      if (sessaoIdValida && pageCount > 0) {
        const [sessaoRow] = await tx
          .select({
            totalEtiquetas: sessaoExpedicao.totalEtiquetas,
            skusContagem: sessaoExpedicao.skusContagem,
          })
          .from(sessaoExpedicao)
          .where(eq(sessaoExpedicao.id, sessaoIdValida))
          .for("update");
        if (sessaoRow) {
          const contagemAtual = { ...(sessaoRow.skusContagem ?? {}) };
          for (const [sku, qtd] of Object.entries(skusCount)) {
            contagemAtual[sku] = (contagemAtual[sku] ?? 0) + qtd;
          }
          await tx
            .update(sessaoExpedicao)
            .set({
              totalEtiquetas: sessaoRow.totalEtiquetas + pageCount,
              skusContagem: contagemAtual,
            })
            .where(eq(sessaoExpedicao.id, sessaoIdValida));
        }
      }

      return { kind: "ok" as const, row };
    });

    if (result.kind === "conflict") {
      return NextResponse.json(
        {
          error: "Etiquetas já impressas nos últimos 30 dias",
          conflicts: result.conflicts,
        },
        { status: 409 },
      );
    }

    return NextResponse.json(result.row, { status: 201 });
  } catch (error) {
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    console.error("Erro ao salvar histórico:", error);
    const msg =
      error instanceof Error ? error.message : "Erro ao salvar histórico";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

