import { NextRequest, NextResponse } from "next/server";
import { modeloPrincipal, modeloCor, modeloTamanho } from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { generateId } from "@/lib/utils";
import { withContaAtiva } from "@/lib/tenancy";
import { syncModelosFromSkus } from "@/lib/modelo-sync";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return msg.includes("conta ativa") || msg.includes("Sessão");
}

export async function GET(request: NextRequest) {
  try {
    const incluirInativos =
      request.nextUrl.searchParams.get("incluirInativos") === "1";

    const modelos = await withContaAtiva(async (tx, contaId) => {
      // Auto-sync com SKUs cadastrados — idempotente, insere o que falta
      await syncModelosFromSkus(tx, contaId);

      const modelosConditions = [eq(modeloPrincipal.contaId, contaId)];
      if (!incluirInativos) modelosConditions.push(eq(modeloPrincipal.ativo, true));

      const rows = await tx
        .select()
        .from(modeloPrincipal)
        .where(and(...modelosConditions))
        .orderBy(asc(modeloPrincipal.codigo));

      // Conta cores e tamanhos por modelo para listagem (counts agregados)
      const cores = await tx
        .select()
        .from(modeloCor)
        .where(eq(modeloCor.contaId, contaId));
      const tamanhos = await tx
        .select()
        .from(modeloTamanho)
        .where(eq(modeloTamanho.contaId, contaId));

      return rows.map((m) => ({
        ...m,
        totalCores: cores.filter((c) => c.modeloId === m.id).length,
        totalTamanhos: tamanhos.filter((t) => t.modeloId === m.id).length,
      }));
    });

    return NextResponse.json({ modelos });
  } catch (error) {
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    console.error("Erro ao listar modelos:", error);
    return NextResponse.json(
      { error: "Erro ao listar modelos" },
      { status: 500 },
    );
  }
}

const createSchema = z.object({
  codigo: z
    .string()
    .min(1)
    .max(50)
    .transform((v) => v.trim().toUpperCase()),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { codigo } = createSchema.parse(body);

    const created = await withContaAtiva(async (tx, contaId) => {
      const [row] = await tx
        .insert(modeloPrincipal)
        .values({ id: generateId(), codigo, contaId })
        .returning();
      return row;
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Dados inválidos", details: error.issues },
        { status: 400 },
      );
    }
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    const pgCode = (error as { code?: string }).code;
    if (pgCode === "23505") {
      return NextResponse.json(
        { error: "Modelo já cadastrado nesta conta" },
        { status: 409 },
      );
    }
    console.error("Erro ao criar modelo:", error);
    return NextResponse.json(
      { error: "Erro ao criar modelo" },
      { status: 500 },
    );
  }
}
