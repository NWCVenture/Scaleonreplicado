// /api/central-envios/configuracoes/alias-tamanho
//
// CRUD de aliases de tamanho (ex.: EXG → EGG). `modeloId = null` = alias
// global da conta; setado = alias específico daquele modelo.
//
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
import { modeloPrincipal, tamanhoAlias } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return msg.includes("conta ativa") || msg.includes("Sessão");
}

const CreateBody = z.object({
  modeloId: z.string().min(1).nullable(),
  codigoAlias: z.string().min(1).max(40),
  codigoReal: z.string().min(1).max(40),
});

const UpdateBody = z.object({
  id: z.string().min(1),
  modeloId: z.string().min(1).nullable().optional(),
  codigoAlias: z.string().min(1).max(40).optional(),
  codigoReal: z.string().min(1).max(40).optional(),
});

const DeleteBody = z.object({ id: z.string().min(1) });

function normalizar(c: string): string {
  return c.trim().toUpperCase();
}

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }
  try {
    const ctx = await requirePapelAtivo();
    const { aliases, modelos } = await withConta(ctx.contaId, async (tx) => {
      const aliasRows = await tx
        .select({
          id: tamanhoAlias.id,
          modeloId: tamanhoAlias.modeloId,
          codigoAlias: tamanhoAlias.codigoAlias,
          codigoReal: tamanhoAlias.codigoReal,
          modeloCodigo: modeloPrincipal.codigo,
        })
        .from(tamanhoAlias)
        .leftJoin(modeloPrincipal, eq(tamanhoAlias.modeloId, modeloPrincipal.id))
        .where(eq(tamanhoAlias.contaId, ctx.contaId))
        .orderBy(asc(tamanhoAlias.codigoAlias));
      const modeloRows = await tx
        .select({ id: modeloPrincipal.id, codigo: modeloPrincipal.codigo })
        .from(modeloPrincipal)
        .where(eq(modeloPrincipal.contaId, ctx.contaId))
        .orderBy(asc(modeloPrincipal.codigo));
      return { aliases: aliasRows, modelos: modeloRows };
    });
    return NextResponse.json({
      aliases,
      meta: {
        papel: ctx.papel,
        podeEditar: isAdminPapel(ctx.papel),
        modelosDisponiveis: modelos,
      },
    });
  } catch (err) {
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: (err as Error).message }, { status: 403 });
    }
    console.error("[alias-tamanho] GET:", err);
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
    const alias = normalizar(data.codigoAlias);
    const real = normalizar(data.codigoReal);
    if (alias === real) {
      return NextResponse.json({ error: "Alias igual ao código real é inútil" }, { status: 400 });
    }
    const id = generateId();
    const row = await withConta(admin.contaId, async (tx) => {
      // Valida modelo, se setado
      if (data.modeloId) {
        const [m] = await tx
          .select({ id: modeloPrincipal.id })
          .from(modeloPrincipal)
          .where(
            and(
              eq(modeloPrincipal.id, data.modeloId),
              eq(modeloPrincipal.contaId, admin.contaId),
            ),
          )
          .limit(1);
        if (!m) throw new Error("VALIDATION:modeloId inexistente");
      }
      try {
        const [r] = await tx
          .insert(tamanhoAlias)
          .values({
            id,
            contaId: admin.contaId,
            modeloId: data.modeloId,
            codigoAlias: alias,
            codigoReal: real,
          })
          .returning();
        return r;
      } catch (e) {
        const msg = (e as Error).message;
        if (msg.includes("uq_tamanho_alias_codigo")) {
          throw new Error("CONFLICT:alias");
        }
        throw e;
      }
    });
    return NextResponse.json({ alias: row }, { status: 201 });
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
    if (msg === "CONFLICT:alias") {
      return NextResponse.json(
        { error: "Já existe alias com este código neste escopo" },
        { status: 409 },
      );
    }
    console.error("[alias-tamanho] POST:", err);
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
      const patch: Record<string, unknown> = {};
      if (data.modeloId !== undefined) patch.modeloId = data.modeloId;
      if (data.codigoAlias !== undefined)
        patch.codigoAlias = normalizar(data.codigoAlias);
      if (data.codigoReal !== undefined)
        patch.codigoReal = normalizar(data.codigoReal);
      if (
        typeof patch.codigoAlias === "string" &&
        typeof patch.codigoReal === "string" &&
        patch.codigoAlias === patch.codigoReal
      ) {
        throw new Error("VALIDATION:Alias igual ao código real");
      }
      try {
        const [r] = await tx
          .update(tamanhoAlias)
          .set(patch)
          .where(
            and(
              eq(tamanhoAlias.id, data.id),
              eq(tamanhoAlias.contaId, admin.contaId),
            ),
          )
          .returning();
        return r;
      } catch (e) {
        const msg = (e as Error).message;
        if (msg.includes("uq_tamanho_alias_codigo")) {
          throw new Error("CONFLICT:alias");
        }
        throw e;
      }
    });
    if (!row) {
      return NextResponse.json({ error: "Alias não encontrado" }, { status: 404 });
    }
    return NextResponse.json({ alias: row });
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
    if (msg === "CONFLICT:alias") {
      return NextResponse.json(
        { error: "Já existe alias com este código neste escopo" },
        { status: 409 },
      );
    }
    console.error("[alias-tamanho] PATCH:", err);
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
        .delete(tamanhoAlias)
        .where(
          and(
            eq(tamanhoAlias.id, data.id),
            eq(tamanhoAlias.contaId, admin.contaId),
          ),
        )
        .returning();
      return row;
    });
    if (!deleted) {
      return NextResponse.json({ error: "Alias não encontrado" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Dados inválidos", details: err.issues },
        { status: 400 },
      );
    }
    console.error("[alias-tamanho] DELETE:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

