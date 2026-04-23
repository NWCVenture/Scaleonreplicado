import { NextRequest, NextResponse } from "next/server";
import { transportadoraPadrao } from "@/lib/db/schema";
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
    const transportadoras = await withContaAtiva(async (tx, contaId) => {
      return tx
        .select()
        .from(transportadoraPadrao)
        .where(eq(transportadoraPadrao.contaId, contaId));
    });

    return NextResponse.json({ transportadoras });
  } catch (error) {
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }
    console.error("Error fetching transportadoras:", error);
    return NextResponse.json(
      { error: "Erro ao buscar transportadoras" },
      { status: 500 }
    );
  }
}

const upsertSchema = z.object({
  transportadora: z.string().min(1),
  prefixos: z.array(z.string()),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const data = upsertSchema.parse(body);

    const { row, created } = await withContaAtiva(async (tx, contaId) => {
      const [existing] = await tx
        .select()
        .from(transportadoraPadrao)
        .where(
          and(
            eq(transportadoraPadrao.transportadora, data.transportadora),
            eq(transportadoraPadrao.contaId, contaId)
          )
        );

      if (existing) {
        const [updated] = await tx
          .update(transportadoraPadrao)
          .set({ prefixos: data.prefixos })
          .where(
            and(
              eq(transportadoraPadrao.id, existing.id),
              eq(transportadoraPadrao.contaId, contaId)
            )
          )
          .returning();
        return { row: updated, created: false };
      }

      const [inserted] = await tx
        .insert(transportadoraPadrao)
        .values({
          id: generateId(),
          transportadora: data.transportadora,
          prefixos: data.prefixos,
          contaId,
        })
        .returning();
      return { row: inserted, created: true };
    });

    return NextResponse.json(row, { status: created ? 201 : 200 });
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

    console.error("Error upserting transportadora:", error);
    return NextResponse.json(
      { error: "Erro ao salvar transportadora" },
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
        .delete(transportadoraPadrao)
        .where(
          and(
            eq(transportadoraPadrao.id, data.id),
            eq(transportadoraPadrao.contaId, contaId)
          )
        )
        .returning();
      return row;
    });

    if (!deleted) {
      return NextResponse.json(
        { error: "Transportadora nao encontrada" },
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

    console.error("Error deleting transportadora:", error);
    return NextResponse.json(
      { error: "Erro ao remover transportadora" },
      { status: 500 }
    );
  }
}
