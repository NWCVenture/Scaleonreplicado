// GET / POST /api/central-envios/sessao
//
// GET: sessão ativa do usuário ou null. Aplica TTL 8h (lazy).
// POST: idempotente — se já existe ativa, devolve; senão cria.

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { withContaAtiva } from "@/lib/tenancy";
import { sessaoCentralEnvios } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";

const SESSAO_TTL_MS = 8 * 60 * 60 * 1000;

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return msg.includes("conta ativa") || msg.includes("Sessão");
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const ativa = await withContaAtiva(async (tx, contaId) => {
      const [row] = await tx
        .select()
        .from(sessaoCentralEnvios)
        .where(
          and(
            eq(sessaoCentralEnvios.contaId, contaId),
            eq(sessaoCentralEnvios.usuarioId, session.user.id),
            eq(sessaoCentralEnvios.status, "ativa"),
          ),
        )
        .orderBy(desc(sessaoCentralEnvios.iniciouEm))
        .limit(1);

      if (!row) return null;

      const idade = Date.now() - new Date(row.ultimaAtividadeEm).getTime();
      if (idade > SESSAO_TTL_MS) {
        await tx
          .update(sessaoCentralEnvios)
          .set({
            status: "encerrada",
            encerrouEm: new Date(),
            encerradaMotivo: "expirada",
          })
          .where(eq(sessaoCentralEnvios.id, row.id));
        return null;
      }
      return row;
    });

    return NextResponse.json({ sessao: ativa });
  } catch (err) {
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    console.error("[central-envios/sessao] GET:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const sess = await withContaAtiva(async (tx, contaId) => {
      const [existente] = await tx
        .select()
        .from(sessaoCentralEnvios)
        .where(
          and(
            eq(sessaoCentralEnvios.contaId, contaId),
            eq(sessaoCentralEnvios.usuarioId, session.user.id),
            eq(sessaoCentralEnvios.status, "ativa"),
          ),
        )
        .limit(1);
      if (existente) return existente;

      const [row] = await tx
        .insert(sessaoCentralEnvios)
        .values({
          id: generateId(),
          contaId,
          usuarioId: session.user.id,
        })
        .returning();
      return row;
    });

    return NextResponse.json({ sessao: sess }, { status: 201 });
  } catch (err) {
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    console.error("[central-envios/sessao] POST:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
