import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { user, usuarioConta, type SessaoColetas } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email";
import type { DevolucaoFormData } from "@/types/coletas";

const TIPO_DISPLAY: Record<string, string> = {
  FLEX: "Flex",
  COLETA: "Coleta",
  DEVOLUCAO: "Devolução",
  CANCELADO: "Cancelado",
};

const CONTA_DISPLAY: Record<string, string> = {
  TIKTOK_SHOP: "TikTok Shop",
  MERCADO_LIVRE: "Mercado Livre",
  SHOPEE: "Shopee",
};

function formatDateTime(d: Date): string {
  return d.toLocaleString("pt-BR");
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type DevolucoesMap = Record<string, DevolucaoFormData>;

function agruparSkusDevolucao(devolucoes: DevolucoesMap): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const dev of Object.values(devolucoes)) {
    for (const line of dev.skuLines ?? []) {
      if (!line.sku) continue;
      totals[line.sku] = (totals[line.sku] || 0) + (line.qtd || 0);
    }
  }
  return totals;
}

export function buildResumoTxt(sessao: SessaoColetas): string {
  const pacotes = (sessao.pacotes ?? []) as string[];
  const devolucoes = (sessao.devolucoesData ?? {}) as unknown as DevolucoesMap;
  const inicio = new Date(sessao.iniciouEm);
  const fim = sessao.encerrouEm ? new Date(sessao.encerrouEm) : new Date();

  let out = "";
  out += "RESUMO DA SESSAO DE COLETAS\n";
  out += "----------------------------------------\n";
  out += `Tipo        : ${TIPO_DISPLAY[sessao.tipo] ?? sessao.tipo}\n`;
  out += `Conta       : ${CONTA_DISPLAY[sessao.conta] ?? sessao.conta}\n`;
  out += `Iniciada em : ${formatDateTime(inicio)}\n`;
  out += `Encerrada em: ${sessao.encerrouEm ? formatDateTime(fim) : "(em andamento)"}\n`;
  out += `Total       : ${pacotes.length} pacote(s)\n`;
  out += "\n";

  const isDevType = sessao.tipo === "DEVOLUCAO" || sessao.tipo === "CANCELADO";
  if (isDevType) {
    const skuTotals = agruparSkusDevolucao(devolucoes);
    const skus = Object.entries(skuTotals).sort((a, b) => b[1] - a[1]);
    if (skus.length > 0) {
      out += "SKUs DEVOLVIDOS\n";
      out += "----------------------------------------\n";
      for (const [sku, qtd] of skus) {
        out += `${sku.padEnd(20)} = ${qtd}\n`;
      }
      out += "\n";
    }
  }

  out += "PACOTES\n";
  out += "----------------------------------------\n";
  for (const codigo of pacotes) {
    const hasDevolucao = devolucoes[codigo];
    out += `${codigo}${hasDevolucao ? " [devolucao]" : ""}\n`;
  }

  return out;
}

export function buildResumoHtml(params: {
  sessao: SessaoColetas;
  operadorNome: string | null;
  operadorEmail: string;
}): string {
  const { sessao, operadorNome, operadorEmail } = params;
  const pacotes = (sessao.pacotes ?? []) as string[];
  const devolucoes = (sessao.devolucoesData ?? {}) as unknown as DevolucoesMap;
  const inicio = new Date(sessao.iniciouEm);
  const fim = sessao.encerrouEm ? new Date(sessao.encerrouEm) : new Date();

  const isDevType = sessao.tipo === "DEVOLUCAO" || sessao.tipo === "CANCELADO";
  const skuTotals = isDevType ? agruparSkusDevolucao(devolucoes) : {};
  const skuRows = Object.entries(skuTotals)
    .sort((a, b) => b[1] - a[1])
    .map(
      ([sku, qtd]) => `
        <tr>
          <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-family:monospace">${escapeHtml(sku)}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600">${qtd}</td>
        </tr>`,
    )
    .join("");

  const pacotesHtml = pacotes
    .map(
      (codigo) =>
        `<li style="font-family:monospace;padding:3px 0">${escapeHtml(codigo)}${
          devolucoes[codigo] ? ' <span style="color:#059669;font-size:11px">[devolução]</span>' : ""
        }</li>`,
    )
    .join("");

  const operadorLinha = operadorNome
    ? `${escapeHtml(operadorNome)} &lt;${escapeHtml(operadorEmail)}&gt;`
    : escapeHtml(operadorEmail);

  return `
    <div style="font-family:sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#111">
      <h2 style="color:#008000;margin:0 0 8px">Resumo da Sessão de Coletas</h2>
      <p style="color:#666;margin:0 0 24px">Gerado em ${formatDateTime(new Date())}</p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
        <tbody>
          <tr><td style="padding:6px 0;color:#666">Operador</td><td style="padding:6px 0;text-align:right">${operadorLinha}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Tipo</td><td style="padding:6px 0;text-align:right">${escapeHtml(TIPO_DISPLAY[sessao.tipo] ?? sessao.tipo)}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Conta</td><td style="padding:6px 0;text-align:right">${escapeHtml(CONTA_DISPLAY[sessao.conta] ?? sessao.conta)}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Início</td><td style="padding:6px 0;text-align:right">${formatDateTime(inicio)}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Encerramento</td><td style="padding:6px 0;text-align:right">${sessao.encerrouEm ? formatDateTime(fim) : "(em andamento)"}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Total de pacotes</td><td style="padding:6px 0;text-align:right;font-weight:600;font-size:18px">${pacotes.length}</td></tr>
        </tbody>
      </table>

      ${
        skuRows
          ? `
      <h3 style="margin:24px 0 12px;font-size:14px;color:#333">SKUs devolvidos</h3>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;margin-bottom:24px">
        <thead>
          <tr style="background:#f3f4f6">
            <th style="padding:8px 12px;text-align:left;font-size:12px;color:#666">SKU</th>
            <th style="padding:8px 12px;text-align:right;font-size:12px;color:#666">Qtd</th>
          </tr>
        </thead>
        <tbody>${skuRows}</tbody>
      </table>`
          : ""
      }

      <h3 style="margin:24px 0 12px;font-size:14px;color:#333">Pacotes</h3>
      <ul style="list-style:none;padding:0;margin:0;max-height:400px;overflow:auto;border:1px solid #e5e7eb;padding:12px">
        ${pacotesHtml || '<li style="color:#888;font-style:italic">Nenhum pacote bipado</li>'}
      </ul>

      <p style="color:#999;font-size:12px;margin-top:32px">
        O arquivo TXT em anexo contém o mesmo resumo em formato plano.
        Email gerado automaticamente pelo módulo de Coletas.
      </p>
    </div>`;
}

async function listarEmailsAdmins(contaId: string): Promise<string[]> {
  const admins = await db
    .select({ email: user.email })
    .from(usuarioConta)
    .innerJoin(user, eq(usuarioConta.usuarioId, user.id))
    .where(
      and(
        eq(usuarioConta.contaId, contaId),
        eq(usuarioConta.ativo, true),
        inArray(usuarioConta.papel, ["owner", "admin"]),
      ),
    );
  return admins.map((a) => a.email).filter(Boolean);
}

export async function enviarRelatorioColetas(
  sessao: SessaoColetas,
): Promise<{ sent: number; failed: number; destinatarios: string[] }> {
  const [operador] = await db
    .select({ name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, sessao.usuarioId));

  if (!operador?.email) {
    return { sent: 0, failed: 1, destinatarios: [] };
  }

  const html = buildResumoHtml({
    sessao,
    operadorNome: operador.name,
    operadorEmail: operador.email,
  });
  const txt = buildResumoTxt(sessao);
  const pacotes = (sessao.pacotes ?? []) as string[];
  const dataStr = new Date().toISOString().split("T")[0];
  const tipoLabel = TIPO_DISPLAY[sessao.tipo] ?? sessao.tipo;
  const subject = `Coletas · ${tipoLabel} · ${pacotes.length} pacote(s) · ${operador.name ?? operador.email}`;

  const adminEmails = await listarEmailsAdmins(sessao.contaId);
  const destinatarios = Array.from(
    new Set([operador.email, ...adminEmails].filter(Boolean)),
  );

  let sent = 0;
  let failed = 0;
  for (const to of destinatarios) {
    try {
      await sendEmail({
        to,
        subject,
        html,
        text: txt,
        attachments: [
          {
            filename: `coletas_${sessao.tipo.toLowerCase()}_${dataStr}.txt`,
            content: txt,
            contentType: "text/plain",
          },
        ],
      });
      sent++;
    } catch (err) {
      console.error(`[coletas-sessao] falha ao enviar pra ${to}:`, err);
      failed++;
    }
  }

  return { sent, failed, destinatarios };
}
