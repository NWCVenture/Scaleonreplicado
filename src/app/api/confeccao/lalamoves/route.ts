// POST /api/confeccao/lalamoves — cria Lalamove manual (subtask OU retirada)
// GET  /api/confeccao/lalamoves?subtaskId=...|retiradaId=... — lista

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { generateId } from "@/lib/utils";
import { withContaAtiva } from "@/lib/tenancy";
import {
  confeccaoLalamove,
  confeccaoRetirada,
  confeccaoSubtask,
} from "@/lib/db/schema";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return (
    msg.includes("conta ativa") ||
    msg.includes("Sessão") ||
    msg.includes("Nenhuma")
  );
}

const EnderecoSchema = z.object({
  rua: z.string().optional(),
  numero: z.string().optional(),
  bairro: z.string().optional(),
  cep: z.string().optional(),
  cidade: z.string().optional(),
  estado: z.string().optional(),
  complemento: z.string().optional(),
});

const CriarLalamoveSchema = z
  .object({
    subtaskId: z.string().optional(),
    retiradaId: z.string().optional(),
    tipo: z.enum(["principal", "outros"]).default("principal"),
    origemEndereco: EnderecoSchema,
    destinoEndereco: EnderecoSchema,
    conteudoDescricao: z.string().max(500).optional(),
    quantidadePecas: z.number().int().positive().optional(),
    valor: z.number().nonnegative().optional(),
    contatoOrigemNome: z.string().max(120).optional(),
    contatoOrigemTelefone: z.string().max(40).optional(),
    contatoDestinoNome: z.string().max(120).optional(),
    contatoDestinoTelefone: z.string().max(40).optional(),
    remarksDestino: z.string().max(500).optional(),
  })
  .refine((d) => d.subtaskId || d.retiradaId, {
    message: "subtaskId ou retiradaId é obrigatório",
  });

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const subtaskId = sp.get("subtaskId");
    const retiradaId = sp.get("retiradaId");
    if (!subtaskId && !retiradaId) {
      return NextResponse.json(
        { error: "subtaskId ou retiradaId é obrigatório" },
        { status: 400 },
      );
    }

    const items = await withContaAtiva(async (tx, contaId) => {
      const conditions = [eq(confeccaoLalamove.contaId, contaId)];
      if (subtaskId)
        conditions.push(eq(confeccaoLalamove.subtaskId, subtaskId));
      if (retiradaId)
        conditions.push(eq(confeccaoLalamove.retiradaId, retiradaId));

      return await tx
        .select()
        .from(confeccaoLalamove)
        .where(and(...conditions))
        .orderBy(desc(confeccaoLalamove.createdAt));
    });

    return NextResponse.json({ items });
  } catch (err) {
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Erro ao listar Lalamoves" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    const parsed = CriarLalamoveSchema.parse(await request.json());

    const result = await withContaAtiva(async (tx, contaId) => {
      // Valida FK pertence à conta
      if (parsed.subtaskId) {
        const [st] = await tx
          .select({ id: confeccaoSubtask.id })
          .from(confeccaoSubtask)
          .where(
            and(
              eq(confeccaoSubtask.id, parsed.subtaskId),
              eq(confeccaoSubtask.contaId, contaId),
            ),
          );
        if (!st) return { notFound: "subtask" as const };
      }
      if (parsed.retiradaId) {
        const [r] = await tx
          .select({ id: confeccaoRetirada.id })
          .from(confeccaoRetirada)
          .where(
            and(
              eq(confeccaoRetirada.id, parsed.retiradaId),
              eq(confeccaoRetirada.contaId, contaId),
            ),
          );
        if (!r) return { notFound: "retirada" as const };
      }

      const [created] = await tx
        .insert(confeccaoLalamove)
        .values({
          id: generateId(),
          contaId,
          subtaskId: parsed.subtaskId ?? null,
          retiradaId: parsed.retiradaId ?? null,
          tipo: parsed.tipo,
          origemSolicitacao: "manual",
          status: "rascunho",
          origemEndereco: parsed.origemEndereco,
          destinoEndereco: parsed.destinoEndereco,
          conteudoDescricao: parsed.conteudoDescricao ?? null,
          quantidadePecas: parsed.quantidadePecas ?? null,
          valor: parsed.valor ?? null,
          contatoOrigemNome: parsed.contatoOrigemNome ?? null,
          contatoOrigemTelefone: parsed.contatoOrigemTelefone ?? null,
          contatoDestinoNome: parsed.contatoDestinoNome ?? null,
          contatoDestinoTelefone: parsed.contatoDestinoTelefone ?? null,
          remarksDestino: parsed.remarksDestino ?? null,
        })
        .returning();
      return { ok: true as const, item: created };
    });

    if ("notFound" in result) {
      return NextResponse.json(
        { error: `${result.notFound} não encontrada` },
        { status: 404 },
      );
    }
    return NextResponse.json({ item: result.item }, { status: 201 });
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
    console.error("Erro ao criar Lalamove:", err);
    return NextResponse.json(
      { error: "Erro ao criar Lalamove" },
      { status: 500 },
    );
  }
}
