import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { produtoAvariado } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { generateId } from "@/lib/utils";
import { withContaAtiva } from "@/lib/tenancy";

export async function GET() {
  try {
    const registros = await withContaAtiva(async (tx, contaId) => {
      return tx
        .select()
        .from(produtoAvariado)
        .where(eq(produtoAvariado.contaId, contaId))
        .orderBy(desc(produtoAvariado.createdAt));
    });

    return NextResponse.json({ registros });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("conta ativa") ||
        error.message.includes("Sessão"))
    ) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }
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

    const novo = await withContaAtiva(async (tx, contaId) => {
      const [created] = await tx
        .insert(produtoAvariado)
        .values({
          id: generateId(),
          sku: data.sku,
          avaria: data.avaria,
          localizacao: data.localizacao,
          codigoFardo:
            data.localizacao === "LOTE_DE_COSTURA" ? data.codigoFardo : null,
          usuarioId: session.user.id,
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

    if (
      error instanceof Error &&
      (error.message.includes("conta ativa") ||
        error.message.includes("Sessão"))
    ) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    console.error("Error creating produto avariado:", error);
    return NextResponse.json(
      { error: "Erro ao registrar produto avariado" },
      { status: 500 }
    );
  }
}
