// GET   /api/confeccao/ops/[numero] — OP completa com subtasks + produto + atribuído
// PATCH /api/confeccao/ops/[numero] — admin edita atribuído/observações
//
// PATCH bloqueia alteração de temVies (regra crítica) e produtoId.
// Mudança de atribuidoAId cria nota de auditoria automática.

import { NextRequest, NextResponse } from "next/server";
import { and, asc, count, eq } from "drizzle-orm";
import { z } from "zod";
import { generateId } from "@/lib/utils";
import { requireAdminAtivo, withContaAtiva } from "@/lib/tenancy";
import {
  confeccaoNota,
  confeccaoOrdemProducao,
  confeccaoProduto,
  confeccaoSubtask,
  user,
} from "@/lib/db/schema";
import { notificarAtribuidoOpMudou } from "@/lib/confeccao/email";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return (
    msg.includes("conta ativa") ||
    msg.includes("Sessão") ||
    msg.includes("Nenhuma")
  );
}

const PatchOPSchema = z
  .object({
    atribuidoAId: z.string().min(1).optional(),
    observacoes: z.string().max(2000).optional().nullable(),
  })
  .strict();
// .strict() rejeita campos extras (ex: temVies, produtoId) com 400

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ numero: string }> },
) {
  try {
    const { numero } = await ctx.params;
    const result = await withContaAtiva(async (tx, contaId) => {
      const [op] = await tx
        .select({
          id: confeccaoOrdemProducao.id,
          numero: confeccaoOrdemProducao.numero,
          sequencialGlobal: confeccaoOrdemProducao.sequencialGlobal,
          status: confeccaoOrdemProducao.status,
          temVies: confeccaoOrdemProducao.temVies,
          observacoes: confeccaoOrdemProducao.observacoes,
          createdAt: confeccaoOrdemProducao.createdAt,
          updatedAt: confeccaoOrdemProducao.updatedAt,
          concluidaEm: confeccaoOrdemProducao.concluidaEm,
          canceladaEm: confeccaoOrdemProducao.canceladaEm,
          cancelamentoJustificativa:
            confeccaoOrdemProducao.cancelamentoJustificativa,
          produtoId: confeccaoOrdemProducao.produtoId,
          produtoNome: confeccaoProduto.nome,
          produtoDescricao: confeccaoProduto.descricao,
          criadaPorId: confeccaoOrdemProducao.criadaPorId,
          atribuidoAId: confeccaoOrdemProducao.atribuidoAId,
        })
        .from(confeccaoOrdemProducao)
        .innerJoin(
          confeccaoProduto,
          eq(confeccaoProduto.id, confeccaoOrdemProducao.produtoId),
        )
        .where(
          and(
            eq(confeccaoOrdemProducao.numero, numero),
            eq(confeccaoOrdemProducao.contaId, contaId),
          ),
        );

      if (!op) return null;

      // criador e atribuído (JOINs separados pra evitar conflito de alias)
      const [criador] = await tx
        .select({ id: user.id, name: user.name, email: user.email })
        .from(user)
        .where(eq(user.id, op.criadaPorId));
      const [atribuido] = await tx
        .select({ id: user.id, name: user.name, email: user.email })
        .from(user)
        .where(eq(user.id, op.atribuidoAId));

      // Subtasks ordenadas pelo fluxo (ordemSequencial 1..6)
      const subtasks = await tx
        .select({
          id: confeccaoSubtask.id,
          numero: confeccaoSubtask.numero,
          idInterno: confeccaoSubtask.idInterno,
          prefixo: confeccaoSubtask.prefixo,
          ordemSequencial: confeccaoSubtask.ordemSequencial,
          status: confeccaoSubtask.status,
          atribuidoAId: confeccaoSubtask.atribuidoAId,
          atribuidoNome: user.name,
          payload: confeccaoSubtask.payload,
          valorServico: confeccaoSubtask.valorServico,
          iniciadaEm: confeccaoSubtask.iniciadaEm,
          concluidaEm: confeccaoSubtask.concluidaEm,
        })
        .from(confeccaoSubtask)
        .leftJoin(user, eq(user.id, confeccaoSubtask.atribuidoAId))
        .where(eq(confeccaoSubtask.ordemProducaoId, op.id))
        .orderBy(asc(confeccaoSubtask.ordemSequencial));

      const concluidas = subtasks.filter((s) => s.status === "concluida").length;
      const total = subtasks.length;

      return {
        op: {
          ...op,
          criadaPor: criador ?? null,
          atribuidoA: atribuido ?? null,
        },
        subtasks,
        progresso: {
          subtasksConcluidas: concluidas,
          subtasksTotal: total,
          percentual: total > 0 ? Math.round((concluidas / total) * 100) : 0,
        },
      };
    });

    if (!result) {
      return NextResponse.json({ error: "OP não encontrada" }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (err) {
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    console.error("Erro ao buscar OP:", err);
    return NextResponse.json({ error: "Erro ao buscar OP" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ numero: string }> },
) {
  let adminCtx;
  try {
    adminCtx = await requireAdminAtivo();
  } catch {
    return NextResponse.json(
      { error: "Acesso negado — requer admin" },
      { status: 403 },
    );
  }

  try {
    const { numero } = await ctx.params;
    const raw = await request.json();

    // Detecta tentativa de alterar campos bloqueados antes do Zod
    if ("temVies" in raw) {
      return NextResponse.json(
        {
          error:
            "temVies não pode ser alterado após a OP ser criada (regra crítica do módulo)",
        },
        { status: 400 },
      );
    }
    if ("produtoId" in raw) {
      return NextResponse.json(
        {
          error:
            "produtoId não pode ser alterado após a OP ser criada (use reordens em V2)",
        },
        { status: 400 },
      );
    }

    const parsed = PatchOPSchema.parse(raw);

    if (
      parsed.atribuidoAId === undefined &&
      parsed.observacoes === undefined
    ) {
      return NextResponse.json(
        { error: "Nada para atualizar" },
        { status: 400 },
      );
    }

    const result = await withContaAtiva(async (tx, contaId) => {
      const [opAtual] = await tx
        .select()
        .from(confeccaoOrdemProducao)
        .where(
          and(
            eq(confeccaoOrdemProducao.numero, numero),
            eq(confeccaoOrdemProducao.contaId, contaId),
          ),
        );
      if (!opAtual) return { notFound: true as const };

      // Captura valor antigo do atribuído pra metadata da nota
      const atribuidoMudou =
        parsed.atribuidoAId !== undefined &&
        parsed.atribuidoAId !== opAtual.atribuidoAId;

      const setObj: Record<string, unknown> = { updatedAt: new Date() };
      if (parsed.atribuidoAId !== undefined)
        setObj.atribuidoAId = parsed.atribuidoAId;
      if (parsed.observacoes !== undefined)
        setObj.observacoes = parsed.observacoes ?? null;

      const [updated] = await tx
        .update(confeccaoOrdemProducao)
        .set(setObj)
        .where(eq(confeccaoOrdemProducao.id, opAtual.id))
        .returning();

      if (atribuidoMudou) {
        const [anterior] = await tx
          .select({ name: user.name })
          .from(user)
          .where(eq(user.id, opAtual.atribuidoAId));
        const [novo] = await tx
          .select({ name: user.name })
          .from(user)
          .where(eq(user.id, parsed.atribuidoAId!));
        const [editor] = await tx
          .select({ name: user.name })
          .from(user)
          .where(eq(user.id, adminCtx.userId));

        await tx.insert(confeccaoNota).values({
          id: generateId(),
          contaId,
          ordemProducaoId: opAtual.id,
          autorId: null,
          conteudo: `Atribuído alterado de "${anterior?.name ?? "?"}" para "${novo?.name ?? "?"}" por ${editor?.name ?? "Sistema"}`,
          isAuditoria: true,
          isInterna: true,
          metadata: {
            campo: "atribuidoAId",
            valorAntigo: opAtual.atribuidoAId,
            valorNovo: parsed.atribuidoAId,
          },
        });
      }

      return {
        ok: true as const,
        op: updated,
        atribuidoMudou,
        atribuidoAnteriorId: opAtual.atribuidoAId,
      };
    });

    if ("notFound" in result) {
      return NextResponse.json({ error: "OP não encontrada" }, { status: 404 });
    }
    if (result.atribuidoMudou && parsed.atribuidoAId) {
      notificarAtribuidoOpMudou({
        opId: result.op.id,
        atribuidoAnteriorId: result.atribuidoAnteriorId,
        atribuidoNovoId: parsed.atribuidoAId,
        editorId: adminCtx.userId,
      });
    }
    return NextResponse.json({ item: result.op });
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
    console.error("Erro ao atualizar OP:", err);
    return NextResponse.json(
      { error: "Erro ao atualizar OP" },
      { status: 500 },
    );
  }
}

void count; // reservado para futuras agregações
