// /api/central-envios/configuracoes/regras-prazo
//
// CRUD de regras de cálculo de prazo por canal/plataforma.
// GET aberto a qualquer vínculo; mutations restritas a admin.

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  isAdminPapel,
  requireAdminAtivo,
  requirePapelAtivo,
  withConta,
} from "@/lib/tenancy";
import { canaisVenda, canalRegraPrazo } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return msg.includes("conta ativa") || msg.includes("Sessão");
}

const PlataformaSchema = z.enum(["tiktok_shop", "shopee", "mercado_livre"]);
const EstrategiaSchema = z.enum([
  "DIAS_UTEIS_POS_VENDA",
  "CAMPO_EXPLICITO",
  "HIBRIDO",
]);

const BaseFields = {
  canalVendaId: z.string().min(1).nullable(),
  plataforma: PlataformaSchema,
  estrategia: EstrategiaSchema,
  diasUteis: z.number().int().min(0).max(60).nullable(),
  campoPrazo: z.string().min(1).max(80).nullable(),
  regexPrazo: z.string().min(1).max(500).nullable(),
  fallbackHoje: z.boolean(),
  ativo: z.boolean(),
};

const CreateBody = z.object({
  ...BaseFields,
  fallbackHoje: BaseFields.fallbackHoje.default(false),
  ativo: BaseFields.ativo.default(true),
});

const UpdateBody = z
  .object({ id: z.string().min(1) })
  .extend({
    canalVendaId: BaseFields.canalVendaId.optional(),
    plataforma: BaseFields.plataforma.optional(),
    estrategia: BaseFields.estrategia.optional(),
    diasUteis: BaseFields.diasUteis.optional(),
    campoPrazo: BaseFields.campoPrazo.optional(),
    regexPrazo: BaseFields.regexPrazo.optional(),
    fallbackHoje: BaseFields.fallbackHoje.optional(),
    ativo: BaseFields.ativo.optional(),
  });

const DeleteBody = z.object({ id: z.string().min(1) });

function validarConsistencia(payload: {
  estrategia: "DIAS_UTEIS_POS_VENDA" | "CAMPO_EXPLICITO" | "HIBRIDO";
  diasUteis: number | null;
  campoPrazo: string | null;
  regexPrazo: string | null;
}): string | null {
  const usaDias =
    payload.estrategia === "DIAS_UTEIS_POS_VENDA" ||
    payload.estrategia === "HIBRIDO";
  const usaCampo =
    payload.estrategia === "CAMPO_EXPLICITO" ||
    payload.estrategia === "HIBRIDO";

  if (usaDias && (payload.diasUteis === null || payload.diasUteis === undefined)) {
    return "Estratégia exige diasUteis";
  }
  if (usaCampo && !payload.campoPrazo) {
    return "Estratégia exige campoPrazo";
  }
  if (payload.regexPrazo) {
    try {
      new RegExp(payload.regexPrazo);
    } catch (e) {
      return `Regex inválida: ${(e as Error).message}`;
    }
  }
  return null;
}

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }
  try {
    const ctx = await requirePapelAtivo();
    const { regras, canais } = await withConta(ctx.contaId, async (tx) => {
      const regrasRows = await tx
        .select({
          id: canalRegraPrazo.id,
          canalVendaId: canalRegraPrazo.canalVendaId,
          plataforma: canalRegraPrazo.plataforma,
          estrategia: canalRegraPrazo.estrategia,
          diasUteis: canalRegraPrazo.diasUteis,
          campoPrazo: canalRegraPrazo.campoPrazo,
          regexPrazo: canalRegraPrazo.regexPrazo,
          fallbackHoje: canalRegraPrazo.fallbackHoje,
          ativo: canalRegraPrazo.ativo,
          canalNomeExibicao: canaisVenda.nomeExibicao,
        })
        .from(canalRegraPrazo)
        .leftJoin(canaisVenda, eq(canalRegraPrazo.canalVendaId, canaisVenda.id))
        .where(eq(canalRegraPrazo.contaId, ctx.contaId))
        .orderBy(
          asc(canalRegraPrazo.plataforma),
          asc(canalRegraPrazo.canalVendaId),
        );
      const canaisRows = await tx
        .select({
          id: canaisVenda.id,
          nomeExibicao: canaisVenda.nomeExibicao,
          plataforma: canaisVenda.plataforma,
        })
        .from(canaisVenda)
        .where(
          and(eq(canaisVenda.contaId, ctx.contaId), eq(canaisVenda.ativo, true)),
        )
        .orderBy(asc(canaisVenda.plataforma), asc(canaisVenda.nomeExibicao));
      return { regras: regrasRows, canais: canaisRows };
    });
    return NextResponse.json({
      regras,
      meta: {
        papel: ctx.papel,
        podeEditar: isAdminPapel(ctx.papel),
        canaisDisponiveis: canais,
      },
    });
  } catch (err) {
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: (err as Error).message }, { status: 403 });
    }
    console.error("[regras-prazo] GET:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let admin;
  try {
    admin = await requireAdminAtivo();
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 403 });
  }
  try {
    const json = await request.json();
    const data = CreateBody.parse(json);
    const erro = validarConsistencia(data);
    if (erro) return NextResponse.json({ error: erro }, { status: 400 });
    const id = generateId();
    const regra = await withConta(admin.contaId, async (tx) => {
      try {
        const [row] = await tx
          .insert(canalRegraPrazo)
          .values({
            id,
            contaId: admin.contaId,
            canalVendaId: data.canalVendaId,
            plataforma: data.plataforma,
            estrategia: data.estrategia,
            diasUteis: data.diasUteis,
            campoPrazo: data.campoPrazo,
            regexPrazo: data.regexPrazo,
            fallbackHoje: data.fallbackHoje,
            ativo: data.ativo,
          })
          .returning();
        return row;
      } catch (e) {
        const msg = (e as Error).message;
        if (msg.includes("uq_canal_regra_prazo_default_plataforma")) {
          throw new Error("CONFLICT:default");
        }
        if (msg.includes("uq_canal_regra_prazo_canal_especifico")) {
          throw new Error("CONFLICT:canal");
        }
        throw e;
      }
    });
    return NextResponse.json({ regra }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Dados inválidos", details: err.issues },
        { status: 400 },
      );
    }
    const msg = (err as Error).message;
    if (msg === "CONFLICT:default") {
      return NextResponse.json(
        { error: "Já existe regra default para esta plataforma" },
        { status: 409 },
      );
    }
    if (msg === "CONFLICT:canal") {
      return NextResponse.json(
        { error: "Já existe regra específica para este canal" },
        { status: 409 },
      );
    }
    console.error("[regras-prazo] POST:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  let admin;
  try {
    admin = await requireAdminAtivo();
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 403 });
  }
  try {
    const json = await request.json();
    const data = UpdateBody.parse(json);
    const regra = await withConta(admin.contaId, async (tx) => {
      const [atual] = await tx
        .select()
        .from(canalRegraPrazo)
        .where(
          and(
            eq(canalRegraPrazo.id, data.id),
            eq(canalRegraPrazo.contaId, admin.contaId),
          ),
        )
        .limit(1);
      if (!atual) return null;
      const merged = {
        estrategia: data.estrategia ?? atual.estrategia,
        diasUteis: data.diasUteis ?? atual.diasUteis,
        campoPrazo: data.campoPrazo ?? atual.campoPrazo,
        regexPrazo: data.regexPrazo ?? atual.regexPrazo,
      };
      const erro = validarConsistencia(merged);
      if (erro) throw new Error("VALIDATION:" + erro);
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (data.canalVendaId !== undefined) patch.canalVendaId = data.canalVendaId;
      if (data.plataforma !== undefined) patch.plataforma = data.plataforma;
      if (data.estrategia !== undefined) patch.estrategia = data.estrategia;
      if (data.diasUteis !== undefined) patch.diasUteis = data.diasUteis;
      if (data.campoPrazo !== undefined) patch.campoPrazo = data.campoPrazo;
      if (data.regexPrazo !== undefined) patch.regexPrazo = data.regexPrazo;
      if (data.fallbackHoje !== undefined) patch.fallbackHoje = data.fallbackHoje;
      if (data.ativo !== undefined) patch.ativo = data.ativo;
      try {
        const [row] = await tx
          .update(canalRegraPrazo)
          .set(patch)
          .where(
            and(
              eq(canalRegraPrazo.id, data.id),
              eq(canalRegraPrazo.contaId, admin.contaId),
            ),
          )
          .returning();
        return row;
      } catch (e) {
        const msg = (e as Error).message;
        if (msg.includes("uq_canal_regra_prazo_default_plataforma")) {
          throw new Error("CONFLICT:default");
        }
        if (msg.includes("uq_canal_regra_prazo_canal_especifico")) {
          throw new Error("CONFLICT:canal");
        }
        throw e;
      }
    });
    if (!regra) {
      return NextResponse.json({ error: "Regra não encontrada" }, { status: 404 });
    }
    return NextResponse.json({ regra });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Dados inválidos", details: err.issues },
        { status: 400 },
      );
    }
    const msg = (err as Error).message ?? "";
    if (msg.startsWith("VALIDATION:")) {
      return NextResponse.json(
        { error: msg.slice("VALIDATION:".length) },
        { status: 400 },
      );
    }
    if (msg === "CONFLICT:default") {
      return NextResponse.json(
        { error: "Já existe regra default para esta plataforma" },
        { status: 409 },
      );
    }
    if (msg === "CONFLICT:canal") {
      return NextResponse.json(
        { error: "Já existe regra específica para este canal" },
        { status: 409 },
      );
    }
    console.error("[regras-prazo] PATCH:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  let admin;
  try {
    admin = await requireAdminAtivo();
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 403 });
  }
  try {
    const json = await request.json();
    const data = DeleteBody.parse(json);
    const deleted = await withConta(admin.contaId, async (tx) => {
      const [row] = await tx
        .delete(canalRegraPrazo)
        .where(
          and(
            eq(canalRegraPrazo.id, data.id),
            eq(canalRegraPrazo.contaId, admin.contaId),
          ),
        )
        .returning();
      return row;
    });
    if (!deleted) {
      return NextResponse.json({ error: "Regra não encontrada" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Dados inválidos", details: err.issues },
        { status: 400 },
      );
    }
    console.error("[regras-prazo] DELETE:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
