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
import { generateId } from "@/lib/utils";
import {
  isAdminPapel,
  requireContaAtiva,
  withConta,
} from "@/lib/tenancy";
import {
  confeccaoNota,
  confeccaoSubtask,
  usuarioConta,
  user,
  type ConfeccaoSubtaskPrefixo,
} from "@/lib/db/schema";
import {
  SubtaskCompraPayloadSchema,
  type SubtaskCompraPayload,
} from "@/lib/confeccao/schemas/payloads/compra";
import { SubtaskRiscoPayloadSchema } from "@/lib/confeccao/schemas/payloads/risco";
import {
  SubtaskCortePayloadSchema,
  type SubtaskCortePayload,
} from "@/lib/confeccao/schemas/payloads/corte";
import { sincronizarCorteComCompra } from "@/lib/confeccao/sincronizar-corte";
import { SubtaskViesPayloadSchema } from "@/lib/confeccao/schemas/payloads/vies";
import { SubtaskCosturaPayloadSchema } from "@/lib/confeccao/schemas/payloads/costura";
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
    case "OPVIE": {
      const r = SubtaskViesPayloadSchema.safeParse(payload);
      if (!r.success) return { ok: false, details: r.error.issues };
      return { ok: true, data: r.data as Record<string, unknown> };
    }
    case "OPSEW": {
      const r = SubtaskCosturaPayloadSchema.safeParse(payload);
      if (!r.success) return { ok: false, details: r.error.issues };
      return { ok: true, data: r.data as Record<string, unknown> };
    }
    // Outras subtasks (RITM-13): payload aceito sem schema específico
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

    const ctxConta = await requireContaAtiva();
    const { id } = await ctx.params;
    const body = (await request.json()) as Record<string, unknown>;
    const justificativaEdicao =
      typeof body.justificativaEdicao === "string"
        ? body.justificativaEdicao.trim()
        : null;

    const result = await withConta(ctxConta.contaId, async (tx) => {
      await assertOpAtivaBySubtask(tx, ctxConta.contaId, id);
      const [st] = await tx
        .select()
        .from(confeccaoSubtask)
        .where(
          and(
            eq(confeccaoSubtask.id, id),
            eq(confeccaoSubtask.contaId, ctxConta.contaId),
          ),
        );
      if (!st) return { notFound: true as const };
      if (st.status === "cancelada") {
        return { blocked: "cancelada" as const };
      }
      if (st.status === "bloqueada") {
        return { blocked: "bloqueada" as const };
      }

      // Edição retroativa em subtask concluída: admin only + justificativa
      const ehEdicaoRetroativa = st.status === "concluida";
      if (ehEdicaoRetroativa) {
        // Valida papel admin (consulta usuario_conta — fora de RLS)
        const [vinculo] = await tx
          .select({ papel: usuarioConta.papel })
          .from(usuarioConta)
          .where(
            and(
              eq(usuarioConta.usuarioId, session.user.id),
              eq(usuarioConta.contaId, ctxConta.contaId),
              eq(usuarioConta.ativo, true),
            ),
          );
        if (!isAdminPapel(vinculo?.papel ?? null)) {
          return { naoAdmin: true as const };
        }
        if (!justificativaEdicao || justificativaEdicao.length < 5) {
          return { semJustificativa: true as const };
        }
      }

      const validacao = validarPayloadPorPrefixo(st.prefixo, body.payload);
      if (!validacao.ok) {
        return { invalido: true as const, details: validacao.details };
      }

      // RITM-33: ao salvar payload da OPBUY, propaga distribuicaoOficinas
      // pro OPCOR da mesma OP. Bloqueia (422) se a mudança removeria
      // oficina com pós-corte preenchido. Comportamento simétrico ao
      // /concluir — vale tanto em rascunho quanto em edição retroativa.
      let opcorIdParaAtualizar: string | null = null;
      let opcorPayloadSincronizado: SubtaskCortePayload | null = null;
      if (st.prefixo === "OPBUY") {
        const novoCompraPayload = validacao.data as SubtaskCompraPayload;
        const [opcor] = await tx
          .select()
          .from(confeccaoSubtask)
          .where(
            and(
              eq(confeccaoSubtask.ordemProducaoId, st.ordemProducaoId),
              eq(confeccaoSubtask.prefixo, "OPCOR"),
            ),
          );
        if (opcor) {
          const sync = sincronizarCorteComCompra(
            novoCompraPayload,
            opcor.payload as SubtaskCortePayload | null,
          );
          if (!sync.ok) {
            return {
              perdaCorte: true as const,
              perdas: sync.perdas,
            };
          }
          opcorIdParaAtualizar = opcor.id;
          opcorPayloadSincronizado = sync.payload;
        }
      }

      const payloadAntigo = st.payload as Record<string, unknown>;
      const [updated] = await tx
        .update(confeccaoSubtask)
        .set({ payload: validacao.data, updatedAt: new Date() })
        .where(eq(confeccaoSubtask.id, id))
        .returning();

      if (opcorIdParaAtualizar && opcorPayloadSincronizado) {
        await tx
          .update(confeccaoSubtask)
          .set({
            payload: opcorPayloadSincronizado as never,
            updatedAt: new Date(),
          })
          .where(eq(confeccaoSubtask.id, opcorIdParaAtualizar));
      }

      // Auditoria de edição retroativa
      if (ehEdicaoRetroativa) {
        const [editor] = await tx
          .select({ name: user.name })
          .from(user)
          .where(eq(user.id, session.user.id));
        await tx.insert(confeccaoNota).values({
          id: generateId(),
          contaId: ctxConta.contaId,
          subtaskId: id,
          autorId: session.user.id,
          conteudo: `Payload da subtask editado retroativamente por ${editor?.name ?? "Admin"} (subtask já concluída). Justificativa: ${justificativaEdicao}`,
          isAuditoria: true,
          isInterna: true,
          metadata: {
            acao: "edicao_retroativa_payload",
            justificativa: justificativaEdicao,
            valorAntigo: payloadAntigo,
            valorNovo: validacao.data,
            editorId: session.user.id,
          },
        });
      }

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
        result.blocked === "cancelada"
          ? "Subtask cancelada — não pode ser editada"
          : "Subtask bloqueada — aguardando subtask anterior";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    if ("naoAdmin" in result) {
      return NextResponse.json(
        {
          error:
            "Subtask concluída — apenas admin pode editar (edição retroativa)",
        },
        { status: 403 },
      );
    }
    if ("semJustificativa" in result) {
      return NextResponse.json(
        {
          error:
            "Edição retroativa exige `justificativaEdicao` (mínimo 5 caracteres) no payload",
        },
        { status: 400 },
      );
    }
    if ("invalido" in result) {
      return NextResponse.json(
        { error: "Payload inválido", details: result.details },
        { status: 400 },
      );
    }
    if ("perdaCorte" in result) {
      const perdas = result.perdas ?? [];
      const lista = perdas
        .map((p) => `${p.oficinaId} (${p.campos.join(", ")})`)
        .join("; ");
      return NextResponse.json(
        {
          error: `Mudança removeria oficina(s) com dados pós-corte preenchidos: ${lista}. Limpe os dados do Corte ou mantenha a oficina no plano.`,
          code: "perda_corte",
          perdas,
        },
        { status: 422 },
      );
    }
    return NextResponse.json({ item: result.item });
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
    console.error("Erro ao atualizar payload:", err);
    return NextResponse.json(
      { error: "Erro ao atualizar payload" },
      { status: 500 },
    );
  }
}
