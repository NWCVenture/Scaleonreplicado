import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { estante, estanteFardo } from "@/lib/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { generateId } from "@/lib/utils";
import { withContaAtiva } from "@/lib/tenancy";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return msg.includes("conta ativa") || msg.includes("Sessão");
}

export async function GET(_request: NextRequest) {
  try {
    const payload = await withContaAtiva(async (tx, contaId) => {
      const estantes = await tx
        .select()
        .from(estante)
        .where(eq(estante.contaId, contaId))
        .orderBy(desc(estante.createdAt));

      const stats = await tx
        .select({
          estanteId: estanteFardo.estanteId,
          fardoCount: sql<number>`cast(count(*) as int)`,
          totalPecas: sql<number>`coalesce(cast(sum(${estanteFardo.quantidade}) as int), 0)`,
          topSkus: sql<string[]>`array_agg(distinct ${estanteFardo.sku})`,
        })
        .from(estanteFardo)
        .where(eq(estanteFardo.contaId, contaId))
        .groupBy(estanteFardo.estanteId);

      const statsMap = new Map(stats.map((s) => [s.estanteId, s]));

      return estantes.map((e) => {
        const s = statsMap.get(e.id);
        return {
          ...e,
          fardoCount: s?.fardoCount ?? 0,
          totalPecas: s?.totalPecas ?? 0,
          topSkus: s?.topSkus ?? [],
        };
      });
    });

    return NextResponse.json({ estantes: payload });
  } catch (error) {
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }
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
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const data = createSchema.parse(body);

    const nova = await withContaAtiva(async (tx, contaId) => {
      const [created] = await tx
        .insert(estante)
        .values({
          id: generateId(),
          nome: data.nome,
          descricao: data.descricao ?? null,
          usuarioId: session.user.id,
          contaId,
        })
        .returning();
      return created;
    });

    return NextResponse.json(nova, { status: 201 });
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

    console.error("Error creating estante:", error);
    return NextResponse.json(
      { error: "Erro ao criar estante" },
      { status: 500 }
    );
  }
}
