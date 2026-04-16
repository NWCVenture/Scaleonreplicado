import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { skuKitRegra, skuKitComponente } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { generateId } from "@/lib/utils";

export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    const rules = await db.select().from(skuKitRegra);

    const kitRules = await Promise.all(
      rules.map(async (rule) => {
        const components = await db
          .select({
            id: skuKitComponente.id,
            sku: skuKitComponente.sku,
            quantidade: skuKitComponente.quantidade,
          })
          .from(skuKitComponente)
          .where(eq(skuKitComponente.kitRegraId, rule.id));

        return {
          id: rule.id,
          kitSku: rule.kitSku,
          createdAt: rule.createdAt,
          components,
        };
      })
    );

    return NextResponse.json({ kitRules });
  } catch (error) {
    console.error("Error fetching kit rules:", error);
    return NextResponse.json(
      { error: "Erro ao buscar regras de kit" },
      { status: 500 }
    );
  }
}

const createSchema = z.object({
  kitSku: z.string().min(1),
  components: z
    .array(
      z.object({
        sku: z.string().min(1),
        quantidade: z.number().int().positive(),
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

    const result = await db.transaction(async (tx) => {
      const regraId = generateId();

      const [regra] = await tx
        .insert(skuKitRegra)
        .values({
          id: regraId,
          kitSku: data.kitSku,
        })
        .returning();

      const componenteValues = data.components.map((c) => ({
        id: generateId(),
        kitRegraId: regraId,
        sku: c.sku,
        quantidade: c.quantidade,
      }));

      await tx.insert(skuKitComponente).values(componenteValues);

      return {
        id: regra.id,
        kitSku: regra.kitSku,
        createdAt: regra.createdAt,
        components: componenteValues.map((c) => ({
          id: c.id,
          sku: c.sku,
          quantidade: c.quantidade,
        })),
      };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Dados invalidos", details: error.issues },
        { status: 400 }
      );
    }

    console.error("Error creating kit rule:", error);
    return NextResponse.json(
      { error: "Erro ao criar regra de kit" },
      { status: 500 }
    );
  }
}

const deleteSchema = z.object({
  id: z.string(),
});

export async function DELETE(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const data = deleteSchema.parse(body);

    const [deleted] = await db
      .delete(skuKitRegra)
      .where(eq(skuKitRegra.id, data.id))
      .returning();

    if (!deleted) {
      return NextResponse.json(
        { error: "Regra de kit nao encontrada" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Dados invalidos", details: error.issues },
        { status: 400 }
      );
    }

    console.error("Error deleting kit rule:", error);
    return NextResponse.json(
      { error: "Erro ao remover regra de kit" },
      { status: 500 }
    );
  }
}
