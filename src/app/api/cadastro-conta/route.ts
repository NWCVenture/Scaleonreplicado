import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { verifyPassword } from "@better-auth/utils/password";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { conta, usuarioConta, user, account } from "@/lib/db/schema";

const bodySchema = z.object({
  nomeEmpresa: z.string().min(2).max(80),
  nomeUsuario: z.string().min(2).max(80),
  email: z.string().email().toLowerCase(),
  senha: z.string().min(8).max(128),
});

const TRIAL_DIAS = 14;

async function isOwnerEmAlgumaConta(userId: string): Promise<boolean> {
  const [existe] = await db
    .select({ id: usuarioConta.id })
    .from(usuarioConta)
    .where(
      and(
        eq(usuarioConta.usuarioId, userId),
        eq(usuarioConta.papel, "owner"),
        eq(usuarioConta.ativo, true),
      ),
    )
    .limit(1);
  return !!existe;
}

async function validarSenhaUsuarioExistente(
  userId: string,
  senha: string,
): Promise<boolean> {
  const [acc] = await db
    .select({ password: account.password })
    .from(account)
    .where(
      and(eq(account.userId, userId), eq(account.providerId, "credential")),
    )
    .limit(1);

  if (!acc?.password) return false;
  return verifyPassword(acc.password, senha);
}

export async function POST(req: Request) {
  let payload;
  try {
    payload = bodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: "Dados inválidos.", detail: (err as Error).message },
      { status: 400 },
    );
  }

  const { nomeEmpresa, nomeUsuario, email, senha } = payload;

  const [existente] = await db
    .select()
    .from(user)
    .where(eq(user.email, email))
    .limit(1);

  let userIdParaOwner: string;

  if (existente) {
    if (await isOwnerEmAlgumaConta(existente.id)) {
      return NextResponse.json(
        {
          error:
            "Este email já é owner de outra conta. Cada email pode ser owner de apenas uma conta.",
        },
        { status: 409 },
      );
    }

    const senhaOk = await validarSenhaUsuarioExistente(existente.id, senha);
    if (!senhaOk) {
      return NextResponse.json(
        {
          error:
            "Email já cadastrado. Informe a senha existente para criar uma nova conta vinculada a este usuário.",
        },
        { status: 401 },
      );
    }

    userIdParaOwner = existente.id;
  } else {
    let signUpResult;
    try {
      signUpResult = await auth.api.signUpEmail({
        body: { email, password: senha, name: nomeUsuario },
        asResponse: false,
      });
    } catch (err) {
      return NextResponse.json(
        {
          error: "Não foi possível criar o usuário.",
          detail: (err as Error).message,
        },
        { status: 400 },
      );
    }

    if (!signUpResult?.user?.id) {
      return NextResponse.json(
        { error: "Falha ao criar usuário no provedor de autenticação." },
        { status: 500 },
      );
    }

    userIdParaOwner = signUpResult.user.id;
  }

  const novaContaId = `c_${nanoid(12)}`;
  const trialExpiraEm = new Date(Date.now() + TRIAL_DIAS * 24 * 60 * 60 * 1000);

  try {
    await db.transaction(async (tx) => {
      await tx.insert(conta).values({
        id: novaContaId,
        nome: nomeEmpresa,
        emailPrincipal: email,
        plano: "trial",
        status: "trial",
        trialExpiraEm,
      });

      await tx.insert(usuarioConta).values({
        id: nanoid(),
        usuarioId: userIdParaOwner,
        contaId: novaContaId,
        papel: "owner",
        aceitoEm: new Date(),
        ativo: true,
      });
    });
  } catch (err) {
    if (!existente) {
      await db
        .delete(user)
        .where(eq(user.id, userIdParaOwner))
        .catch(() => {});
    }
    return NextResponse.json(
      { error: "Falha ao criar a conta.", detail: (err as Error).message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    contaId: novaContaId,
    userId: userIdParaOwner,
    trialExpiraEm: trialExpiraEm.toISOString(),
    reaproveitouUsuario: !!existente,
  });
}
