import { sendEmail } from "@/lib/email";
import { db } from "@/lib/db";
import {
  user,
  usuarioConta,
  sessaoExpedicao,
  historicoImpressaoEtiquetas,
} from "@/lib/db/schema";
import { and, eq, gte, inArray } from "drizzle-orm";

type SessaoRow = typeof sessaoExpedicao.$inferSelect;

export type RelatorioPayload = {
  inicio: Date;
  fim: Date;
  totalEtiquetas: number;
  skusContagem: Record<string, number>;
  usuarioNome: string | null;
  usuarioEmail: string;
};

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

export function buildRelatorioHtml(p: RelatorioPayload): string {
  const duracao = formatDuration(p.fim.getTime() - p.inicio.getTime());

  const skusOrdenados = Object.entries(p.skusContagem ?? {}).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );

  const skusRows =
    skusOrdenados.length === 0
      ? `<tr><td colspan="2" style="padding:12px;text-align:center;color:#888">Nenhuma etiqueta processada no período</td></tr>`
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
      <p style="color:#666;margin:0 0 24px">Gerado em ${formatDateTime(p.fim)}</p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
        <tbody>
          <tr><td style="padding:6px 0;color:#666">Operador</td><td style="padding:6px 0;text-align:right">${p.usuarioNome ?? "—"} &lt;${p.usuarioEmail}&gt;</td></tr>
          <tr><td style="padding:6px 0;color:#666">Início do período</td><td style="padding:6px 0;text-align:right">${formatDateTime(p.inicio)}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Fim do período</td><td style="padding:6px 0;text-align:right">${formatDateTime(p.fim)}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Duração</td><td style="padding:6px 0;text-align:right">${duracao}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Total de etiquetas</td><td style="padding:6px 0;text-align:right;font-weight:600;font-size:18px">${p.totalEtiquetas}</td></tr>
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
        Este email foi gerado pelo módulo de Expedição Diária.
      </p>
    </div>`;
}

// Lista emails dos administradores (owner/admin) ativos da conta
export async function listarEmailsAdmins(contaId: string): Promise<string[]> {
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

// Agrega contagem de etiquetas e SKUs do operador a partir do histórico
// dentro do intervalo informado (since → agora). Usa skus_count gravado
// em cada linha do histórico — atualizado pelo POST do histórico.
export async function agregarRelatorioPorPeriodo(params: {
  contaId: string;
  usuarioId: string;
  since: Date;
}): Promise<{ totalEtiquetas: number; skusContagem: Record<string, number> }> {
  const rows = await db
    .select({
      pageCount: historicoImpressaoEtiquetas.pageCount,
      skusCount: historicoImpressaoEtiquetas.skusCount,
    })
    .from(historicoImpressaoEtiquetas)
    .where(
      and(
        eq(historicoImpressaoEtiquetas.contaId, params.contaId),
        eq(historicoImpressaoEtiquetas.usuarioId, params.usuarioId),
        gte(historicoImpressaoEtiquetas.createdAt, params.since),
      ),
    );

  let totalEtiquetas = 0;
  const skusContagem: Record<string, number> = {};
  for (const r of rows) {
    totalEtiquetas += r.pageCount ?? 0;
    const sk = (r.skusCount as Record<string, number> | null) ?? {};
    for (const [sku, qtd] of Object.entries(sk)) {
      const n = Number(qtd);
      if (Number.isFinite(n) && n > 0) {
        skusContagem[sku] = (skusContagem[sku] ?? 0) + n;
      }
    }
  }
  return { totalEtiquetas, skusContagem };
}

// Versão genérica usada pelo botão "Enviar Relatório" — recebe a lista
// de destinatários direto do front, agrega o histórico no período e
// despacha o email pra cada um.
export async function enviarRelatorio(params: {
  contaId: string;
  usuarioId: string;
  destinatarios: string[];
  since: Date;
  ate?: Date;
}): Promise<{ sent: number; failed: number; totalEtiquetas: number }> {
  const ate = params.ate ?? new Date();
  const [operador] = await db
    .select({ name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, params.usuarioId));
  if (!operador?.email) return { sent: 0, failed: 1, totalEtiquetas: 0 };

  const { totalEtiquetas, skusContagem } = await agregarRelatorioPorPeriodo({
    contaId: params.contaId,
    usuarioId: params.usuarioId,
    since: params.since,
  });

  const html = buildRelatorioHtml({
    inicio: params.since,
    fim: ate,
    totalEtiquetas,
    skusContagem,
    usuarioNome: operador.name,
    usuarioEmail: operador.email,
  });

  const subject = `Relatório de Expedição · ${totalEtiquetas} etiqueta(s) · ${operador.name ?? operador.email}`;

  const destinatarios = Array.from(
    new Set(
      params.destinatarios
        .map((d) => d.trim())
        .filter((d) => d.length > 0 && d.includes("@")),
    ),
  );

  let sent = 0;
  let failed = 0;
  for (const to of destinatarios) {
    try {
      await sendEmail({ to, subject, html });
      sent++;
    } catch (err) {
      console.error(`[expedicao-relatorio] falha ao enviar pra ${to}:`, err);
      failed++;
    }
  }
  return { sent, failed, totalEtiquetas };
}

// Compatibilidade com fluxo antigo de sessão: monta o relatório a partir
// dos contadores armazenados em sessao_expedicao. Mantido pra histórico
// (POST /sessao/[id]/encerrar ainda chama isso).
export async function enviarRelatorioSessao(
  sessao: SessaoRow,
): Promise<{ sent: number; failed: number }> {
  const [operador] = await db
    .select({ name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, sessao.usuarioId));
  if (!operador?.email) return { sent: 0, failed: 1 };

  const inicio = new Date(sessao.iniciouEm);
  const fim = sessao.encerrouEm ? new Date(sessao.encerrouEm) : new Date();

  const html = buildRelatorioHtml({
    inicio,
    fim,
    totalEtiquetas: sessao.totalEtiquetas,
    skusContagem: sessao.skusContagem ?? {},
    usuarioNome: operador.name,
    usuarioEmail: operador.email,
  });

  const subject = `Relatório de Expedição · ${sessao.totalEtiquetas} etiqueta(s) · ${operador.name ?? operador.email}`;

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
