import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { contagemBipagem } from "@/lib/db/schema";
import { desc, inArray } from "drizzle-orm";
import { z } from "zod";
import { generateId } from "@/lib/utils";

export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    const items = await db
      .select()
      .from(contagemBipagem)
      .orderBy(desc(contagemBipagem.createdAt));

    return NextResponse.json({ items });
  } catch (error) {
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
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const data = createSchema.parse(body);

    const [novo] = await db
      .insert(contagemBipagem)
      .values({
        id: generateId(),
        sku: data.sku,
        lote: data.lote,
        quantidade: data.quantidade,
        raw: data.raw,
      })
      .returning();

    return NextResponse.json(novo, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Dados invalidos", details: error.issues },
        { status: 400 }
      );
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
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const { ids } = deleteSchema.parse(body);

    const result = await db
      .delete(contagemBipagem)
      .where(inArray(contagemBipagem.id, ids));

    return NextResponse.json({ deleted: ids.length });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Dados invalidos", details: error.issues },
        { status: 400 }
      );
    }

    console.error("Error deleting contagem bipagem:", error);
    return NextResponse.json(
      { error: "Erro ao deletar bipagens" },
      { status: 500 }
    );
  }
}
