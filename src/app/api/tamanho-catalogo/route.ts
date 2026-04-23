import { NextRequest, NextResponse } from "next/server";
import { tamanhoCatalogo } from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { generateId } from "@/lib/utils";
import { withContaAtiva } from "@/lib/tenancy";

export async function GET(request: NextRequest) {
  try {
    const incluirInativos =
      request.nextUrl.searchParams.get("incluirInativos") === "1";
    const tamanhos = await withContaAtiva(async (tx, contaId) => {
      const conditions = [eq(tamanhoCatalogo.contaId, contaId)];
      if (!incluirInativos) conditions.push(eq(tamanhoCatalogo.ativo, true));
      return tx
        .select()
        .from(tamanhoCatalogo)
        .where(and(...conditions))
        .orderBy(asc(tamanhoCatalogo.ordem), asc(tamanhoCatalogo.codigo));
    });
    return NextResponse.json({ tamanhos });
  } catch (error) {
    if (error instanceof Error && error.message.includes("conta ativa")) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }
    console.error("Error fetching tamanhos:", error);
    return NextResponse.json(
      { error: "Erro ao buscar tamanhos" },
      { status: 500 },
    );
  }
}

const createSchema = z.object({
  codigo: z
    .string()
    .min(1)
    .max(20)
    .transform((v) => v.trim().toUpperCase()),
  ordem: z.number().int().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { codigo, ordem } = createSchema.parse(body);
    const created = await withContaAtiva(async (tx, contaId) => {
      const [row] = await tx
        .insert(tamanhoCatalogo)
        .values({ id: generateId(), codigo, contaId, ordem: ordem ?? 0 })
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
        { error: "Tamanho ja cadastrado nesta conta" },
        { status: 409 },
      );
    }
    console.error("Error creating tamanho:", error);
    const msg = error instanceof Error ? error.message : "Erro ao criar tamanho";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
