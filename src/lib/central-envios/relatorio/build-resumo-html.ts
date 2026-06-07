// Template HTML inline-styled do email de resumo de planejamento (RITM-11).
//
// Sem react-email — overkill pra 1 template. Mantemos estilo inline pra
// compat com clientes de email (Gmail, Outlook desktop).

import type { EstatisticasSessao } from "@/lib/central-envios/sessao/types";
import type { PlanejamentoSnapshotCliente } from "./types";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatarData(iso: string): string {
  // dd/MM/yyyy a partir de YYYY-MM-DD ou ISO completo
  const d = iso.slice(0, 10).split("-");
  if (d.length === 3) return `${d[2]}/${d[1]}/${d[0]}`;
  return iso;
}

function rotuloCanal(codigo: string): string {
  switch (codigo) {
    case "tiktok_shop":
      return "TikTok Shop";
    case "mercado_livre":
      return "Mercado Livre";
    case "shopee":
      return "Shopee";
    default:
      return codigo;
  }
}

function topN<T extends string>(
  contagem: Record<T, number>,
  n: number,
): Array<{ chave: T; valor: number }> {
  return (Object.entries(contagem) as Array<[T, number]>)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([chave, valor]) => ({ chave, valor }));
}

export type ResumoTexto = { html: string; text: string };

export function buildResumoHtml({
  planejamento,
  contaNome,
  detalheUrl,
}: {
  planejamento: PlanejamentoSnapshotCliente;
  contaNome: string;
  detalheUrl: string | null;
}): ResumoTexto {
  const stats = planejamento.estatisticas as EstatisticasSessao;
  const data = formatarData(planejamento.dataReferencia);
  const totalNoPrazo = stats.totalNoPrazo;
  const totalSemData = stats.totalSemData;
  const topModelos = topN(stats.porModelo, 5);
  const porCanal = (Object.entries(stats.porCanal) as Array<[string, number]>)
    .sort((a, b) => b[1] - a[1]);

  const linhasArquivos = planejamento.arquivosIngeridos
    .map(
      (a) =>
        `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee">${escapeHtml(a.arquivoNome)}</td>` +
        `<td style="padding:4px 8px;border-bottom:1px solid #eee">${a.tipo === "tiktok_csv" ? "TikTok" : "Mercado Livre"}</td>` +
        `<td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${a.linhasValidas}</td></tr>`,
    )
    .join("");

  const linhasModelos = topModelos
    .map(
      (m) =>
        `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee">${escapeHtml(m.chave)}</td>` +
        `<td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${m.valor}</td></tr>`,
    )
    .join("");

  const linhasCanais = porCanal
    .map(
      ([c, v]) =>
        `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee">${escapeHtml(rotuloCanal(c))}</td>` +
        `<td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${v}</td></tr>`,
    )
    .join("");

  const html = `
<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:640px;margin:0 auto;padding:32px;color:#111">
  <h2 style="margin:0 0 8px 0;color:#008000">Central de Envios — Planejamento ${data}</h2>
  <p style="margin:0 0 24px 0;color:#555">${escapeHtml(contaNome)}</p>

  <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-bottom:24px">
    <tr>
      <td style="padding:8px 12px;background:#f5f5f5;border-radius:6px 0 0 6px"><strong>Total</strong></td>
      <td style="padding:8px 12px;background:#f5f5f5;text-align:right;border-radius:0 6px 6px 0">${planejamento.totalPedidos}</td>
    </tr>
    <tr><td colspan="2" style="height:4px"></td></tr>
    <tr>
      <td style="padding:8px 12px;background:#fee">⚠ Atrasados</td>
      <td style="padding:8px 12px;background:#fee;text-align:right;color:#a00"><strong>${planejamento.totalAtrasados}</strong></td>
    </tr>
    <tr><td colspan="2" style="height:4px"></td></tr>
    <tr>
      <td style="padding:8px 12px;background:#fff5e6">Hoje</td>
      <td style="padding:8px 12px;background:#fff5e6;text-align:right;color:#b75"><strong>${planejamento.totalHoje}</strong></td>
    </tr>
    <tr><td colspan="2" style="height:4px"></td></tr>
    <tr>
      <td style="padding:8px 12px;background:#eef9ee">No prazo</td>
      <td style="padding:8px 12px;background:#eef9ee;text-align:right;color:#080">${totalNoPrazo}</td>
    </tr>
    <tr><td colspan="2" style="height:4px"></td></tr>
    <tr>
      <td style="padding:8px 12px;background:#f5f5f5">Sem data</td>
      <td style="padding:8px 12px;background:#f5f5f5;text-align:right;color:#666">${totalSemData}</td>
    </tr>
    <tr><td colspan="2" style="height:4px"></td></tr>
    <tr>
      <td style="padding:8px 12px;background:#fffae6">? Ambíguos</td>
      <td style="padding:8px 12px;background:#fffae6;text-align:right;color:#a80">${planejamento.totalAmbiguos}</td>
    </tr>
  </table>

  ${
    topModelos.length > 0
      ? `<h3 style="margin:16px 0 8px 0">Top modelos</h3>
  <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-bottom:24px">
    <thead><tr><th style="text-align:left;padding:4px 8px;border-bottom:2px solid #ddd">Modelo</th><th style="text-align:right;padding:4px 8px;border-bottom:2px solid #ddd">Pedidos</th></tr></thead>
    <tbody>${linhasModelos}</tbody>
  </table>`
      : ""
  }

  ${
    porCanal.length > 0
      ? `<h3 style="margin:16px 0 8px 0">Por canal</h3>
  <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-bottom:24px">
    <thead><tr><th style="text-align:left;padding:4px 8px;border-bottom:2px solid #ddd">Canal</th><th style="text-align:right;padding:4px 8px;border-bottom:2px solid #ddd">Pedidos</th></tr></thead>
    <tbody>${linhasCanais}</tbody>
  </table>`
      : ""
  }

  ${
    planejamento.arquivosIngeridos.length > 0
      ? `<h3 style="margin:16px 0 8px 0">Arquivos consolidados</h3>
  <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-bottom:24px">
    <thead><tr><th style="text-align:left;padding:4px 8px;border-bottom:2px solid #ddd">Arquivo</th><th style="text-align:left;padding:4px 8px;border-bottom:2px solid #ddd">Tipo</th><th style="text-align:right;padding:4px 8px;border-bottom:2px solid #ddd">Linhas</th></tr></thead>
    <tbody>${linhasArquivos}</tbody>
  </table>`
      : ""
  }

  ${
    detalheUrl
      ? `<p style="margin:32px 0 0 0"><a href="${escapeHtml(detalheUrl)}" style="display:inline-block;padding:10px 20px;background:#008000;color:#fff;border-radius:6px;text-decoration:none">Ver no ERP</a></p>`
      : ""
  }

  <p style="color:#999;font-size:12px;margin-top:32px">Snapshot imutável gerado em ${planejamento.geradoEm.slice(0, 16).replace("T", " ")} UTC.</p>
</div>
`.trim();

  const text = [
    `Central de Envios — Planejamento ${data}`,
    contaNome,
    "",
    `Total:      ${planejamento.totalPedidos}`,
    `Atrasados:  ${planejamento.totalAtrasados}`,
    `Hoje:       ${planejamento.totalHoje}`,
    `No prazo:   ${totalNoPrazo}`,
    `Sem data:   ${totalSemData}`,
    `Ambíguos:   ${planejamento.totalAmbiguos}`,
    "",
    detalheUrl ? `Detalhes: ${detalheUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { html, text };
}
