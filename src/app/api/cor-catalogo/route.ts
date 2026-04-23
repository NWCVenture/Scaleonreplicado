import { NextRequest, NextResponse } from "next/server";
import { corCatalogo } from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { generateId } from "@/lib/utils";
import { withContaAtiva } from "@/lib/tenancy";

export async function GET(request: NextRequest) {
  try {
    const incluirInativos =
      request.nextUrl.searchParams.get("incluirInativos") === "1";
    const cores = await withContaAtiva(async (tx, contaId) => {
      const conditions = [eq(corCatalogo.contaId, contaId)];
      if (!incluirInativos) conditions.push(eq(corCatalogo.ativo, true));
      return tx
        .select()
        .from(corCatalogo)
        .where(and(...conditions))
        .orderBy(asc(corCatalogo.codigo));
    });
    return NextResponse.json({ cores });
  } catch (error) {
    if (error instanceof Error && error.message.includes("conta ativa")) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }
    console.error("Error fetching cores:", error);
    return NextResponse.json({ error: "Erro ao buscar cores" }, { status: 500 });
  }
}

const createSchema = z.object({
  codigo: z
    .string()
    .min(1)
    .max(20)
    .transform((v) => v.trim().toUpperCase()),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { codigo } = createSchema.parse(body);
    const created = await withContaAtiva(async (tx, contaId) => {
      const [row] = await tx
        .insert(corCatalogo)
        .values({ id: generateId(), codigo, contaId })
        .returning();
      return row;
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0].message },
        { status: 400 },
      );
    }
    if (error instanceof Error && error.message.includes("conta ativa")) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }
    const pgCode = (error as { code?: string }).code;
    if (
      pgCode === "23505" ||
      (error instanceof Error &&
        (error.message.includes("unique") || error.message.includes("duplicate")))
    ) {
      return NextResponse.json(
        { error: "Cor ja cadastrada nesta conta" },
        { status: 409 },
      );
    }
    console.error("Error creating cor:", error);
    const msg = error instanceof Error ? error.message : "Erro ao criar cor";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
