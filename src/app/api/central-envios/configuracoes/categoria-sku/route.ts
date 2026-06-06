// /api/central-envios/configuracoes/categoria-sku
//
// GET: lista categorias ativas + meta (papel, modelosDisponiveis) pra UI.
//   Acesso: qualquer vínculo ativo (operador também lê pra debugar extrator).
//
// POST/PATCH/DELETE: CRUD restrito a admin/owner — alterar regras afeta o
// snapshot de todos os planejamentos futuros da conta.

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
import { categoriaSku, modeloPrincipal } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return msg.includes("conta ativa") || msg.includes("Sessão");
}

// Schema de uma única regra. Para `regex`, validamos o pattern em runtime
// (try/catch new RegExp) — Zod sozinho não cobre regex inválida.
const RegraSchema = z.discriminatedUnion("tipo", [
  z.object({
    tipo: z.literal("regex"),
    pattern: z.string().min(1).max(500),
    flags: z.string().max(8).optional(),
  }),
  z.object({
    tipo: z.literal("composicao"),
    modeloCodigo: z.string().min(1).max(40),
    qtdMin: z.number().int().min(0).optional(),
    qtdMax: z.number().int().min(0).optional(),
  }),
  z.object({
    tipo: z.literal("tag"),
    tags: z.array(z.string().min(1).max(40)).min(1),
  }),
]);

const CreateBody = z.object({
  nome: z.string().min(1).max(80),
  ordem: z.number().int().default(0),
  ativo: z.boolean().default(true),
  regras: z.array(RegraSchema).min(1),
});

const UpdateBody = z.object({
  id: z.string().min(1),
  nome: z.string().min(1).max(80).optional(),
  ordem: z.number().int().optional(),
  ativo: z.boolean().optional(),
  regras: z.array(RegraSchema).min(1).optional(),
});

const DeleteBody = z.object({ id: z.string().min(1) });

type RegraValidada = z.infer<typeof RegraSchema>;

function validarRegrasRuntime(regras: RegraValidada[]): string | null {
  for (const r of regras) {
    if (r.tipo === "regex") {
      try {
        new RegExp(r.pattern, r.flags ?? "i");
      } catch (e) {
        return `Regex inválida em "${r.pattern}": ${(e as Error).message}`;
      }
    }
    if (r.tipo === "composicao") {
      if (
        r.qtdMin !== undefined &&
        r.qtdMax !== undefined &&
        r.qtdMin > r.qtdMax
      ) {
        return `qtdMin (${r.qtdMin}) > qtdMax (${r.qtdMax})`;
      }
    }
  }
  return null;
}

async function carregarMeta(contaId: string) {
  return withConta(contaId, async (tx) => {
    const modelos = await tx
      .select({ id: modeloPrincipal.id, codigo: modeloPrincipal.codigo })
      .from(modeloPrincipal)
      .where(eq(modeloPrincipal.contaId, contaId))
      .orderBy(asc(modeloPrincipal.codigo));
    return { modelosDisponiveis: modelos };
  });
}

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }
  try {
    const ctx = await requirePapelAtivo();
    const categorias = await withConta(ctx.contaId, (tx) =>
      tx
        .select({
          id: categoriaSku.id,
          nome: categoriaSku.nome,
          ordem: categoriaSku.ordem,
          ativo: categoriaSku.ativo,
          regras: categoriaSku.regras,
        })
        .from(categoriaSku)
        .where(eq(categoriaSku.contaId, ctx.contaId))
        .orderBy(asc(categoriaSku.ordem), asc(categoriaSku.nome)),
    );
    const meta = await carregarMeta(ctx.contaId);
    return NextResponse.json({
      categorias,
      meta: {
        papel: ctx.papel,
        podeEditar: isAdminPapel(ctx.papel),
        modelosDisponiveis: meta.modelosDisponiveis,
      },
    });
  } catch (err) {
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: (err as Error).message }, { status: 403 });
    }
    console.error("[categoria-sku] GET:", err);
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
    const erroRegra = validarRegrasRuntime(data.regras);
    if (erroRegra) {
      return NextResponse.json({ error: erroRegra }, { status: 400 });
    }
    const id = generateId();
    const categoria = await withConta(admin.contaId, async (tx) => {
      try {
        const [row] = await tx
          .insert(categoriaSku)
          .values({
            id,
            contaId: admin.contaId,
            nome: data.nome,
            ordem: data.ordem,
            ativo: data.ativo,
            regras: data.regras,
          })
          .returning();
        return row;
      } catch (e) {
        const msg = (e as Error).message;
        if (msg.includes("uq_categoria_sku_nome_conta")) {
          throw new Error("CONFLICT:nome");
        }
        throw e;
      }
    });
    return NextResponse.json({ categoria }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Dados inválidos", details: err.issues },
        { status: 400 },
      );
    }
    if ((err as Error).message === "CONFLICT:nome") {
      return NextResponse.json(
        { error: "Já existe categoria com este nome" },
        { status: 409 },
      );
    }
    console.error("[categoria-sku] POST:", err);
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
    if (data.regras) {
      const erroRegra = validarRegrasRuntime(data.regras);
      if (erroRegra) {
        return NextResponse.json({ error: erroRegra }, { status: 400 });
      }
    }
    const categoria = await withConta(admin.contaId, async (tx) => {
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (data.nome !== undefined) patch.nome = data.nome;
      if (data.ordem !== undefined) patch.ordem = data.ordem;
      if (data.ativo !== undefined) patch.ativo = data.ativo;
      if (data.regras !== undefined) patch.regras = data.regras;
      try {
        const [row] = await tx
          .update(categoriaSku)
          .set(patch)
          .where(
            and(
              eq(categoriaSku.id, data.id),
              eq(categoriaSku.contaId, admin.contaId),
            ),
          )
          .returning();
        return row;
      } catch (e) {
        const msg = (e as Error).message;
        if (msg.includes("uq_categoria_sku_nome_conta")) {
          throw new Error("CONFLICT:nome");
        }
        throw e;
      }
    });
    if (!categoria) {
      return NextResponse.json({ error: "Categoria não encontrada" }, { status: 404 });
    }
    return NextResponse.json({ categoria });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Dados inválidos", details: err.issues },
        { status: 400 },
      );
    }
    if ((err as Error).message === "CONFLICT:nome") {
      return NextResponse.json(
        { error: "Já existe categoria com este nome" },
        { status: 409 },
      );
    }
    console.error("[categoria-sku] PATCH:", err);
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
        .delete(categoriaSku)
        .where(
          and(
            eq(categoriaSku.id, data.id),
            eq(categoriaSku.contaId, admin.contaId),
          ),
        )
        .returning();
      return row;
    });
    if (!deleted) {
      return NextResponse.json({ error: "Categoria não encontrada" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Dados inválidos", details: err.issues },
        { status: 400 },
      );
    }
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: (err as Error).message }, { status: 403 });
    }
    console.error("[categoria-sku] DELETE:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
