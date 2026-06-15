import { NextRequest, NextResponse } from "next/server";
import {
  coletaBipagem,
  coletaBipagemPacote,
  coletaDevolucao,
  coletaDevolucaoSku,
  user,
} from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
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

      if (pacotes.length === 0) {
        return { bipagem, pacotes: [] };
      }

      // 3. Batch-fetch devolucoes e sku lines de todos os pacotes em 2 queries
      // (em vez de 2N queries) — evitava o N+1 que travava o endpoint pra
      // bipagens grandes (chamado pelos botões Copiar e Bipar Mais do histórico).
      const pacoteIds = pacotes.map((p) => p.id);
      const devolucoes = await tx
        .select()
        .from(coletaDevolucao)
        .where(
          and(
            inArray(coletaDevolucao.pacoteId, pacoteIds),
            eq(coletaDevolucao.contaId, contaId)
          )
        );

      const devolucoesById = new Map(devolucoes.map((d) => [d.id, d]));
      const devolucaoPorPacote = new Map(
        devolucoes.map((d) => [d.pacoteId, d])
      );

      const skuLinesByDevolucao = new Map<
        string,
        Array<typeof coletaDevolucaoSku.$inferSelect>
      >();
      if (devolucoes.length > 0) {
        const skuLines = await tx
          .select()
          .from(coletaDevolucaoSku)
          .where(
            and(
              inArray(
                coletaDevolucaoSku.devolucaoId,
                Array.from(devolucoesById.keys())
              ),
              eq(coletaDevolucaoSku.contaId, contaId)
            )
          );
        for (const line of skuLines) {
          const arr = skuLinesByDevolucao.get(line.devolucaoId) ?? [];
          arr.push(line);
          skuLinesByDevolucao.set(line.devolucaoId, arr);
        }
      }

      const pacotesComDevolucao = pacotes.map((p) => {
        const dev = devolucaoPorPacote.get(p.id);
        if (!dev) return { ...p, devolucao: null };
        return {
          ...p,
          devolucao: {
            ...dev,
            skuLines: skuLinesByDevolucao.get(dev.id) ?? [],
          },
        };
      });

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
