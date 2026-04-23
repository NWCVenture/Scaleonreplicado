import { NextRequest, NextResponse } from "next/server";
import { contagemManuseavel } from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { generateId } from "@/lib/utils";
import { withContaAtiva } from "@/lib/tenancy";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return msg.includes("conta ativa") || msg.includes("Sessão");
}

export async function GET(_request: NextRequest) {
  try {
    const items = await withContaAtiva(async (tx, contaId) => {
      return tx
        .select()
        .from(contagemManuseavel)
        .where(eq(contagemManuseavel.contaId, contaId))
        .orderBy(asc(contagemManuseavel.sku));
    });

    return NextResponse.json({ items });
  } catch (error) {
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }
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
    const body = await request.json();
    const data = upsertSchema.parse(body);

    await withContaAtiva(async (tx, contaId) => {
      const existing = await tx
        .select()
        .from(contagemManuseavel)
        .where(
          and(
            eq(contagemManuseavel.contaId, contaId),
            eq(contagemManuseavel.sku, data.sku)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        await tx
          .update(contagemManuseavel)
          .set({ quantidade: data.quantidade, updatedAt: new Date() })
          .where(
            and(
              eq(contagemManuseavel.contaId, contaId),
              eq(contagemManuseavel.id, existing[0].id)
            )
          );
      } else {
        await tx.insert(contagemManuseavel).values({
          id: generateId(),
          sku: data.sku,
          quantidade: data.quantidade,
          contaId,
        });
      }
    });

    return NextResponse.json({ ok: true });
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

    console.error("Error upserting contagem manuseavel:", error);
    return NextResponse.json(
      { error: "Erro ao atualizar manuseavel" },
      { status: 500 }
    );
  }
}
