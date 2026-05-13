// POST /api/confeccao/notas/whatsapp
//
// Registra log automático de envio de WhatsApp (clique no botão wa.me) na
// subtask correspondente. Cria nota com isAuditoria=true e timestamp.
//
// Não envia mensagem — apenas registra que o operador clicou no botão.

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { generateId } from "@/lib/utils";
import { withContaAtiva } from "@/lib/tenancy";
import {
  confeccaoNota,
  confeccaoSubtask,
  confeccaoOrdemProducao,
} from "@/lib/db/schema";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return (
    msg.includes("conta ativa") ||
    msg.includes("Sessão") ||
    msg.includes("Nenhuma")
  );
}

const LogWhatsAppSchema = z
  .object({
    subtaskId: z.string().optional(),
    ordemProducaoId: z.string().optional(),
    destinatarioNome: z.string().max(200),
    destinatarioTelefone: z.string().max(40),
    contexto: z.string().max(200).optional(),
  })
  .refine((d) => d.subtaskId || d.ordemProducaoId, {
    message: "subtaskId ou ordemProducaoId é obrigatório",
  });

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    const parsed = LogWhatsAppSchema.parse(await request.json());

    const result = await withContaAtiva(async (tx, contaId) => {
      // Valida FK (RLS protege, mas fail-fast 404 limpo)
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
      if (parsed.ordemProducaoId) {
        const [op] = await tx
          .select({ id: confeccaoOrdemProducao.id })
          .from(confeccaoOrdemProducao)
          .where(
            and(
              eq(confeccaoOrdemProducao.id, parsed.ordemProducaoId),
              eq(confeccaoOrdemProducao.contaId, contaId),
            ),
          );
        if (!op) return { notFound: "op" as const };
      }

      const conteudo = `WhatsApp aberto para ${parsed.destinatarioNome} (${parsed.destinatarioTelefone}) por ${session.user.name ?? session.user.email}${parsed.contexto ? ` — ${parsed.contexto}` : ""}`;

      const [nota] = await tx
        .insert(confeccaoNota)
        .values({
          id: generateId(),
          contaId,
          subtaskId: parsed.subtaskId ?? null,
          ordemProducaoId: parsed.ordemProducaoId ?? null,
          autorId: null,
          conteudo,
          isAuditoria: true,
          isInterna: true,
          metadata: {
            acao: "whatsapp_aberto",
            destinatarioNome: parsed.destinatarioNome,
            destinatarioTelefone: parsed.destinatarioTelefone,
            contexto: parsed.contexto ?? null,
            usuarioId: session.user.id,
            timestamp: new Date().toISOString(),
          },
        })
        .returning();
      return { ok: true as const, nota };
    });

    if ("notFound" in result) {
      return NextResponse.json(
        { error: `${result.notFound} não encontrada` },
        { status: 404 },
      );
    }
    return NextResponse.json({ item: result.nota }, { status: 201 });
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
      { error: "Erro ao registrar envio WhatsApp" },
      { status: 500 },
    );
  }
}
