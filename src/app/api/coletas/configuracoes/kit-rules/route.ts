import { NextRequest, NextResponse } from "next/server";
import { skuKitRegra, skuKitComponente } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { generateId } from "@/lib/utils";
import { withContaAtiva } from "@/lib/tenancy";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return msg.includes("conta ativa") || msg.includes("Sessão");
}

export async function GET() {
  try {
    const kitRules = await withContaAtiva(async (tx, contaId) => {
      const rules = await tx
        .select()
        .from(skuKitRegra)
        .where(eq(skuKitRegra.contaId, contaId));

      return await Promise.all(
        rules.map(async (rule) => {
          const components = await tx
            .select({
              id: skuKitComponente.id,
              sku: skuKitComponente.sku,
              quantidade: skuKitComponente.quantidade,
            })
            .from(skuKitComponente)
            .where(
              and(
                eq(skuKitComponente.kitRegraId, rule.id),
                eq(skuKitComponente.contaId, contaId)
              )
            );

          return {
            id: rule.id,
            kitSku: rule.kitSku,
            createdAt: rule.createdAt,
            components,
          };
        })
      );
    });

    return NextResponse.json({ kitRules });
  } catch (error) {
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }
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
    const body = await request.json();
    const data = createSchema.parse(body);

    const result = await withContaAtiva(async (tx, contaId) => {
      const regraId = generateId();

      const [regra] = await tx
        .insert(skuKitRegra)
        .values({
          id: regraId,
          kitSku: data.kitSku,
          contaId,
        })
        .returning();

      const componenteValues = data.components.map((c) => ({
        id: generateId(),
        kitRegraId: regraId,
        sku: c.sku,
        quantidade: c.quantidade,
        contaId,
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
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
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
    const body = await request.json();
    const data = deleteSchema.parse(body);

    const deleted = await withContaAtiva(async (tx, contaId) => {
      const [row] = await tx
        .delete(skuKitRegra)
        .where(
          and(eq(skuKitRegra.id, data.id), eq(skuKitRegra.contaId, contaId))
        )
        .returning();
      return row;
    });

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
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    console.error("Error deleting kit rule:", error);
    return NextResponse.json(
      { error: "Erro ao remover regra de kit" },
      { status: 500 }
    );
  }
}
