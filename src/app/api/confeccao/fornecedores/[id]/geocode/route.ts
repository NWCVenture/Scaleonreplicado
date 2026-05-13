// POST /api/confeccao/fornecedores/[id]/geocode — admin
//
// Re-geocode manual disparado pela UI (botão "Atualizar coordenadas").
// Síncrono: aguarda Nominatim e retorna lat/lng (ou erro).
//
// Diferente do POST/PATCH normal (que dispara geocoding background) —
// aqui o user clicou explicitamente e quer ver o resultado.

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withContaAtiva, requireAdminAtivo } from "@/lib/tenancy";
import { confeccaoFornecedor } from "@/lib/db/schema";
import { geocodificarEndereco } from "@/lib/confeccao/geocoding";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return (
    msg.includes("conta ativa") ||
    msg.includes("Sessão") ||
    msg.includes("Nenhuma")
  );
}

export async function POST(
  _request: NextRequest,
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

    const fornecedor = await withContaAtiva(async (tx, contaId) => {
      const [row] = await tx
        .select()
        .from(confeccaoFornecedor)
        .where(
          and(
            eq(confeccaoFornecedor.id, id),
            eq(confeccaoFornecedor.contaId, contaId),
          ),
        );
      return row ?? null;
    });

    if (!fornecedor) {
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    }

    const result = await geocodificarEndereco({
      rua: fornecedor.enderecoRua,
      numero: fornecedor.enderecoNumero,
      bairro: fornecedor.enderecoBairro,
      cidade: fornecedor.enderecoCidade,
      estado: fornecedor.enderecoEstado,
      cep: fornecedor.enderecoCep,
    });

    if (!result) {
      return NextResponse.json(
        {
          error:
            "Geocoding falhou — endereço não encontrado ou serviço indisponível",
        },
        { status: 422 },
      );
    }

    const updated = await withContaAtiva(async (tx, contaId) => {
      const [row] = await tx
        .update(confeccaoFornecedor)
        .set({
          latitude: result.latitude,
          longitude: result.longitude,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(confeccaoFornecedor.id, id),
            eq(confeccaoFornecedor.contaId, contaId),
          ),
        )
        .returning();
      return row;
    });

    return NextResponse.json({
      item: updated,
      precisao: result.precisao,
    });
  } catch (err) {
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    console.error("Erro no re-geocode:", err);
    return NextResponse.json(
      { error: "Erro ao geocodificar" },
      { status: 500 },
    );
  }
}
