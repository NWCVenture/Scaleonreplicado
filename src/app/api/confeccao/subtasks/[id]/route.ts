// GET    /api/confeccao/subtasks/[id] — detalhe da subtask
// PATCH  /api/confeccao/subtasks/[id] — admin (atribuído, status placeholder)
//
// Mudanças de status só são validadas formalmente nas RITMs específicas
// (08-13). Aqui aceitamos a transição mas registramos nota de auditoria.

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { generateId } from "@/lib/utils";
import { requireAdminAtivo, withContaAtiva } from "@/lib/tenancy";
import {
  confeccaoNota,
  confeccaoOrdemProducao,
  confeccaoSubtask,
  user,
} from "@/lib/db/schema";
import { notificarAtribuidoSubtaskMudou } from "@/lib/confeccao/email";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return (
    msg.includes("conta ativa") ||
    msg.includes("Sessão") ||
    msg.includes("Nenhuma")
  );
}

const PatchSubtaskSchema = z
  .object({
    atribuidoAId: z.string().nullable().optional(),
    status: z
      .enum(["bloqueada", "pendente", "em_andamento", "concluida", "cancelada"])
      .optional(),
  })
  .strict();

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const result = await withContaAtiva(async (tx, contaId) => {
      const [st] = await tx
        .select({
          id: confeccaoSubtask.id,
          numero: confeccaoSubtask.numero,
          idInterno: confeccaoSubtask.idInterno,
          prefixo: confeccaoSubtask.prefixo,
          ordemSequencial: confeccaoSubtask.ordemSequencial,
          status: confeccaoSubtask.status,
          payload: confeccaoSubtask.payload,
          valorServico: confeccaoSubtask.valorServico,
          iniciadaEm: confeccaoSubtask.iniciadaEm,
          concluidaEm: confeccaoSubtask.concluidaEm,
          createdAt: confeccaoSubtask.createdAt,
          updatedAt: confeccaoSubtask.updatedAt,
          ordemProducaoId: confeccaoSubtask.ordemProducaoId,
          opNumero: confeccaoOrdemProducao.numero,
          atribuidoAId: confeccaoSubtask.atribuidoAId,
          atribuidoNome: user.name,
        })
        .from(confeccaoSubtask)
        .innerJoin(
          confeccaoOrdemProducao,
          eq(confeccaoOrdemProducao.id, confeccaoSubtask.ordemProducaoId),
        )
        .leftJoin(user, eq(user.id, confeccaoSubtask.atribuidoAId))
        .where(
          and(
            eq(confeccaoSubtask.id, id),
            eq(confeccaoSubtask.contaId, contaId),
          ),
        );
      return st ?? null;
    });

    if (!result) {
      return NextResponse.json(
        { error: "Subtask não encontrada" },
        { status: 404 },
      );
    }
    return NextResponse.json({ item: result });
  } catch (err) {
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Erro ao buscar subtask" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
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
    const { id } = await ctx.params;
    const parsed = PatchSubtaskSchema.parse(await request.json());

    if (parsed.atribuidoAId === undefined && parsed.status === undefined) {
      return NextResponse.json(
        { error: "Nada para atualizar" },
        { status: 400 },
      );
    }

    const result = await withContaAtiva(async (tx, contaId) => {
      const [stAtual] = await tx
        .select()
        .from(confeccaoSubtask)
        .where(
          and(
            eq(confeccaoSubtask.id, id),
            eq(confeccaoSubtask.contaId, contaId),
          ),
        );
      if (!stAtual) return { notFound: true as const };

      const setObj: Record<string, unknown> = { updatedAt: new Date() };
      if (parsed.atribuidoAId !== undefined)
        setObj.atribuidoAId = parsed.atribuidoAId;
      if (parsed.status !== undefined) setObj.status = parsed.status;

      const [updated] = await tx
        .update(confeccaoSubtask)
        .set(setObj)
        .where(eq(confeccaoSubtask.id, id))
        .returning();

      // Auditoria: atribuído alterado
      if (
        parsed.atribuidoAId !== undefined &&
        parsed.atribuidoAId !== stAtual.atribuidoAId
      ) {
        const [editor] = await tx
          .select({ name: user.name })
          .from(user)
          .where(eq(user.id, adminCtx.userId));
        await tx.insert(confeccaoNota).values({
          id: generateId(),
          contaId,
          subtaskId: stAtual.id,
          autorId: null,
          conteudo: `Atribuído da subtask alterado por ${editor?.name ?? "Sistema"}`,
          isAuditoria: true,
          isInterna: true,
          metadata: {
            campo: "atribuidoAId",
            valorAntigo: stAtual.atribuidoAId,
            valorNovo: parsed.atribuidoAId,
          },
        });
      }
      // Auditoria: status alterado
      if (parsed.status !== undefined && parsed.status !== stAtual.status) {
        const [editor] = await tx
          .select({ name: user.name })
          .from(user)
          .where(eq(user.id, adminCtx.userId));
        await tx.insert(confeccaoNota).values({
          id: generateId(),
          contaId,
          subtaskId: stAtual.id,
          autorId: null,
          conteudo: `Status alterado de "${stAtual.status}" para "${parsed.status}" por ${editor?.name ?? "Sistema"}`,
          isAuditoria: true,
          isInterna: true,
          metadata: {
            campo: "status",
            valorAntigo: stAtual.status,
            valorNovo: parsed.status,
          },
        });
      }

      return {
        ok: true as const,
        item: updated,
        atribuidoMudou:
          parsed.atribuidoAId !== undefined &&
          parsed.atribuidoAId !== stAtual.atribuidoAId,
        atribuidoAnteriorId: stAtual.atribuidoAId,
      };
    });

    if ("notFound" in result) {
      return NextResponse.json(
        { error: "Subtask não encontrada" },
        { status: 404 },
      );
    }
    if (result.atribuidoMudou) {
      notificarAtribuidoSubtaskMudou({
        subtaskId: result.item.id,
        atribuidoAnteriorId: result.atribuidoAnteriorId,
        atribuidoNovoId: parsed.atribuidoAId ?? null,
        editorId: adminCtx.userId,
      });
    }
    return NextResponse.json({ item: result.item });
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
    return NextResponse.json(
      { error: "Erro ao atualizar subtask" },
      { status: 500 },
    );
  }
}
