// Dispatchers fire-and-forget de notificações (RITM-17).
//
// Padrão: cada função é síncrona aparentemente (retorna void) mas spawna
// promise em background. Falhas são logadas mas não propagam.
//
// O caller (endpoint) chama estas funções APÓS o commit da transação
// principal — pra não bloquear a resposta HTTP e não enviar email se a
// transação rolar back.

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { confeccaoSubtask, user } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email";
import {
  buildAtribuidoMudouAnteriorEmail,
  buildAtribuidoMudouNovoEmail,
  buildOpCanceladaEmail,
  buildOpConcluidaEmail,
  buildOpCriadaEmail,
  buildRetiradaParcialEmail,
  buildSubtaskConcluidaAnteriorEmail,
  buildSubtaskConcluidaProximoEmail,
  type EmailRender,
} from "./templates";
import {
  buscarAdminsConta,
  buscarConferenciaDaOP,
  buscarOpPorId,
  buscarSubtaskPorId,
  buscarUsuario,
  opUrl,
  type DestinatarioBasico,
} from "./destinatarios";

function disparar(
  destinatario: DestinatarioBasico,
  render: EmailRender,
  contexto: string,
): void {
  void (async () => {
    try {
      await sendEmail({
        to: destinatario.email,
        subject: render.subject,
        html: render.html,
        text: render.text,
      });
    } catch (err) {
      console.warn(
        `[email] disparo falhou (${contexto} → ${destinatario.email}):`,
        (err as Error).message,
      );
    }
  })();
}

// ============================================================
// 1. OP criada
// ============================================================

export function notificarOpCriada(input: {
  opId: string;
  criadorId: string;
}): void {
  void (async () => {
    const op = await buscarOpPorId(input.opId);
    if (!op) return;
    const atribuido = await buscarUsuario(op.atribuidoAId);
    if (!atribuido) return;
    const criador = await buscarUsuario(input.criadorId);
    const url = opUrl(op.numero);
    const render = buildOpCriadaEmail({
      destinatarioNome: atribuido.name,
      opNumero: op.numero,
      produtoNome: op.produtoNome,
      temVies: op.temVies,
      criadorNome: criador?.name ?? "Sistema",
      opUrl: url,
    });
    disparar(atribuido, render, "op-criada");
  })();
}

// ============================================================
// 2 & 3. Subtask concluída (+ OP concluída se for o caso)
// ============================================================

export function notificarSubtaskConcluida(input: {
  subtaskAnteriorId: string;
  proximaSubtaskId: string | null;
  atribuidoAnteriorId: string | null;
  executorId: string;
}): void {
  void (async () => {
    const anterior = await buscarSubtaskPorId(input.subtaskAnteriorId);
    if (!anterior) return;
    const op = await buscarOpPorId(anterior.ordemProducaoId);
    if (!op) return;
    const url = opUrl(op.numero);
    const executor = await buscarUsuario(input.executorId);
    const executorNome = executor?.name ?? "Sistema";

    // 2a. Atribuído da próxima subtask, se houver
    if (input.proximaSubtaskId) {
      const proxima = await buscarSubtaskPorId(input.proximaSubtaskId);
      if (proxima) {
        // Atribuído da próxima — se nulo, cai pra atribuído da OP
        const destId = proxima.atribuidoAId ?? op.atribuidoAId;
        const destinatario = await buscarUsuario(destId);
        if (destinatario) {
          const render = buildSubtaskConcluidaProximoEmail({
            destinatarioNome: destinatario.name,
            opNumero: op.numero,
            produtoNome: op.produtoNome,
            subtaskAnteriorNumero: anterior.numero,
            subtaskProximaNumero: proxima.numero,
            subtaskProximaPrefixo: proxima.prefixo,
            executorNome,
            opUrl: url,
          });
          disparar(destinatario, render, "subtask-concluida-proximo");
        }
      }
    }

    // 2b. Atribuído anterior — só se diferente do executor
    if (
      input.atribuidoAnteriorId &&
      input.atribuidoAnteriorId !== input.executorId
    ) {
      const anteriorDest = await buscarUsuario(input.atribuidoAnteriorId);
      if (anteriorDest) {
        const render = buildSubtaskConcluidaAnteriorEmail({
          destinatarioNome: anteriorDest.name,
          opNumero: op.numero,
          produtoNome: op.produtoNome,
          subtaskNumero: anterior.numero,
          executorNome,
          opUrl: url,
        });
        disparar(anteriorDest, render, "subtask-concluida-anterior");
      }
    }
  })();
}

export function notificarOpConcluida(input: {
  opId: string;
  executorId: string;
}): void {
  void (async () => {
    const op = await buscarOpPorId(input.opId);
    if (!op) return;
    // Defesa: só dispara se OP realmente foi marcada concluida (evita
    // notificação falsa quando proximaDesbloqueada veio null por
    // corrupção/ordem inesperada).
    if (op.status !== "concluida") return;
    const url = opUrl(op.numero);
    const executor = await buscarUsuario(input.executorId);
    const executorNome = executor?.name ?? "Sistema";

    // Admins/owners + atribuído da OP (deduplicado por email)
    const admins = await buscarAdminsConta(op.contaId);
    const atribuido = await buscarUsuario(op.atribuidoAId);
    const todos = [...admins];
    if (atribuido && !todos.some((d) => d.email === atribuido.email)) {
      todos.push(atribuido);
    }
    for (const d of todos) {
      const render = buildOpConcluidaEmail({
        destinatarioNome: d.name,
        opNumero: op.numero,
        produtoNome: op.produtoNome,
        executorNome,
        opUrl: url,
      });
      disparar(d, render, "op-concluida");
    }
  })();
}

// ============================================================
// 4. Atribuído de OP alterado
// ============================================================

export function notificarAtribuidoOpMudou(input: {
  opId: string;
  atribuidoAnteriorId: string;
  atribuidoNovoId: string;
  editorId: string;
}): void {
  void (async () => {
    if (input.atribuidoAnteriorId === input.atribuidoNovoId) return;
    const op = await buscarOpPorId(input.opId);
    if (!op) return;
    const url = opUrl(op.numero);
    const editor = await buscarUsuario(input.editorId);
    const editorNome = editor?.name ?? "Sistema";
    const novo = await buscarUsuario(input.atribuidoNovoId);
    const anterior = await buscarUsuario(input.atribuidoAnteriorId);

    if (novo && novo.id !== input.editorId) {
      const render = buildAtribuidoMudouNovoEmail({
        destinatarioNome: novo.name,
        alvoLabel: `OP ${op.numero}`,
        produtoNome: op.produtoNome,
        editorNome,
        url,
      });
      disparar(novo, render, "atribuido-op-novo");
    }
    if (anterior && anterior.id !== input.editorId) {
      const render = buildAtribuidoMudouAnteriorEmail({
        destinatarioNome: anterior.name,
        alvoLabel: `OP ${op.numero}`,
        produtoNome: op.produtoNome,
        novoAtribuidoNome: novo?.name ?? "?",
        editorNome,
        url,
      });
      disparar(anterior, render, "atribuido-op-anterior");
    }
  })();
}

// ============================================================
// 5. Atribuído de subtask alterado
// ============================================================

export function notificarAtribuidoSubtaskMudou(input: {
  subtaskId: string;
  atribuidoAnteriorId: string | null;
  atribuidoNovoId: string | null;
  editorId: string;
}): void {
  void (async () => {
    if (input.atribuidoAnteriorId === input.atribuidoNovoId) return;
    const st = await buscarSubtaskPorId(input.subtaskId);
    if (!st) return;
    const op = await buscarOpPorId(st.ordemProducaoId);
    if (!op) return;
    const url = opUrl(op.numero);
    const editor = await buscarUsuario(input.editorId);
    const editorNome = editor?.name ?? "Sistema";
    const novo = await buscarUsuario(input.atribuidoNovoId);
    const anterior = await buscarUsuario(input.atribuidoAnteriorId);
    const alvoLabel = `subtask ${st.numero} da OP ${op.numero}`;

    if (novo && novo.id !== input.editorId) {
      const render = buildAtribuidoMudouNovoEmail({
        destinatarioNome: novo.name,
        alvoLabel,
        produtoNome: op.produtoNome,
        editorNome,
        url,
      });
      disparar(novo, render, "atribuido-subtask-novo");
    }
    if (anterior && anterior.id !== input.editorId) {
      const render = buildAtribuidoMudouAnteriorEmail({
        destinatarioNome: anterior.name,
        alvoLabel,
        produtoNome: op.produtoNome,
        novoAtribuidoNome: novo?.name ?? "?",
        editorNome,
        url,
      });
      disparar(anterior, render, "atribuido-subtask-anterior");
    }
  })();
}

// ============================================================
// 6b. OP cancelada
// ============================================================

export function notificarOpCancelada(input: {
  opId: string;
  canceladaPorId: string;
  canceladaPorNome: string;
  autorizadoPorNome: string | null;
  justificativa: string;
}): void {
  void (async () => {
    const op = await buscarOpPorId(input.opId);
    if (!op) return;
    const url = opUrl(op.numero);

    // Admins/owners + atribuído OP + atribuídos das subtasks ativas
    const admins = await buscarAdminsConta(op.contaId);
    const atribuidoOp = await buscarUsuario(op.atribuidoAId);

    let atribuidosSubtasksAtivas: DestinatarioBasico[] = [];
    try {
      const rows = await db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
        })
        .from(confeccaoSubtask)
        .innerJoin(user, eq(user.id, confeccaoSubtask.atribuidoAId))
        .where(
          and(
            eq(confeccaoSubtask.ordemProducaoId, op.id),
            inArray(confeccaoSubtask.status, ["pendente", "em_andamento"]),
          ),
        );
      atribuidosSubtasksAtivas = rows.filter(
        (r): r is DestinatarioBasico => Boolean(r.email),
      );
    } catch (err) {
      console.warn(
        "[email] notificarOpCancelada subtasks ativas falhou:",
        (err as Error).message,
      );
    }

    // Deduplicação por email
    const enviados = new Set<string>();
    const destinatarios: DestinatarioBasico[] = [];
    for (const d of [...admins, atribuidoOp, ...atribuidosSubtasksAtivas]) {
      if (!d) continue;
      if (enviados.has(d.email)) continue;
      enviados.add(d.email);
      destinatarios.push(d);
    }

    for (const d of destinatarios) {
      const render = buildOpCanceladaEmail({
        destinatarioNome: d.name,
        opNumero: op.numero,
        produtoNome: op.produtoNome,
        canceladaPorNome: input.canceladaPorNome,
        autorizadoPorNome: input.autorizadoPorNome,
        justificativa: input.justificativa,
        opUrl: url,
      });
      disparar(d, render, "op-cancelada");
    }
  })();
}

// ============================================================
// 6. Retirada parcial — atribuído Conferência
// ============================================================

export function notificarRetiradaParcial(input: {
  subtaskCosturaId: string;
  retiradaNumero: string;
  oficinaNome: string;
  subconferenciaNumero: string;
  totalPecas: number;
  executorId: string;
}): void {
  void (async () => {
    const stCostura = await buscarSubtaskPorId(input.subtaskCosturaId);
    if (!stCostura) return;
    const op = await buscarOpPorId(stCostura.ordemProducaoId);
    if (!op) return;
    const stConf = await buscarConferenciaDaOP(stCostura.ordemProducaoId);
    const destId = stConf?.atribuidoAId ?? op.atribuidoAId;
    const destinatario = await buscarUsuario(destId);
    if (!destinatario) return;
    if (destinatario.id === input.executorId) return; // não notifica quem disparou
    const executor = await buscarUsuario(input.executorId);
    const render = buildRetiradaParcialEmail({
      destinatarioNome: destinatario.name,
      opNumero: op.numero,
      produtoNome: op.produtoNome,
      retiradaNumero: input.retiradaNumero,
      oficinaNome: input.oficinaNome,
      subconferenciaNumero: input.subconferenciaNumero,
      totalPecas: input.totalPecas,
      executorNome: executor?.name ?? "Sistema",
      conferenciaUrl: opUrl(op.numero),
    });
    disparar(destinatario, render, "retirada-parcial");
  })();
}
