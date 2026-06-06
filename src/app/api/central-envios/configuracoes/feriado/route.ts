// /api/central-envios/configuracoes/feriado
//
// CRUD manual de feriados. O endpoint de sync nacional (POST /sync-nacional)
// continua intocado e popula feriados com fonte='nacional_api'.
//
// PATCH só edita descrição — data muda via delete+recriação (evita conflito
// com unique (contaId, data) silencioso).
// POST força fonte='manual'; outras fontes (estadual/etc.) ainda não têm UI.

import { NextRequest, NextResponse } from "next/server";
import { and, asc, between, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  isAdminPapel,
  requireAdminAtivo,
  requirePapelAtivo,
  withConta,
} from "@/lib/tenancy";
import { feriado } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return msg.includes("conta ativa") || msg.includes("Sessão");
}

const DataIso = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve ser YYYY-MM-DD");

const CreateBody = z.object({
  data: DataIso,
  descricao: z.string().min(1).max(200),
});

const UpdateBody = z.object({
  id: z.string().min(1),
  descricao: z.string().min(1).max(200),
});

const DeleteBody = z.object({ id: z.string().min(1) });

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }
  const url = new URL(request.url);
  const anoQuery = url.searchParams.get("ano");
  const anos = anoQuery ? [Number(anoQuery)] : null;
  if (anos && (Number.isNaN(anos[0]) || anos[0] < 2000 || anos[0] > 2100)) {
    return NextResponse.json({ error: "Ano inválido" }, { status: 400 });
  }
  try {
    const ctx = await requirePapelAtivo();
    const feriados = await withConta(ctx.contaId, async (tx) => {
      const q = tx
        .select({
          id: feriado.id,
          data: feriado.data,
          descricao: feriado.descricao,
          fonte: feriado.fonte,
        })
        .from(feriado)
        .where(
          anos
            ? and(
                eq(feriado.contaId, ctx.contaId),
                between(
                  feriado.data,
                  `${anos[0]}-01-01`,
                  `${anos[0]}-12-31`,
                ),
              )
            : eq(feriado.contaId, ctx.contaId),
        )
        .orderBy(asc(feriado.data));
      return q;
    });
    return NextResponse.json({
      feriados,
      meta: {
        papel: ctx.papel,
        podeEditar: isAdminPapel(ctx.papel),
      },
    });
  } catch (err) {
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: (err as Error).message }, { status: 403 });
    }
    console.error("[feriado] GET:", err);
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
    const id = generateId();
    const row = await withConta(admin.contaId, async (tx) => {
      try {
        const [r] = await tx
          .insert(feriado)
          .values({
            id,
            contaId: admin.contaId,
            data: data.data,
            descricao: data.descricao,
            fonte: "manual",
          })
          .returning();
        return r;
      } catch (e) {
        const msg = (e as Error).message;
        if (msg.includes("uq_feriado_conta_data")) {
          throw new Error("CONFLICT:data");
        }
        throw e;
      }
    });
    return NextResponse.json({ feriado: row }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Dados inválidos", details: err.issues },
        { status: 400 },
      );
    }
    if ((err as Error).message === "CONFLICT:data") {
      return NextResponse.json(
        { error: "Já existe feriado nesta data" },
        { status: 409 },
      );
    }
    console.error("[feriado] POST:", err);
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
    const row = await withConta(admin.contaId, async (tx) => {
      const [r] = await tx
        .update(feriado)
        .set({ descricao: data.descricao })
        .where(
          and(
            eq(feriado.id, data.id),
            eq(feriado.contaId, admin.contaId),
          ),
        )
        .returning();
      return r;
    });
    if (!row) {
      return NextResponse.json({ error: "Feriado não encontrado" }, { status: 404 });
    }
    return NextResponse.json({ feriado: row });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Dados inválidos", details: err.issues },
        { status: 400 },
      );
    }
    console.error("[feriado] PATCH:", err);
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
        .delete(feriado)
        .where(
          and(
            eq(feriado.id, data.id),
            eq(feriado.contaId, admin.contaId),
          ),
        )
        .returning();
      return row;
    });
    if (!deleted) {
      return NextResponse.json({ error: "Feriado não encontrado" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Dados inválidos", details: err.issues },
        { status: 400 },
      );
    }
    console.error("[feriado] DELETE:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
