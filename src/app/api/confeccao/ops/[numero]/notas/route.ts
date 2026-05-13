// GET  /api/confeccao/ops/[numero]/notas — lista notas (com incluirSubtasks + apenasAuditoria)
// POST /api/confeccao/ops/[numero]/notas — cria nota manual

import { NextRequest, NextResponse } from "next/server";
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { generateId } from "@/lib/utils";
import { withContaAtiva } from "@/lib/tenancy";
import {
  confeccaoNota,
  confeccaoOrdemProducao,
  confeccaoSubtask,
  user,
} from "@/lib/db/schema";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return (
    msg.includes("conta ativa") ||
    msg.includes("Sessão") ||
    msg.includes("Nenhuma")
  );
}

const CriarNotaSchema = z.object({
  conteudo: z.string().min(1).max(5000).trim(),
});

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ numero: string }> },
) {
  try {
    const { numero } = await ctx.params;
    const sp = request.nextUrl.searchParams;
    const incluirSubtasks = sp.get("incluirSubtasks") === "true";
    const apenasAuditoria = sp.get("apenasAuditoria") === "true";

    const result = await withContaAtiva(async (tx, contaId) => {
      const [op] = await tx
        .select({ id: confeccaoOrdemProducao.id })
        .from(confeccaoOrdemProducao)
        .where(
          and(
            eq(confeccaoOrdemProducao.numero, numero),
            eq(confeccaoOrdemProducao.contaId, contaId),
          ),
        );
      if (!op) return null;

      // IDs de subtasks da OP — se incluirSubtasks, traz notas delas tbm
      let subtaskIds: string[] = [];
      if (incluirSubtasks) {
        const sts = await tx
          .select({ id: confeccaoSubtask.id })
          .from(confeccaoSubtask)
          .where(eq(confeccaoSubtask.ordemProducaoId, op.id));
        subtaskIds = sts.map((s) => s.id);
      }

      const conditions = [eq(confeccaoNota.contaId, contaId)];
      if (apenasAuditoria) {
        conditions.push(eq(confeccaoNota.isAuditoria, true));
      }
      // Notas da OP OU das suas subtasks (se solicitado)
      const filtroEscopo = subtaskIds.length
        ? or(
            eq(confeccaoNota.ordemProducaoId, op.id),
            inArray(confeccaoNota.subtaskId, subtaskIds),
          )
        : eq(confeccaoNota.ordemProducaoId, op.id);
      if (filtroEscopo) conditions.push(filtroEscopo);

      const notas = await tx
        .select({
          id: confeccaoNota.id,
          ordemProducaoId: confeccaoNota.ordemProducaoId,
          subtaskId: confeccaoNota.subtaskId,
          autorId: confeccaoNota.autorId,
          autorNome: user.name,
          conteudo: confeccaoNota.conteudo,
          isAuditoria: confeccaoNota.isAuditoria,
          isInterna: confeccaoNota.isInterna,
          metadata: confeccaoNota.metadata,
          createdAt: confeccaoNota.createdAt,
        })
        .from(confeccaoNota)
        .leftJoin(user, eq(user.id, confeccaoNota.autorId))
        .where(and(...conditions))
        .orderBy(desc(confeccaoNota.createdAt));

      return { items: notas };
    });

    if (!result) {
      return NextResponse.json({ error: "OP não encontrada" }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (err) {
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    console.error("Erro ao listar notas:", err);
    return NextResponse.json(
      { error: "Erro ao listar notas" },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ numero: string }> },
) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const { numero } = await ctx.params;
    const parsed = CriarNotaSchema.parse(await request.json());

    const result = await withContaAtiva(async (tx, contaId) => {
      const [op] = await tx
        .select({ id: confeccaoOrdemProducao.id })
        .from(confeccaoOrdemProducao)
        .where(
          and(
            eq(confeccaoOrdemProducao.numero, numero),
            eq(confeccaoOrdemProducao.contaId, contaId),
          ),
        );
      if (!op) return { notFound: true as const };

      const [nota] = await tx
        .insert(confeccaoNota)
        .values({
          id: generateId(),
          contaId,
          ordemProducaoId: op.id,
          autorId: session.user.id,
          conteudo: parsed.conteudo,
          isAuditoria: false,
          isInterna: true,
        })
        .returning();
      return { ok: true as const, nota };
    });

    if ("notFound" in result) {
      return NextResponse.json({ error: "OP não encontrada" }, { status: 404 });
    }
    return NextResponse.json({ item: result.nota }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Dados inválidos", details: err.issues },
        { status: 400 },
      );
    }
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    console.error("Erro ao criar nota:", err);
    return NextResponse.json({ error: "Erro ao criar nota" }, { status: 500 });
  }
}

void asc;
