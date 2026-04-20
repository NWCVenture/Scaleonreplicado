import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { stockItem } from "@/lib/db/schema";
import { z } from "zod";
import { generateId } from "@/lib/utils";

const createStockItemsSchema = z.object({
  items: z
    .array(
      z.object({
        sku: z.string(),
        lote: z.string(),
        quantidade: z.number().int().positive(),
        codigoFardo: z.string().optional(),
      })
    )
    .min(1),
});

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const { items } = createStockItemsSchema.parse(body);

    const values = items.map((item) => ({
      id: generateId(),
      sku: item.sku,
      lote: item.lote,
      quantidade: item.quantidade,
      codigoFardo: item.codigoFardo ?? null,
      usuarioId: session.user.id,
    }));

    await db.insert(stockItem).values(values);

    return NextResponse.json(
      { count: values.length, ids: values.map((v) => v.id) },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Dados invalidos", details: error.issues },
        { status: 400 }
      );
    }

    console.error("Error creating stock items:", error);
    return NextResponse.json(
      { error: "Erro ao criar itens de estoque" },
      { status: 500 }
    );
  }
}
