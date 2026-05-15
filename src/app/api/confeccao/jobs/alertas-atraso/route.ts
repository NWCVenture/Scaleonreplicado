// POST /api/confeccao/jobs/alertas-atraso — RITM-22
//
// Cron handler invocado pela Vercel Cron 1×/dia (config em vercel.json).
// Itera contas ativas, detecta oficinas em atraso (vencendo em 24h ou
// vencidas) e dispara emails. Idempotente: log com UNIQUE constraint
// + INSERT ... ON CONFLICT DO NOTHING garante no máximo 1 envio por
// (subtask × oficina × tipo × dia).
//
// Auth: header `Authorization: Bearer ${CRON_SECRET}` obrigatório.

import { NextRequest, NextResponse } from "next/server";
import { and, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { withConta } from "@/lib/tenancy";
import {
  conta,
  confeccaoAlertaAtrasoLog,
  confeccaoFornecedor,
  confeccaoOrdemProducao,
  confeccaoProduto,
  confeccaoSubtask,
  user,
  usuarioConta,
} from "@/lib/db/schema";
import { generateId } from "@/lib/utils";
import {
  montarAlertasAtraso,
  type LogExistenteRaw,
  type OficinaRaw,
  type OpRaw,
  type SubtaskCosturaRaw,
  type UsuarioRaw,
} from "@/lib/confeccao/alertas-atraso";
import {
  notificarPrazoVencendo,
  notificarPrazoVencido,
} from "@/lib/confeccao/email";

interface ResultadoConta {
  contaId: string;
  alertasEnviados: number;
  alertasIgnorados: number;
  erros: number;
}

function diaUTC(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0),
  );
}

export async function POST(request: NextRequest) {
  // === Auth ===
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[alertas-atraso] CRON_SECRET não configurado");
    return NextResponse.json(
      { error: "Servidor mal configurado" },
      { status: 500 },
    );
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const agora = new Date();
  const dataRefHoje = diaUTC(agora);

  // === Lista de contas (db direto — tabela conta não tem RLS) ===
  let contas: { id: string }[];
  try {
    contas = await db
      .select({ id: conta.id })
      .from(conta)
      .where(eq(conta.status, "ativa"));
  } catch (err) {
    console.error("[alertas-atraso] falha listando contas:", err);
    return NextResponse.json(
      { error: "Erro listando contas" },
      { status: 500 },
    );
  }

  const resultados: ResultadoConta[] = [];

  for (const c of contas) {
    const res: ResultadoConta = {
      contaId: c.id,
      alertasEnviados: 0,
      alertasIgnorados: 0,
      erros: 0,
    };
    try {
      // Carrega dados da conta dentro de transação com RLS scoped.
      const dados = await withConta(c.id, async (tx) => {
        // OPs em andamento + produto pra nome amigável
        const opsRows = await tx
          .select({
            id: confeccaoOrdemProducao.id,
            numero: confeccaoOrdemProducao.numero,
            status: confeccaoOrdemProducao.status,
            produtoId: confeccaoOrdemProducao.produtoId,
            produtoNome: confeccaoProduto.nome,
          })
          .from(confeccaoOrdemProducao)
          .innerJoin(
            confeccaoProduto,
            eq(confeccaoProduto.id, confeccaoOrdemProducao.produtoId),
          )
          .where(eq(confeccaoOrdemProducao.status, "em_andamento"));

        if (opsRows.length === 0) {
          return null;
        }

        const opIds = opsRows.map((o) => o.id);
        const opNomeProdutoById = new Map(
          opsRows.map((o) => [o.id, o.produtoNome]),
        );

        // Subtasks de costura dessas OPs
        const stRows = await tx
          .select({
            id: confeccaoSubtask.id,
            ordemProducaoId: confeccaoSubtask.ordemProducaoId,
            atribuidoAId: confeccaoSubtask.atribuidoAId,
            payload: confeccaoSubtask.payload,
          })
          .from(confeccaoSubtask)
          .where(
            and(
              eq(confeccaoSubtask.prefixo, "OPSEW"),
              inArray(confeccaoSubtask.ordemProducaoId, opIds),
            ),
          );

        if (stRows.length === 0) return null;

        // Fornecedores (oficinas)
        const ofRows = await tx
          .select({
            id: confeccaoFornecedor.id,
            nome: confeccaoFornecedor.nome,
          })
          .from(confeccaoFornecedor);

        // Atribuídos das subtasks
        const atribuidoIds = stRows
          .map((s) => s.atribuidoAId)
          .filter((x): x is string => x !== null);

        // Admins ativos da conta — `user` e `usuario_conta` não têm RLS,
        // mas filtramos por contaId mesmo assim.
        const adminRows = await tx
          .select({
            id: user.id,
            name: user.name,
            email: user.email,
          })
          .from(usuarioConta)
          .innerJoin(user, eq(user.id, usuarioConta.usuarioId))
          .where(
            and(
              eq(usuarioConta.contaId, c.id),
              eq(usuarioConta.ativo, true),
              inArray(usuarioConta.papel, ["owner", "admin"]),
            ),
          );

        const adminsIds = adminRows.map((a) => a.id);

        // Usuários atribuídos (pode incluir admins; dedup feito no Map abaixo)
        const usuarioIdsUnicos = Array.from(
          new Set<string>([...atribuidoIds, ...adminsIds]),
        );
        let atribuidoRows: Array<{ id: string; name: string; email: string }> = [];
        if (usuarioIdsUnicos.length > 0) {
          atribuidoRows = await tx
            .select({
              id: user.id,
              name: user.name,
              email: user.email,
            })
            .from(user)
            .where(inArray(user.id, usuarioIdsUnicos));
        }

        // Log de hoje (idempotência)
        const logRows = await tx
          .select({
            subtaskId: confeccaoAlertaAtrasoLog.subtaskId,
            oficinaId: confeccaoAlertaAtrasoLog.oficinaId,
            tipoAlerta: confeccaoAlertaAtrasoLog.tipoAlerta,
            dataReferencia: confeccaoAlertaAtrasoLog.dataReferencia,
          })
          .from(confeccaoAlertaAtrasoLog)
          .where(gte(confeccaoAlertaAtrasoLog.dataReferencia, dataRefHoje));

        return {
          opsRows,
          stRows,
          ofRows,
          atribuidoRows,
          adminsIds,
          logRows,
          opNomeProdutoById,
        };
      });

      if (!dados) {
        resultados.push(res);
        continue;
      }

      // === Monta input do service ===
      const ops: OpRaw[] = dados.opsRows.map((o) => ({
        id: o.id,
        numero: o.numero,
        status: o.status as OpRaw["status"],
      }));
      const subtasks: SubtaskCosturaRaw[] = dados.stRows.map((s) => ({
        id: s.id,
        ordemProducaoId: s.ordemProducaoId,
        atribuidoAId: s.atribuidoAId,
        payload: s.payload as Record<string, unknown>,
      }));
      const oficinas: OficinaRaw[] = dados.ofRows.map((o) => ({
        id: o.id,
        nome: o.nome,
      }));
      const usuarios: UsuarioRaw[] = dados.atribuidoRows
        .filter((u) => u.email)
        .map((u) => ({ id: u.id, name: u.name, email: u.email }));
      const logExistente: LogExistenteRaw[] = dados.logRows.map((l) => ({
        subtaskId: l.subtaskId,
        oficinaId: l.oficinaId,
        tipoAlerta: l.tipoAlerta as LogExistenteRaw["tipoAlerta"],
        dataReferenciaISO: new Date(l.dataReferencia).toISOString(),
      }));

      const alertas = montarAlertasAtraso({
        agora,
        ops,
        subtasksCostura: subtasks,
        oficinas,
        usuarios,
        adminsIds: dados.adminsIds,
        logExistente,
      });

      // === Insere log com ON CONFLICT + dispara emails ===
      // Cada alerta vai num INSERT separado pra capturar o "inseriu vs.
      // conflitou" individualmente. Se inseriu (returning algo), dispara.
      for (const alerta of alertas) {
        try {
          const inserted = await withConta(c.id, async (tx) => {
            return tx
              .insert(confeccaoAlertaAtrasoLog)
              .values({
                id: generateId(),
                contaId: c.id,
                ordemProducaoId: alerta.opId,
                subtaskId: alerta.subtaskId,
                oficinaId: alerta.oficinaId,
                tipoAlerta: alerta.tipoAlerta,
                dataReferencia: dataRefHoje,
                destinatariosCount: alerta.destinatarios.length,
                enviadosCount: alerta.destinatarios.length,
              })
              .onConflictDoNothing({
                target: [
                  confeccaoAlertaAtrasoLog.contaId,
                  confeccaoAlertaAtrasoLog.subtaskId,
                  confeccaoAlertaAtrasoLog.oficinaId,
                  confeccaoAlertaAtrasoLog.tipoAlerta,
                  confeccaoAlertaAtrasoLog.dataReferencia,
                ],
              })
              .returning({ id: confeccaoAlertaAtrasoLog.id });
          });

          if (inserted.length === 0) {
            // Outro processo registrou antes — não envia
            res.alertasIgnorados += 1;
            continue;
          }

          const produtoNome =
            dados.opNomeProdutoById.get(alerta.opId) ?? "—";

          for (const destinatario of alerta.destinatarios) {
            if (alerta.tipoAlerta === "vencendo_24h") {
              notificarPrazoVencendo({
                destinatario,
                opNumero: alerta.opNumero,
                produtoNome,
                oficinaNome: alerta.oficinaNome,
                prazoProducaoISO: alerta.prazoProducaoISO,
              });
            } else {
              notificarPrazoVencido({
                destinatario,
                opNumero: alerta.opNumero,
                produtoNome,
                oficinaNome: alerta.oficinaNome,
                prazoProducaoISO: alerta.prazoProducaoISO,
                diasAtraso: alerta.diasAtraso,
              });
            }
          }
          res.alertasEnviados += 1;
        } catch (err) {
          console.error(
            `[alertas-atraso] falha alerta ${alerta.tipoAlerta} subtask=${alerta.subtaskId} oficina=${alerta.oficinaId}:`,
            err,
          );
          res.erros += 1;
        }
      }
    } catch (err) {
      console.error(`[alertas-atraso] falha conta ${c.id}:`, err);
      res.erros += 1;
    }
    resultados.push(res);
  }

  const total = resultados.reduce(
    (acc, r) => {
      acc.alertasEnviados += r.alertasEnviados;
      acc.alertasIgnorados += r.alertasIgnorados;
      acc.erros += r.erros;
      return acc;
    },
    { alertasEnviados: 0, alertasIgnorados: 0, erros: 0 },
  );

  return NextResponse.json({
    executadoEm: agora.toISOString(),
    contasProcessadas: resultados.length,
    ...total,
    porConta: resultados,
  });
}

// GET retorna 405 — cron é estritamente POST.
export function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
