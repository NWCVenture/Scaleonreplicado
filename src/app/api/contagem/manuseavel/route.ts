import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { contagemManuseavel } from "@/lib/db/schema";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { generateId } from "@/lib/utils";

export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    const items = await db
      .select()
      .from(contagemManuseavel)
      .orderBy(asc(contagemManuseavel.sku));

    return NextResponse.json({ items });
  } catch (error) {
    console.error("Error fetching contagem manuseavel:", error);
    return NextResponse.json(
      { error: "Erro ao buscar manuseavel" },
      { status: 500 }
    );
  }
}

const upsertSchema = z.object({
  sku: z.string().min(1),
  quantidade: z.number().int().min(0),
});

export async function PUT(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const data = upsertSchema.parse(body);

    const existing = await db
      .select()
      .from(contagemManuseavel)
      .where(eq(contagemManuseavel.sku, data.sku))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(contagemManuseavel)
        .set({ quantidade: data.quantidade, updatedAt: new Date() })
        .where(eq(contagemManuseavel.id, existing[0].id));
    } else {
      await db.insert(contagemManuseavel).values({
        id: generateId(),
        sku: data.sku,
        quantidade: data.quantidade,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Dados invalidos", details: error.issues },
        { status: 400 }
      );
    }

    console.error("Error upserting contagem manuseavel:", error);
    return NextResponse.json(
      { error: "Erro ao atualizar manuseavel" },
      { status: 500 }
    );
  }
}
