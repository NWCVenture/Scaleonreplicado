import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { user, usuarioConta } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
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

async function getVinculo(usuarioId: string, contaId: string) {
  const [v] = await db
    .select()
    .from(usuarioConta)
    .where(
      and(
        eq(usuarioConta.usuarioId, usuarioId),
        eq(usuarioConta.contaId, contaId),
        eq(usuarioConta.ativo, true),
      ),
    );
  return v;
}

const PAPEIS = [
  "owner",
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

const patchSchema = z
  .object({
    papel: z.enum(PAPEIS).optional(),
    role: z
      .enum(["admin", "supervisor", "funcionario", "expedicao"])
      .optional(),
    name: z.string().min(2).optional(),
  })
  .refine((data) => data.papel || data.role || data.name, {
    message: "Forneça pelo menos um campo para atualizar",
  });

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAdminInConta(request);
  if (!ctx) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;

  const vinculo = await getVinculo(id, ctx.contaId);
  if (!vinculo) {
    return NextResponse.json(
      { error: "Usuário não pertence à sua conta" },
      { status: 404 },
    );
  }

  const body = await request.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 },
    );
  }

  const { papel, role, name } = parsed.data;
  const novoPapel = papel ?? (role ? ROLE_LEGACY_MAP[role] : undefined);

  if (novoPapel && vinculo.papel === "owner") {
    return NextResponse.json(
      { error: "Não é possível alterar o papel do owner da conta" },
      { status: 403 },
    );
  }

  if (novoPapel === "owner") {
    return NextResponse.json(
      { error: "Owner não pode ser atribuído por esta rota" },
      { status: 403 },
    );
  }

  if (novoPapel && ctx.session.user.id === id) {
    return NextResponse.json(
      { error: "Você não pode alterar seu próprio papel" },
      { status: 403 },
    );
  }

  await db.transaction(async (tx) => {
    if (name) {
      await tx
        .update(user)
        .set({ name, updatedAt: new Date() })
        .where(eq(user.id, id));
    }
    if (novoPapel) {
      await tx
        .update(usuarioConta)
        .set({ papel: novoPapel })
        .where(eq(usuarioConta.id, vinculo.id));
    }
  });

  const [updated] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
    })
    .from(user)
    .where(eq(user.id, id));

  const vinculoAtualizado = await getVinculo(id, ctx.contaId);

  return NextResponse.json({
    ...updated,
    papelNaConta: vinculoAtualizado?.papel ?? null,
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAdminInConta(request);
  if (!ctx) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;

  const vinculo = await getVinculo(id, ctx.contaId);
  if (!vinculo) {
    return NextResponse.json(
      { error: "Usuário não pertence à sua conta" },
      { status: 404 },
    );
  }

  if (vinculo.papel === "owner") {
    return NextResponse.json(
      { error: "Não é possível remover o owner da conta" },
      { status: 403 },
    );
  }

  if (ctx.session.user.id === id) {
    return NextResponse.json(
      { error: "Você não pode remover sua própria conta" },
      { status: 403 },
    );
  }

  await db
    .update(usuarioConta)
    .set({ ativo: false })
    .where(eq(usuarioConta.id, vinculo.id));

  return new NextResponse(null, { status: 204 });
}
