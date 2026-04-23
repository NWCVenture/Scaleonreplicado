import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  getPapelAtivo,
  isAdminPapel,
  listarContasDoUsuario,
} from "@/lib/tenancy";

export async function GET() {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });

  if (!session) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const [{ contaId, papel }, contas] = await Promise.all([
    getPapelAtivo(),
    listarContasDoUsuario(session.user.id),
  ]);

  return NextResponse.json({
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      emailVerified: session.user.emailVerified,
    },
    contaAtivaId: contaId,
    papelAtivo: papel,
    isAdmin: isAdminPapel(papel),
    contas,
  });
}
