// PATCH /api/confeccao/subtasks/[id]/payload
//
// Atualiza o payload JSONB da subtask. Faz dispatch de validação por
// prefixo — pra OPBUY usa SubtaskCompraPayloadSchema. Outras subtasks
// (08+) adicionam seu schema aqui.
//
// Bloqueia atualização se status = concluída (edição retroativa exige
// fluxo dedicado — RITM-15).

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { withContaAtiva } from "@/lib/tenancy";
import {
  confeccaoSubtask,
  type ConfeccaoSubtaskPrefixo,
} from "@/lib/db/schema";
import { SubtaskCompraPayloadSchema } from "@/lib/confeccao/schemas/payloads/compra";
import { SubtaskRiscoPayloadSchema } from "@/lib/confeccao/schemas/payloads/risco";
import { SubtaskCortePayloadSchema } from "@/lib/confeccao/schemas/payloads/corte";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return (
    msg.includes("conta ativa") ||
    msg.includes("Sessão") ||
    msg.includes("Nenhuma")
  );
}

function validarPayloadPorPrefixo(
  prefixo: ConfeccaoSubtaskPrefixo,
  payload: unknown,
): { ok: true; data: Record<string, unknown> } | { ok: false; details: z.ZodIssue[] } {
  switch (prefixo) {
    case "OPBUY": {
      const r = SubtaskCompraPayloadSchema.safeParse(payload);
      if (!r.success) return { ok: false, details: r.error.issues };
      return { ok: true, data: r.data as Record<string, unknown> };
    }
    case "OPRIS": {
      const r = SubtaskRiscoPayloadSchema.safeParse(payload);
      if (!r.success) return { ok: false, details: r.error.issues };
      return { ok: true, data: r.data as Record<string, unknown> };
    }
    case "OPCOR": {
      const r = SubtaskCortePayloadSchema.safeParse(payload);
      if (!r.success) return { ok: false, details: r.error.issues };
      return { ok: true, data: r.data as Record<string, unknown> };
    }
    // Outras subtasks (RITM-11 a 13): payload aceito sem schema específico
    // por ora. Cada RITM vai adicionar seu schema aqui.
    default: {
      if (typeof payload !== "object" || payload === null) {
        return {
          ok: false,
          details: [
            { code: "custom", path: [], message: "payload deve ser objeto" } as z.ZodIssue,
          ],
        };
      }
      return { ok: true, data: payload as Record<string, unknown> };
    }
  }
}

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const { id } = await ctx.params;
    const body = (await request.json()) as Record<string, unknown>;

    const result = await withContaAtiva(async (tx, contaId) => {
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
      if (st.status === "concluida") {
        return { blocked: "concluida" as const };
      }
      if (st.status === "cancelada") {
        return { blocked: "cancelada" as const };
      }
      if (st.status === "bloqueada") {
        return { blocked: "bloqueada" as const };
      }

      const validacao = validarPayloadPorPrefixo(st.prefixo, body.payload);
      if (!validacao.ok) {
        return { invalido: true as const, details: validacao.details };
      }

      const [updated] = await tx
        .update(confeccaoSubtask)
        .set({ payload: validacao.data, updatedAt: new Date() })
        .where(eq(confeccaoSubtask.id, id))
        .returning();
      return { ok: true as const, item: updated };
    });

    if ("notFound" in result) {
      return NextResponse.json(
        { error: "Subtask não encontrada" },
        { status: 404 },
      );
    }
    if ("blocked" in result) {
      const msg =
        result.blocked === "concluida"
          ? "Subtask concluída — use o fluxo de edição retroativa (RITM-15)"
          : result.blocked === "cancelada"
            ? "Subtask cancelada — não pode ser editada"
            : "Subtask bloqueada — aguardando subtask anterior";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    if ("invalido" in result) {
      return NextResponse.json(
        { error: "Payload inválido", details: result.details },
        { status: 400 },
      );
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
    console.error("Erro ao atualizar payload:", err);
    return NextResponse.json(
      { error: "Erro ao atualizar payload" },
      { status: 500 },
    );
  }
}
