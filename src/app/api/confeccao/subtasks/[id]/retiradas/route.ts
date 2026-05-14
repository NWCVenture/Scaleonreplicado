// POST /api/confeccao/subtasks/[id]/retiradas — cria retirada (parcial/final)
// GET  /api/confeccao/subtasks/[id]/retiradas — lista retiradas da subtask Costura

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { withContaAtiva } from "@/lib/tenancy";
import {
  confeccaoFornecedor,
  confeccaoRetirada,
  confeccaoSubconferencia,
} from "@/lib/db/schema";
import {
  criarRetirada,
  RetiradaError,
} from "@/lib/confeccao/criar-retirada";
import { notificarRetiradaParcial } from "@/lib/confeccao/email";
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

const CriarRetiradaPayloadSchema = z.object({
  oficinaId: z.string().min(1),
  tipo: z.enum(["parcial", "final"]),
  pecasPorTamanhoCor: z.record(
    z.string(),
    z.record(z.string(), z.number().int().nonnegative()),
  ),
  dataRetirada: z.string().datetime(),
});

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const items = await withContaAtiva(async (tx, contaId) =>
      tx
        .select({
          id: confeccaoRetirada.id,
          numero: confeccaoRetirada.numero,
          subtaskCosturaId: confeccaoRetirada.subtaskCosturaId,
          oficinaId: confeccaoRetirada.oficinaId,
          tipo: confeccaoRetirada.tipo,
          pecasPorTamanhoCor: confeccaoRetirada.pecasPorTamanhoCor,
          dataRetirada: confeccaoRetirada.dataRetirada,
          canceladaEm: confeccaoRetirada.canceladaEm,
          createdAt: confeccaoRetirada.createdAt,
          subconferenciaId: confeccaoSubconferencia.id,
          subconferenciaNumero: confeccaoSubconferencia.numero,
          subconferenciaStatus: confeccaoSubconferencia.status,
        })
        .from(confeccaoRetirada)
        .leftJoin(
          confeccaoSubconferencia,
          eq(confeccaoSubconferencia.retiradaId, confeccaoRetirada.id),
        )
        .where(
          and(
            eq(confeccaoRetirada.subtaskCosturaId, id),
            eq(confeccaoRetirada.contaId, contaId),
          ),
        )
        .orderBy(asc(confeccaoRetirada.createdAt)),
    );
    return NextResponse.json({ items });
  } catch (err) {
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Erro ao listar retiradas" },
      { status: 500 },
    );
  }
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
    const parsed = CriarRetiradaPayloadSchema.parse(await request.json());

    const result = await withContaAtiva(async (tx, contaId) => {
      await assertOpAtivaBySubtask(tx, contaId, id);
      const r = await criarRetirada(tx, {
        contaId,
        subtaskCosturaId: id,
        oficinaId: parsed.oficinaId,
        tipo: parsed.tipo,
        pecasPorTamanhoCor: parsed.pecasPorTamanhoCor,
        dataRetirada: new Date(parsed.dataRetirada),
        usuarioId: session.user.id,
      });
      const [oficina] = await tx
        .select({ nome: confeccaoFornecedor.nome })
        .from(confeccaoFornecedor)
        .where(eq(confeccaoFornecedor.id, parsed.oficinaId));
      return { ...r, oficinaNome: oficina?.nome ?? "(oficina)" };
    });

    if (parsed.tipo === "parcial") {
      const total = Object.values(parsed.pecasPorTamanhoCor).reduce(
        (s, m) => s + Object.values(m).reduce((s2, v) => s2 + v, 0),
        0,
      );
      notificarRetiradaParcial({
        subtaskCosturaId: id,
        retiradaNumero: result.retirada.numero,
        oficinaNome: result.oficinaNome,
        subconferenciaNumero: result.subconferencia.numero,
        totalPecas: total,
        executorId: session.user.id,
      });
    }

    return NextResponse.json(result, { status: 201 });
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
    if (err instanceof RetiradaError) {
      const status =
        err.code === "subtask_invalida" ||
        err.code === "subtask_conferencia_nao_existe"
          ? 404
          : 400;
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status },
      );
    }
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    console.error("Erro ao criar retirada:", err);
    return NextResponse.json(
      { error: "Erro ao criar retirada" },
      { status: 500 },
    );
  }
}
