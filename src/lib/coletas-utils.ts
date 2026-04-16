import type { TransportadoraLabel } from "@/lib/db/schema";
import type {
  SkuLine,
  SkuKitRule,
  CarrierPattern,
  DevolucoesMap,
  BipagemRecord,
  ContaOperacao,
} from "@/types/coletas";
import { FUNCTION_DISPLAY, OPERATION_DISPLAY } from "@/types/coletas";

// ── Carrier Detection ────────────────────────────────────────────────────────

export function detectCarrier(
  code: string,
  patterns: CarrierPattern[],
): TransportadoraLabel {
  if (/^4\d{10}$/.test(code)) return "ML";
  if (/^BR\d{12,13}[A-Z]?$/.test(code)) return "SHP";
  if (/^\d{13,14}$/.test(code)) {
    for (const p of patterns) {
      if (
        p.prefixos.some((pfx) => pfx.trim() && code.startsWith(pfx.trim()))
      ) {
        // Match transportadora string to enum value
        if (p.transportadora.includes("JDLOG")) return "TTK_JDLOG";
        if (p.transportadora.includes("IMILE")) return "TTK_IMILE";
      }
    }
    return "DESCONHECIDA";
  }
  return "DESCONHECIDA";
}

// ── ID Extraction ────────────────────────────────────────────────────────────

export function extractFlexIds(text: string): string[] {
  const pattern = /\^id\^Ç\^(\d{11})\^/g;
  const ids: string[] = [];
  let match;
  while ((match = pattern.exec(text)) !== null) ids.push(match[1]);
  return ids;
}

export function extractShippingIds(text: string): string[] {
  const re = /(4\d{10}|BR\d{12,13}[A-Z]?|\d{13,14})/g;
  return text.match(re) || [];
}

// ── SKU Kit Explosion ────────────────────────────────────────────────────────

export function explodeSkuLines(
  lines: SkuLine[],
  kitRules: SkuKitRule[],
): SkuLine[] {
  const result: SkuLine[] = [];
  for (const line of lines) {
    const kit = kitRules.find(
      (k) => k.kitSku.toUpperCase() === line.sku.toUpperCase(),
    );
    if (kit) {
      for (const comp of kit.components) {
        result.push({ sku: comp.sku, qtd: comp.qtd * line.qtd });
      }
    } else {
      result.push({ ...line });
    }
  }
  return result;
}

export function sumSkuLines(lines: SkuLine[]): SkuLine[] {
  const map: Record<string, number> = {};
  for (const l of lines) {
    const key = l.sku.trim().toUpperCase();
    if (key) map[key] = (map[key] || 0) + l.qtd;
  }
  return Object.entries(map)
    .filter(([sku]) => sku)
    .map(([sku, qtd]) => ({ sku, qtd }))
    .sort((a, b) => a.sku.localeCompare(b.sku));
}

// ── Manifest HTML ────────────────────────────────────────────────────────────

function formatDateForDisplay(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function buildManifestHTML(
  idsArr: string[],
  accountName: string,
  functionType: string,
  _devolucoesData?: DevolucoesMap,
): string {
  const dataStr = formatDateForDisplay();
  const isFlex = functionType === "FLEX";

  let numCols = 1;
  if (isFlex) {
    if (idsArr.length <= 20) numCols = 1;
    else if (idsArr.length <= 40) numCols = 2;
    else numCols = 3;
  } else {
    if (idsArr.length > 75) numCols = 4;
    else if (idsArr.length > 50) numCols = 3;
    else if (idsArr.length > 25) numCols = 2;
  }

  const itemsPerCol = Math.ceil(idsArr.length / numCols);
  let rows = "";
  for (let i = 0; i < itemsPerCol; i++) {
    rows += "<tr>";
    for (let col = 0; col < numCols; col++) {
      const idx = col * itemsPerCol + i;
      rows += `<td>${idx < idsArr.length ? idsArr[idx] : ""}</td>`;
    }
    rows += "</tr>";
  }

  const title =
    functionType === "CANCELADO"
      ? "CANCELADOS"
      : functionType === "DEVOLUCAO"
        ? "DEVOLUÇÕES"
        : "ROMANEIO";
  const isFlexSingleCol = isFlex && idsArr.length <= 20;
  const flexFontSize = isFlexSingleCol ? "24px" : "28px";
  const flexPadding = isFlexSingleCol ? "10px 16px" : "12px 20px";
  const tableWidth = isFlexSingleCol ? "auto" : "100%";
  const tableMargin = isFlexSingleCol ? "0 auto" : "0";

  const tableStyle = isFlex
    ? `table { width: ${tableWidth}; border-collapse: collapse; margin: ${tableMargin}; } td { border: 1px solid #000; padding: ${flexPadding}; font-size: ${flexFontSize}; font-weight: bold; font-family: 'Courier New', monospace; text-align: center; }`
    : `table { width: 100%; border-collapse: collapse; margin-bottom: 12px; } td { border: 1px solid #000; padding: 3px 6px; font-size: 11px; font-weight: bold; font-family: 'Courier New', monospace; text-align: left; }`;

  const headerTitle = isFlex
    ? "ROMANEIO - FLEX - TM LOGISTICA"
    : `${title} - TM LOGISTICA`;
  const headerSubtitle = isFlex
    ? ""
    : `LISTA ${accountName} DIA ${dataStr}:`;
  const titleSize = isFlex ? "32px" : "24px";

  return `<!doctype html><html lang='pt-BR'><head><meta charset='utf-8'><title>${title}</title><style>
    @page { size: A4 portrait; margin: 10mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; color: #000; padding: 10px; background: #fff; }
    .header { text-align: center; margin-bottom: 16px; }
    .logo { max-width: 150px; height: auto; margin: 0 auto 12px; display: block; }
    .title { font-size: ${titleSize}; font-weight: bold; margin-bottom: 8px; }
    .subtitle { font-size: 16px; font-weight: bold; margin-bottom: 12px; }
    ${tableStyle}
    .total { text-align: center; font-size: ${isFlex ? "24px" : "16px"}; font-weight: bold; margin: 16px 0; }
    .signature-label { font-size: 18px; font-weight: bold; margin-right: 10px; }
    .signature-line { display: inline-block; border-bottom: 2px solid #000; width: 450px; vertical-align: bottom; height: 25px; }
    @media print { .ids-list { display: none; } @page { margin: 10mm; @bottom-left{content:""} @bottom-center{content:""} @bottom-right{content:""} } }
  </style></head><body>
    <div class="header">
      <img src="/logo-full.png" alt="Logo" class="logo" onerror="this.style.display='none';" />
      <div class="title">${headerTitle}</div>
      ${headerSubtitle ? `<div class="subtitle">${headerSubtitle}</div>` : ""}
    </div>
    <div class="ids-list" style="font-size:10px;color:#999;margin:8px 0;word-break:break-all;">${idsArr.join(", ")}</div>
    <table>${rows}</table>
    <div class="total">TOTAL = ${idsArr.length}</div>
    <div style="margin-top:30px;">
      <span class="signature-label">ASSINATURA:</span><span class="signature-line"></span>
    </div>
    <script>window.addEventListener('load',()=>setTimeout(()=>window.print(),200));<\/script>
  </body></html>`;
}

// ── Devolucao Export TXT ─────────────────────────────────────────────────────

export function buildDevolucaoExportTxt(
  ids: string[],
  devolucoesData: DevolucoesMap,
  kitRules: SkuKitRule[],
  filterOperacao?: ContaOperacao,
): string {
  const allDev = Object.entries(devolucoesData).filter(
    ([id, d]) => ids.includes(id) && d.tipo === "DEVOLUCAO",
  );
  const filtered = filterOperacao
    ? allDev.filter(([, d]) => d.operacao === filterOperacao)
    : allDev;

  if (!filtered.length) return "";

  const date = new Date();
  const dateStr = `${date.getDate().toString().padStart(2, "0")}-${(date.getMonth() + 1).toString().padStart(2, "0")}-${date.getFullYear()}`;

  let content = `RELATÓRIO DE DEVOLUÇÕES - TM LOGISTICA\n`;
  content += `Gerado em: ${new Date().toLocaleString("pt-BR")}\n`;
  if (filterOperacao)
    content += `Operação: ${OPERATION_DISPLAY[filterOperacao]}\n`;
  content += `Total de pacotes: ${filtered.length}\n\n`;
  content += "=".repeat(60) + "\n\n";

  const allExploded: SkuLine[] = [];

  filtered.forEach(([id, d]) => {
    content += `Pacote: ${id}\n`;
    content += `Operação: ${OPERATION_DISPLAY[d.operacao]}\n`;
    d.skuLines.forEach((line) => {
      content += `  SKU: ${line.sku} (Qtd: ${line.qtd})\n`;
    });
    const exploded = explodeSkuLines(d.skuLines, kitRules);
    const hasKitExpansion = exploded.some(
      (e, i) =>
        e.sku !== d.skuLines[i]?.sku || e.qtd !== d.skuLines[i]?.qtd,
    );
    if (hasKitExpansion) {
      content += `  → Unidades:\n`;
      const summed = sumSkuLines(exploded);
      summed.forEach((e) => {
        content += `    ${e.sku}: ${e.qtd}\n`;
        allExploded.push(e);
      });
    } else {
      exploded.forEach((e) => allExploded.push(e));
    }
    content += `  Avaria: ${d.avaria ? "SIM" : "NÃO"}${d.avaria && d.obs ? ` - ${d.obs}` : ""}\n`;
    if (d.fotoPacoteBase64) content += `  Foto pacote: [anexada]\n`;
    if (d.fotoAvariaBase64) content += `  Foto avaria: [anexada]\n`;
    content += "\n";
  });

  content += "=".repeat(60) + "\n";
  content += "TOTAL PARA ENTRADA NO UPSELLER:\n";
  const totais = sumSkuLines(allExploded);
  totais.forEach((t) => {
    content += `${t.sku}: ${t.qtd}\n`;
  });
  content += "=".repeat(60) + "\n";

  return content;
}

// ── Historico Reports ────────────────────────────────────────────────────────

function fmtDate(ts: string): string {
  return new Date(ts).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function buildHistoricoReport(
  type: "geral" | "resumido",
  bipagens: BipagemRecord[],
): string {
  if (type === "geral") return buildRelatorioGeral(bipagens);
  return buildRelatorioResumido(bipagens);
}

function buildRelatorioGeral(bipagens: BipagemRecord[]): string {
  const linhas: string[] = [
    "=".repeat(100),
    "RELATÓRIO GERAL DE COLETAS",
    "=".repeat(100),
    `Total de registros: ${bipagens.length}`,
    `Data de geração: ${new Date().toLocaleString("pt-BR")}`,
    "",
    "Data/Hora | Tipo | Conta | Total | Status | Usuário",
    "-".repeat(100),
  ];

  bipagens.forEach((item) => {
    const data = fmtDate(item.createdAt);
    const tipo = FUNCTION_DISPLAY[item.tipo] || item.tipo;
    const conta = OPERATION_DISPLAY[item.conta] || item.conta;
    const status = item.revisado ? "✓ Revisado" : "⏳ Pendente";
    const revisadoInfo =
      item.revisado && item.revisadoEm
        ? `${item.revisadoPorNome || "-"} em ${fmtDate(item.revisadoEm)}`
        : "";
    linhas.push(
      `${data} | ${tipo} | ${conta} | ${item.total} | ${status}${revisadoInfo ? ` (${revisadoInfo})` : ""} | ${item.usuarioNome}`,
    );
  });

  return linhas.join("\n");
}

function buildRelatorioResumido(bipagens: BipagemRecord[]): string {
  const linhas: string[] = [
    "=".repeat(100),
    "RELATÓRIO RESUMIDO DE COLETAS",
    "=".repeat(100),
    `Total de registros: ${bipagens.length}`,
    `Data de geração: ${new Date().toLocaleString("pt-BR")}`,
    "",
  ];

  // Aggregate by tipo
  const porTipo: Record<string, number> = {};
  const porConta: Record<string, number> = {};
  const porTipoConta: Record<string, number> = {};

  bipagens.forEach((item) => {
    const tipo = FUNCTION_DISPLAY[item.tipo] || item.tipo;
    const conta = OPERATION_DISPLAY[item.conta] || item.conta;
    porTipo[tipo] = (porTipo[tipo] || 0) + item.total;
    porConta[conta] = (porConta[conta] || 0) + item.total;
    const key = `${tipo} - ${conta}`;
    porTipoConta[key] = (porTipoConta[key] || 0) + item.total;
  });

  linhas.push("TOTAIS POR TIPO:", "-".repeat(60));
  Object.entries(porTipo)
    .sort((a, b) => b[1] - a[1])
    .forEach(([tipo, total]) => {
      linhas.push(`${tipo}: ${total}`);
    });

  linhas.push("", "TOTAIS POR CONTA:", "-".repeat(60));
  Object.entries(porConta)
    .sort((a, b) => b[1] - a[1])
    .forEach(([conta, total]) => {
      linhas.push(`${conta}: ${total}`);
    });

  linhas.push("", "TOTAIS POR TIPO + CONTA:", "-".repeat(60));
  Object.entries(porTipoConta)
    .sort((a, b) => b[1] - a[1])
    .forEach(([key, total]) => {
      linhas.push(`${key}: ${total}`);
    });

  const totalGeral = Object.values(porTipo).reduce(
    (sum, qtd) => sum + qtd,
    0,
  );
  linhas.push("", "TOTAL GERAL:", "-".repeat(60), `${totalGeral} pacotes`);

  return linhas.join("\n");
}

// ── Download / File helpers ──────────────────────────────────────────────────

export function downloadTxt(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
