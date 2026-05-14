// POST /api/confeccao/subtasks/[id]/concluir — em_andamento → concluida
//
// Valida o payload da subtask (por prefixo) antes de concluir.
// Destrava a próxima subtask + marca OP como concluída se todas concluíram.

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { withContaAtiva } from "@/lib/tenancy";
import { confeccaoSubtask } from "@/lib/db/schema";
import {
  concluirSubtask,
  TransicaoSubtaskError,
} from "@/lib/confeccao/transicao-subtask";
import {
  ConcluirSubtaskCompraSchema,
  type SubtaskCompraPayload,
} from "@/lib/confeccao/schemas/payloads/compra";
import {
  ConcluirSubtaskRiscoSchema,
  validarLarguraVsRolo,
} from "@/lib/confeccao/schemas/payloads/risco";
import {
  ConcluirSubtaskCorteSchema,
  rolosCompradosPorCorDeCompra,
  validarSaldoRolos,
} from "@/lib/confeccao/schemas/payloads/corte";
import { ConcluirSubtaskViesSchema } from "@/lib/confeccao/schemas/payloads/vies";
import {
  ConcluirSubtaskCosturaSchema,
  pecasCortadasPorTamCor,
  validarSaldoPecasVsCorte,
  type SubtaskCosturaPayload,
} from "@/lib/confeccao/schemas/payloads/costura";
import { confeccaoSubconferencia } from "@/lib/db/schema";
import {
  notificarOpConcluida,
  notificarSubtaskConcluida,
} from "@/lib/confeccao/email";

function isTenancyAuthError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return (
    msg.includes("conta ativa") ||
    msg.includes("Sessão") ||
    msg.includes("Nenhuma")
  );
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    const { id } = await ctx.params;

    const result = await withContaAtiva(async (tx, contaId) => {
      // Lê payload atual e valida por prefixo antes de concluir
      const [st] = await tx
        .select()
        .from(confeccaoSubtask)
        .where(
          and(
            eq(confeccaoSubtask.id, id),
            eq(confeccaoSubtask.contaId, contaId),
          ),
        );
      if (!st) {
        return { notFound: true as const };
      }

      // Dispatch de validação por prefixo
      if (st.prefixo === "OPBUY") {
        const r = ConcluirSubtaskCompraSchema.safeParse(st.payload);
        if (!r.success) {
          return {
            invalido: true as const,
            details: r.error.issues,
            mensagem:
              "Payload da subtask Compra está incompleto. Preencha todos os campos pré + pós-compra antes de concluir.",
          };
        }
      } else if (st.prefixo === "OPCOR") {
        const r = ConcluirSubtaskCorteSchema.safeParse(st.payload);
        if (!r.success) {
          return {
            invalido: true as const,
            details: r.error.issues,
            mensagem:
              "Payload do Corte está incompleto. Cada oficina precisa ter rolos enviados, folhas, rendimento e preço/peça.",
          };
        }
        // Validação cross-subtask: saldo de rolos vindo da Compra
        const [opbuy] = await tx
          .select({ payload: confeccaoSubtask.payload })
          .from(confeccaoSubtask)
          .where(
            and(
              eq(confeccaoSubtask.ordemProducaoId, st.ordemProducaoId),
              eq(confeccaoSubtask.prefixo, "OPBUY"),
            ),
          );
        const rolosDisponiveis = rolosCompradosPorCorDeCompra(
          opbuy?.payload as SubtaskCompraPayload | undefined,
        );
        if (rolosDisponiveis.size === 0) {
          return {
            invalido: true as const,
            details: [
              {
                code: "custom",
                path: ["oficinas"],
                message:
                  "Subtask Compra ainda não definiu rolos recebidos — conclua-a primeiro",
              },
            ],
            mensagem:
              "Subtask Compra ainda não definiu rolos recebidos — conclua-a primeiro",
          };
        }
        const saldoOk = validarSaldoRolos(r.data.oficinas, rolosDisponiveis);
        if (!saldoOk.ok) {
          return {
            invalido: true as const,
            details: [
              {
                code: "custom",
                path: ["oficinas"],
                message: saldoOk.mensagem,
              },
            ],
            mensagem: saldoOk.mensagem,
          };
        }
      } else if (st.prefixo === "OPSEW") {
        const r = ConcluirSubtaskCosturaSchema.safeParse(st.payload);
        if (!r.success) {
          return {
            invalido: true as const,
            details: r.error.issues,
            mensagem:
              "Costura não pode ser concluída: todas as oficinas precisam estar finalizadas (com retirada final feita) e ter prazo, peças, etiquetagem e preço/peça definidos.",
          };
        }
        // Cross-subtask: saldo de peças vs rendimento do Corte
        const [opcor] = await tx
          .select({ payload: confeccaoSubtask.payload })
          .from(confeccaoSubtask)
          .where(
            and(
              eq(confeccaoSubtask.ordemProducaoId, st.ordemProducaoId),
              eq(confeccaoSubtask.prefixo, "OPCOR"),
            ),
          );
        const pecasDisponiveis = pecasCortadasPorTamCor(opcor?.payload);
        if (pecasDisponiveis.size === 0) {
          return {
            invalido: true as const,
            details: [
              {
                code: "custom",
                path: ["oficinas"],
                message:
                  "Subtask Corte ainda não definiu rendimento — conclua-a primeiro",
              },
            ],
            mensagem:
              "Subtask Corte ainda não definiu rendimento — conclua-a primeiro",
          };
        }
        const saldoOk = validarSaldoPecasVsCorte(
          r.data.oficinas,
          pecasDisponiveis,
        );
        if (!saldoOk.ok) {
          return {
            invalido: true as const,
            details: [
              {
                code: "custom",
                path: ["oficinas"],
                message: saldoOk.mensagem,
              },
            ],
            mensagem: saldoOk.mensagem,
          };
        }
      } else if (st.prefixo === "OPCONF") {
        // Conferência só fecha quando:
        //  - Todas as subconferências da subtask estão concluidas
        //  - Todas as oficinas da Costura estão "finalizada" (sem retiradas pendentes)
        const subconfs = await tx
          .select({ status: confeccaoSubconferencia.status })
          .from(confeccaoSubconferencia)
          .where(eq(confeccaoSubconferencia.subtaskConferenciaId, st.id));
        if (subconfs.length === 0) {
          return {
            invalido: true as const,
            details: [
              {
                code: "custom",
                path: [],
                message:
                  "Nenhuma subconferência existe ainda. Aguarde a primeira retirada da Costura criar uma.",
              },
            ],
            mensagem:
              "Nenhuma subconferência existe ainda. Aguarde a primeira retirada da Costura criar uma.",
          };
        }
        const pendentes = subconfs.filter((s) => s.status !== "concluida");
        if (pendentes.length > 0) {
          return {
            invalido: true as const,
            details: [
              {
                code: "custom",
                path: [],
                message: `${pendentes.length} subconferência(s) ainda não concluída(s)`,
              },
            ],
            mensagem: `${pendentes.length} subconferência(s) ainda não concluída(s) — conclua-as antes de fechar a Conferência`,
          };
        }
        // Verifica Costura
        const [opsew] = await tx
          .select({ payload: confeccaoSubtask.payload })
          .from(confeccaoSubtask)
          .where(
            and(
              eq(confeccaoSubtask.ordemProducaoId, st.ordemProducaoId),
              eq(confeccaoSubtask.prefixo, "OPSEW"),
            ),
          );
        const oficinas =
          (opsew?.payload as SubtaskCosturaPayload | undefined)?.oficinas ??
          [];
        const naoFinalizadas = oficinas.filter(
          (o) => o.statusInterno !== "finalizada",
        );
        if (naoFinalizadas.length > 0) {
          return {
            invalido: true as const,
            details: [
              {
                code: "custom",
                path: [],
                message: `${naoFinalizadas.length} oficina(s) da Costura sem retirada final`,
              },
            ],
            mensagem: `${naoFinalizadas.length} oficina(s) da Costura sem retirada final — finalize-as antes`,
          };
        }
      } else if (st.prefixo === "OPVIE") {
        const r = ConcluirSubtaskViesSchema.safeParse(st.payload);
        if (!r.success) {
          return {
            invalido: true as const,
            details: r.error.issues,
            mensagem:
              "Payload do Viés está incompleto. Preencha fábrica, tamanho da bandeira, tipo/cor, metragem e preço antes de concluir.",
          };
        }
      } else if (st.prefixo === "OPRIS") {
        const r = ConcluirSubtaskRiscoSchema.safeParse(st.payload);
        if (!r.success) {
          return {
            invalido: true as const,
            details: r.error.issues,
            mensagem:
              "Payload do Risco está incompleto. Preencha fornecedor, tamanhos, dados técnicos e valor antes de concluir.",
          };
        }
        // Validação cross-subtask: largura do risco ≤ largura do rolo (OPBUY.pos)
        const [opbuy] = await tx
          .select({ payload: confeccaoSubtask.payload })
          .from(confeccaoSubtask)
          .where(
            and(
              eq(confeccaoSubtask.ordemProducaoId, st.ordemProducaoId),
              eq(confeccaoSubtask.prefixo, "OPBUY"),
            ),
          );
        const larguraRoloCm =
          (opbuy?.payload as SubtaskCompraPayload | undefined)?.pos
            ?.larguraRoloCm ?? null;
        const valida = validarLarguraVsRolo(r.data.larguraCm, larguraRoloCm);
        if (!valida.ok) {
          return {
            invalido: true as const,
            details: [
              {
                code: "custom",
                path: ["larguraCm"],
                message: valida.mensagem,
              },
            ],
            mensagem: valida.mensagem,
          };
        }
      }
      // Outras subtasks (RITM-10+): validação respectiva, por ora aceita
      // qualquer payload (cada RITM adiciona seu schema de conclusão).

      const transicao = await concluirSubtask(tx, {
        contaId,
        subtaskId: id,
        usuarioId: session.user.id,
      });
      // Após a transição, lê OP pra saber se foi marcada como concluída
      const [opAtual] = await tx
        .select({
          id: confeccaoSubtask.ordemProducaoId,
        })
        .from(confeccaoSubtask)
        .where(eq(confeccaoSubtask.id, id));
      return {
        ok: true as const,
        subtask: transicao,
        ordemProducaoId: opAtual?.id ?? st.ordemProducaoId,
        atribuidoAnteriorId: st.atribuidoAId,
      };
    });

    if ("notFound" in result) {
      return NextResponse.json(
        { error: "Subtask não encontrada" },
        { status: 404 },
      );
    }
    if ("invalido" in result) {
      return NextResponse.json(
        { error: result.mensagem, details: result.details },
        { status: 400 },
      );
    }

    // Dispara notificações fire-and-forget (após commit da transação)
    notificarSubtaskConcluida({
      subtaskAnteriorId: result.subtask.id,
      proximaSubtaskId: result.subtask.proximaDesbloqueada?.id ?? null,
      atribuidoAnteriorId: result.atribuidoAnteriorId,
      executorId: session.user.id,
    });
    // OP concluída: detecta lendo status atual (concluirSubtask marca a OP
    // quando todas as subtasks fecham)
    if (!result.subtask.proximaDesbloqueada) {
      notificarOpConcluida({
        opId: result.ordemProducaoId,
        executorId: session.user.id,
      });
    }

    return NextResponse.json({ subtask: result.subtask });
  } catch (err) {
    if (err instanceof TransicaoSubtaskError) {
      const status =
        err.code === "subtask_nao_encontrada" ? 404 : 400;
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status },
      );
    }
    if (isTenancyAuthError(err)) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Erro ao concluir subtask" },
      { status: 500 },
    );
  }
}
