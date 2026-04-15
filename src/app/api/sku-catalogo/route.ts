import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { skuCatalogo } from "@/lib/db/schema";
import { asc, ilike } from "drizzle-orm";
import { z } from "zod";
import { generateId } from "@/lib/utils";

export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    const search = request.nextUrl.searchParams.get("search");

    const skus = await db
      .select()
      .from(skuCatalogo)
      .where(search ? ilike(skuCatalogo.codigo, `%${search}%`) : undefined)
      .orderBy(asc(skuCatalogo.codigo));

    return NextResponse.json({ skus });
  } catch (error) {
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
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const { codigo } = createSkuSchema.parse(body);

    const [newSku] = await db
      .insert(skuCatalogo)
      .values({ id: generateId(), codigo })
      .returning();

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
      error.message.includes("unique constraint")
    ) {
      return NextResponse.json({ error: "SKU ja existe" }, { status: 409 });
    }

    console.error("Error creating SKU:", error);
    return NextResponse.json({ error: "Erro ao criar SKU" }, { status: 500 });
  }
}
