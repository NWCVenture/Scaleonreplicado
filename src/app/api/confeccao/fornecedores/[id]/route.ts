// GET    /api/confeccao/fornecedores/[id]
// PATCH  /api/confeccao/fornecedores/[id] — admin (re-dispara geocoding se endereço muda)
// DELETE /api/confeccao/fornecedores/[id] — admin (soft default)

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withContaAtiva, requireAdminAtivo } from "@/lib/tenancy";
import {
  confeccaoFornecedor,
  confeccaoRetirada,
} from "@/lib/db/schema";
import { AtualizarFornecedorSchema } from "@/lib/confeccao/schemas/cadastros";
import { agendarGeocoding } from "@/lib/confeccao/geocoding-job";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return (
    msg.includes("conta ativa") ||
    msg.includes("Sessão") ||
    msg.includes("Nenhuma")
  );
}

const CAMPOS_ENDERECO: ReadonlyArray<keyof z.infer<typeof AtualizarFornecedorSchema>> =
  [
    "enderecoRua",
    "enderecoNumero",
    "enderecoBairro",
    "enderecoCep",
    "enderecoCidade",
    "enderecoEstado",
  ];

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const item = await withContaAtiva(async (tx, contaId) => {
      const rows = await tx
        .select()
        .from(confeccaoFornecedor)
        .where(
          and(
            eq(confeccaoFornecedor.id, id),
            eq(confeccaoFornecedor.contaId, contaId),
          ),
        );
      return rows[0] ?? null;
    });
    if (!item) {
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    }
    return NextResponse.json({ item });
  } catch (err) {
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    return NextResponse.json({ error: "Erro ao buscar" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    try {
      await requireAdminAtivo();
    } catch {
      return NextResponse.json(
        { error: "Acesso negado — requer admin" },
        { status: 403 },
      );
    }
    const { id } = await ctx.params;
    const parsed = AtualizarFornecedorSchema.parse(await request.json());

    // Se algum campo de endereço mudou, zeramos lat/lng pra re-geocoding
    const enderecoMudou = CAMPOS_ENDERECO.some((k) => parsed[k] !== undefined);

    const updated = await withContaAtiva(async (tx, contaId) => {
      const setObj: Record<string, unknown> = { updatedAt: new Date() };
      for (const k of [
        "nome",
        "categorias",
        "whatsapp",
        "telefoneE164",
        "enderecoRua",
        "enderecoNumero",
        "enderecoComplemento",
        "enderecoBairro",
        "enderecoCep",
        "enderecoCidade",
        "enderecoEstado",
        "contatoNome",
        "observacoes",
        "ativo",
      ] as const) {
        if (parsed[k] !== undefined) {
          setObj[k] = parsed[k] === null ? null : parsed[k];
        }
      }
      if (enderecoMudou) {
        setObj.latitude = null;
        setObj.longitude = null;
      }

      const [row] = await tx
        .update(confeccaoFornecedor)
        .set(setObj)
        .where(
          and(
            eq(confeccaoFornecedor.id, id),
            eq(confeccaoFornecedor.contaId, contaId),
          ),
        )
        .returning();
      return row ?? null;
    });

    if (!updated) {
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    }

    // Re-geocoding background se endereço mudou
    if (enderecoMudou) {
      agendarGeocoding(updated.id, updated.contaId, {
        rua: updated.enderecoRua,
        numero: updated.enderecoNumero,
        bairro: updated.enderecoBairro,
        cidade: updated.enderecoCidade,
        estado: updated.enderecoEstado,
        cep: updated.enderecoCep,
      });
    }

    return NextResponse.json({ item: updated });
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
    return NextResponse.json(
      { error: "Erro ao atualizar fornecedor" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    try {
      await requireAdminAtivo();
    } catch {
      return NextResponse.json(
        { error: "Acesso negado — requer admin" },
        { status: 403 },
      );
    }
    const { id } = await ctx.params;
    const hard = request.nextUrl.searchParams.get("hard") === "true";

    const result = await withContaAtiva(async (tx, contaId) => {
      if (hard) {
        // FK RESTRICT em confeccao_retirada.oficina_id bloquearia o
        // delete na hora — detectamos aqui pra retornar 409 limpo.
        const [r] = await tx
          .select({ id: confeccaoRetirada.id })
          .from(confeccaoRetirada)
          .where(eq(confeccaoRetirada.oficinaId, id))
          .limit(1);
        if (r) return { blocked: true as const };

        const deleted = await tx
          .delete(confeccaoFornecedor)
          .where(
            and(
              eq(confeccaoFornecedor.id, id),
              eq(confeccaoFornecedor.contaId, contaId),
            ),
          )
          .returning();
        return { ok: deleted.length > 0, mode: "hard" as const };
      }
      const updated = await tx
        .update(confeccaoFornecedor)
        .set({ ativo: false, updatedAt: new Date() })
        .where(
          and(
            eq(confeccaoFornecedor.id, id),
            eq(confeccaoFornecedor.contaId, contaId),
          ),
        )
        .returning();
      return { ok: updated.length > 0, mode: "soft" as const };
    });

    if ("blocked" in result && result.blocked) {
      return NextResponse.json(
        {
          error:
            "Fornecedor referenciado em retiradas — desative em vez de deletar",
        },
        { status: 409 },
      );
    }
    if (!result.ok) {
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    }
    return NextResponse.json({ deleted: true, mode: result.mode });
  } catch (err) {
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Erro ao deletar fornecedor" },
      { status: 500 },
    );
  }
}
