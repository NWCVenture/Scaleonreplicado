import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { user, account, usuarioConta } from "@/lib/db/schema";
import { desc, eq, and } from "drizzle-orm";
import { z } from "zod";
import { generateId } from "@/lib/utils";
import { hashPassword } from "@better-auth/utils/password";
import { requireAdminAtivo } from "@/lib/tenancy";

async function requireAdminInConta(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return null;
  try {
    const ctx = await requireAdminAtivo();
    return { session, contaId: ctx.contaId };
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const ctx = await requireAdminInConta(request);
  if (!ctx) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const users = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
      papelNaConta: usuarioConta.papel,
    })
    .from(user)
    .innerJoin(usuarioConta, eq(usuarioConta.usuarioId, user.id))
    .where(
      and(
        eq(usuarioConta.contaId, ctx.contaId),
        eq(usuarioConta.ativo, true),
      ),
    )
    .orderBy(desc(user.createdAt));

  return NextResponse.json(
    users.map((u) => ({
      ...u,
      isSystemAdmin: u.papelNaConta === "owner",
    })),
  );
}

const PAPEIS = [
  "admin",
  "gerente",
  "operador",
  "costureiro",
  "financeiro",
  "fiscal",
  "supervisor",
  "funcionario",
  "expedicao",
] as const;

const ROLE_LEGACY_MAP: Record<string, (typeof PAPEIS)[number]> = {
  admin: "admin",
  supervisor: "supervisor",
  funcionario: "funcionario",
  expedicao: "expedicao",
};

const createUserSchema = z
  .object({
    name: z.string().min(2, "Nome deve ter ao menos 2 caracteres"),
    email: z.string().email("Email inválido").transform((v) => v.toLowerCase().trim()),
    password: z
      .string()
      .min(8, "Senha deve ter ao menos 8 caracteres")
      .optional()
      .or(z.literal("")),
    papel: z.enum(PAPEIS).optional(),
    role: z
      .enum(["admin", "supervisor", "funcionario", "expedicao"])
      .optional(),
  })
  .refine((data) => data.papel || data.role, {
    message: "Informe o papel do usuário",
    path: ["papel"],
  });

export async function POST(request: NextRequest) {
  const ctx = await requireAdminInConta(request);
  if (!ctx) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 },
    );
  }

  const { name, email, password, papel, role } = parsed.data;
  const papelFinal = papel ?? (role ? ROLE_LEGACY_MAP[role] : "operador");

  if (papelFinal === "admin" || papelFinal === "gerente") {
    // ok — admin in conta
  }

  const [existingUser] = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(eq(user.email, email));

  // Caso 1 — usuário já existe: apenas vincula a esta conta (Phase A).
  if (existingUser) {
    const [vinculoExistente] = await db
      .select()
      .from(usuarioConta)
      .where(
        and(
          eq(usuarioConta.usuarioId, existingUser.id),
          eq(usuarioConta.contaId, ctx.contaId),
        ),
      );

    if (vinculoExistente && vinculoExistente.ativo) {
      return NextResponse.json(
        { error: "Usuário já vinculado a esta conta" },
        { status: 409 },
      );
    }

    if (vinculoExistente && !vinculoExistente.ativo) {
      // Reativa vínculo previamente desativado.
      await db
        .update(usuarioConta)
        .set({ papel: papelFinal, ativo: true, aceitoEm: new Date() })
        .where(eq(usuarioConta.id, vinculoExistente.id));
    } else {
      await db.insert(usuarioConta).values({
        id: generateId(),
        usuarioId: existingUser.id,
        contaId: ctx.contaId,
        papel: papelFinal,
        convidadoPorId: ctx.session.user.id,
        aceitoEm: new Date(),
        ativo: true,
      });
    }

    return NextResponse.json(
      {
        id: existingUser.id,
        email,
        name: existingUser.name,
        papelNaConta: papelFinal,
        vinculado: true,
      },
      { status: 200 },
    );
  }

  // Caso 2 — usuário novo: exige senha e cria.
  if (!password) {
    return NextResponse.json(
      { error: "Senha obrigatória para novo usuário" },
      { status: 400 },
    );
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
      role: "funcionario", // valor legado mantido por compatibilidade
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

    await tx.insert(usuarioConta).values({
      id: generateId(),
      usuarioId: userId,
      contaId: ctx.contaId,
      papel: papelFinal,
      convidadoPorId: ctx.session.user.id,
      aceitoEm: now,
      ativo: true,
    });
  });

  try {
    await auth.api.sendVerificationEmail({
      body: { email, callbackURL: "/" },
    });
  } catch {
    // non-fatal
  }

  return NextResponse.json(
    {
      id: userId,
      name,
      email,
      papelNaConta: papelFinal,
      criado: true,
    },
    { status: 201 },
  );
}
