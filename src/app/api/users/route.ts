import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { user, account } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { generateId } from "@/lib/utils";
import { hashPassword } from "@better-auth/utils/password";

const SYSTEM_ADMIN_EMAIL = "admin@nwc.com";

async function requireAdmin(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return null;
  const role = (session.user as Record<string, unknown>).role;
  if (role !== "admin") return null;
  return session;
}

export async function GET(request: NextRequest) {
  const session = await requireAdmin(request);
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const users = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    })
    .from(user)
    .orderBy(desc(user.createdAt));

  return NextResponse.json(
    users.map((u) => ({ ...u, isSystemAdmin: u.email === SYSTEM_ADMIN_EMAIL }))
  );
}

const createUserSchema = z.object({
  name: z.string().min(2, "Nome deve ter ao menos 2 caracteres"),
  email: z.string().email("Email inválido"),
  password: z.string().min(8, "Senha deve ter ao menos 8 caracteres"),
  role: z.enum(["admin", "supervisor", "funcionario", "expedicao"]),
});

export async function POST(request: NextRequest) {
  const session = await requireAdmin(request);
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  const { name, email, password, role } = parsed.data;

  const existing = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  if (existing.length > 0) {
    return NextResponse.json({ error: "Email já cadastrado" }, { status: 409 });
  }

  const hashedPassword = await hashPassword(password);
  const userId = generateId();
  const accountId = generateId();
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx.insert(user).values({
      id: userId,
      name,
      email,
      emailVerified: false,
      role,
      createdAt: now,
      updatedAt: now,
    });

    await tx.insert(account).values({
      id: accountId,
      accountId: userId,
      providerId: "credential",
      userId,
      password: hashedPassword,
      createdAt: now,
      updatedAt: now,
    });
  });

  const created = await db
    .select({ id: user.id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt })
    .from(user)
    .where(eq(user.id, userId));

  try {
    await auth.api.sendVerificationEmail({ body: { email, callbackURL: "/" } });
  } catch {
    // non-fatal: user can resend from dashboard
  }

  return NextResponse.json(created[0], { status: 201 });
}
