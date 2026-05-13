// POST /api/confeccao/subtasks/[id]/concluir — em_andamento → concluida
//
// Valida o payload da subtask (por prefixo) antes de concluir.
// Destrava a próxima subtask + marca OP como concluída se todas concluíram.

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { withContaAtiva } from "@/lib/tenancy";
import { confeccaoSubtask } from "@/lib/db/schema";
import {
  concluirSubtask,
  TransicaoSubtaskError,
} from "@/lib/confeccao/transicao-subtask";
import {
  ConcluirSubtaskCompraSchema,
  type SubtaskCompraPayload,
} from "@/lib/confeccao/schemas/payloads/compra";
import {
  ConcluirSubtaskRiscoSchema,
  validarLarguraVsRolo,
} from "@/lib/confeccao/schemas/payloads/risco";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return (
    msg.includes("conta ativa") ||
    msg.includes("Sessão") ||
    msg.includes("Nenhuma")
  );
}

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

    const result = await withContaAtiva(async (tx, contaId) => {
      // Lê payload atual e valida por prefixo antes de concluir
      const [st] = await tx
        .select()
        .from(confeccaoSubtask)
        .where(
          and(
            eq(confeccaoSubtask.id, id),
            eq(confeccaoSubtask.contaId, contaId),
          ),
        );
      if (!st) {
        return { notFound: true as const };
      }

      // Dispatch de validação por prefixo
      if (st.prefixo === "OPBUY") {
        const r = ConcluirSubtaskCompraSchema.safeParse(st.payload);
        if (!r.success) {
          return {
            invalido: true as const,
            details: r.error.issues,
            mensagem:
              "Payload da subtask Compra está incompleto. Preencha todos os campos pré + pós-compra antes de concluir.",
          };
        }
      } else if (st.prefixo === "OPRIS") {
        const r = ConcluirSubtaskRiscoSchema.safeParse(st.payload);
        if (!r.success) {
          return {
            invalido: true as const,
            details: r.error.issues,
            mensagem:
              "Payload do Risco está incompleto. Preencha fornecedor, tamanhos, dados técnicos e valor antes de concluir.",
          };
        }
        // Validação cross-subtask: largura do risco ≤ largura do rolo (OPBUY.pos)
        const [opbuy] = await tx
          .select({ payload: confeccaoSubtask.payload })
          .from(confeccaoSubtask)
          .where(
            and(
              eq(confeccaoSubtask.ordemProducaoId, st.ordemProducaoId),
              eq(confeccaoSubtask.prefixo, "OPBUY"),
            ),
          );
        const larguraRoloCm =
          (opbuy?.payload as SubtaskCompraPayload | undefined)?.pos
            ?.larguraRoloCm ?? null;
        const valida = validarLarguraVsRolo(r.data.larguraCm, larguraRoloCm);
        if (!valida.ok) {
          return {
            invalido: true as const,
            details: [
              {
                code: "custom",
                path: ["larguraCm"],
                message: valida.mensagem,
              },
            ],
            mensagem: valida.mensagem,
          };
        }
      }
      // Outras subtasks (RITM-10+): validação respectiva, por ora aceita
      // qualquer payload (cada RITM adiciona seu schema de conclusão).

      const transicao = await concluirSubtask(tx, {
        contaId,
        subtaskId: id,
        usuarioId: session.user.id,
      });
      return { ok: true as const, subtask: transicao };
    });

    if ("notFound" in result) {
      return NextResponse.json(
        { error: "Subtask não encontrada" },
        { status: 404 },
      );
    }
    if ("invalido" in result) {
      return NextResponse.json(
        { error: result.mensagem, details: result.details },
        { status: 400 },
      );
    }
    return NextResponse.json({ subtask: result.subtask });
  } catch (err) {
    if (err instanceof TransicaoSubtaskError) {
      const status =
        err.code === "subtask_nao_encontrada" ? 404 : 400;
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status },
      );
    }
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Erro ao concluir subtask" },
      { status: 500 },
    );
  }
}
