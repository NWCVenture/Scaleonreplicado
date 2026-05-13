// GET    /api/confeccao/anexos/[id]  — metadados + blobUrl (autenticado)
// DELETE /api/confeccao/anexos/[id]  — remove do Blob + banco (admin only)
//
// DELETE bloqueia remoção de anexo de subtask/OP concluída — edição
// retroativa exige fluxo dedicado (RITM-15). Best-effort no Blob —
// se falhar, ainda removemos do DB e logamos (anexo virou orphan).

import { NextRequest, NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { requireAdminAtivo, withContaAtiva } from "@/lib/tenancy";
import {
  confeccaoAnexo,
  confeccaoNota,
  confeccaoOrdemProducao,
  confeccaoSubtask,
} from "@/lib/db/schema";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return (
    msg.includes("conta ativa") ||
    msg.includes("Sessão") ||
    msg.includes("Nenhuma") ||
    msg.includes("Acesso negado")
  );
}

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const anexo = await withContaAtiva(async (tx) => {
      const rows = await tx
        .select()
        .from(confeccaoAnexo)
        .where(eq(confeccaoAnexo.id, id));
      return rows[0] ?? null;
    });

    if (!anexo) {
      return NextResponse.json(
        { error: "Anexo não encontrado" },
        { status: 404 },
      );
    }
    return NextResponse.json({ anexo });
  } catch (err) {
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Erro ao buscar anexo" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    // Autorização: apenas admin/owner pode deletar
    try {
      await requireAdminAtivo();
    } catch {
      return NextResponse.json(
        { error: "Acesso negado — requer admin" },
        { status: 403 },
      );
    }

    const result = await withContaAtiva(async (tx, contaId) => {
      const [anexo] = await tx
        .select()
        .from(confeccaoAnexo)
        .where(eq(confeccaoAnexo.id, id));
      if (!anexo) return { notFound: true as const };

      // Bloquear se subtask vinculada está concluída
      if (anexo.subtaskId) {
        const [st] = await tx
          .select({ status: confeccaoSubtask.status })
          .from(confeccaoSubtask)
          .where(eq(confeccaoSubtask.id, anexo.subtaskId));
        if (st?.status === "concluida") {
          return { blockedConcluida: true as const };
        }
      }
      // Mesma regra pra OP vinculada
      if (anexo.ordemProducaoId) {
        const [op] = await tx
          .select({ status: confeccaoOrdemProducao.status })
          .from(confeccaoOrdemProducao)
          .where(eq(confeccaoOrdemProducao.id, anexo.ordemProducaoId));
        if (op?.status === "concluida") {
          return { blockedConcluida: true as const };
        }
      }

      await tx.delete(confeccaoAnexo).where(eq(confeccaoAnexo.id, id));

      // Auditoria — só cria nota se houver subtask ou OP pra vincular
      // (constraint confeccao_nota_tem_pai). Anexos de Lalamove puro
      // ficam sem nota; comportamento aceitável (auditoria detalhada
      // do Lalamove vem nas RITMs 25-28).
      if (anexo.subtaskId || anexo.ordemProducaoId) {
        await tx.insert(confeccaoNota).values({
          id: nanoid(),
          contaId,
          subtaskId: anexo.subtaskId,
          ordemProducaoId: anexo.ordemProducaoId,
          autorId: null,
          conteudo: `Anexo '${anexo.nomeArquivo}' removido por ${session.user.name ?? session.user.email}`,
          isAuditoria: true,
          isInterna: true,
          metadata: { anexoId: id, categoria: anexo.categoria },
        });
      }

      return { ok: true as const, anexo };
    });

    if (result.notFound) {
      return NextResponse.json(
        { error: "Anexo não encontrado" },
        { status: 404 },
      );
    }
    if (result.blockedConcluida) {
      return NextResponse.json(
        {
          error:
            "Anexo de subtask/OP concluída só pode ser removido via fluxo de edição retroativa",
        },
        { status: 400 },
      );
    }

    // Best-effort no Blob — se falhar, ainda removemos do DB e logamos.
    try {
      await del(result.anexo.blobUrl);
    } catch (e) {
      console.warn(
        `[confeccao/anexos] falha ao remover ${id} do Blob:`,
        (e as Error).message,
      );
    }

    return NextResponse.json({ deleted: true });
  } catch (err) {
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Erro ao remover anexo" },
      { status: 500 },
    );
  }
}
