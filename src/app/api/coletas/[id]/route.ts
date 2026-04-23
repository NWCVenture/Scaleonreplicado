import { NextRequest, NextResponse } from "next/server";
import {
  coletaBipagem,
  coletaBipagemPacote,
  coletaDevolucao,
  coletaDevolucaoSku,
  user,
} from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { withContaAtiva } from "@/lib/tenancy";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return msg.includes("conta ativa") || msg.includes("Sessão");
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const revisadoPorUser = alias(user, "revisado_por_user");

    const result = await withContaAtiva(async (tx, contaId) => {
      // 1. Get bipagem with user names
      const [bipagem] = await tx
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
        .where(
          and(eq(coletaBipagem.id, id), eq(coletaBipagem.contaId, contaId))
        );

      if (!bipagem) {
        return { notFound: true as const };
      }

      // 2. Get all pacotes for this bipagem
      const pacotes = await tx
        .select()
        .from(coletaBipagemPacote)
        .where(
          and(
            eq(coletaBipagemPacote.bipagemId, id),
            eq(coletaBipagemPacote.contaId, contaId)
          )
        );

      // 3. For each pacote, get devolucao + sku lines
      const pacotesComDevolucao = await Promise.all(
        pacotes.map(async (p) => {
          const [dev] = await tx
            .select()
            .from(coletaDevolucao)
            .where(
              and(
                eq(coletaDevolucao.pacoteId, p.id),
                eq(coletaDevolucao.contaId, contaId)
              )
            );
          if (!dev) return { ...p, devolucao: null };
          const skuLines = await tx
            .select()
            .from(coletaDevolucaoSku)
            .where(
              and(
                eq(coletaDevolucaoSku.devolucaoId, dev.id),
                eq(coletaDevolucaoSku.contaId, contaId)
              )
            );
          return { ...p, devolucao: { ...dev, skuLines } };
        })
      );

      return { bipagem, pacotes: pacotesComDevolucao };
    });

    if ("notFound" in result) {
      return NextResponse.json(
        { error: "Bipagem nao encontrada" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ...result.bipagem,
      pacotes: result.pacotes,
    });
  } catch (error) {
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }
    console.error("Error fetching coleta:", error);
    return NextResponse.json(
      { error: "Erro ao buscar coleta" },
      { status: 500 }
    );
  }
}
