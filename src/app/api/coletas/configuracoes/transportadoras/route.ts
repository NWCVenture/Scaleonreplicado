import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { transportadoraPadrao } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { generateId } from "@/lib/utils";

export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    const transportadoras = await db
      .select()
      .from(transportadoraPadrao);

    return NextResponse.json({ transportadoras });
  } catch (error) {
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
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const data = upsertSchema.parse(body);

    const [existing] = await db
      .select()
      .from(transportadoraPadrao)
      .where(eq(transportadoraPadrao.transportadora, data.transportadora));

    if (existing) {
      const [updated] = await db
        .update(transportadoraPadrao)
        .set({ prefixos: data.prefixos })
        .where(eq(transportadoraPadrao.id, existing.id))
        .returning();

      return NextResponse.json(updated);
    }

    const [created] = await db
      .insert(transportadoraPadrao)
      .values({
        id: generateId(),
        transportadora: data.transportadora,
        prefixos: data.prefixos,
      })
      .returning();

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Dados invalidos", details: error.issues },
        { status: 400 }
      );
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
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const data = deleteSchema.parse(body);

    const [deleted] = await db
      .delete(transportadoraPadrao)
      .where(eq(transportadoraPadrao.id, data.id))
      .returning();

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

    console.error("Error deleting transportadora:", error);
    return NextResponse.json(
      { error: "Erro ao remover transportadora" },
      { status: 500 }
    );
  }
}
