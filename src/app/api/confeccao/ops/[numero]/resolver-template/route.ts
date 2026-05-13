// POST /api/confeccao/ops/[numero]/resolver-template
//
// Recebe { templateId } ou { corpoCru } + opcional { fornecedorId }.
// Carrega a OP completa, monta o contexto (payloads das subtasks + maps
// de catálogo) e devolve o corpo com placeholders substituídos.
//
// Centralizar a resolução no server evita 3 fetches no cliente toda vez
// que abrir o picker.

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { withContaAtiva } from "@/lib/tenancy";
import {
  confeccaoCor,
  confeccaoFornecedor,
  confeccaoOrdemProducao,
  confeccaoProduto,
  confeccaoSubtask,
  confeccaoTemplateWhatsapp,
  confeccaoTipoTecido,
} from "@/lib/db/schema";
import {
  resolverPlaceholders,
  type ContextoPlaceholders,
} from "@/lib/confeccao/resolver-placeholders";
import type { SubtaskCompraPayload } from "@/lib/confeccao/schemas/payloads/compra";
import type { SubtaskCortePayload } from "@/lib/confeccao/schemas/payloads/corte";
import type { SubtaskCosturaPayload } from "@/lib/confeccao/schemas/payloads/costura";
import type { SubtaskRiscoPayload } from "@/lib/confeccao/schemas/payloads/risco";
import type { SubtaskViesPayload } from "@/lib/confeccao/schemas/payloads/vies";

const InputSchema = z
  .object({
    templateId: z.string().min(1).optional(),
    corpoCru: z.string().min(1).max(5000).optional(),
    fornecedorId: z.string().min(1).optional(),
  })
  .refine((d) => d.templateId || d.corpoCru, {
    message: "templateId ou corpoCru é obrigatório",
  });

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return (
    msg.includes("conta ativa") ||
    msg.includes("Sessão") ||
    msg.includes("Nenhuma")
  );
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ numero: string }> },
) {
  try {
    const { numero } = await ctx.params;
    const parsed = InputSchema.parse(await request.json());

    const result = await withContaAtiva(async (tx, contaId) => {
      const [op] = await tx
        .select({
          id: confeccaoOrdemProducao.id,
          numero: confeccaoOrdemProducao.numero,
          produtoNome: confeccaoProduto.nome,
        })
        .from(confeccaoOrdemProducao)
        .innerJoin(
          confeccaoProduto,
          eq(confeccaoProduto.id, confeccaoOrdemProducao.produtoId),
        )
        .where(
          and(
            eq(confeccaoOrdemProducao.numero, numero),
            eq(confeccaoOrdemProducao.contaId, contaId),
          ),
        );
      if (!op) return { notFound: "op" as const };

      // Resolve corpo (template ou cru)
      let corpoOriginal = parsed.corpoCru ?? "";
      let templateMeta: {
        id: string;
        nome: string;
        categoria: string;
      } | null = null;
      if (parsed.templateId) {
        const [tpl] = await tx
          .select()
          .from(confeccaoTemplateWhatsapp)
          .where(
            and(
              eq(confeccaoTemplateWhatsapp.id, parsed.templateId),
              eq(confeccaoTemplateWhatsapp.contaId, contaId),
            ),
          );
        if (!tpl) return { notFound: "template" as const };
        corpoOriginal = tpl.corpo;
        templateMeta = {
          id: tpl.id,
          nome: tpl.nome,
          categoria: tpl.categoria,
        };
      }

      const subtasks = await tx
        .select({
          prefixo: confeccaoSubtask.prefixo,
          payload: confeccaoSubtask.payload,
        })
        .from(confeccaoSubtask)
        .where(eq(confeccaoSubtask.ordemProducaoId, op.id))
        .orderBy(asc(confeccaoSubtask.ordemSequencial));

      const byPrefixo = new Map(subtasks.map((s) => [s.prefixo, s.payload]));

      // Catálogos (id → nome) — limitamos a registros da conta;
      // como o volume é baixo (centenas), trazemos tudo.
      const cores = await tx
        .select({ id: confeccaoCor.id, nome: confeccaoCor.nome })
        .from(confeccaoCor)
        .where(eq(confeccaoCor.contaId, contaId));
      const tipos = await tx
        .select({
          id: confeccaoTipoTecido.id,
          nome: confeccaoTipoTecido.nome,
        })
        .from(confeccaoTipoTecido)
        .where(eq(confeccaoTipoTecido.contaId, contaId));

      let fornecedorNome: string | undefined;
      if (parsed.fornecedorId) {
        const [forn] = await tx
          .select({ nome: confeccaoFornecedor.nome })
          .from(confeccaoFornecedor)
          .where(
            and(
              eq(confeccaoFornecedor.id, parsed.fornecedorId),
              eq(confeccaoFornecedor.contaId, contaId),
            ),
          );
        fornecedorNome = forn?.nome;
      }

      const contexto: ContextoPlaceholders = {
        opNumero: op.numero,
        produtoNome: op.produtoNome,
        fornecedorNome,
        compra: byPrefixo.get("OPBUY") as SubtaskCompraPayload | null,
        risco: byPrefixo.get("OPRIS") as SubtaskRiscoPayload | null,
        corte: byPrefixo.get("OPCOR") as SubtaskCortePayload | null,
        vies: byPrefixo.get("OPVIE") as SubtaskViesPayload | null,
        costura: byPrefixo.get("OPSEW") as SubtaskCosturaPayload | null,
        tipoTecidoNomes: new Map(tipos.map((t) => [t.id, t.nome])),
        corNomes: new Map(cores.map((c) => [c.id, c.nome])),
      };

      const corpoResolvido = resolverPlaceholders(corpoOriginal, contexto);

      return { ok: true as const, corpoResolvido, template: templateMeta };
    });

    if ("notFound" in result) {
      return NextResponse.json(
        { error: `${result.notFound} não encontrada` },
        { status: 404 },
      );
    }
    return NextResponse.json({
      corpoResolvido: result.corpoResolvido,
      template: result.template,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Dados inválidos", details: err.issues },
        { status: 400 },
      );
    }
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    console.error("Erro ao resolver template:", err);
    return NextResponse.json(
      { error: "Erro ao resolver template" },
      { status: 500 },
    );
  }
}
