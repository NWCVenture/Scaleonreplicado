// POST /api/confeccao/ops — admin cria nova OP (com 5/6 subtasks atomicamente)
// GET  /api/confeccao/ops — lista paginada com filtros (status, atribuídoA, search)

import { NextRequest, NextResponse } from "next/server";
import { and, asc, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAdminAtivo, withContaAtiva } from "@/lib/tenancy";
import {
  confeccaoOrdemProducao,
  confeccaoProduto,
  confeccaoSubtask,
  user,
} from "@/lib/db/schema";
import {
  CriarOPSchema,
  ListarOPsQuerySchema,
} from "@/lib/confeccao/schemas/op";
import { criarOP, CriarOPError } from "@/lib/confeccao/criar-op";
import { notificarOpCriada } from "@/lib/confeccao/email";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return (
    msg.includes("conta ativa") ||
    msg.includes("Sessão") ||
    msg.includes("Nenhuma")
  );
}

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const parsed = ListarOPsQuerySchema.parse({
      page: sp.get("page") ?? undefined,
      pageSize: sp.get("pageSize") ?? undefined,
      search: sp.get("search") ?? undefined,
      status: sp.getAll("status").length > 0 ? sp.getAll("status") : undefined,
      atribuidoA: sp.get("atribuidoA") ?? undefined,
    });

    const result = await withContaAtiva(async (tx, contaId) => {
      const conditions = [eq(confeccaoOrdemProducao.contaId, contaId)];
      if (parsed.status && parsed.status.length > 0) {
        conditions.push(inArray(confeccaoOrdemProducao.status, parsed.status));
      }
      if (parsed.atribuidoA) {
        conditions.push(
          eq(confeccaoOrdemProducao.atribuidoAId, parsed.atribuidoA),
        );
      }
      // Busca por número da OP OU nome do produto
      const productSubquery = parsed.search
        ? or(
            ilike(confeccaoOrdemProducao.numero, `%${parsed.search}%`),
            sql`EXISTS (
              SELECT 1 FROM ${confeccaoProduto}
              WHERE ${confeccaoProduto.id} = ${confeccaoOrdemProducao.produtoId}
              AND ${confeccaoProduto.nome} ILIKE ${"%" + parsed.search + "%"}
            )`,
          )
        : null;
      if (productSubquery) conditions.push(productSubquery);

      const where = and(...conditions);

      const items = await tx
        .select({
          id: confeccaoOrdemProducao.id,
          numero: confeccaoOrdemProducao.numero,
          status: confeccaoOrdemProducao.status,
          temVies: confeccaoOrdemProducao.temVies,
          observacoes: confeccaoOrdemProducao.observacoes,
          createdAt: confeccaoOrdemProducao.createdAt,
          updatedAt: confeccaoOrdemProducao.updatedAt,
          concluidaEm: confeccaoOrdemProducao.concluidaEm,
          produtoId: confeccaoOrdemProducao.produtoId,
          produtoNome: confeccaoProduto.nome,
          atribuidoAId: confeccaoOrdemProducao.atribuidoAId,
          atribuidoNome: user.name,
        })
        .from(confeccaoOrdemProducao)
        .innerJoin(
          confeccaoProduto,
          eq(confeccaoProduto.id, confeccaoOrdemProducao.produtoId),
        )
        .innerJoin(user, eq(user.id, confeccaoOrdemProducao.atribuidoAId))
        .where(where)
        .orderBy(desc(confeccaoOrdemProducao.createdAt))
        .limit(parsed.pageSize)
        .offset((parsed.page - 1) * parsed.pageSize);

      const [{ total }] = await tx
        .select({ total: count() })
        .from(confeccaoOrdemProducao)
        .where(where);

      // Computa progresso (subtasks concluídas / total) por OP
      const opIds = items.map((i) => i.id);
      const progresso = opIds.length
        ? await tx
            .select({
              opId: confeccaoSubtask.ordemProducaoId,
              status: confeccaoSubtask.status,
              total: count(),
            })
            .from(confeccaoSubtask)
            .where(inArray(confeccaoSubtask.ordemProducaoId, opIds))
            .groupBy(
              confeccaoSubtask.ordemProducaoId,
              confeccaoSubtask.status,
            )
        : [];

      const progressoPorOp = new Map<
        string,
        { total: number; concluidas: number }
      >();
      for (const p of progresso) {
        const cur = progressoPorOp.get(p.opId) ?? {
          total: 0,
          concluidas: 0,
        };
        cur.total += Number(p.total);
        if (p.status === "concluida") cur.concluidas += Number(p.total);
        progressoPorOp.set(p.opId, cur);
      }

      const itemsComProgresso = items.map((i) => {
        const prog = progressoPorOp.get(i.id) ?? { total: 0, concluidas: 0 };
        return {
          ...i,
          progresso: {
            subtasksConcluidas: prog.concluidas,
            subtasksTotal: prog.total,
            percentual:
              prog.total > 0
                ? Math.round((prog.concluidas / prog.total) * 100)
                : 0,
          },
        };
      });

      return { items: itemsComProgresso, total: Number(total) };
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Parâmetros inválidos", details: err.issues },
        { status: 400 },
      );
    }
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    console.error("Erro ao listar OPs:", err);
    return NextResponse.json(
      { error: "Erro ao listar OPs" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
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
    const parsed = CriarOPSchema.parse(await request.json());

    const result = await withContaAtiva(async (tx, contaId) =>
      criarOP(tx, {
        contaId,
        criadaPorId: adminCtx.userId,
        data: parsed,
      }),
    );

    notificarOpCriada({ opId: result.op.id, criadorId: adminCtx.userId });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Dados inválidos", details: err.issues },
        { status: 400 },
      );
    }
    if (err instanceof CriarOPError) {
      const status =
        err.code === "produto_nao_encontrado" ? 404 : 400;
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status },
      );
    }
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    const pgCode = (err as { code?: string }).code;
    if (pgCode === "23505") {
      return NextResponse.json(
        { error: "Conflito de número de OP — tente novamente" },
        { status: 409 },
      );
    }
    console.error("Erro ao criar OP:", err);
    return NextResponse.json({ error: "Erro ao criar OP" }, { status: 500 });
  }
}

// silence unused import warning for asc — pode ser usado em filtros futuros
void asc;
