import { NextRequest, NextResponse } from "next/server";
import { etiquetaAssociacao } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { generateId } from "@/lib/utils";
import { withContaAtiva } from "@/lib/tenancy";

export async function GET(request: NextRequest) {
  try {
    const etiquetas = await withContaAtiva(async (tx, contaId) => {
      return tx
        .select()
        .from(etiquetaAssociacao)
        .where(eq(etiquetaAssociacao.contaId, contaId))
        .orderBy(desc(etiquetaAssociacao.createdAt));
    });

    return NextResponse.json({ etiquetas });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("conta ativa") ||
        error.message.includes("Sessão"))
    ) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

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
    const body = await request.json();
    const data = createSchema.parse(body);

    const created = await withContaAtiva(async (tx, contaId) => {
      const records = data.etiquetas.map((item) => ({
        id: generateId(),
        etiqueta: item.etiqueta,
        sku: item.sku,
        quantidade: item.quantidade,
        contaId,
      }));

      return tx.insert(etiquetaAssociacao).values(records).returning();
    });

    return NextResponse.json(created, { status: 201 });
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

    console.error("Error creating etiquetas:", error);
    return NextResponse.json(
      { error: "Erro ao registrar etiquetas" },
      { status: 500 }
    );
  }
}
