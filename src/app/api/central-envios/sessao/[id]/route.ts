// PATCH /api/central-envios/sessao/[id]
//
// Auto-save de campos leves: filtrosExtrator + tipoVisualizacao.
// Não aceita atualizar dados/arquivosIngeridos — só /processar pode.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { withContaAtiva } from "@/lib/tenancy";
import { sessaoCentralEnvios } from "@/lib/db/schema";

const PatchSchema = z
  .object({
    filtrosExtrator: z.record(z.string(), z.unknown()).optional(),
    tipoVisualizacao: z.string().min(1).max(64).optional(),
  })
  .refine(
    (v) => v.filtrosExtrator !== undefined || v.tipoVisualizacao !== undefined,
    "Pelo menos um campo deve ser informado",
  );

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const { id } = await params;

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const json = await request.json().catch(() => ({}));
  const parsed = PatchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Body inválido" },
      { status: 400 },
    );
  }

  try {
    const atualizada = await withContaAtiva(async (tx, contaId) => {
      const [row] = await tx
        .select()
        .from(sessaoCentralEnvios)
        .where(
          and(
            eq(sessaoCentralEnvios.id, id),
            eq(sessaoCentralEnvios.contaId, contaId),
            eq(sessaoCentralEnvios.usuarioId, session.user.id),
            eq(sessaoCentralEnvios.status, "ativa"),
          ),
        )
        .limit(1);
      if (!row) return null;

      const updates: Record<string, unknown> = {
        ultimaAtividadeEm: new Date(),
      };
      if (parsed.data.filtrosExtrator !== undefined) {
        updates.filtrosExtrator = parsed.data.filtrosExtrator;
      }
      if (parsed.data.tipoVisualizacao !== undefined) {
        updates.tipoVisualizacao = parsed.data.tipoVisualizacao;
      }
      const [updated] = await tx
        .update(sessaoCentralEnvios)
        .set(updates)
        .where(eq(sessaoCentralEnvios.id, id))
        .returning();
      return updated;
    });

    if (!atualizada) {
      return NextResponse.json(
        { error: "Sessão não encontrada ou não está ativa" },
        { status: 404 },
      );
    }
    return NextResponse.json({ sessao: atualizada });
  } catch (err) {
    console.error("[central-envios/sessao/[id]] PATCH:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
