import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { estante, estanteFardo } from "@/lib/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { generateId } from "@/lib/utils";

export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    const estantes = await db
      .select()
      .from(estante)
      .orderBy(desc(estante.createdAt));

    const stats = await db
      .select({
        estanteId: estanteFardo.estanteId,
        fardoCount: sql<number>`cast(count(*) as int)`,
        totalPecas: sql<number>`coalesce(cast(sum(${estanteFardo.quantidade}) as int), 0)`,
        topSkus: sql<string[]>`array_agg(distinct ${estanteFardo.sku})`,
      })
      .from(estanteFardo)
      .groupBy(estanteFardo.estanteId);

    const statsMap = new Map(stats.map((s) => [s.estanteId, s]));

    const result = estantes.map((e) => {
      const s = statsMap.get(e.id);
      return {
        ...e,
        fardoCount: s?.fardoCount ?? 0,
        totalPecas: s?.totalPecas ?? 0,
        topSkus: s?.topSkus ?? [],
      };
    });

    return NextResponse.json({ estantes: result });
  } catch (error) {
    console.error("Error fetching estantes:", error);
    return NextResponse.json(
      { error: "Erro ao buscar estantes" },
      { status: 500 }
    );
  }
}

const createSchema = z.object({
  nome: z
    .string()
    .min(1)
    .max(100)
    .transform((v) => v.toUpperCase()),
  descricao: z.string().max(500).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const data = createSchema.parse(body);

    const [nova] = await db
      .insert(estante)
      .values({
        id: generateId(),
        nome: data.nome,
        descricao: data.descricao ?? null,
        usuarioId: session.user.id,
      })
      .returning();

    return NextResponse.json(nova, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Dados invalidos", details: error.issues },
        { status: 400 }
      );
    }

    console.error("Error creating estante:", error);
    return NextResponse.json(
      { error: "Erro ao criar estante" },
      { status: 500 }
    );
  }
}
