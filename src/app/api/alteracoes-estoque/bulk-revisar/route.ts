import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { alteracaoEstoque } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withContaAtiva } from "@/lib/tenancy";

const bulkSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
});

export async function PUT(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const data = bulkSchema.parse(body);

    const updated = await withContaAtiva(async (tx, contaId) => {
      return tx
        .update(alteracaoEstoque)
        .set({
          revisado: true,
          revisadoPor: session.user.id,
          revisadoEm: new Date(),
        })
        .where(
          and(
            inArray(alteracaoEstoque.id, data.ids),
            eq(alteracaoEstoque.revisado, false),
            eq(alteracaoEstoque.contaId, contaId)
          )
        )
        .returning({ id: alteracaoEstoque.id });
    });

    return NextResponse.json({ success: true, count: updated.length });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Dados invalidos", details: error.issues },
        { status: 400 }
      );
    }

    if (
      error instanceof Error &&
      (error.message.includes("conta ativa") ||
        error.message.includes("Sessão"))
    ) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    console.error("Error bulk reviewing alteracoes estoque:", error);
    return NextResponse.json(
      { error: "Erro ao revisar alteracoes de estoque" },
      { status: 500 }
    );
  }
}
