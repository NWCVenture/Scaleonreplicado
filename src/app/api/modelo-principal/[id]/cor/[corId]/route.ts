import { NextRequest, NextResponse } from "next/server";
import { modeloCor, modeloPrincipal } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withContaAtiva } from "@/lib/tenancy";
import { deactivateSkusByModeloCor } from "@/lib/modelo-cascade";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return msg.includes("conta ativa") || msg.includes("Sessão");
}

const patchSchema = z.object({
  ativo: z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string; corId: string }> },
) {
  try {
    const { id: modeloId, corId } = await ctx.params;
    const body = await request.json();
    const parsed = patchSchema.parse(body);

    let skusAfetados = 0;
    const updated = await withContaAtiva(async (tx, contaId) => {
      const [row] = await tx
        .update(modeloCor)
        .set(parsed)
        .where(
          and(
            eq(modeloCor.id, corId),
            eq(modeloCor.modeloId, modeloId),
            eq(modeloCor.contaId, contaId),
          ),
        )
        .returning();

      // Cascata: desativar cor também desativa SKUs (modelo, cor, *)
      if (row && parsed.ativo === false) {
        const [modelo] = await tx
          .select({ codigo: modeloPrincipal.codigo })
          .from(modeloPrincipal)
          .where(
            and(
              eq(modeloPrincipal.id, modeloId),
              eq(modeloPrincipal.contaId, contaId),
            ),
          );
        if (modelo) {
          skusAfetados = await deactivateSkusByModeloCor(
            tx,
            contaId,
            modelo.codigo,
            row.codigo,
          );
        }
      }

      return row;
    });

    if (!updated) {
      return NextResponse.json(
        { error: "Cor não encontrada" },
        { status: 404 },
      );
    }
    return NextResponse.json({ ...updated, skusAfetados });
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
    console.error("Erro ao atualizar cor:", error);
    return NextResponse.json(
      { error: "Erro ao atualizar cor" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; corId: string }> },
) {
  try {
    const { id: modeloId, corId } = await ctx.params;

    const deleted = await withContaAtiva(async (tx, contaId) => {
      const [row] = await tx
        .delete(modeloCor)
        .where(
          and(
            eq(modeloCor.id, corId),
            eq(modeloCor.modeloId, modeloId),
            eq(modeloCor.contaId, contaId),
          ),
        )
        .returning();
      return row;
    });

    if (!deleted) {
      return NextResponse.json(
        { error: "Cor não encontrada" },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    console.error("Erro ao excluir cor:", error);
    return NextResponse.json(
      { error: "Erro ao excluir cor" },
      { status: 500 },
    );
  }
}
