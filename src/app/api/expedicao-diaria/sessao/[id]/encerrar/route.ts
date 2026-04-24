import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sessaoExpedicao } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { withContaAtiva } from "@/lib/tenancy";
import { enviarRelatorioSessao } from "@/lib/sessao-expedicao-relatorio";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return msg.includes("conta ativa") || msg.includes("Sessão");
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

    const encerrada = await withContaAtiva(async (tx, contaId) => {
      const [row] = await tx
        .update(sessaoExpedicao)
        .set({
          status: "encerrada",
          encerrouEm: new Date(),
        })
        .where(
          and(
            eq(sessaoExpedicao.id, id),
            eq(sessaoExpedicao.contaId, contaId),
            eq(sessaoExpedicao.usuarioId, session.user.id),
            eq(sessaoExpedicao.status, "ativa"),
          ),
        )
        .returning();
      return row ?? null;
    });

    if (!encerrada) {
      return NextResponse.json(
        { error: "Sessão não encontrada ou já encerrada" },
        { status: 404 },
      );
    }

    // Envia relatório por email em background — best-effort. Não bloqueia a
    // resposta em caso de falha no envio.
    let emailResult = { sent: 0, failed: 0 };
    try {
      emailResult = await enviarRelatorioSessao(encerrada);
      // Marca relatório_enviado = true se pelo menos 1 email foi entregue
      if (emailResult.sent > 0) {
        const { db } = await import("@/lib/db");
        await db
          .update(sessaoExpedicao)
          .set({ relatorioEnviado: true })
          .where(eq(sessaoExpedicao.id, id));
      }
    } catch (e) {
      console.error("[sessao/encerrar] falha ao enviar relatório:", e);
    }

    return NextResponse.json({ sessao: encerrada, email: emailResult });
  } catch (error) {
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    console.error("Erro ao encerrar sessão:", error);
    return NextResponse.json(
      { error: "Erro ao encerrar sessão" },
      { status: 500 },
    );
  }
}
