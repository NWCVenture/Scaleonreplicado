import { NextRequest, NextResponse } from "next/server";
import { modeloPrincipal, modeloTamanho } from "@/lib/db/schema";
import { and, eq, max } from "drizzle-orm";
import { z } from "zod";
import { generateId } from "@/lib/utils";
import { withContaAtiva } from "@/lib/tenancy";
import { upsertTamanhoGlobal } from "@/lib/modelo-cascade";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return msg.includes("conta ativa") || msg.includes("Sessão");
}

const createSchema = z.object({
  codigo: z
    .string()
    .min(1)
    .max(20)
    .transform((v) => v.trim().toUpperCase()),
  ordem: z.number().int().optional(),
});

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id: modeloId } = await ctx.params;
    const body = await request.json();
    const { codigo, ordem } = createSchema.parse(body);

    const created = await withContaAtiva(async (tx, contaId) => {
      const [modelo] = await tx
        .select({ id: modeloPrincipal.id })
        .from(modeloPrincipal)
        .where(
          and(
            eq(modeloPrincipal.id, modeloId),
            eq(modeloPrincipal.contaId, contaId),
          ),
        );
      if (!modelo) return null;

      let ordemFinal = ordem;
      if (ordemFinal === undefined) {
        const [{ maxOrdem }] = await tx
          .select({ maxOrdem: max(modeloTamanho.ordem) })
          .from(modeloTamanho)
          .where(
            and(
              eq(modeloTamanho.modeloId, modeloId),
              eq(modeloTamanho.contaId, contaId),
            ),
          );
        ordemFinal = (maxOrdem ?? -1) + 1;
      }

      const [row] = await tx
        .insert(modeloTamanho)
        .values({
          id: generateId(),
          modeloId,
          codigo,
          ordem: ordemFinal,
          contaId,
        })
        .returning();

      // Sync inverso: tamanho também fica disponível no catálogo global
      // (usado pelo dialog "Novo SKU" na aba SKUs)
      await upsertTamanhoGlobal(tx, contaId, codigo, ordemFinal);

      return row;
    });

    if (!created) {
      return NextResponse.json(
        { error: "Modelo não encontrado" },
        { status: 404 },
      );
    }
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Dados inválidos", details: error.issues },
        { status: 400 },
      );
    }
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    const pgCode = (error as { code?: string }).code;
    if (pgCode === "23505") {
      return NextResponse.json(
        { error: "Tamanho já cadastrado neste modelo" },
        { status: 409 },
      );
    }
    console.error("Erro ao criar tamanho:", error);
    return NextResponse.json(
      { error: "Erro ao criar tamanho" },
      { status: 500 },
    );
  }
}
