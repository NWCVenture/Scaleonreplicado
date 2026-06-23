// POST /api/confeccao/subtasks/[id]/transicionar
//
// Endpoint unificado pras transições "manuais" do seletor de status:
//
//   * → cancelada              (qualquer usuário com justificativa)
//   em_andamento → pendente    (qualquer usuário; justificativa opcional)
//   cancelada → pendente       (admin com justificativa)
//
// Transições que continuam tendo endpoints próprios (validação pesada):
//   pendente → em_andamento    → POST /iniciar
//   em_andamento → concluida   → POST /concluir
//   concluida → em_andamento   → POST /reabrir

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { requireAdminAtivo, withContaAtiva } from "@/lib/tenancy";
import { confeccaoSubtask } from "@/lib/db/schema";
import {
  cancelarSubtask,
  descancelarSubtask,
  voltarParaPendente,
  TransicionarSubtaskError,
} from "@/lib/confeccao/transicionar-subtask";
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

const BodySchema = z.object({
  para: z.enum(["pendente", "em_andamento", "concluida", "cancelada"]),
  justificativa: z.string().max(2000).optional(),
});

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    const { id } = await ctx.params;
    const body = BodySchema.parse(await request.json());

    // Descancelar exige admin. Cancelar e voltar-pendente abertos.
    if (body.para === "pendente") {
      // Pode ser voltarParaPendente (de em_andamento) ou descancelar
      // (de cancelada). Endpoint detecta no service via st.status.
      // Pra descancelar exigimos admin — fazemos check duplo aqui.
    }

    const result = await withContaAtiva(async (tx, contaId) => {
      await assertOpAtivaBySubtask(tx, contaId, id);

      if (body.para === "cancelada") {
        return {
          tipo: "cancelar" as const,
          out: await cancelarSubtask(tx, {
            contaId,
            subtaskId: id,
            usuarioId: session.user.id,
            justificativa: body.justificativa ?? "",
          }),
        };
      }

      if (body.para === "pendente") {
        // Detecta sub-caso lendo o status atual via tabela
        // (cancelarSubtask/descancelarSubtask validam o estado origem).
        const [st] = await tx
          .select({ status: confeccaoSubtask.status })
          .from(confeccaoSubtask)
          .where(
            and(
              eq(confeccaoSubtask.id, id),
              eq(confeccaoSubtask.contaId, contaId),
            ),
          );
        if (!st) {
          throw new TransicionarSubtaskError(
            "subtask_nao_encontrada",
            "Subtask não encontrada",
          );
        }
        if (st.status === "cancelada") {
          // descancelar — requer admin
          // verificação feita após o withContaAtiva
          return {
            tipo: "descancelar_pending" as const,
            justificativa: body.justificativa ?? "",
          };
        }
        return {
          tipo: "voltar" as const,
          out: await voltarParaPendente(tx, {
            contaId,
            subtaskId: id,
            usuarioId: session.user.id,
            justificativa: body.justificativa,
          }),
        };
      }

      // em_andamento e concluida não passam por aqui — frontend usa
      // /iniciar, /concluir, /reabrir.
      throw new TransicionarSubtaskError(
        "transicao_invalida",
        `Transição pra "${body.para}" não é suportada neste endpoint. Use /iniciar, /concluir ou /reabrir.`,
      );
    });

    // Caso descancelar → precisa admin. Reabre outro contexto admin.
    if (result.tipo === "descancelar_pending") {
      try {
        await requireAdminAtivo();
      } catch {
        return NextResponse.json(
          {
            error:
              "Apenas admins podem reativar subtasks canceladas — peça pra um admin",
          },
          { status: 403 },
        );
      }
      const out = await withContaAtiva(async (tx, contaId) => {
        await assertOpAtivaBySubtask(tx, contaId, id);
        return descancelarSubtask(tx, {
          contaId,
          subtaskId: id,
          usuarioId: session.user.id,
          justificativa: result.justificativa,
        });
      });
      return NextResponse.json({ subtask: out });
    }

    return NextResponse.json({ subtask: result.out });
  } catch (err) {
    if (err instanceof OpCanceladaError) {
      return NextResponse.json(
        { error: err.message, code: "op_cancelada" },
        { status: 409 },
      );
    }
    if (err instanceof TransicionarSubtaskError) {
      const status = err.code === "subtask_nao_encontrada" ? 404 : 400;
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status },
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
      { error: "Erro ao transicionar subtask" },
      { status: 500 },
    );
  }
}
