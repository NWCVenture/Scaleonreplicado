import { sendEmail } from "@/lib/email";
import { db } from "@/lib/db";
import { user, usuarioConta, sessaoExpedicao } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";

type SessaoRow = typeof sessaoExpedicao.$inferSelect;

function formatDateTime(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return [
    h > 0 ? `${h}h` : null,
    m > 0 || h > 0 ? `${String(m).padStart(h > 0 ? 2 : 1, "0")}min` : null,
    `${String(s).padStart(2, "0")}s`,
  ]
    .filter(Boolean)
    .join(" ");
}

function buildRelatorioHtml(params: {
  sessao: SessaoRow;
  usuarioNome: string | null;
  usuarioEmail: string;
}): string {
  const { sessao, usuarioNome, usuarioEmail } = params;
  const inicio = new Date(sessao.iniciouEm);
  const fim = sessao.encerrouEm ? new Date(sessao.encerrouEm) : new Date();
  const duracao = formatDuration(fim.getTime() - inicio.getTime());

  const skusOrdenados = Object.entries(sessao.skusContagem ?? {}).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );

  const skusRows =
    skusOrdenados.length === 0
      ? `<tr><td colspan="2" style="padding:12px;text-align:center;color:#888">Nenhuma etiqueta processada nesta sessão</td></tr>`
      : skusOrdenados
          .map(
            ([sku, qtd]) => `
              <tr>
                <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-family:monospace">${sku}</td>
                <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600">${qtd}</td>
              </tr>`,
          )
          .join("");

  return `
    <div style="font-family:sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#111">
      <h2 style="color:#008000;margin:0 0 8px">Relatório de Expedição</h2>
      <p style="color:#666;margin:0 0 24px">Sessão encerrada em ${formatDateTime(fim)}</p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
        <tbody>
          <tr><td style="padding:6px 0;color:#666">Operador</td><td style="padding:6px 0;text-align:right">${usuarioNome ?? "—"} &lt;${usuarioEmail}&gt;</td></tr>
          <tr><td style="padding:6px 0;color:#666">Início</td><td style="padding:6px 0;text-align:right">${formatDateTime(inicio)}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Término</td><td style="padding:6px 0;text-align:right">${formatDateTime(fim)}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Duração</td><td style="padding:6px 0;text-align:right">${duracao}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Total de etiquetas</td><td style="padding:6px 0;text-align:right;font-weight:600;font-size:18px">${sessao.totalEtiquetas}</td></tr>
        </tbody>
      </table>

      <h3 style="margin:24px 0 12px;font-size:14px;color:#333">Etiquetas por SKU</h3>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb">
        <thead>
          <tr style="background:#f3f4f6">
            <th style="padding:8px 12px;text-align:left;font-size:12px;color:#666">SKU</th>
            <th style="padding:8px 12px;text-align:right;font-size:12px;color:#666">Qtd</th>
          </tr>
        </thead>
        <tbody>${skusRows}</tbody>
      </table>

      <p style="color:#999;font-size:12px;margin-top:32px">
        Este email foi enviado automaticamente pelo módulo de Expedição Diária.
      </p>
    </div>`;
}

// Lista emails dos administradores (owner/admin) da conta
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

export async function enviarRelatorioSessao(
  sessao: SessaoRow,
): Promise<{ sent: number; failed: number }> {
  const [operador] = await db
    .select({ name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, sessao.usuarioId));

  if (!operador?.email) {
    return { sent: 0, failed: 1 };
  }

  const html = buildRelatorioHtml({
    sessao,
    usuarioNome: operador.name,
    usuarioEmail: operador.email,
  });

  const subject = `Relatório de Expedição · ${sessao.totalEtiquetas} etiqueta(s) · ${operador.name ?? operador.email}`;

  // Destinatários: operador + admins (deduplicados)
  const adminEmails = await listarEmailsAdmins(sessao.contaId);
  const destinatarios = Array.from(
    new Set([operador.email, ...adminEmails].filter(Boolean)),
  );

  let sent = 0;
  let failed = 0;
  for (const to of destinatarios) {
    try {
      await sendEmail({ to, subject, html });
      sent++;
    } catch (err) {
      console.error(`[sessao-relatorio] falha ao enviar pra ${to}:`, err);
      failed++;
    }
  }
  return { sent, failed };
}
