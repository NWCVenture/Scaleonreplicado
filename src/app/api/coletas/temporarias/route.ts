import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { coletaBipagemTemporaria } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { generateId } from "@/lib/utils";
import { withContaAtiva } from "@/lib/tenancy";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return msg.includes("conta ativa") || msg.includes("Sessão");
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    const temporarias = await withContaAtiva(async (tx, contaId) => {
      return tx
        .select()
        .from(coletaBipagemTemporaria)
        .where(
          and(
            eq(coletaBipagemTemporaria.usuarioId, session.user.id),
            eq(coletaBipagemTemporaria.contaId, contaId)
          )
        )
        .orderBy(desc(coletaBipagemTemporaria.createdAt));
    });

    return NextResponse.json({ temporarias });
  } catch (error) {
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }
    console.error("Error fetching temporarias:", error);
    return NextResponse.json(
      { error: "Erro ao buscar bipagens temporarias" },
      { status: 500 }
    );
  }
}

const createSchema = z.object({
  tipo: z.enum(["FLEX", "COLETA", "DEVOLUCAO", "CANCELADO"]),
  conta: z.enum(["TIKTOK_SHOP", "MERCADO_LIVRE", "SHOPEE"]),
  total: z.number().int(),
  dados: z.object({
    pacotes: z.array(
      z.object({
        codigo: z.string(),
        transportadora: z.string().optional(),
      })
    ),
    devolucoes: z.record(z.string(), z.object({
      skuLines: z.array(z.object({ sku: z.string(), qtd: z.number() })),
      operacao: z.string(),
      avaria: z.string(),
      obs: z.string(),
      tipo: z.string(),
    })),
  }),
});

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const data = createSchema.parse(body);

    const id = generateId();

    await withContaAtiva(async (tx, contaId) => {
      await tx.insert(coletaBipagemTemporaria).values({
        id,
        tipo: data.tipo,
        conta: data.conta,
        total: data.total,
        dados: data.dados,
        usuarioId: session.user.id,
        contaId,
      });
    });

    return NextResponse.json({ id }, { status: 201 });
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

    console.error("Error saving temporaria:", error);
    return NextResponse.json(
      { error: "Erro ao salvar bipagem temporaria" },
      { status: 500 }
    );
  }
}
