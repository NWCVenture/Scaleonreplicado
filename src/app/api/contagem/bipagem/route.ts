import { NextRequest, NextResponse } from "next/server";
import { contagemBipagem } from "@/lib/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { generateId } from "@/lib/utils";
import { withContaAtiva } from "@/lib/tenancy";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return msg.includes("conta ativa") || msg.includes("Sessão");
}

export async function GET(_request: NextRequest) {
  try {
    const items = await withContaAtiva(async (tx, contaId) => {
      return tx
        .select()
        .from(contagemBipagem)
        .where(eq(contagemBipagem.contaId, contaId))
        .orderBy(desc(contagemBipagem.createdAt));
    });

    return NextResponse.json({ items });
  } catch (error) {
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }
    console.error("Error fetching contagem bipagem:", error);
    return NextResponse.json(
      { error: "Erro ao buscar bipagens" },
      { status: 500 }
    );
  }
}

const createSchema = z.object({
  sku: z.string().min(1),
  lote: z.string().min(1),
  quantidade: z.number().int().positive(),
  raw: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const data = createSchema.parse(body);

    const novo = await withContaAtiva(async (tx, contaId) => {
      const [created] = await tx
        .insert(contagemBipagem)
        .values({
          id: generateId(),
          sku: data.sku,
          lote: data.lote,
          quantidade: data.quantidade,
          raw: data.raw,
          contaId,
        })
        .returning();
      return created;
    });

    return NextResponse.json(novo, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Dados invalidos", details: error.issues },
        { status: 400 }
      );
    }
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    console.error("Error creating contagem bipagem:", error);
    return NextResponse.json(
      { error: "Erro ao registrar bipagem" },
      { status: 500 }
    );
  }
}

const deleteSchema = z.object({
  ids: z.array(z.string()).min(1),
});

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { ids } = deleteSchema.parse(body);

    await withContaAtiva(async (tx, contaId) => {
      await tx
        .delete(contagemBipagem)
        .where(
          and(
            eq(contagemBipagem.contaId, contaId),
            inArray(contagemBipagem.id, ids)
          )
        );
    });

    return NextResponse.json({ deleted: ids.length });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Dados invalidos", details: error.issues },
        { status: 400 }
      );
    }
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    console.error("Error deleting contagem bipagem:", error);
    return NextResponse.json(
      { error: "Erro ao deletar bipagens" },
      { status: 500 }
    );
  }
}
