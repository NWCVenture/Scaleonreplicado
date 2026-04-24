import { NextRequest, NextResponse } from "next/server";
import { modeloTamanho, modeloPrincipal } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withContaAtiva } from "@/lib/tenancy";
import { deactivateSkusByModeloTamanho } from "@/lib/modelo-cascade";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return msg.includes("conta ativa") || msg.includes("Sessão");
}

const patchSchema = z.object({
  ativo: z.boolean().optional(),
  ordem: z.number().int().optional(),
});

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string; tamanhoId: string }> },
) {
  try {
    const { id: modeloId, tamanhoId } = await ctx.params;
    const body = await request.json();
    const parsed = patchSchema.parse(body);

    let skusAfetados = 0;
    const updated = await withContaAtiva(async (tx, contaId) => {
      const [row] = await tx
        .update(modeloTamanho)
        .set(parsed)
        .where(
          and(
            eq(modeloTamanho.id, tamanhoId),
            eq(modeloTamanho.modeloId, modeloId),
            eq(modeloTamanho.contaId, contaId),
          ),
        )
        .returning();

      // Cascata: desativar tamanho também desativa SKUs (modelo, *, tamanho)
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
          skusAfetados = await deactivateSkusByModeloTamanho(
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
        { error: "Tamanho não encontrado" },
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
    console.error("Erro ao atualizar tamanho:", error);
    return NextResponse.json(
      { error: "Erro ao atualizar tamanho" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; tamanhoId: string }> },
) {
  try {
    const { id: modeloId, tamanhoId } = await ctx.params;

    const deleted = await withContaAtiva(async (tx, contaId) => {
      const [row] = await tx
        .delete(modeloTamanho)
        .where(
          and(
            eq(modeloTamanho.id, tamanhoId),
            eq(modeloTamanho.modeloId, modeloId),
            eq(modeloTamanho.contaId, contaId),
          ),
        )
        .returning();
      return row;
    });

    if (!deleted) {
      return NextResponse.json(
        { error: "Tamanho não encontrado" },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    console.error("Erro ao excluir tamanho:", error);
    return NextResponse.json(
      { error: "Erro ao excluir tamanho" },
      { status: 500 },
    );
  }
}
