import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { estante, estanteFardo, estanteMovimentacao } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { generateId } from "@/lib/utils";
import { withContaAtiva } from "@/lib/tenancy";
import { parseQRCode } from "@/lib/estante-utils";
import {
  temIdentidade,
  validarQR,
  type FardoValidado,
  type MotivoRecusa,
} from "@/lib/estante-virtual/fardo-qr";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return msg.includes("conta ativa") || msg.includes("Sessão");
}

const addFardoSchema = z.object({
  fardos: z
    .array(
      z.object({
        // Sem limite de tamanho aqui de propósito: quem julga tamanho é
        // `validarQR`, por item. Um `.max()` no schema derrubaria o lote
        // inteiro com 400 por causa de uma única etiqueta malformada, em vez
        // de aceitar as boas e reportar a ruim em `recusados`.
        qrCode: z.string().min(1),
        // sku/lote/quantidade ainda são aceitos por compatibilidade com
        // clientes antigos, mas são IGNORADOS: o servidor deriva tudo do
        // próprio qrCode. Confiar no cliente era o que permitia gravar SKU
        // divergente da etiqueta — e sem normalização nenhuma.
        sku: z.string().optional(),
        lote: z.string().optional(),
        quantidade: z.number().int().positive().optional(),
      })
    )
    .min(1),
  // origem="importacao" mantém o comportamento antigo (1 linha IMPORTACAO
  // de resumo no histórico). O fluxo normal de inclusão envia "manual"
  // (padrão), que loga 1 ENTRADA por fardo pra auditoria detalhada.
  origem: z.enum(["manual", "importacao"]).optional().default("manual"),
});

type SkippedFardo = {
  qrCode: string;
  sku: string;
  lote: string;
  motivo: "duplicado-mesma-estante" | "ja-existe-outra-estante";
  estanteNome?: string;
};

/** Etiqueta que nem chegou a ser avaliada: formato fora do contrato. */
type RecusadoFardo = {
  qrCode: string;
  motivo: MotivoRecusa;
  detalhe: string;
};

/**
 * Etiqueta v1 (`SKU}LOTE}QTD`): entrou, mas sem passar por verificação de
 * duplicata — ela não carrega identificador, então é impossível distinguir
 * uma re-bipagem de um segundo fardo legítimo. Antes isso acontecia em
 * silêncio, com a mesma mensagem de sucesso de uma inclusão verificada.
 */
type SemVerificacaoFardo = {
  qrCode: string;
  sku: string;
  lote: string;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const data = addFardoSchema.parse(body);

    const result = await withContaAtiva(async (tx, contaId) => {
      const [found] = await tx
        .select({ nome: estante.nome })
        .from(estante)
        .where(and(eq(estante.contaId, contaId), eq(estante.id, id)));

      if (!found) {
        return null;
      }

      // ── Etapa 1: validação de formato ──────────────────────────────
      // Régua estrita (src/lib/estante-virtual/fardo-qr.ts): tamanho máximo
      // e contagem de campos exata. O que não passa é recusado com motivo,
      // sem contaminar o resto do lote — os demais fardos seguem normalmente.
      const recusados: RecusadoFardo[] = [];
      const validos: FardoValidado[] = [];

      for (const f of data.fardos) {
        const r = validarQR(f.qrCode);
        if (!r.ok) {
          recusados.push({
            qrCode: f.qrCode.slice(0, 120),
            motivo: r.motivo,
            detalhe: r.detalhe,
          });
          continue;
        }
        validos.push(r.fardo);
      }

      // ── Etapa 2: anti-duplicata ────────────────────────────────────
      // Compara uuid e codigoFardo contra todas as estantes da conta. Só
      // alcança etiquetas que carregam identificador; as v1 passam direto
      // e são reportadas em `semVerificacao`.
      const candidates = validos.map((fardo) => ({
        qrCode: fardo.qrCode,
        sku: fardo.sku,
        lote: fardo.lote,
        quantidade: fardo.quantidade,
        parsed: {
          codigoFardo: fardo.codigoFardo ?? undefined,
          uuid: fardo.fardoUuid ?? undefined,
        },
        temIdentidade: temIdentidade(fardo),
      }));

      const semVerificacao: SemVerificacaoFardo[] = candidates
        .filter((c) => !c.temIdentidade)
        .map((c) => ({ qrCode: c.qrCode, sku: c.sku, lote: c.lote }));

      const existentes = await tx
        .select({
          id: estanteFardo.id,
          estanteId: estanteFardo.estanteId,
          estanteNome: estante.nome,
          qrCode: estanteFardo.qrCode,
        })
        .from(estanteFardo)
        .innerJoin(estante, eq(estante.id, estanteFardo.estanteId))
        .where(eq(estanteFardo.contaId, contaId));

      const existentesIndex = existentes.map((e) => ({
        estanteId: e.estanteId,
        estanteNome: e.estanteNome,
        parsed: parseQRCode(e.qrCode),
        qrCode: e.qrCode,
      }));

      const skipped: SkippedFardo[] = [];
      // Campos derivados do QR pelo servidor — nunca o que o cliente mandou.
      const aInserir: Array<{
        qrCode: string;
        sku: string;
        lote: string;
        quantidade: number;
      }> = [];
      // Detecta duplicatas dentro do próprio batch (mesmo uuid/codigoFardo
      // chegando duas vezes no mesmo POST).
      const uuidsBatch = new Set<string>();
      const codigosBatch = new Set<string>();

      for (const cand of candidates) {
        const parsedUuid = cand.parsed?.uuid;
        const parsedCodigo = cand.parsed?.codigoFardo;

        let conflitoEstante: { estanteId: string; estanteNome: string } | null =
          null;
        if (parsedUuid) {
          const hit = existentesIndex.find(
            (e) => e.parsed?.uuid === parsedUuid
          );
          if (hit) {
            conflitoEstante = {
              estanteId: hit.estanteId,
              estanteNome: hit.estanteNome,
            };
          }
        }
        if (!conflitoEstante && parsedCodigo) {
          const hit = existentesIndex.find(
            (e) => e.parsed?.codigoFardo === parsedCodigo
          );
          if (hit) {
            conflitoEstante = {
              estanteId: hit.estanteId,
              estanteNome: hit.estanteNome,
            };
          }
        }

        if (conflitoEstante) {
          skipped.push({
            qrCode: cand.qrCode,
            sku: cand.sku,
            lote: cand.lote,
            motivo:
              conflitoEstante.estanteId === id
                ? "duplicado-mesma-estante"
                : "ja-existe-outra-estante",
            estanteNome: conflitoEstante.estanteNome,
          });
          continue;
        }

        if (parsedUuid && uuidsBatch.has(parsedUuid)) {
          skipped.push({
            qrCode: cand.qrCode,
            sku: cand.sku,
            lote: cand.lote,
            motivo: "duplicado-mesma-estante",
          });
          continue;
        }
        if (parsedCodigo && codigosBatch.has(parsedCodigo)) {
          skipped.push({
            qrCode: cand.qrCode,
            sku: cand.sku,
            lote: cand.lote,
            motivo: "duplicado-mesma-estante",
          });
          continue;
        }

        if (parsedUuid) uuidsBatch.add(parsedUuid);
        if (parsedCodigo) codigosBatch.add(parsedCodigo);
        aInserir.push({
          qrCode: cand.qrCode,
          sku: cand.sku,
          lote: cand.lote,
          quantidade: cand.quantidade,
        });
      }

      if (aInserir.length === 0) {
        return { added: 0, skipped, recusados, semVerificacao };
      }

      const [{ count: totalAntes }] = await tx
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(estanteFardo)
        .where(
          and(
            eq(estanteFardo.contaId, contaId),
            eq(estanteFardo.estanteId, id)
          )
        );

      const newFardos = aInserir.map((f) => ({
        id: generateId(),
        estanteId: id,
        qrCode: f.qrCode,
        sku: f.sku,
        lote: f.lote,
        quantidade: f.quantidade,
        adicionadoPor: session.user.id,
        contaId,
      }));

      await tx.insert(estanteFardo).values(newFardos);

      if (data.origem === "importacao") {
        // Mantém o comportamento legado da Importar Balanço: 1 linha
        // IMPORTACAO resumo (sem fardoSku/Lote/Quantidade individuais).
        const [{ total: totalPecas }] = await tx
          .select({
            total: sql<number>`coalesce(cast(sum(${estanteFardo.quantidade}) as int), 0)`,
          })
          .from(estanteFardo)
          .where(
            and(
              eq(estanteFardo.contaId, contaId),
              eq(estanteFardo.estanteId, id)
            )
          );
        await tx.insert(estanteMovimentacao).values({
          id: generateId(),
          estanteId: id,
          estanteNome: found.nome,
          tipo: "IMPORTACAO",
          fardoSku: null,
          fardoLote: null,
          fardoQuantidade: null,
          totalAntes,
          totalDepois: totalAntes + aInserir.length,
          totalPecas,
          usuarioId: session.user.id,
          contaId,
        });
      } else {
        // Fluxo manual (bipagem com revisão): 1 ENTRADA por fardo.
        // total_antes/total_depois são incrementais conforme cada fardo entra.
        const movs = newFardos.map((f, idx) => ({
          id: generateId(),
          estanteId: id,
          estanteNome: found.nome,
          tipo: "ENTRADA" as const,
          fardoSku: f.sku,
          fardoLote: f.lote,
          fardoQuantidade: f.quantidade,
          totalAntes: totalAntes + idx,
          totalDepois: totalAntes + idx + 1,
          totalPecas: null,
          usuarioId: session.user.id,
          contaId,
        }));
        await tx.insert(estanteMovimentacao).values(movs);
      }

      return { added: aInserir.length, skipped, recusados, semVerificacao };
    });

    if (!result) {
      return NextResponse.json(
        { error: "Estante nao encontrada" },
        { status: 404 }
      );
    }

    return NextResponse.json(result, { status: 201 });
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

    console.error("Error adding fardos:", error);
    return NextResponse.json(
      { error: "Erro ao adicionar fardos" },
      { status: 500 }
    );
  }
}
