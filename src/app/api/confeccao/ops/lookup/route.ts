// GET /api/confeccao/ops/lookup?q=<termo>&status=<csv>
//
// Autocomplete de OPs pra vinculação a lote/QR (RITM-24). Diferente do
// /api/confeccao/ops, este endpoint:
//   - Retorna no máximo 20 resultados
//   - Aceita CSV em ?status= (default: em_andamento,concluida — cancela exclusa)
//   - Não pagina, não devolve progresso
//   - Ordena por concluidaEm DESC NULLS LAST, depois createdAt DESC

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withContaAtiva } from "@/lib/tenancy";
import {
  confeccaoOrdemProducao,
  confeccaoProduto,
} from "@/lib/db/schema";

const STATUS_VALIDOS = ["em_andamento", "concluida", "cancelada"] as const;
type StatusValido = (typeof STATUS_VALIDOS)[number];

const QuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  status: z
    .string()
    .optional()
    .transform((raw) => {
      if (!raw) return ["em_andamento", "concluida"] as StatusValido[];
      const parts = raw
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const validos = parts.filter((s): s is StatusValido =>
        (STATUS_VALIDOS as readonly string[]).includes(s),
      );
      return validos.length > 0 ? validos : (["em_andamento", "concluida"] as StatusValido[]);
    }),
});

const LIMIT = 20;

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
    const parsed = QuerySchema.parse({
      q: sp.get("q") ?? undefined,
      status: sp.get("status") ?? undefined,
    });

    const ops = await withContaAtiva(async (tx, contaId) => {
      const conditions = [
        eq(confeccaoOrdemProducao.contaId, contaId),
        inArray(confeccaoOrdemProducao.status, parsed.status),
      ];
      if (parsed.q) {
        conditions.push(ilike(confeccaoOrdemProducao.numero, `%${parsed.q}%`));
      }

      return tx
        .select({
          id: confeccaoOrdemProducao.id,
          numero: confeccaoOrdemProducao.numero,
          status: confeccaoOrdemProducao.status,
          produtoNome: confeccaoProduto.nome,
          concluidaEm: confeccaoOrdemProducao.concluidaEm,
          createdAt: confeccaoOrdemProducao.createdAt,
        })
        .from(confeccaoOrdemProducao)
        .innerJoin(
          confeccaoProduto,
          eq(confeccaoProduto.id, confeccaoOrdemProducao.produtoId),
        )
        .where(and(...conditions))
        .orderBy(
          sql`${confeccaoOrdemProducao.concluidaEm} DESC NULLS LAST`,
          desc(confeccaoOrdemProducao.createdAt),
        )
        .limit(LIMIT);
    });

    return NextResponse.json({ ops });
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
    console.error("Erro no lookup de OPs:", err);
    return NextResponse.json(
      { error: "Erro ao buscar OPs" },
      { status: 500 },
    );
  }
}
