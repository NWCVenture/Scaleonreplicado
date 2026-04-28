import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withContaAtiva } from "@/lib/tenancy";
import { enviarRelatorio } from "@/lib/sessao-expedicao-relatorio";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return msg.includes("conta ativa") || msg.includes("Sessão");
}

type Periodo = "hoje" | "24h" | "7d";

function calcularInicio(periodo: Periodo): Date {
  const now = new Date();
  if (periodo === "24h") {
    return new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }
  if (periodo === "7d") {
    return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }
  // "hoje" — meia-noite local
  const inicio = new Date(now);
  inicio.setHours(0, 0, 0, 0);
  return inicio;
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as {
      destinatarios?: unknown;
      periodo?: unknown;
    } | null;

    const destinatariosRaw = Array.isArray(body?.destinatarios)
      ? body!.destinatarios
      : [];
    const destinatarios = destinatariosRaw
      .map((v) => String(v).trim())
      .filter((v) => v.length > 0 && v.includes("@"));

    if (destinatarios.length === 0) {
      return NextResponse.json(
        { error: "Selecione pelo menos um destinatário" },
        { status: 400 },
      );
    }

    const periodo: Periodo =
      body?.periodo === "24h" || body?.periodo === "7d"
        ? body.periodo
        : "hoje";

    const since = calcularInicio(periodo);
    const ate = new Date();

    const result = await withContaAtiva(async (_tx, contaId) => {
      return enviarRelatorio({
        contaId,
        usuarioId: session.user.id,
        destinatarios,
        since,
        ate,
      });
    });

    return NextResponse.json({ ...result, since, ate });
  } catch (error) {
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    console.error("Erro ao enviar relatório:", error);
    return NextResponse.json(
      { error: "Erro ao enviar relatório" },
      { status: 500 },
    );
  }
}
