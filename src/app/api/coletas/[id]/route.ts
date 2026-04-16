import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  coletaBipagem,
  coletaBipagemPacote,
  coletaDevolucao,
  coletaDevolucaoSku,
  user,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const revisadoPorUser = alias(user, "revisado_por_user");

    // 1. Get bipagem with user names
    const [bipagem] = await db
      .select({
        id: coletaBipagem.id,
        tipo: coletaBipagem.tipo,
        conta: coletaBipagem.conta,
        total: coletaBipagem.total,
        revisado: coletaBipagem.revisado,
        revisadoPor: coletaBipagem.revisadoPor,
        revisadoPorNome: revisadoPorUser.name,
        revisadoEm: coletaBipagem.revisadoEm,
        usuarioId: coletaBipagem.usuarioId,
        usuarioNome: user.name,
        createdAt: coletaBipagem.createdAt,
      })
      .from(coletaBipagem)
      .leftJoin(user, eq(coletaBipagem.usuarioId, user.id))
      .leftJoin(
        revisadoPorUser,
        eq(coletaBipagem.revisadoPor, revisadoPorUser.id)
      )
      .where(eq(coletaBipagem.id, id));

    if (!bipagem) {
      return NextResponse.json(
        { error: "Bipagem nao encontrada" },
        { status: 404 }
      );
    }

    // 2. Get all pacotes for this bipagem
    const pacotes = await db
      .select()
      .from(coletaBipagemPacote)
      .where(eq(coletaBipagemPacote.bipagemId, id));

    // 3. For each pacote, get devolucao + sku lines
    const pacotesComDevolucao = await Promise.all(
      pacotes.map(async (p) => {
        const [dev] = await db
          .select()
          .from(coletaDevolucao)
          .where(eq(coletaDevolucao.pacoteId, p.id));
        if (!dev) return { ...p, devolucao: null };
        const skuLines = await db
          .select()
          .from(coletaDevolucaoSku)
          .where(eq(coletaDevolucaoSku.devolucaoId, dev.id));
        return { ...p, devolucao: { ...dev, skuLines } };
      })
    );

    return NextResponse.json({ ...bipagem, pacotes: pacotesComDevolucao });
  } catch (error) {
    console.error("Error fetching coleta:", error);
    return NextResponse.json(
      { error: "Erro ao buscar coleta" },
      { status: 500 }
    );
  }
}
