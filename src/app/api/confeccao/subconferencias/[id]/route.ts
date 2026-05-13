// PATCH /api/confeccao/subconferencias/[id] — atualiza um ou mais campos
//
// Bloqueia edição se subconferência já está concluida (a menos que tenha
// `justificativaEdicao` no payload — edição retroativa).

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { generateId } from "@/lib/utils";
import { withContaAtiva } from "@/lib/tenancy";
import {
  confeccaoNota,
  confeccaoSubconferencia,
} from "@/lib/db/schema";
import { AtualizarSubconferenciaSchema } from "@/lib/confeccao/schemas/subconferencia";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return (
    msg.includes("conta ativa") ||
    msg.includes("Sessão") ||
    msg.includes("Nenhuma")
  );
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
    const parsed = AtualizarSubconferenciaSchema.parse(await request.json());

    const result = await withContaAtiva(async (tx, contaId) => {
      const [atual] = await tx
        .select()
        .from(confeccaoSubconferencia)
        .where(
          and(
            eq(confeccaoSubconferencia.id, id),
            eq(confeccaoSubconferencia.contaId, contaId),
          ),
        );
      if (!atual) return { notFound: true as const };

      // Bloqueia edição em subconferência concluída sem justificativa
      const editandoConcluida = atual.status === "concluida";
      if (editandoConcluida && !parsed.justificativaEdicao) {
        return { concluidaSemJustif: true as const };
      }

      const setObj: Record<string, unknown> = { updatedAt: new Date() };
      if (parsed.pecasRecebidas !== undefined)
        setObj.pecasRecebidas = parsed.pecasRecebidas;
      if (parsed.divergenciaConfirmada !== undefined)
        setObj.divergenciaConfirmada = parsed.divergenciaConfirmada;
      if (parsed.oficinaResponsavelDivergenciaId !== undefined)
        setObj.oficinaResponsavelDivergenciaId =
          parsed.oficinaResponsavelDivergenciaId;
      if (parsed.quantidadeRevelada !== undefined)
        setObj.quantidadeRevelada = parsed.quantidadeRevelada;
      if (parsed.responsavelInspecaoId !== undefined)
        setObj.responsavelInspecaoId = parsed.responsavelInspecaoId;
      if (parsed.aprovadas !== undefined) setObj.aprovadas = parsed.aprovadas;
      if (parsed.reprovadas !== undefined)
        setObj.reprovadas = parsed.reprovadas;
      if (parsed.tiposDefeito !== undefined)
        setObj.tiposDefeito = parsed.tiposDefeito;
      if (parsed.dataInspecao !== undefined)
        setObj.dataInspecao = parsed.dataInspecao
          ? new Date(parsed.dataInspecao)
          : null;
      if (parsed.destinoReprovadas !== undefined)
        setObj.destinoReprovadas = parsed.destinoReprovadas;
      if (parsed.localizacaoArmazem !== undefined)
        setObj.localizacaoArmazem = parsed.localizacaoArmazem;

      const [updated] = await tx
        .update(confeccaoSubconferencia)
        .set(setObj)
        .where(eq(confeccaoSubconferencia.id, id))
        .returning();

      // Audita edição retroativa
      if (editandoConcluida && parsed.justificativaEdicao) {
        await tx.insert(confeccaoNota).values({
          id: generateId(),
          contaId,
          subtaskId: atual.subtaskConferenciaId,
          autorId: session.user.id,
          conteudo: `Subconferência ${atual.numero} editada após conclusão: ${parsed.justificativaEdicao}`,
          isAuditoria: true,
          isInterna: true,
          metadata: {
            acao: "editar_subconferencia_concluida",
            subconferenciaId: atual.id,
            justificativa: parsed.justificativaEdicao,
          },
        });
      }

      return { ok: true as const, item: updated };
    });

    if ("notFound" in result) {
      return NextResponse.json(
        { error: "Subconferência não encontrada" },
        { status: 404 },
      );
    }
    if ("concluidaSemJustif" in result) {
      return NextResponse.json(
        {
          error:
            "Subconferência concluída — informe justificativaEdicao para editar",
        },
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
    return NextResponse.json(
      { error: "Erro ao atualizar subconferência" },
      { status: 500 },
    );
  }
}
