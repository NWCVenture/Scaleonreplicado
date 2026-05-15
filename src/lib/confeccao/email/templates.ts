// Templates de email do módulo Confecção (RITM-17).
//
// Cada função `build*Email` retorna `{ subject, html, text }`. São puras:
// recebem dados já carregados do banco e formatam. Sem deps externas, sem
// I/O.
//
// Convenções:
//  - HTML inline-styled (clientes de email frequentemente ignoram CSS externo)
//  - Cores compatíveis com o tema verde do projeto
//  - Plain text espelha o conteúdo do HTML em formato simples (clientes
//    sem render de HTML ainda recebem informação útil)
//  - Sem emojis (mantém ascético e profissional)

export interface EmailRender {
  subject: string;
  html: string;
  text: string;
}

interface BotaoLinkParams {
  href: string;
  label: string;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function botao({ href, label }: BotaoLinkParams): string {
  const hrefSafe = escapeHtml(href);
  const labelSafe = escapeHtml(label);
  return `<a href="${hrefSafe}" style="display:inline-block;margin:24px 0;padding:12px 28px;background:#008000;color:#fff;border-radius:6px;text-decoration:none;font-weight:bold">${labelSafe}</a>`;
}

function envelope(opts: {
  titulo: string;
  saudacao?: string;
  paragrafos: string[];
  cta?: BotaoLinkParams;
  rodape?: string;
}): string {
  const partes: string[] = [];
  partes.push(
    `<h2 style="color:#008000;margin:0 0 12px 0">${escapeHtml(opts.titulo)}</h2>`,
  );
  if (opts.saudacao) {
    partes.push(`<p>${escapeHtml(opts.saudacao)}</p>`);
  }
  for (const p of opts.paragrafos) {
    partes.push(`<p>${p}</p>`);
  }
  if (opts.cta) {
    partes.push(botao(opts.cta));
  }
  if (opts.rodape) {
    partes.push(
      `<p style="color:#666;font-size:13px;margin-top:24px">${escapeHtml(opts.rodape)}</p>`,
    );
  }
  return `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px;line-height:1.5">${partes.join("")}</div>`;
}

function plain(linhas: string[]): string {
  return linhas.filter(Boolean).join("\n");
}

// ============================================================
// 1. OP criada — atribuído
// ============================================================

export interface OpCriadaParams {
  destinatarioNome: string;
  opNumero: string;
  produtoNome: string;
  temVies: boolean;
  criadorNome: string;
  opUrl: string;
}

export function buildOpCriadaEmail(params: OpCriadaParams): EmailRender {
  const subject = `Nova OP atribuída: ${params.opNumero} — ${params.produtoNome}`;
  const html = envelope({
    titulo: "Nova OP atribuída a você",
    saudacao: `Olá, ${params.destinatarioNome}.`,
    paragrafos: [
      `A OP <strong>${escapeHtml(params.opNumero)}</strong> (${escapeHtml(params.produtoNome)}) foi criada por ${escapeHtml(params.criadorNome)} e atribuída a você.`,
      params.temVies
        ? "Esta OP <strong>tem Viés</strong> — o fluxo passa por OPBUY → OPRIS → OPCOR → OPVIE → OPSEW → OPCONF."
        : "Fluxo: OPBUY → OPRIS → OPCOR → OPSEW → OPCONF.",
    ],
    cta: { href: params.opUrl, label: "Abrir OP" },
    rodape: "Você pode reatribuir a OP no header da tela da OP.",
  });
  const text = plain([
    "Nova OP atribuída a você",
    "",
    `Olá, ${params.destinatarioNome}.`,
    `A OP ${params.opNumero} (${params.produtoNome}) foi criada por ${params.criadorNome} e atribuída a você.`,
    params.temVies
      ? "Esta OP tem Viés — fluxo: OPBUY → OPRIS → OPCOR → OPVIE → OPSEW → OPCONF."
      : "Fluxo: OPBUY → OPRIS → OPCOR → OPSEW → OPCONF.",
    "",
    `Abrir: ${params.opUrl}`,
  ]);
  return { subject, html, text };
}

// ============================================================
// 2. Subtask concluída — atribuído da próxima
// ============================================================

export interface SubtaskConcluidaProximoParams {
  destinatarioNome: string;
  opNumero: string;
  produtoNome: string;
  subtaskAnteriorNumero: string;
  subtaskProximaNumero: string;
  subtaskProximaPrefixo: string;
  executorNome: string;
  opUrl: string;
}

export function buildSubtaskConcluidaProximoEmail(
  params: SubtaskConcluidaProximoParams,
): EmailRender {
  const subject = `${params.subtaskProximaNumero} desbloqueada — OP ${params.opNumero}`;
  const html = envelope({
    titulo: "Subtask desbloqueada",
    saudacao: `Olá, ${params.destinatarioNome}.`,
    paragrafos: [
      `A subtask <strong>${escapeHtml(params.subtaskAnteriorNumero)}</strong> da OP <strong>${escapeHtml(params.opNumero)}</strong> (${escapeHtml(params.produtoNome)}) foi concluída por ${escapeHtml(params.executorNome)}.`,
      `Sua subtask <strong>${escapeHtml(params.subtaskProximaNumero)}</strong> (${escapeHtml(params.subtaskProximaPrefixo)}) está agora <strong>pendente</strong> e pode ser iniciada.`,
    ],
    cta: { href: params.opUrl, label: "Abrir OP" },
  });
  const text = plain([
    "Subtask desbloqueada",
    "",
    `Olá, ${params.destinatarioNome}.`,
    `${params.subtaskAnteriorNumero} da OP ${params.opNumero} (${params.produtoNome}) foi concluída por ${params.executorNome}.`,
    `Sua subtask ${params.subtaskProximaNumero} (${params.subtaskProximaPrefixo}) está pendente.`,
    "",
    `Abrir: ${params.opUrl}`,
  ]);
  return { subject, html, text };
}

// ============================================================
// 2b. Subtask concluída — atribuído anterior (ciência)
// ============================================================

export interface SubtaskConcluidaAnteriorParams {
  destinatarioNome: string;
  opNumero: string;
  produtoNome: string;
  subtaskNumero: string;
  executorNome: string;
  opUrl: string;
}

export function buildSubtaskConcluidaAnteriorEmail(
  params: SubtaskConcluidaAnteriorParams,
): EmailRender {
  const subject = `Sua subtask ${params.subtaskNumero} foi concluída`;
  const html = envelope({
    titulo: "Subtask concluída",
    saudacao: `Olá, ${params.destinatarioNome}.`,
    paragrafos: [
      `Sua subtask <strong>${escapeHtml(params.subtaskNumero)}</strong> (OP ${escapeHtml(params.opNumero)} — ${escapeHtml(params.produtoNome)}) foi concluída por ${escapeHtml(params.executorNome)}.`,
    ],
    cta: { href: params.opUrl, label: "Ver OP" },
  });
  const text = plain([
    "Subtask concluída",
    "",
    `Olá, ${params.destinatarioNome}.`,
    `Sua subtask ${params.subtaskNumero} (OP ${params.opNumero} — ${params.produtoNome}) foi concluída por ${params.executorNome}.`,
    "",
    `Ver: ${params.opUrl}`,
  ]);
  return { subject, html, text };
}

// ============================================================
// 3. OP concluída — admins + atribuído
// ============================================================

export interface OpConcluidaParams {
  destinatarioNome: string;
  opNumero: string;
  produtoNome: string;
  executorNome: string;
  opUrl: string;
}

export function buildOpConcluidaEmail(params: OpConcluidaParams): EmailRender {
  const subject = `OP ${params.opNumero} concluída — ${params.produtoNome}`;
  const html = envelope({
    titulo: "OP concluída",
    saudacao: `Olá, ${params.destinatarioNome}.`,
    paragrafos: [
      `A OP <strong>${escapeHtml(params.opNumero)}</strong> (${escapeHtml(params.produtoNome)}) foi finalizada — todas as subtasks foram concluídas. A última transição foi feita por ${escapeHtml(params.executorNome)}.`,
      "Acesse a aba Evidências de Pagamento da OP para revisar custos e comprovantes.",
    ],
    cta: { href: params.opUrl, label: "Ver OP" },
  });
  const text = plain([
    "OP concluída",
    "",
    `Olá, ${params.destinatarioNome}.`,
    `A OP ${params.opNumero} (${params.produtoNome}) foi finalizada por ${params.executorNome}.`,
    "Acesse a aba Evidências de Pagamento da OP para revisar custos e comprovantes.",
    "",
    `Ver: ${params.opUrl}`,
  ]);
  return { subject, html, text };
}

// ============================================================
// 4 & 5. Atribuído alterado (OP ou subtask)
// ============================================================

export interface AtribuidoMudouNovoParams {
  destinatarioNome: string;
  alvoLabel: string; // ex: "OP OP05260001" ou "subtask OPBUY0001 da OP OP05260001"
  produtoNome: string;
  editorNome: string;
  url: string;
}

export function buildAtribuidoMudouNovoEmail(
  params: AtribuidoMudouNovoParams,
): EmailRender {
  const subject = `Atribuído a você: ${params.alvoLabel}`;
  const html = envelope({
    titulo: "Você é o novo responsável",
    saudacao: `Olá, ${params.destinatarioNome}.`,
    paragrafos: [
      `Você foi atribuído à <strong>${escapeHtml(params.alvoLabel)}</strong> (${escapeHtml(params.produtoNome)}) por ${escapeHtml(params.editorNome)}.`,
    ],
    cta: { href: params.url, label: "Abrir" },
  });
  const text = plain([
    "Você é o novo responsável",
    "",
    `Olá, ${params.destinatarioNome}.`,
    `Você foi atribuído à ${params.alvoLabel} (${params.produtoNome}) por ${params.editorNome}.`,
    "",
    `Abrir: ${params.url}`,
  ]);
  return { subject, html, text };
}

export interface AtribuidoMudouAnteriorParams {
  destinatarioNome: string;
  alvoLabel: string;
  produtoNome: string;
  novoAtribuidoNome: string;
  editorNome: string;
  url: string;
}

export function buildAtribuidoMudouAnteriorEmail(
  params: AtribuidoMudouAnteriorParams,
): EmailRender {
  const subject = `Você não é mais o responsável: ${params.alvoLabel}`;
  const html = envelope({
    titulo: "Atribuição transferida",
    saudacao: `Olá, ${params.destinatarioNome}.`,
    paragrafos: [
      `${escapeHtml(params.editorNome)} transferiu <strong>${escapeHtml(params.alvoLabel)}</strong> (${escapeHtml(params.produtoNome)}) de você para <strong>${escapeHtml(params.novoAtribuidoNome)}</strong>.`,
    ],
    cta: { href: params.url, label: "Ver" },
  });
  const text = plain([
    "Atribuição transferida",
    "",
    `Olá, ${params.destinatarioNome}.`,
    `${params.editorNome} transferiu ${params.alvoLabel} (${params.produtoNome}) de você para ${params.novoAtribuidoNome}.`,
    "",
    `Ver: ${params.url}`,
  ]);
  return { subject, html, text };
}

// ============================================================
// 6b. OP cancelada — admins + atribuído + atribuídos de subtasks ativas
// ============================================================

export interface OpCanceladaParams {
  destinatarioNome: string;
  opNumero: string;
  produtoNome: string;
  canceladaPorNome: string;
  autorizadoPorNome: string | null;
  justificativa: string;
  opUrl: string;
}

export function buildOpCanceladaEmail(
  params: OpCanceladaParams,
): EmailRender {
  const subject = `OP ${params.opNumero} cancelada`;
  const linhasJustificativa = params.justificativa
    .split(/\n+/)
    .map((l) => `<p style="margin:0">${escapeHtml(l)}</p>`)
    .join("");
  const paragrafos: string[] = [
    `A OP <strong>${escapeHtml(params.opNumero)}</strong> (${escapeHtml(params.produtoNome)}) foi cancelada por ${escapeHtml(params.canceladaPorNome)}${params.autorizadoPorNome ? `, com autorização de ${escapeHtml(params.autorizadoPorNome)}` : ""}.`,
    `<strong>Justificativa:</strong></p>${linhasJustificativa}<p>Esta ação é definitiva — a OP não pode ser reaberta. Custos e materiais já registrados ficam categorizados como "Cancelados ${escapeHtml(params.opNumero)}" para contabilidade separada.`,
  ];
  const html = envelope({
    titulo: "OP cancelada",
    saudacao: `Olá, ${params.destinatarioNome}.`,
    paragrafos,
    cta: { href: params.opUrl, label: "Ver OP" },
  });
  const text = plain([
    "OP cancelada",
    "",
    `Olá, ${params.destinatarioNome}.`,
    `A OP ${params.opNumero} (${params.produtoNome}) foi cancelada por ${params.canceladaPorNome}${params.autorizadoPorNome ? ` com autorização de ${params.autorizadoPorNome}` : ""}.`,
    "",
    `Justificativa: ${params.justificativa}`,
    "",
    "Esta ação é definitiva — a OP não pode ser reaberta.",
    "",
    `Ver: ${params.opUrl}`,
  ]);
  return { subject, html, text };
}

// ============================================================
// 6. Retirada parcial — atribuído Conferência
// ============================================================

export interface RetiradaParcialParams {
  destinatarioNome: string;
  opNumero: string;
  produtoNome: string;
  retiradaNumero: string;
  oficinaNome: string;
  subconferenciaNumero: string;
  totalPecas: number;
  executorNome: string;
  conferenciaUrl: string;
}

export function buildRetiradaParcialEmail(
  params: RetiradaParcialParams,
): EmailRender {
  const subject = `Nova retirada parcial — OP ${params.opNumero}`;
  const html = envelope({
    titulo: "Retirada parcial registrada",
    saudacao: `Olá, ${params.destinatarioNome}.`,
    paragrafos: [
      `${escapeHtml(params.executorNome)} registrou a retirada <strong>${escapeHtml(params.retiradaNumero)}</strong> da oficina ${escapeHtml(params.oficinaNome)} (OP ${escapeHtml(params.opNumero)} — ${escapeHtml(params.produtoNome)}), totalizando <strong>${params.totalPecas}</strong> peças.`,
      `A subconferência <strong>${escapeHtml(params.subconferenciaNumero)}</strong> está aberta na subtask de Conferência para você fazer a contagem.`,
    ],
    cta: { href: params.conferenciaUrl, label: "Abrir Conferência" },
  });
  const text = plain([
    "Retirada parcial registrada",
    "",
    `Olá, ${params.destinatarioNome}.`,
    `${params.executorNome} registrou ${params.retiradaNumero} da oficina ${params.oficinaNome} (OP ${params.opNumero} — ${params.produtoNome}), ${params.totalPecas} peças.`,
    `Subconferência ${params.subconferenciaNumero} aberta.`,
    "",
    `Abrir: ${params.conferenciaUrl}`,
  ]);
  return { subject, html, text };
}

// ============================================================
// 7. Alerta — prazo vencendo em 24h (atribuído da Costura)
// ============================================================

export interface AlertaPrazoVencendoParams {
  destinatarioNome: string;
  opNumero: string;
  produtoNome: string;
  oficinaNome: string;
  prazoProducaoFormatado: string; // ex: "15/05/2026 18:00"
  opUrl: string;
}

export function buildAlertaPrazoVencendoEmail(
  params: AlertaPrazoVencendoParams,
): EmailRender {
  const subject = `Prazo vencendo em 24h — OP ${params.opNumero}`;
  const html = envelope({
    titulo: "Prazo vencendo em 24h",
    saudacao: `Olá, ${params.destinatarioNome}.`,
    paragrafos: [
      `O prazo de produção da oficina <strong>${escapeHtml(params.oficinaNome)}</strong> na OP <strong>${escapeHtml(params.opNumero)}</strong> (${escapeHtml(params.produtoNome)}) vence em menos de 24 horas: <strong>${escapeHtml(params.prazoProducaoFormatado)}</strong>.`,
      "Confirme o status da oficina ou registre a retirada final antes do vencimento.",
    ],
    cta: { href: params.opUrl, label: "Abrir OP" },
  });
  const text = plain([
    "Prazo vencendo em 24h",
    "",
    `Olá, ${params.destinatarioNome}.`,
    `O prazo da oficina ${params.oficinaNome} na OP ${params.opNumero} (${params.produtoNome}) vence em menos de 24h: ${params.prazoProducaoFormatado}.`,
    "Confirme o status ou registre a retirada final.",
    "",
    `Abrir: ${params.opUrl}`,
  ]);
  return { subject, html, text };
}

// ============================================================
// 8. Alerta — prazo vencido (atribuído + admins, re-emitido diariamente)
// ============================================================

export interface AlertaPrazoVencidoParams {
  destinatarioNome: string;
  opNumero: string;
  produtoNome: string;
  oficinaNome: string;
  prazoProducaoFormatado: string;
  diasAtraso: number; // 0 = vence hoje, 1+ = atrasado
  opUrl: string;
}

export function buildAlertaPrazoVencidoEmail(
  params: AlertaPrazoVencidoParams,
): EmailRender {
  const sufixoDias =
    params.diasAtraso <= 0
      ? "(vence hoje)"
      : params.diasAtraso === 1
        ? "(1 dia de atraso)"
        : `(${params.diasAtraso} dias de atraso)`;
  const subject = `Prazo vencido — OP ${params.opNumero} ${sufixoDias}`;
  const html = envelope({
    titulo: "Prazo de produção vencido",
    saudacao: `Olá, ${params.destinatarioNome}.`,
    paragrafos: [
      `O prazo da oficina <strong>${escapeHtml(params.oficinaNome)}</strong> na OP <strong>${escapeHtml(params.opNumero)}</strong> (${escapeHtml(params.produtoNome)}) <strong>${escapeHtml(sufixoDias)}</strong>: ${escapeHtml(params.prazoProducaoFormatado)}.`,
      "Por favor verifique o status, contate a oficina e registre a retirada final quando concluída.",
    ],
    cta: { href: params.opUrl, label: "Abrir OP" },
    rodape:
      "Este alerta é re-enviado diariamente enquanto a oficina não for finalizada.",
  });
  const text = plain([
    "Prazo de produção vencido",
    "",
    `Olá, ${params.destinatarioNome}.`,
    `Oficina ${params.oficinaNome} na OP ${params.opNumero} (${params.produtoNome}) ${sufixoDias}: ${params.prazoProducaoFormatado}.`,
    "Verifique o status, contate a oficina e registre a retirada final quando concluída.",
    "",
    `Abrir: ${params.opUrl}`,
    "",
    "Este alerta é re-enviado diariamente enquanto a oficina não for finalizada.",
  ]);
  return { subject, html, text };
}
