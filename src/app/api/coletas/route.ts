import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  coletaBipagem,
  coletaBipagemPacote,
  coletaDevolucao,
  coletaDevolucaoSku,
  user,
} from "@/lib/db/schema";
import { and, count, desc, eq, gte, lte } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { generateId } from "@/lib/utils";
import { withContaAtiva } from "@/lib/tenancy";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return msg.includes("conta ativa") || msg.includes("Sessão");
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const dataInicio = searchParams.get("dataInicio");
    const dataFim = searchParams.get("dataFim");
    const tipo = searchParams.get("tipo");
    const conta = searchParams.get("conta");
    const revisado = searchParams.get("revisado") || "todos";
    const limit = Math.min(
      parseInt(searchParams.get("limit") || "50", 10) || 50,
      200
    );
    const offset = parseInt(searchParams.get("offset") || "0", 10) || 0;

    const result = await withContaAtiva(async (tx, contaId) => {
      const conditions = [eq(coletaBipagem.contaId, contaId)];

      if (dataInicio) {
        conditions.push(gte(coletaBipagem.createdAt, new Date(dataInicio)));
      }
      if (dataFim) {
        const endOfDay = new Date(dataFim);
        endOfDay.setHours(23, 59, 59, 999);
        conditions.push(lte(coletaBipagem.createdAt, endOfDay));
      }
      if (tipo) {
        conditions.push(
          eq(
            coletaBipagem.tipo,
            tipo as "FLEX" | "COLETA" | "DEVOLUCAO" | "CANCELADO"
          )
        );
      }
      if (conta) {
        conditions.push(
          eq(
            coletaBipagem.conta,
            conta as "TIKTOK_SHOP" | "MERCADO_LIVRE" | "SHOPEE"
          )
        );
      }
      if (revisado === "revisados") {
        conditions.push(eq(coletaBipagem.revisado, true));
      } else if (revisado === "pendentes") {
        conditions.push(eq(coletaBipagem.revisado, false));
      }

      const whereClause = and(...conditions);

      const revisadoPorUser = alias(user, "revisado_por_user");

      const bipagens = await tx
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
        .where(whereClause)
        .orderBy(desc(coletaBipagem.createdAt))
        .limit(limit)
        .offset(offset);

      const [{ total }] = await tx
        .select({ total: count() })
        .from(coletaBipagem)
        .where(whereClause);

      return { bipagens, total };
    });

    return NextResponse.json(result);
  } catch (error) {
    if (isTenancyAuthError(error)) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }
    console.error("Error fetching coletas:", error);
    return NextResponse.json(
      { error: "Erro ao buscar bipagens" },
      { status: 500 }
    );
  }
}

const createSchema = z.object({
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
    const base64Data = base64.includes(",")
      ? base64.split(",")[1]
      : base64;
    const buffer = Buffer.from(base64Data!, "base64");
    const blob = await put(`coletas/${bipagemId}/${filename}`, buffer, {
      access: "public",
    });
    return blob.url;
  } catch {
    // Vercel Blob not configured — skip photo upload
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const data = createSchema.parse(body);

    const bipagemId = generateId();

    // Pre-compute pacote rows so we can upload photos outside the transaction
    const pacoteRows = data.pacotes.map((p) => ({
      id: generateId(),
      bipagemId,
      codigo: p.codigo,
      transportadora: p.transportadora ?? null,
    }));

    // Upload photos BEFORE opening the transaction (non-critical, external I/O)
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
          bipagemId,
          `${pacoteRow.id}-pacote.png`,
          devData.fotoPacoteBase64
        );
      }
      if (devData.fotoAvariaBase64) {
        fotoAvariaUrl = await uploadPhoto(
          bipagemId,
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

    await withContaAtiva(async (tx, contaId) => {
      // 1. Insert coleta_bipagem
      await tx.insert(coletaBipagem).values({
        id: bipagemId,
        tipo: data.tipo,
        conta: data.conta,
        total: data.pacotes.length,
        usuarioId: session.user.id,
        contaId,
      });

      // 2. Batch insert pacotes
      await tx.insert(coletaBipagemPacote).values(
        pacoteRows.map((row) => ({
          ...row,
          contaId,
        }))
      );

      // 3. Insert devolucoes + sku lines
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
    });

    return NextResponse.json({ id: bipagemId }, { status: 201 });
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

    console.error("Error creating bipagem:", error);
    return NextResponse.json(
      { error: "Erro ao registrar bipagem" },
      { status: 500 }
    );
  }
}
