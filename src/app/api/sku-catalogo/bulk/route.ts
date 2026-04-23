import { NextRequest, NextResponse } from "next/server";
import { skuCatalogo } from "@/lib/db/schema";
import { z } from "zod";
import { generateId } from "@/lib/utils";
import { withContaAtiva } from "@/lib/tenancy";

const bulkSchema = z.object({
  codigos: z
    .array(z.string().min(1).max(120))
    .min(1)
    .max(2000),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { codigos } = bulkSchema.parse(body);

    const normalized = Array.from(
      new Set(
        codigos
          .map((c) => c.trim().toUpperCase().replace(/\s+/g, " "))
          .filter((c) => c.length > 0),
      ),
    );

    if (normalized.length === 0) {
      return NextResponse.json(
        { error: "Nenhum codigo valido informado" },
        { status: 400 },
      );
    }

    const result = await withContaAtiva(async (tx, contaId) => {
      const rows = normalized.map((codigo) => ({
        id: generateId(),
        codigo,
        contaId,
      }));

      const inserted = await tx
        .insert(skuCatalogo)
        .values(rows)
        .onConflictDoNothing({
          target: [skuCatalogo.codigo, skuCatalogo.contaId],
        })
        .returning();

      return {
        created: inserted.length,
        skipped: normalized.length - inserted.length,
        total: normalized.length,
        rows: inserted,
      };
    });

    return NextResponse.json(result, { status: 201 });
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
    console.error("Error bulk creating SKUs:", error);
    const msg = error instanceof Error ? error.message : "Erro ao criar SKUs";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
