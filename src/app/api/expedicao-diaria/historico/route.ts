import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  historicoImpressaoEtiquetas,
  sessaoExpedicao,
  user,
} from "@/lib/db/schema";
import { and, desc, eq, gt, lt } from "drizzle-orm";
import { generateId } from "@/lib/utils";
import { withContaAtiva } from "@/lib/tenancy";
import type { db as dbType } from "@/lib/db";

type Tx = Parameters<Parameters<typeof dbType.transaction>[0]>[0];

const RETENCAO_MS = 48 * 60 * 60 * 1000;

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
  if (expirados.length === 0) return;
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

    const formData = await request.formData();
    const file = formData.get("file");
    const fileName = String(formData.get("fileName") ?? "etiquetas.pdf");
    const groupLabel = String(formData.get("groupLabel") ?? "");
    const pageCount = parseInt(String(formData.get("pageCount") ?? "0"), 10) || 0;
    const subgroupIdsRaw = String(formData.get("subgroupIds") ?? "[]");
    const skusCountRaw = String(formData.get("skusCount") ?? "{}");
    const sessaoIdRaw = formData.get("sessaoId");
    const sessaoId =
      typeof sessaoIdRaw === "string" && sessaoIdRaw.length > 0
        ? sessaoIdRaw
        : null;

    if (!(file instanceof Blob)) {
      return NextResponse.json(
        { error: "Arquivo PDF ausente" },
        { status: 400 },
      );
    }

    let subgroupIds: string[] = [];
    try {
      const parsed = JSON.parse(subgroupIdsRaw);
      if (Array.isArray(parsed)) {
        subgroupIds = parsed.map((v) => String(v));
      }
    } catch {
      subgroupIds = [];
    }

    let skusCount: Record<string, number> = {};
    try {
      const parsed = JSON.parse(skusCountRaw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed)) {
          const n = Number(v);
          if (Number.isFinite(n) && n > 0) skusCount[k] = Math.floor(n);
        }
      }
    } catch {
      skusCount = {};
    }

    const id = generateId();
    const buffer = Buffer.from(await file.arrayBuffer());
    const { put } = await import("@vercel/blob");
    const safeName = fileName.replace(/[^\w.\-]/g, "_");
    const blob = await put(
      `expedicao-diaria/${id}/${safeName}`,
      buffer,
      { access: "public" },
    );

    const expiresAt = new Date(Date.now() + RETENCAO_MS);

    const created = await withContaAtiva(async (tx, contaId) => {
      // Valida que a sessão, se informada, pertence ao usuário e está ativa
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
          blobUrl: blob.url,
          fileName,
          groupLabel,
          subgroupIds,
          pageCount,
          expiresAt,
        })
        .returning();

      // Atualiza contadores da sessão (atomic: SELECT ... FOR UPDATE + UPDATE)
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

      return row;
    });

    return NextResponse.json(created, { status: 201 });
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

