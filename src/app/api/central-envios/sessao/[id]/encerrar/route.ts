// POST /api/central-envios/sessao/[id]/encerrar
//
// Marca a sessão como encerrada. Motivo válido: 'finalizada' (operador
// clicou arquivar) ou 'forcada' (forçar parada). 'expirada' é
// reservada para TTL (set pelo GET).
//
// Idempotente: já encerrada → 200 noop.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { withContaAtiva } from "@/lib/tenancy";
import { sessaoCentralEnvios } from "@/lib/db/schema";

const BodySchema = z.object({
  motivo: z.enum(["finalizada", "forcada"]),
});

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  const { id } = await params;

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const json = await request.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Body inválido" },
      { status: 400 },
    );
  }

  try {
    const r = await withContaAtiva(async (tx, contaId) => {
      const [row] = await tx
        .select()
        .from(sessaoCentralEnvios)
        .where(
          and(
            eq(sessaoCentralEnvios.id, id),
            eq(sessaoCentralEnvios.contaId, contaId),
            eq(sessaoCentralEnvios.usuarioId, session.user.id),
          ),
        )
        .limit(1);
      if (!row) return { found: false } as const;
      if (row.status === "encerrada") return { found: true, noop: true } as const;

      await tx
        .update(sessaoCentralEnvios)
        .set({
          status: "encerrada",
          encerrouEm: new Date(),
          encerradaMotivo: parsed.data.motivo,
        })
        .where(eq(sessaoCentralEnvios.id, id));
      return { found: true, noop: false } as const;
    });

    if (!r.found) {
      return NextResponse.json(
        { error: "Sessão não encontrada" },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, noop: r.noop });
  } catch (err) {
    console.error("[central-envios/sessao/[id]/encerrar] POST:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
