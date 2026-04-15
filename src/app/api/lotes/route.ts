import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { loteCadastrado } from "@/lib/db/schema";
import { asc } from "drizzle-orm";
import { z } from "zod";
import { generateId } from "@/lib/utils";

export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    const lotes = await db
      .select()
      .from(loteCadastrado)
      .orderBy(asc(loteCadastrado.nome));

    return NextResponse.json({ lotes });
  } catch (error) {
    console.error("Error fetching lotes:", error);
    return NextResponse.json(
      { error: "Erro ao buscar lotes" },
      { status: 500 }
    );
  }
}

const createLoteSchema = z.object({
  nome: z
    .string()
    .min(1)
    .max(100)
    .transform((v) => v.trim().toUpperCase()),
});

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const { nome } = createLoteSchema.parse(body);

    const [newLote] = await db
      .insert(loteCadastrado)
      .values({ id: generateId(), nome })
      .returning();

    return NextResponse.json(newLote, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Dados invalidos", details: error.issues },
        { status: 400 }
      );
    }

    if (
      error instanceof Error &&
      error.message.includes("unique constraint")
    ) {
      return NextResponse.json({ error: "Lote ja existe" }, { status: 409 });
    }

    console.error("Error creating lote:", error);
    return NextResponse.json(
      { error: "Erro ao criar lote" },
      { status: 500 }
    );
  }
}
