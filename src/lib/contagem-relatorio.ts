import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { user, usuarioConta } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email";

export type ContagemItem = {
  sku: string;
  lote: string;
  quantidade: number;
  createdAt: string | Date;
};

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildRelatorioTxt(
  items: ContagemItem[],
  geradoEm: Date = new Date(),
): string {
  let report = "";
  report += "RELATORIO DE BALANCO DE ESTOQUE\n";
  report += `Gerado em: ${geradoEm.toLocaleString("pt-BR")}\n`;
  report += "----------------------------------------\n\n";

  report += "RESUMO POR COR/PRODUTO\n";
  report += "----------------------------------------\n";
  const byColor: Record<string, number> = {};
  for (const item of items) {
    const parts = item.sku.split(" ");
    if (parts.length >= 2) {
      const key = `${parts[0]} - ${parts[1]}`;
      byColor[key] = (byColor[key] || 0) + item.quantidade;
    } else {
      byColor["OUTROS"] = (byColor["OUTROS"] || 0) + item.quantidade;
    }
  }
  for (const [key, total] of Object.entries(byColor).sort()) {
    report += `${key.padEnd(20)}: ${total} pecas\n`;
  }
  report += "\n";

  report += "SOMA DOS ESTOQUES POR SKU\n";
  report += "----------------------------------------\n";
  const bySku: Record<string, number> = {};
  for (const item of items) {
    bySku[item.sku] = (bySku[item.sku] || 0) + item.quantidade;
  }
  for (const [sku, total] of Object.entries(bySku).sort()) {
    report += `${sku.padEnd(20)} = ${total}\n`;
  }
  report += "\n";

  report += "RELATORIO DE BIPAGEM (DETALHADO)\n";
  report += "----------------------------------------\n";
  report += "HORA      | SKU                  | QTD | LOTE\n";
  const ordered = [...items].sort(
    (a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  for (const item of ordered) {
    const time = new Date(item.createdAt).toLocaleTimeString("pt-BR");
    report += `${time}  | ${item.sku.padEnd(20)} | ${String(item.quantidade).padEnd(3)} | ${item.lote}\n`;
  }

  return report;
}

export function buildRelatorioHtml(params: {
  items: ContagemItem[];
  operadorNome: string | null;
  operadorEmail: string;
  geradoEm?: Date;
}): string {
  const geradoEm = params.geradoEm ?? new Date();

  const byColor: Record<string, number> = {};
  const bySku: Record<string, number> = {};
  let totalPecas = 0;
  for (const item of params.items) {
    totalPecas += item.quantidade;
    const parts = item.sku.split(" ");
    const colorKey =
      parts.length >= 2 ? `${parts[0]} - ${parts[1]}` : "OUTROS";
    byColor[colorKey] = (byColor[colorKey] || 0) + item.quantidade;
    bySku[item.sku] = (bySku[item.sku] || 0) + item.quantidade;
  }

  const colorRows = Object.entries(byColor)
    .sort()
    .map(
      ([key, total]) => `
        <tr>
          <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb">${escapeHtml(key)}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600">${total}</td>
        </tr>`,
    )
    .join("");

  const skuRows = Object.entries(bySku)
    .sort()
    .map(
      ([sku, total]) => `
        <tr>
          <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-family:monospace">${escapeHtml(sku)}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600">${total}</td>
        </tr>`,
    )
    .join("");

  const operadorLinha = params.operadorNome
    ? `${escapeHtml(params.operadorNome)} &lt;${escapeHtml(params.operadorEmail)}&gt;`
    : escapeHtml(params.operadorEmail);

  return `
    <div style="font-family:sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#111">
      <h2 style="color:#008000;margin:0 0 8px">Balanço de Estoque</h2>
      <p style="color:#666;margin:0 0 24px">Gerado em ${geradoEm.toLocaleString("pt-BR")}</p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
        <tbody>
          <tr><td style="padding:6px 0;color:#666">Operador</td><td style="padding:6px 0;text-align:right">${operadorLinha}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Total de fardos</td><td style="padding:6px 0;text-align:right">${params.items.length}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Total de peças</td><td style="padding:6px 0;text-align:right;font-weight:600;font-size:18px">${totalPecas}</td></tr>
        </tbody>
      </table>

      <h3 style="margin:24px 0 12px;font-size:14px;color:#333">Resumo por cor/produto</h3>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;margin-bottom:24px">
        <thead>
          <tr style="background:#f3f4f6">
            <th style="padding:8px 12px;text-align:left;font-size:12px;color:#666">Cor/Produto</th>
            <th style="padding:8px 12px;text-align:right;font-size:12px;color:#666">Peças</th>
          </tr>
        </thead>
        <tbody>${colorRows}</tbody>
      </table>

      <h3 style="margin:24px 0 12px;font-size:14px;color:#333">Soma por SKU</h3>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb">
        <thead>
          <tr style="background:#f3f4f6">
            <th style="padding:8px 12px;text-align:left;font-size:12px;color:#666">SKU</th>
            <th style="padding:8px 12px;text-align:right;font-size:12px;color:#666">Qtd</th>
          </tr>
        </thead>
        <tbody>${skuRows}</tbody>
      </table>

      <p style="color:#999;font-size:12px;margin-top:32px">
        O arquivo TXT em anexo contém o detalhamento completo das bipagens.
        Email gerado automaticamente pelo módulo de Contagem.
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

export async function enviarRelatorioContagem(params: {
  items: ContagemItem[];
  operadorId: string;
  contaId: string;
}): Promise<{ sent: number; failed: number; destinatarios: string[] }> {
  const { items, operadorId, contaId } = params;

  const [operador] = await db
    .select({ name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, operadorId));

  if (!operador?.email) {
    return { sent: 0, failed: 1, destinatarios: [] };
  }

  const geradoEm = new Date();
  const html = buildRelatorioHtml({
    items,
    operadorNome: operador.name,
    operadorEmail: operador.email,
    geradoEm,
  });
  const txt = buildRelatorioTxt(items, geradoEm);
  const dataStr = geradoEm.toISOString().split("T")[0];
  const totalPecas = items.reduce((a, i) => a + i.quantidade, 0);
  const subject = `Balanço de Estoque · ${totalPecas} peça(s) · ${operador.name ?? operador.email}`;

  const adminEmails = await listarEmailsAdmins(contaId);
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
            filename: `balanco_estoque_${dataStr}.txt`,
            content: txt,
            contentType: "text/plain",
          },
        ],
      });
      sent++;
    } catch (err) {
      console.error(`[contagem-relatorio] falha ao enviar pra ${to}:`, err);
      failed++;
    }
  }

  return { sent, failed, destinatarios };
}
