import { NextRequest, NextResponse } from "next/server";
import { loteCadastrado } from "@/lib/db/schema";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { generateId } from "@/lib/utils";
import { withContaAtiva } from "@/lib/tenancy";

export async function GET(_request: NextRequest) {
  try {
    const lotes = await withContaAtiva(async (tx, contaId) => {
      return tx
        .select()
        .from(loteCadastrado)
        .where(eq(loteCadastrado.contaId, contaId))
        .orderBy(asc(loteCadastrado.nome));
    });

    return NextResponse.json({ lotes });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("conta ativa") ||
        error.message.includes("Sessão"))
    ) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

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
    const body = await request.json();
    const { nome } = createLoteSchema.parse(body);

    const newLote = await withContaAtiva(async (tx, contaId) => {
      const [created] = await tx
        .insert(loteCadastrado)
        .values({ id: generateId(), nome, contaId })
        .returning();
      return created;
    });

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
      (error.message.includes("conta ativa") ||
        error.message.includes("Sessão"))
    ) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
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
