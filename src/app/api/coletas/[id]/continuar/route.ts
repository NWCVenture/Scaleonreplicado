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
import { withContaAtiva, corpoDeErroDeTenancy, corpoSemSessao } from "@/lib/tenancy";

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
  // Códigos que ESTA tela tinha ao entrar em "continuar". É a referência do que
  // ela pode remover: um pacote que não está nessa base e nem na lista enviada
  // foi bipado por outra pessoa depois, e não é da conta deste request mexer.
  // Ausente (aba antiga): nada é removido — perder bipagem é pior que deixar
  // de aplicar uma remoção.
  pacotesBase: z.array(z.string()).optional(),
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
      return NextResponse.json(corpoSemSessao(), { status: 401 });
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

    // Upload de fotos fora da transação (I/O externo — não pode segurar lock).
    // `indicePacote` aponta para a posição em `pacoteRows`: o id definitivo do
    // pacote só é conhecido dentro da transação, porque pacote que já existe
    // mantém a linha atual em vez de ganhar linha nova.
    type DevolucaoPrepared = {
      indicePacote: number;
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
    for (const [indicePacote, pacoteRow] of pacoteRows.entries()) {
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
        indicePacote,
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

      // Estado atual no banco. Pode conter pacotes que esta tela nunca viu,
      // bipados por outra pessoa depois que ela carregou a bipagem.
      const armazenados = await tx
        .select({ id: coletaBipagemPacote.id, codigo: coletaBipagemPacote.codigo })
        .from(coletaBipagemPacote)
        .where(
          and(
            eq(coletaBipagemPacote.bipagemId, id),
            eq(coletaBipagemPacote.contaId, contaId)
          )
        );

      const armazenadosPorCodigo = new Map<string, string[]>();
      for (const p of armazenados) {
        const lista = armazenadosPorCodigo.get(p.codigo) ?? [];
        lista.push(p.id);
        armazenadosPorCodigo.set(p.codigo, lista);
      }

      // Quantas vezes cada código veio nesta requisição. Contagem, não conjunto:
      // com a deduplicação desligada o operador pode bipar o mesmo código duas
      // vezes de propósito, e isso precisa ser preservado.
      const enviadosPorCodigo = new Map<string, number>();
      for (const p of data.pacotes) {
        enviadosPorCodigo.set(p.codigo, (enviadosPorCodigo.get(p.codigo) ?? 0) + 1);
      }

      const base = new Set(data.pacotesBase ?? data.pacotes.map((p) => p.codigo));

      // Resolve, para cada linha enviada, se ela reaproveita um pacote que já
      // está no banco ou se vira linha nova. E decide o que remover: só sobra
      // de código que estava na base desta tela.
      const idsParaRemover: string[] = [];
      const idsReaproveitados = new Set<string>();
      const idFinalPorIndice = new Map<number, string>();
      const indicesPorCodigo = new Map<string, number[]>();
      for (const [indice, row] of pacoteRows.entries()) {
        const lista = indicesPorCodigo.get(row.codigo) ?? [];
        lista.push(indice);
        indicesPorCodigo.set(row.codigo, lista);
      }

      for (const [codigo, indices] of indicesPorCodigo) {
        const existentes = armazenadosPorCodigo.get(codigo) ?? [];
        indices.forEach((indice, i) => {
          const reaproveitado = existentes[i];
          if (reaproveitado) {
            idFinalPorIndice.set(indice, reaproveitado);
            idsReaproveitados.add(reaproveitado);
          } else {
            idFinalPorIndice.set(indice, pacoteRows[indice].id);
          }
        });
        // Sobra de linhas do mesmo código: remove só se o código era da base.
        if (existentes.length > indices.length && base.has(codigo)) {
          idsParaRemover.push(...existentes.slice(indices.length));
        }
      }

      // Códigos que o banco tem e esta requisição não trouxe: remoção
      // deliberada quando estavam na base; pacote de outra pessoa quando não.
      for (const [codigo, ids] of armazenadosPorCodigo) {
        if (enviadosPorCodigo.has(codigo)) continue;
        if (base.has(codigo)) idsParaRemover.push(...ids);
      }

      // Devoluções: apaga as das linhas removidas e também as das reaproveitadas
      // (essas são regravadas logo abaixo, para a edição do operador valer).
      const idsComDevolucaoObsoleta = [...idsParaRemover, ...idsReaproveitados];
      if (idsComDevolucaoObsoleta.length > 0) {
        const devolucoesAntigas = await tx
          .select({ id: coletaDevolucao.id })
          .from(coletaDevolucao)
          .where(
            and(
              inArray(coletaDevolucao.pacoteId, idsComDevolucaoObsoleta),
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
      }

      if (idsParaRemover.length > 0) {
        await tx
          .delete(coletaBipagemPacote)
          .where(
            and(
              inArray(coletaBipagemPacote.id, idsParaRemover),
              eq(coletaBipagemPacote.contaId, contaId)
            )
          );
      }

      // Insere só o que ainda não existe.
      const linhasNovas = pacoteRows.filter(
        (row, indice) => idFinalPorIndice.get(indice) === row.id,
      );
      if (linhasNovas.length > 0) {
        await tx
          .insert(coletaBipagemPacote)
          .values(linhasNovas.map((row) => ({ ...row, contaId })));
      }

      // Total = o que ficou no banco, não o tamanho da lista enviada: pacote de
      // outro operador continua contando.
      const total =
        armazenados.length - idsParaRemover.length + linhasNovas.length;

      // Atualiza a bipagem (tipo/conta podem ter mudado, total muda, e o
      // status revisado volta a falso porque novos pacotes foram adicionados)
      await tx
        .update(coletaBipagem)
        .set({
          tipo: data.tipo,
          conta: data.conta,
          total,
          revisado: false,
          revisadoPor: null,
          revisadoEm: null,
        })
        .where(
          and(eq(coletaBipagem.id, id), eq(coletaBipagem.contaId, contaId))
        );

      // Insere devoluções + skus
      for (const dev of devolucoesPrepared) {
        const pacoteId = idFinalPorIndice.get(dev.indicePacote);
        if (!pacoteId) continue;
        await tx.insert(coletaDevolucao).values({
          id: dev.devolucaoId,
          pacoteId,
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
      return NextResponse.json(corpoDeErroDeTenancy(error), { status: 401 });
    }
    console.error("Error continuing bipagem:", error);
    return NextResponse.json(
      { error: "Erro ao continuar bipagem" },
      { status: 500 }
    );
  }
}
