import { NextRequest, NextResponse } from "next/server";
import { modeloPrincipal, modeloCor, modeloTamanho } from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { withContaAtiva } from "@/lib/tenancy";
import { syncModelosFromSkus } from "@/lib/modelo-sync";
import { deactivateSkusByModelo } from "@/lib/modelo-cascade";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return msg.includes("conta ativa") || msg.includes("Sessão");
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;

    const data = await withContaAtiva(async (tx, contaId) => {
      await syncModelosFromSkus(tx, contaId);

      const [modelo] = await tx
        .select()
        .from(modeloPrincipal)
        .where(
          and(eq(modeloPrincipal.id, id), eq(modeloPrincipal.contaId, contaId)),
        );
      if (!modelo) return null;

      const cores = await tx
        .select()
        .from(modeloCor)
        .where(
          and(eq(modeloCor.modeloId, id), eq(modeloCor.contaId, contaId)),
        )
        .orderBy(asc(modeloCor.codigo));

      const tamanhos = await tx
        .select()
        .from(modeloTamanho)
        .where(
          and(
            eq(modeloTamanho.modeloId, id),
            eq(modeloTamanho.contaId, contaId),
          ),
        )
        .orderBy(asc(modeloTamanho.ordem), asc(modeloTamanho.codigo));

      return { modelo, cores, tamanhos };
    });

    if (!data) {
      return NextResponse.json(
        { error: "Modelo não encontrado" },
        { status: 404 },
      );
    }
    return NextResponse.json(data);
  } catch (error) {
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    console.error("Erro ao buscar modelo:", error);
    return NextResponse.json(
      { error: "Erro ao buscar modelo" },
      { status: 500 },
    );
  }
}

const patchSchema = z.object({
  ativo: z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const body = await request.json();
    const parsed = patchSchema.parse(body);

    let skusAfetados = 0;
    const updated = await withContaAtiva(async (tx, contaId) => {
      const [row] = await tx
        .update(modeloPrincipal)
        .set(parsed)
        .where(
          and(eq(modeloPrincipal.id, id), eq(modeloPrincipal.contaId, contaId)),
        )
        .returning();

      // Cascata: desativar modelo também desativa todas suas cores/tamanhos
      // e todos os SKUs em sku_catalogo do modelo.
      // Reativar modelo NÃO reativa variações (usuário escolhe quais ligar).
      if (row && parsed.ativo === false) {
        await tx
          .update(modeloCor)
          .set({ ativo: false })
          .where(
            and(
              eq(modeloCor.modeloId, id),
              eq(modeloCor.contaId, contaId),
            ),
          );
        await tx
          .update(modeloTamanho)
          .set({ ativo: false })
          .where(
            and(
              eq(modeloTamanho.modeloId, id),
              eq(modeloTamanho.contaId, contaId),
            ),
          );
        skusAfetados = await deactivateSkusByModelo(tx, contaId, row.codigo);
      }

      return row;
    });

    if (!updated) {
      return NextResponse.json(
        { error: "Modelo não encontrado" },
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
    console.error("Erro ao atualizar modelo:", error);
    return NextResponse.json(
      { error: "Erro ao atualizar modelo" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;

    const deleted = await withContaAtiva(async (tx, contaId) => {
      const [row] = await tx
        .delete(modeloPrincipal)
        .where(
          and(eq(modeloPrincipal.id, id), eq(modeloPrincipal.contaId, contaId)),
        )
        .returning();
      return row;
    });

    if (!deleted) {
      return NextResponse.json(
        { error: "Modelo não encontrado" },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    console.error("Erro ao excluir modelo:", error);
    return NextResponse.json(
      { error: "Erro ao excluir modelo" },
      { status: 500 },
    );
  }
}
