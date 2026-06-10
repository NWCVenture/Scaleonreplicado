import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { analisePedidosImport } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";
import { withContaAtiva } from "@/lib/tenancy";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return msg.includes("conta ativa") || msg.includes("Sessão");
}

// Linhas são serializadas pelo parser client e re-hidratadas no GET. Validamos
// só o shape top-level pra evitar custo de validar 10k linhas por upload.
const postSchema = z.object({
  nomeArquivo: z.string().min(1),
  tamanhoArquivo: z.number().int().nonnegative().default(0),
  periodoMin: z.string().datetime(),
  periodoMax: z.string().datetime(),
  totalLinhas: z.number().int().nonnegative(),
  estadosDistintos: z.array(z.string()),
  avisos: z.array(z.string()),
  linhas: z.array(z.unknown()),
});

export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const registro = await withContaAtiva(async (tx, contaId) => {
      const [row] = await tx
        .select()
        .from(analisePedidosImport)
        .where(eq(analisePedidosImport.contaId, contaId))
        .limit(1);
      return row ?? null;
    });

    return NextResponse.json({ import: registro });
  } catch (error) {
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    console.error("[analise-pedidos/import] GET:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    const body = await request.json();
    const data = postSchema.parse(body);

    const registro = await withContaAtiva(async (tx, contaId) => {
      const [row] = await tx
        .insert(analisePedidosImport)
        .values({
          id: generateId(),
          contaId,
          importadoPor: session.user.id,
          nomeArquivo: data.nomeArquivo,
          tamanhoArquivo: data.tamanhoArquivo,
          periodoMin: new Date(data.periodoMin),
          periodoMax: new Date(data.periodoMax),
          totalLinhas: data.totalLinhas,
          estadosDistintos: data.estadosDistintos,
          avisos: data.avisos,
          linhas: data.linhas,
          importadoEm: new Date(),
        })
        .onConflictDoUpdate({
          target: analisePedidosImport.contaId,
          set: {
            importadoPor: session.user.id,
            nomeArquivo: data.nomeArquivo,
            tamanhoArquivo: data.tamanhoArquivo,
            periodoMin: new Date(data.periodoMin),
            periodoMax: new Date(data.periodoMax),
            totalLinhas: data.totalLinhas,
            estadosDistintos: data.estadosDistintos,
            avisos: data.avisos,
            linhas: data.linhas,
            importadoEm: new Date(),
          },
        })
        .returning();
      return row;
    });

    return NextResponse.json({ import: registro }, { status: 200 });
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
    console.error("[analise-pedidos/import] POST:", error);
    return NextResponse.json(
      { error: "Erro ao salvar import" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    await withContaAtiva(async (tx, contaId) => {
      await tx
        .delete(analisePedidosImport)
        .where(eq(analisePedidosImport.contaId, contaId));
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    console.error("[analise-pedidos/import] DELETE:", error);
    return NextResponse.json(
      { error: "Erro ao remover import" },
      { status: 500 },
    );
  }
}
