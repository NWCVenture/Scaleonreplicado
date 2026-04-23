import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { trocarContaAtiva } from "@/lib/tenancy";

const BodySchema = z.object({
  contaId: z.string().min(1),
});

export async function POST(request: Request) {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });

  if (!session) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "contaId inválido" },
      { status: 400 },
    );
  }

  try {
    await trocarContaAtiva(
      session.session.id,
      session.user.id,
      parsed.data.contaId,
    );
    return NextResponse.json({ ok: true, contaAtivaId: parsed.data.contaId });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 403 },
    );
  }
}
