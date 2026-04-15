import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { contagemEmbalado } from "@/lib/db/schema";
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
      .from(contagemEmbalado)
      .orderBy(desc(contagemEmbalado.createdAt));

    return NextResponse.json({ items });
  } catch (error) {
    console.error("Error fetching contagem embalados:", error);
    return NextResponse.json(
      { error: "Erro ao buscar embalados" },
      { status: 500 }
    );
  }
}

const createSchema = z.object({
  sku: z.string().min(1),
  quantidade: z.number().int().positive(),
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
      .insert(contagemEmbalado)
      .values({
        id: generateId(),
        sku: data.sku,
        quantidade: data.quantidade,
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

    console.error("Error creating contagem embalado:", error);
    return NextResponse.json(
      { error: "Erro ao registrar embalado" },
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

    await db
      .delete(contagemEmbalado)
      .where(inArray(contagemEmbalado.id, ids));

    return NextResponse.json({ deleted: ids.length });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Dados invalidos", details: error.issues },
        { status: 400 }
      );
    }

    console.error("Error deleting contagem embalados:", error);
    return NextResponse.json(
      { error: "Erro ao deletar embalados" },
      { status: 500 }
    );
  }
}
