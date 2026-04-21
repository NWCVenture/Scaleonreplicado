import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

const SYSTEM_ADMIN_EMAIL = "admin@nwc.com";

async function requireAdmin(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return null;
  const role = (session.user as Record<string, unknown>).role;
  if (role !== "admin") return null;
  return session;
}

const patchSchema = z.object({
  role: z.enum(["admin", "supervisor", "funcionario", "expedicao"]).optional(),
  name: z.string().min(2).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin(request);
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;

  const [target] = await db.select().from(user).where(eq(user.id, id));
  if (!target) {
    return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  }

  const body = await request.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { role, name } = parsed.data;

  if (role && target.email === SYSTEM_ADMIN_EMAIL) {
    return NextResponse.json(
      { error: "Não é possível alterar o perfil do administrador do sistema" },
      { status: 403 }
    );
  }

  if (role && session.user.id === id) {
    return NextResponse.json(
      { error: "Você não pode alterar seu próprio perfil" },
      { status: 403 }
    );
  }

  await db
    .update(user)
    .set({ ...(role && { role }), ...(name && { name }), updatedAt: new Date() })
    .where(eq(user.id, id));

  const [updated] = await db
    .select({ id: user.id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt })
    .from(user)
    .where(eq(user.id, id));

  return NextResponse.json(updated);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin(request);
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;

  const [target] = await db.select().from(user).where(eq(user.id, id));
  if (!target) {
    return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  }

  if (target.email === SYSTEM_ADMIN_EMAIL) {
    return NextResponse.json(
      { error: "Não é possível excluir o administrador do sistema" },
      { status: 403 }
    );
  }

  if (session.user.id === id) {
    return NextResponse.json(
      { error: "Você não pode excluir sua própria conta" },
      { status: 403 }
    );
  }

  await db.delete(user).where(eq(user.id, id));

  return new NextResponse(null, { status: 204 });
}
