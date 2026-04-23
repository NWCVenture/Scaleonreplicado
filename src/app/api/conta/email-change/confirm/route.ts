import { NextRequest, NextResponse } from "next/server";
import { eq, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { conta, emailChangeRequest, user } from "@/lib/db/schema";

function appUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.BETTER_AUTH_URL ||
    "http://localhost:3009"
  );
}

function redirectStatus(status: "ok" | "pending" | "expired" | "invalid") {
  return NextResponse.redirect(`${appUrl()}/gerenciar-conta?email=${status}`);
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return redirectStatus("invalid");

  const [request] = await db
    .select()
    .from(emailChangeRequest)
    .where(
      or(
        eq(emailChangeRequest.tokenAtual, token),
        eq(emailChangeRequest.tokenNovo, token),
      ),
    )
    .limit(1);

  if (!request) return redirectStatus("invalid");
  if (request.aplicadoEm || request.canceladoEm) return redirectStatus("invalid");
  if (request.expiraEm < new Date()) return redirectStatus("expired");

  const ehAtual = token === request.tokenAtual;
  const agora = new Date();

  const updates: Partial<typeof emailChangeRequest.$inferInsert> = {};
  if (ehAtual && !request.confirmadoAtualEm) {
    updates.confirmadoAtualEm = agora;
  }
  if (!ehAtual && !request.confirmadoNovoEm) {
    updates.confirmadoNovoEm = agora;
  }

  const ambosConfirmados =
    (request.confirmadoAtualEm || updates.confirmadoAtualEm) &&
    (request.confirmadoNovoEm || updates.confirmadoNovoEm);

  if (ambosConfirmados) {
    // Aplica a troca: atualiza user.email e conta.emailPrincipal
    const [colisao] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, request.emailNovo))
      .limit(1);

    if (colisao && colisao.id !== request.ownerUserId) {
      await db
        .update(emailChangeRequest)
        .set({ canceladoEm: agora })
        .where(eq(emailChangeRequest.id, request.id));
      return redirectStatus("invalid");
    }

    await db.transaction(async (tx) => {
      await tx
        .update(user)
        .set({ email: request.emailNovo, updatedAt: agora })
        .where(eq(user.id, request.ownerUserId));

      await tx
        .update(conta)
        .set({ emailPrincipal: request.emailNovo, updatedAt: agora })
        .where(eq(conta.id, request.contaId));

      await tx
        .update(emailChangeRequest)
        .set({ ...updates, aplicadoEm: agora })
        .where(eq(emailChangeRequest.id, request.id));
    });

    return redirectStatus("ok");
  }

  await db
    .update(emailChangeRequest)
    .set(updates)
    .where(eq(emailChangeRequest.id, request.id));

  return redirectStatus("pending");
}
