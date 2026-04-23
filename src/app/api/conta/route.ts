import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getContaAtiva, listarContasDoUsuario } from "@/lib/tenancy";

export async function GET() {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });

  if (!session) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const [ctx, contas] = await Promise.all([
    getContaAtiva(),
    listarContasDoUsuario(session.user.id),
  ]);

  return NextResponse.json({
    contaAtivaId: ctx.contaId,
    contas,
  });
}
