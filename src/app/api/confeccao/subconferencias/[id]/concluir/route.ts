// POST /api/confeccao/subconferencias/[id]/concluir
//
// Valida contagem + destinação, DERIVA aprovadas (recebidas − defeitos)
// e marca subconferência como concluida. Cria nota de auditoria.

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { generateId } from "@/lib/utils";
import { withContaAtiva } from "@/lib/tenancy";
import {
  confeccaoNota,
  confeccaoSubconferencia,
} from "@/lib/db/schema";
import {
  derivarAprovadas,
  validarPodeConcluirSubconferencia,
  type MatrizPecas,
} from "@/lib/confeccao/schemas/subconferencia";
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
      const [sc] = await tx
        .select()
        .from(confeccaoSubconferencia)
        .where(
          and(
            eq(confeccaoSubconferencia.id, id),
            eq(confeccaoSubconferencia.contaId, contaId),
          ),
        );
      if (!sc) return { notFound: true as const };
      if (sc.status === "concluida") {
        return { jaConcluida: true as const };
      }
      await assertOpAtivaBySubtask(tx, contaId, sc.subtaskConferenciaId);

      const pecasRecebidas = sc.pecasRecebidas as MatrizPecas | null;
      const reprovadas = sc.reprovadas as MatrizPecas | null;
      const validacao = validarPodeConcluirSubconferencia({
        pecasRecebidas,
        reprovadas,
        localizacaoArmazem: sc.localizacaoArmazem,
        destinoReprovadas: sc.destinoReprovadas as
          | "doacao"
          | "descarte"
          | "retrabalho"
          | null,
      });
      if (!validacao.ok) {
        return { invalido: true as const, mensagem: validacao.mensagem };
      }

      const agora = new Date();
      const [updated] = await tx
        .update(confeccaoSubconferencia)
        .set({
          status: "concluida",
          concluidaEm: agora,
          updatedAt: agora,
          // Aprovadas não são mais digitadas: derivadas da contagem menos
          // defeitos, na conclusão — custos e dashboard de qualidade leem
          // esse campo de subconferências concluídas.
          aprovadas: derivarAprovadas(pecasRecebidas ?? {}, reprovadas),
        })
        .where(eq(confeccaoSubconferencia.id, id))
        .returning();

      await tx.insert(confeccaoNota).values({
        id: generateId(),
        contaId,
        subtaskId: sc.subtaskConferenciaId,
        autorId: null,
        conteudo: `Subconferência ${sc.numero} concluída por ${session.user.name ?? session.user.email}`,
        isAuditoria: true,
        isInterna: true,
        metadata: {
          acao: "concluir_subconferencia",
          subconferenciaId: sc.id,
        },
      });

      return { ok: true as const, item: updated };
    });

    if ("notFound" in result) {
      return NextResponse.json(
        { error: "Subconferência não encontrada" },
        { status: 404 },
      );
    }
    if ("jaConcluida" in result) {
      return NextResponse.json(
        { error: "Subconferência já está concluída" },
        { status: 400 },
      );
    }
    if ("invalido" in result) {
      return NextResponse.json({ error: result.mensagem }, { status: 400 });
    }
    return NextResponse.json({ item: result.item });
  } catch (err) {
    if (err instanceof OpCanceladaError) {
      return NextResponse.json(
        { error: err.message, code: "op_cancelada" },
        { status: 409 },
      );
    }
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    console.error("Erro ao concluir subconferência:", err);
    return NextResponse.json(
      { error: "Erro ao concluir subconferência" },
      { status: 500 },
    );
  }
}
