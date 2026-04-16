import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { etiquetaAssociacao } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { z } from "zod";
import { generateId } from "@/lib/utils";

export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    const etiquetas = await db
      .select()
      .from(etiquetaAssociacao)
      .orderBy(desc(etiquetaAssociacao.createdAt));

    return NextResponse.json({ etiquetas });
  } catch (error) {
    console.error("Error fetching etiquetas:", error);
    return NextResponse.json(
      { error: "Erro ao buscar etiquetas" },
      { status: 500 }
    );
  }
}

const createSchema = z.object({
  etiquetas: z
    .array(
      z.object({
        etiqueta: z.string().min(1),
        sku: z.string().min(1),
        quantidade: z.number().int().min(0),
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
    const data = createSchema.parse(body);

    const records = data.etiquetas.map((item) => ({
      id: generateId(),
      etiqueta: item.etiqueta,
      sku: item.sku,
      quantidade: item.quantidade,
    }));

    const created = await db
      .insert(etiquetaAssociacao)
      .values(records)
      .returning();

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Dados invalidos", details: error.issues },
        { status: 400 }
      );
    }

    console.error("Error creating etiquetas:", error);
    return NextResponse.json(
      { error: "Erro ao registrar etiquetas" },
      { status: 500 }
    );
  }
}
