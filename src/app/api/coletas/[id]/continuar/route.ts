import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  coletaBipagem,
  coletaBipagemPacote,
  coletaDevolucao,
  coletaDevolucaoSku,
} from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { generateId } from "@/lib/utils";
import { withContaAtiva } from "@/lib/tenancy";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return msg.includes("conta ativa") || msg.includes("Sessão");
}

const continuarSchema = z.object({
  tipo: z.enum(["FLEX", "COLETA", "DEVOLUCAO", "CANCELADO"]),
  conta: z.enum(["TIKTOK_SHOP", "MERCADO_LIVRE", "SHOPEE"]),
  pacotes: z
    .array(
      z.object({
        codigo: z.string().min(1),
        transportadora: z
          .enum(["TTK_JDLOG", "TTK_IMILE", "ML", "SHP", "DESCONHECIDA"])
          .optional(),
      })
    )
    .min(1),
  devolucoes: z
    .record(
      z.string(),
      z.object({
        skuLines: z
          .array(
            z.object({
              sku: z.string().min(1),
              qtd: z.number().int().positive(),
            })
          )
          .min(1),
        operacao: z.enum(["TIKTOK_SHOP", "MERCADO_LIVRE", "SHOPEE"]),
        avaria: z.boolean(),
        obs: z.string().optional(),
        tipo: z.enum(["FLEX", "COLETA", "DEVOLUCAO", "CANCELADO"]),
        fotoPacoteBase64: z.string().optional(),
        fotoAvariaBase64: z.string().optional(),
      })
    )
    .optional()
    .default({}),
});

async function uploadPhoto(
  bipagemId: string,
  filename: string,
  base64: string
): Promise<string | null> {
  try {
    const { put } = await import("@vercel/blob");
    const base64Data = base64.includes(",") ? base64.split(",")[1] : base64;
    const buffer = Buffer.from(base64Data!, "base64");
    const blob = await put(`coletas/${bipagemId}/${filename}`, buffer, {
      access: "public",
    });
    return blob.url;
  } catch {
    return null;
  }
}

// PUT /api/coletas/[id]/continuar — substitui pacotes e devoluções da bipagem
// (mantendo o mesmo record), em vez de criar um novo. Usado pelo botão
// "Bipar Mais" do histórico: o usuário continua a bipagem original em vez de
// clonar um registro novo.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const data = continuarSchema.parse(body);

    // Pre-compute pacote rows fora da transação
    const pacoteRows = data.pacotes.map((p) => ({
      id: generateId(),
      bipagemId: id,
      codigo: p.codigo,
      transportadora: p.transportadora ?? null,
    }));

    // Upload de fotos fora da transação (I/O externo — não pode segurar lock)
    type DevolucaoPrepared = {
      pacoteId: string;
      devolucaoId: string;
      operacao: "TIKTOK_SHOP" | "MERCADO_LIVRE" | "SHOPEE";
      avaria: boolean;
      observacao: string | null;
      tipo: "FLEX" | "COLETA" | "DEVOLUCAO" | "CANCELADO";
      fotoPacoteUrl: string | null;
      fotoAvariaUrl: string | null;
      skuLines: { id: string; sku: string; quantidade: number }[];
    };

    const devolucoesPrepared: DevolucaoPrepared[] = [];
    for (const pacoteRow of pacoteRows) {
      const devData = data.devolucoes[pacoteRow.codigo];
      if (!devData) continue;

      let fotoPacoteUrl: string | null = null;
      let fotoAvariaUrl: string | null = null;

      if (devData.fotoPacoteBase64) {
        fotoPacoteUrl = await uploadPhoto(
          id,
          `${pacoteRow.id}-pacote.png`,
          devData.fotoPacoteBase64
        );
      }
      if (devData.fotoAvariaBase64) {
        fotoAvariaUrl = await uploadPhoto(
          id,
          `${pacoteRow.id}-avaria.png`,
          devData.fotoAvariaBase64
        );
      }

      const devolucaoId = generateId();
      devolucoesPrepared.push({
        pacoteId: pacoteRow.id,
        devolucaoId,
        operacao: devData.operacao,
        avaria: devData.avaria,
        observacao: devData.obs || null,
        tipo: devData.tipo,
        fotoPacoteUrl,
        fotoAvariaUrl,
        skuLines: devData.skuLines.map((line) => ({
          id: generateId(),
          sku: line.sku,
          quantidade: line.qtd,
        })),
      });
    }

    const notFound = { notFound: true as const };

    const result = await withContaAtiva(async (tx, contaId) => {
      // Garante que a bipagem existe e pertence à conta ativa
      const [bipagem] = await tx
        .select({ id: coletaBipagem.id })
        .from(coletaBipagem)
        .where(
          and(eq(coletaBipagem.id, id), eq(coletaBipagem.contaId, contaId))
        );
      if (!bipagem) return notFound;

      // Apaga pacotes/devoluções/skus existentes desta bipagem.
      // O ON DELETE CASCADE da FK derruba devolucoes + skus em cascata,
      // mas como temos WHERE por contaId pra respeitar a RLS, deletamos os
      // filhos explicitamente primeiro.
      const pacotesAntigos = await tx
        .select({ id: coletaBipagemPacote.id })
        .from(coletaBipagemPacote)
        .where(
          and(
            eq(coletaBipagemPacote.bipagemId, id),
            eq(coletaBipagemPacote.contaId, contaId)
          )
        );

      if (pacotesAntigos.length > 0) {
        const pacoteIdsAntigos = pacotesAntigos.map((p) => p.id);

        const devolucoesAntigas = await tx
          .select({ id: coletaDevolucao.id })
          .from(coletaDevolucao)
          .where(
            and(
              inArray(coletaDevolucao.pacoteId, pacoteIdsAntigos),
              eq(coletaDevolucao.contaId, contaId)
            )
          );
        if (devolucoesAntigas.length > 0) {
          const devolucaoIdsAntigos = devolucoesAntigas.map((d) => d.id);
          await tx
            .delete(coletaDevolucaoSku)
            .where(
              and(
                inArray(coletaDevolucaoSku.devolucaoId, devolucaoIdsAntigos),
                eq(coletaDevolucaoSku.contaId, contaId)
              )
            );
          await tx
            .delete(coletaDevolucao)
            .where(
              and(
                inArray(coletaDevolucao.id, devolucaoIdsAntigos),
                eq(coletaDevolucao.contaId, contaId)
              )
            );
        }
        await tx
          .delete(coletaBipagemPacote)
          .where(
            and(
              inArray(coletaBipagemPacote.id, pacoteIdsAntigos),
              eq(coletaBipagemPacote.contaId, contaId)
            )
          );
      }

      // Atualiza a bipagem (tipo/conta podem ter mudado, total muda, e o
      // status revisado volta a falso porque novos pacotes foram adicionados)
      await tx
        .update(coletaBipagem)
        .set({
          tipo: data.tipo,
          conta: data.conta,
          total: data.pacotes.length,
          revisado: false,
          revisadoPor: null,
          revisadoEm: null,
        })
        .where(
          and(eq(coletaBipagem.id, id), eq(coletaBipagem.contaId, contaId))
        );

      // Insere os novos pacotes
      await tx
        .insert(coletaBipagemPacote)
        .values(pacoteRows.map((row) => ({ ...row, contaId })));

      // Insere devoluções + skus
      for (const dev of devolucoesPrepared) {
        await tx.insert(coletaDevolucao).values({
          id: dev.devolucaoId,
          pacoteId: dev.pacoteId,
          operacao: dev.operacao,
          avaria: dev.avaria,
          observacao: dev.observacao,
          tipo: dev.tipo,
          fotoPacoteUrl: dev.fotoPacoteUrl,
          fotoAvariaUrl: dev.fotoAvariaUrl,
          contaId,
        });
        await tx.insert(coletaDevolucaoSku).values(
          dev.skuLines.map((line) => ({
            id: line.id,
            devolucaoId: dev.devolucaoId,
            sku: line.sku,
            quantidade: line.quantidade,
            contaId,
          }))
        );
      }

      return { ok: true as const };
    });

    if ("notFound" in result) {
      return NextResponse.json(
        { error: "Bipagem nao encontrada" },
        { status: 404 }
      );
    }

    return NextResponse.json({ id });
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
    console.error("Error continuing bipagem:", error);
    return NextResponse.json(
      { error: "Erro ao continuar bipagem" },
      { status: 500 }
    );
  }
}
