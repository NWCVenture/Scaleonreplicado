import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db } from "@/lib/db";
import { conta, user, usuarioConta, emailChangeRequest } from "@/lib/db/schema";
import { requirePapelAtivo } from "@/lib/tenancy";
import { generateId } from "@/lib/utils";
import { sendEmail } from "@/lib/email";

const TTL_HORAS = 2;

const startSchema = z.object({
  emailNovo: z.string().email().toLowerCase(),
});

function appUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.BETTER_AUTH_URL ||
    "http://localhost:3009"
  );
}

function emailHtml(opts: {
  titulo: string;
  intro: string;
  url: string;
  cta: string;
}) {
  return `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px">
      <h2 style="color:#008000">${opts.titulo}</h2>
      <p>${opts.intro}</p>
      <a href="${opts.url}"
        style="display:inline-block;margin:24px 0;padding:12px 28px;background:#008000;color:#fff;border-radius:6px;text-decoration:none;font-weight:bold">
        ${opts.cta}
      </a>
      <p style="color:#666;font-size:13px">Este link expira em ${TTL_HORAS} hora(s). Se você não solicitou esta troca, ignore este email.</p>
    </div>
  `;
}

export async function GET() {
  try {
    const ctx = await requirePapelAtivo();
    if (ctx.papel !== "owner") {
      return NextResponse.json(
        { error: "Apenas o owner pode trocar o email da conta." },
        { status: 403 },
      );
    }

    const pendentes = await db
      .select()
      .from(emailChangeRequest)
      .where(
        and(
          eq(emailChangeRequest.contaId, ctx.contaId),
          eq(emailChangeRequest.ownerUserId, ctx.userId),
        ),
      )
      .orderBy(emailChangeRequest.createdAt);

    const ativa = pendentes.find(
      (p) => !p.aplicadoEm && !p.canceladoEm && p.expiraEm > new Date(),
    );

    return NextResponse.json({
      pendente: ativa
        ? {
            id: ativa.id,
            emailAtual: ativa.emailAtual,
            emailNovo: ativa.emailNovo,
            confirmadoAtual: !!ativa.confirmadoAtualEm,
            confirmadoNovo: !!ativa.confirmadoNovoEm,
            expiraEm: ativa.expiraEm,
            createdAt: ativa.createdAt,
          }
        : null,
    });
  } catch {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
}

export async function POST(req: NextRequest) {
  let ctx;
  try {
    ctx = await requirePapelAtivo();
  } catch {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  if (ctx.papel !== "owner") {
    return NextResponse.json(
      { error: "Apenas o owner pode trocar o email da conta." },
      { status: 403 },
    );
  }

  const body = await req.json();
  const parsed = startSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 },
    );
  }

  const emailNovo = parsed.data.emailNovo;

  const [usuario] = await db
    .select()
    .from(user)
    .where(eq(user.id, ctx.userId))
    .limit(1);

  if (!usuario) {
    return NextResponse.json(
      { error: "Usuário não encontrado." },
      { status: 404 },
    );
  }

  if (usuario.email === emailNovo) {
    return NextResponse.json(
      { error: "O email novo deve ser diferente do atual." },
      { status: 400 },
    );
  }

  const [colisao] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, emailNovo))
    .limit(1);

  if (colisao) {
    return NextResponse.json(
      { error: "Este email já está em uso por outro usuário." },
      { status: 409 },
    );
  }

  // Cancela quaisquer requests anteriores da mesma conta/owner
  await db
    .update(emailChangeRequest)
    .set({ canceladoEm: new Date() })
    .where(
      and(
        eq(emailChangeRequest.contaId, ctx.contaId),
        eq(emailChangeRequest.ownerUserId, ctx.userId),
      ),
    );

  const tokenAtual = nanoid(40);
  const tokenNovo = nanoid(40);
  const expiraEm = new Date(Date.now() + TTL_HORAS * 60 * 60 * 1000);

  await db.insert(emailChangeRequest).values({
    id: generateId(),
    contaId: ctx.contaId,
    ownerUserId: ctx.userId,
    emailAtual: usuario.email,
    emailNovo,
    tokenAtual,
    tokenNovo,
    expiraEm,
  });

  const base = appUrl();
  const urlAtual = `${base}/api/conta/email-change/confirm?token=${tokenAtual}`;
  const urlNovo = `${base}/api/conta/email-change/confirm?token=${tokenNovo}`;

  const [contaInfo] = await db
    .select({ nome: conta.nome })
    .from(conta)
    .where(eq(conta.id, ctx.contaId))
    .limit(1);

  const nomeConta = contaInfo?.nome ?? "sua conta";

  await Promise.all([
    sendEmail({
      to: usuario.email,
      subject: `Confirme a troca de email — ${nomeConta}`,
      html: emailHtml({
        titulo: "Confirme a troca de email da conta",
        intro: `Você solicitou alterar o email do owner de <strong>${nomeConta}</strong> de <strong>${usuario.email}</strong> para <strong>${emailNovo}</strong>. Clique abaixo para confirmar a partir do email atual.`,
        url: urlAtual,
        cta: "Confirmar a partir do email atual",
      }),
    }),
    sendEmail({
      to: emailNovo,
      subject: `Confirme seu novo email — ${nomeConta}`,
      html: emailHtml({
        titulo: "Confirme seu novo email",
        intro: `Este endereço foi indicado como o novo email do owner de <strong>${nomeConta}</strong>. Clique abaixo para confirmar.`,
        url: urlNovo,
        cta: "Confirmar novo email",
      }),
    }),
  ]).catch((err) => console.error("[email-change] envio falhou:", err));

  return NextResponse.json({
    ok: true,
    expiraEm,
    enviado: { atual: usuario.email, novo: emailNovo },
  });
}

export async function DELETE() {
  let ctx;
  try {
    ctx = await requirePapelAtivo();
  } catch {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  if (ctx.papel !== "owner") {
    return NextResponse.json({ error: "Apenas o owner." }, { status: 403 });
  }

  await db
    .update(emailChangeRequest)
    .set({ canceladoEm: new Date() })
    .where(
      and(
        eq(emailChangeRequest.contaId, ctx.contaId),
        eq(emailChangeRequest.ownerUserId, ctx.userId),
      ),
    );

  return NextResponse.json({ ok: true });
}
