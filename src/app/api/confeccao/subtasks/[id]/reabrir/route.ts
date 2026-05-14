// POST /api/confeccao/subtasks/[id]/reabrir
//
// Admin reabre subtask concluida (concluida → em_andamento). Caso de
// "marcou como concluída por engano". Exige justificativa.
// Registra nota de auditoria com metadata.

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { generateId } from "@/lib/utils";
import { requireAdminAtivo, withContaAtiva } from "@/lib/tenancy";
import {
  confeccaoNota,
  confeccaoSubtask,
  user,
} from "@/lib/db/schema";
import {
  assertOpAtivaBySubtask,
  OpCanceladaError,
} from "@/lib/confeccao/assert-op-ativa";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return (
    msg.includes("conta ativa") ||
    msg.includes("Sessão") ||
    msg.includes("Nenhuma")
  );
}

const ReabrirSchema = z.object({
  justificativa: z.string().min(5).max(2000),
});

export async function POST(
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
    const parsed = ReabrirSchema.parse(await request.json());

    const result = await withContaAtiva(async (tx, contaId) => {
      await assertOpAtivaBySubtask(tx, contaId, id);
      const [st] = await tx
        .select()
        .from(confeccaoSubtask)
        .where(
          and(
            eq(confeccaoSubtask.id, id),
            eq(confeccaoSubtask.contaId, contaId),
          ),
        );
      if (!st) return { notFound: true as const };
      if (st.status !== "concluida") {
        return {
          erro: `Subtask está em status "${st.status}" — só pode reabrir subtask concluída`,
        };
      }

      const [updated] = await tx
        .update(confeccaoSubtask)
        .set({
          status: "em_andamento",
          concluidaEm: null,
          updatedAt: new Date(),
        })
        .where(eq(confeccaoSubtask.id, id))
        .returning();

      const [editor] = await tx
        .select({ name: user.name })
        .from(user)
        .where(eq(user.id, adminCtx.userId));

      await tx.insert(confeccaoNota).values({
        id: generateId(),
        contaId,
        subtaskId: id,
        autorId: null,
        conteudo: `Subtask reaberta por ${editor?.name ?? "Admin"}. Justificativa: ${parsed.justificativa}`,
        isAuditoria: true,
        isInterna: true,
        metadata: {
          acao: "reabrir_subtask",
          valorAntigo: "concluida",
          valorNovo: "em_andamento",
          justificativa: parsed.justificativa,
          editorId: adminCtx.userId,
        },
      });

      return { ok: true as const, item: updated };
    });

    if ("notFound" in result) {
      return NextResponse.json(
        { error: "Subtask não encontrada" },
        { status: 404 },
      );
    }
    if ("erro" in result) {
      return NextResponse.json({ error: result.erro }, { status: 400 });
    }
    return NextResponse.json({ subtask: result.item });
  } catch (err) {
    if (err instanceof OpCanceladaError) {
      return NextResponse.json(
        { error: err.message, code: "op_cancelada" },
        { status: 409 },
      );
    }
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
      { error: "Erro ao reabrir subtask" },
      { status: 500 },
    );
  }
}
