// POST /api/confeccao/uploads/confirm
//
// Chamado pelo cliente APÓS upload() retornar com sucesso. Cria o
// registro em `confeccao_anexo` e uma nota de auditoria automática.
//
// Verifica no Blob (HEAD) que o objeto realmente existe — defesa contra
// payload forjado pelo cliente.

import { NextRequest, NextResponse } from "next/server";
import { head } from "@vercel/blob";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { withContaAtiva } from "@/lib/tenancy";
import {
  confeccaoAnexo,
  confeccaoLalamove,
  confeccaoNota,
  confeccaoRetirada,
} from "@/lib/db/schema";
import { ConfirmAnexoSchema } from "@/lib/confeccao/schemas/anexo";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return (
    msg.includes("conta ativa") ||
    msg.includes("Sessão") ||
    msg.includes("Nenhuma")
  );
}

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  let parsed;
  try {
    parsed = ConfirmAnexoSchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { error: "Payload inválido", details: (err as Error).message },
      { status: 400 },
    );
  }

  // Verifica que o blob realmente existe — head() lança se 404.
  try {
    await head(parsed.blobUrl);
  } catch {
    return NextResponse.json(
      {
        error:
          "Blob não encontrado — upload incompleto ou URL inválida",
      },
      { status: 400 },
    );
  }

  try {
    const result = await withContaAtiva(async (tx, contaId) => {
      // Anti-replay: UNIQUE em blob_url já impede, mas detectar aqui dá
      // um 409 limpo em vez de erro genérico no INSERT.
      const existente = await tx
        .select()
        .from(confeccaoAnexo)
        .where(eq(confeccaoAnexo.blobUrl, parsed.blobUrl));
      if (existente.length > 0) {
        return { conflict: true as const, anexo: existente[0] };
      }

      const anexoId = nanoid();
      const [anexo] = await tx
        .insert(confeccaoAnexo)
        .values({
          id: anexoId,
          contaId,
          subtaskId: parsed.subtaskId ?? null,
          ordemProducaoId: parsed.ordemProducaoId ?? null,
          lalamoveId: parsed.lalamoveId ?? null,
          categoria: parsed.categoria,
          nomeArquivo: parsed.nomeArquivo,
          tipoMime: parsed.tipoMime,
          tamanhoBytes: parsed.tamanhoBytes,
          blobUrl: parsed.blobUrl,
          blobPathname: parsed.blobPathname,
          enviadoPorId: session.user.id,
        })
        .returning();

      // Auditoria em confeccao_nota. Constraint confeccao_nota_tem_pai
      // exige ordem_producao_id OU subtask_id; se o anexo é só de
      // Lalamove, resolvemos o subtask vinculado pra atender a constraint.
      let notaSubtaskId: string | null = parsed.subtaskId ?? null;
      let notaOrdemProducaoId: string | null = parsed.ordemProducaoId ?? null;
      if (!notaSubtaskId && !notaOrdemProducaoId && parsed.lalamoveId) {
        const [ll] = await tx
          .select({
            subtaskId: confeccaoLalamove.subtaskId,
            retiradaId: confeccaoLalamove.retiradaId,
          })
          .from(confeccaoLalamove)
          .where(eq(confeccaoLalamove.id, parsed.lalamoveId));
        if (ll?.subtaskId) {
          notaSubtaskId = ll.subtaskId;
        } else if (ll?.retiradaId) {
          const [ret] = await tx
            .select({
              subtaskCosturaId: confeccaoRetirada.subtaskCosturaId,
            })
            .from(confeccaoRetirada)
            .where(eq(confeccaoRetirada.id, ll.retiradaId));
          if (ret) notaSubtaskId = ret.subtaskCosturaId;
        }
      }

      if (notaSubtaskId || notaOrdemProducaoId) {
        await tx.insert(confeccaoNota).values({
          id: nanoid(),
          contaId,
          subtaskId: notaSubtaskId,
          ordemProducaoId: notaOrdemProducaoId,
          autorId: null,
          conteudo: `Anexo '${parsed.nomeArquivo}' enviado por ${session.user.name ?? session.user.email}`,
          isAuditoria: true,
          isInterna: true,
          metadata: {
            anexoId,
            categoria: parsed.categoria,
            tipoMime: parsed.tipoMime,
            tamanhoBytes: parsed.tamanhoBytes,
          },
        });
      }

      return { conflict: false as const, anexo };
    });

    if (result.conflict) {
      return NextResponse.json(
        { error: "Anexo já confirmado para esta URL", anexo: result.anexo },
        { status: 409 },
      );
    }
    return NextResponse.json({ anexo: result.anexo }, { status: 201 });
  } catch (err) {
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    return NextResponse.json(
      { error: (err as Error).message ?? "Erro ao confirmar anexo" },
      { status: 500 },
    );
  }
}
