import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { produtoAvariado } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { z } from "zod";
import { generateId } from "@/lib/utils";

export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    const registros = await db
      .select()
      .from(produtoAvariado)
      .orderBy(desc(produtoAvariado.createdAt));

    return NextResponse.json({ registros });
  } catch (error) {
    console.error("Error fetching produtos avariados:", error);
    return NextResponse.json(
      { error: "Erro ao buscar produtos avariados" },
      { status: 500 }
    );
  }
}

const createSchema = z.object({
  sku: z.string().min(1).max(50),
  avaria: z.string().min(1).max(500),
  localizacao: z.enum(["DEVOLUCAO", "ESTANTE", "LOTE_DE_COSTURA"]),
  codigoFardo: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const data = createSchema.parse(body);

    if (data.localizacao === "LOTE_DE_COSTURA" && !data.codigoFardo) {
      return NextResponse.json(
        { error: "Codigo do fardo e obrigatorio para Lote de Costura" },
        { status: 400 }
      );
    }

    const [novo] = await db
      .insert(produtoAvariado)
      .values({
        id: generateId(),
        sku: data.sku,
        avaria: data.avaria,
        localizacao: data.localizacao,
        codigoFardo: data.localizacao === "LOTE_DE_COSTURA" ? data.codigoFardo : null,
        usuarioId: session.user.id,
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

    console.error("Error creating produto avariado:", error);
    return NextResponse.json(
      { error: "Erro ao registrar produto avariado" },
      { status: 500 }
    );
  }
}
