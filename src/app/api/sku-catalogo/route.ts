import { NextRequest, NextResponse } from "next/server";
import { skuCatalogo } from "@/lib/db/schema";
import { and, asc, eq, ilike, not } from "drizzle-orm";
import { z } from "zod";
import { generateId } from "@/lib/utils";
import { withContaAtiva } from "@/lib/tenancy";

export async function GET(request: NextRequest) {
  try {
    const search = request.nextUrl.searchParams.get("search");
    const incluirInativos =
      request.nextUrl.searchParams.get("incluirInativos") === "1";
    const apenasUnitarios =
      request.nextUrl.searchParams.get("apenasUnitarios") === "1";

    const skus = await withContaAtiva(async (tx, contaId) => {
      const conditions = [eq(skuCatalogo.contaId, contaId)];
      if (search) conditions.push(ilike(skuCatalogo.codigo, `%${search}%`));
      if (!incluirInativos) conditions.push(eq(skuCatalogo.ativo, true));
      if (apenasUnitarios) {
        conditions.push(not(ilike(skuCatalogo.codigo, "KIT 2 %")));
        conditions.push(not(ilike(skuCatalogo.codigo, "KIT 3 %")));
        conditions.push(not(ilike(skuCatalogo.codigo, "MIX 3 %")));
      }
      return tx
        .select()
        .from(skuCatalogo)
        .where(and(...conditions))
        .orderBy(asc(skuCatalogo.codigo));
    });

    return NextResponse.json({ skus });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("conta ativa") ||
        error.message.includes("Sessão"))
    ) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }
    console.error("Error fetching SKUs:", error);
    return NextResponse.json({ error: "Erro ao buscar SKUs" }, { status: 500 });
  }
}

const createSkuSchema = z.object({
  codigo: z
    .string()
    .min(1)
    .max(50)
    .transform((v) => v.trim().toUpperCase()),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { codigo } = createSkuSchema.parse(body);

    const newSku = await withContaAtiva(async (tx, contaId) => {
      const [created] = await tx
        .insert(skuCatalogo)
        .values({ id: generateId(), codigo, contaId })
        .returning();
      return created;
    });

    return NextResponse.json(newSku, { status: 201 });
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

    // Postgres unique violation (code 23505) — pg-driver attaches `.code`
    const pgCode = (error as { code?: string }).code;
    if (
      pgCode === "23505" ||
      (error instanceof Error &&
        (error.message.includes("unique constraint") ||
          error.message.includes("duplicate key")))
    ) {
      return NextResponse.json(
        { error: "SKU ja cadastrado nesta conta" },
        { status: 409 }
      );
    }

    console.error("Error creating SKU:", error);
    const msg = error instanceof Error ? error.message : "Erro ao criar SKU";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
