// PATCH  /api/confeccao/lalamoves/[id] — atualiza status/valor/datas (manual)
// DELETE /api/confeccao/lalamoves/[id] — cancela (status='cancelado')

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { withContaAtiva } from "@/lib/tenancy";
import { confeccaoLalamove, confeccaoRetirada } from "@/lib/db/schema";
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

// Modo manual: aceita rascunho → coletado → entregue (transições simples)
const PatchLalamoveSchema = z
  .object({
    status: z
      .enum([
        "rascunho",
        "coletado",
        "entregue",
        "cancelado",
      ])
      .optional(),
    valor: z.number().nonnegative().optional(),
    conteudoDescricao: z.string().max(500).optional().nullable(),
    quantidadePecas: z.number().int().positive().optional().nullable(),
    dataColeta: z.string().datetime().optional().nullable(),
    dataEntrega: z.string().datetime().optional().nullable(),
    cancelamentoMotivo: z.string().max(500).optional().nullable(),
  })
  .strict();

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
    const parsed = PatchLalamoveSchema.parse(await request.json());

    const updated = await withContaAtiva(async (tx, contaId) => {
      // Resolve subtaskId via Lalamove (direto ou via retirada)
      const [ll] = await tx
        .select({
          subtaskId: confeccaoLalamove.subtaskId,
          retiradaId: confeccaoLalamove.retiradaId,
        })
        .from(confeccaoLalamove)
        .where(
          and(
            eq(confeccaoLalamove.id, id),
            eq(confeccaoLalamove.contaId, contaId),
          ),
        );
      if (ll) {
        let stId = ll.subtaskId;
        if (!stId && ll.retiradaId) {
          const [r] = await tx
            .select({ subtaskCosturaId: confeccaoRetirada.subtaskCosturaId })
            .from(confeccaoRetirada)
            .where(eq(confeccaoRetirada.id, ll.retiradaId));
          stId = r?.subtaskCosturaId ?? null;
        }
        if (stId) {
          await assertOpAtivaBySubtask(tx, contaId, stId);
        }
      }
      const setObj: Record<string, unknown> = { updatedAt: new Date() };
      if (parsed.status !== undefined) {
        setObj.status = parsed.status;
        if (parsed.status === "cancelado") {
          setObj.canceladaEm = new Date();
          setObj.canceladaPorId = session.user.id;
        }
      }
      if (parsed.valor !== undefined) setObj.valor = parsed.valor;
      if (parsed.conteudoDescricao !== undefined)
        setObj.conteudoDescricao = parsed.conteudoDescricao;
      if (parsed.quantidadePecas !== undefined)
        setObj.quantidadePecas = parsed.quantidadePecas;
      if (parsed.dataColeta !== undefined)
        setObj.dataColeta = parsed.dataColeta ? new Date(parsed.dataColeta) : null;
      if (parsed.dataEntrega !== undefined)
        setObj.dataEntrega = parsed.dataEntrega ? new Date(parsed.dataEntrega) : null;
      if (parsed.cancelamentoMotivo !== undefined)
        setObj.cancelamentoMotivo = parsed.cancelamentoMotivo;

      const [row] = await tx
        .update(confeccaoLalamove)
        .set(setObj)
        .where(
          and(
            eq(confeccaoLalamove.id, id),
            eq(confeccaoLalamove.contaId, contaId),
          ),
        )
        .returning();
      return row ?? null;
    });

    if (!updated) {
      return NextResponse.json(
        { error: "Lalamove não encontrado" },
        { status: 404 },
      );
    }
    return NextResponse.json({ item: updated });
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
      { error: "Erro ao atualizar Lalamove" },
      { status: 500 },
    );
  }
}
