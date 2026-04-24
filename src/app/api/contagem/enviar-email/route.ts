import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { contagemBipagem } from "@/lib/db/schema";
import { withContaAtiva, requireContaAtiva } from "@/lib/tenancy";
import { enviarRelatorioContagem } from "@/lib/contagem-relatorio";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return msg.includes("conta ativa") || msg.includes("Sessão");
}

export async function POST(_request: NextRequest) {
  try {
    const { userId, contaId } = await requireContaAtiva();

    const items = await withContaAtiva(async (tx, cid) => {
      return tx
        .select({
          sku: contagemBipagem.sku,
          lote: contagemBipagem.lote,
          quantidade: contagemBipagem.quantidade,
          createdAt: contagemBipagem.createdAt,
        })
        .from(contagemBipagem)
        .where(eq(contagemBipagem.contaId, cid))
        .orderBy(desc(contagemBipagem.createdAt));
    });

    if (items.length === 0) {
      return NextResponse.json(
        { error: "Nenhuma bipagem para enviar" },
        { status: 400 },
      );
    }

    const result = await enviarRelatorioContagem({
      items: items.map((i) => ({
        sku: i.sku,
        lote: i.lote,
        quantidade: i.quantidade,
        createdAt: i.createdAt,
      })),
      operadorId: userId,
      contaId,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }
    console.error("[contagem/enviar-email] erro:", error);
    return NextResponse.json(
      { error: "Erro ao enviar relatório por email" },
      { status: 500 },
    );
  }
}
