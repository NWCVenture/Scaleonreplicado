export interface ParsedQR {
  sku: string;
  lote: string;
  qtd: number;
}

export function parseQRCode(raw: string): ParsedQR | null {
  const normalized = raw.trim().replace(/^\d+/, "").replace(/}/g, "|");
  const parts = normalized.split("|").map((p) => p.trim());
  if (parts.length >= 3) {
    const [a, b, c] = parts;
    // Formato QR: SKU|LOTE|QTD (terceiro é número)
    const qtdFromC = parseInt(c, 10);
    if (a && b && !isNaN(qtdFromC)) return { sku: a, lote: b, qtd: qtdFromC };
    // Formato importação: SKU|QTD|LOTE (segundo é número)
    const qtdFromB = parseInt(b, 10);
    if (a && !isNaN(qtdFromB) && c) return { sku: a, lote: c, qtd: qtdFromB };
  }
  return null;
}

export function parseImportText(
  text: string,
): Array<{ sku: string; qtd: number; lote: string }> {
  const results: Array<{ sku: string; qtd: number; lote: string }> = [];

  // Normalise: split on newlines AND tabs so pasted bipagem lines (tab-separated) each become their own entry
  const rawTokens = text.split(/[\n\t]/);

  for (const token of rawTokens) {
    const t = token.trim();
    if (
      !t ||
      t.startsWith("---") ||
      t.startsWith("HORA") ||
      t.startsWith("RELAT") ||
      t.startsWith("SOMA") ||
      t.startsWith("RESUMO") ||
      t.startsWith("Gerado") ||
      t.startsWith("BIPAGEM") ||
      t.includes("peças") ||
      t.includes("----")
    )
      continue;

    // Format 1: QR bipagem  "LUA AZ GG}ESTOQUE PADRO}60" or pipe-separated
    const qrParts = t.replace(/\}/g, "|").split("|").map((p) => p.trim());
    if (qrParts.length >= 3) {
      // Detailed report: HH:MM:SS | SKU | QTD | LOTE
      if (/^\d{2}:\d{2}:\d{2}$/.test(qrParts[0])) {
        const sku = qrParts[1], qtd = parseInt(qrParts[2]), lote = qrParts[3] ?? "";
        if (sku && !isNaN(qtd)) { results.push({ sku, qtd, lote }); continue; }
      }
      // Simple: SKU | QTD | LOTE  or  SKU | LOTE | QTD
      const [a, b, c] = qrParts;
      const qtdFromC = parseInt(c, 10);
      if (a && b && !isNaN(qtdFromC)) { results.push({ sku: a, lote: b, qtd: qtdFromC }); continue; }
      const qtdFromB = parseInt(b, 10);
      if (a && !isNaN(qtdFromB) && c) { results.push({ sku: a, lote: c, qtd: qtdFromB }); continue; }
    }

    // Format 2: space-separated  "LUA AZ GG 60" — last token is quantity
    const spaceParts = t.split(/\s+/);
    if (spaceParts.length >= 2) {
      const lastVal = parseInt(spaceParts[spaceParts.length - 1], 10);
      if (!isNaN(lastVal) && lastVal > 0) {
        const sku = spaceParts.slice(0, -1).join(" ");
        results.push({ sku, qtd: lastVal, lote: "IMPORTADO" });
        continue;
      }
    }
  }
  return results;
}

const PRODUTO_ORDER = ["CJ", "LUA", "NBA", "SOL", "PUFFER"];
const COR_ORDER = ["AZ", "BR", "CZ", "PT", "VM", "VD", "AM", "RS"];
const TAMANHO_ORDER = ["P", "M", "G", "GG", "EGG"];

export function parseSKUParts(sku: string): {
  produto: string;
  cor: string;
  tam: string;
} {
  const parts = sku.trim().split(/\s+/);
  return { produto: parts[0] || "", cor: parts[1] || "", tam: parts[2] || "" };
}

export function compareSKU(a: string, b: string): number {
  const pa = parseSKUParts(a);
  const pb = parseSKUParts(b);
  const pi = PRODUTO_ORDER.indexOf(pa.produto);
  const pj = PRODUTO_ORDER.indexOf(pb.produto);
  if (pi !== pj) return (pi < 0 ? 99 : pi) - (pj < 0 ? 99 : pj);
  const ci = COR_ORDER.indexOf(pa.cor);
  const cj = COR_ORDER.indexOf(pb.cor);
  if (ci !== cj) return (ci < 0 ? 99 : ci) - (cj < 0 ? 99 : cj);
  const ti = TAMANHO_ORDER.indexOf(pa.tam);
  const tj = TAMANHO_ORDER.indexOf(pb.tam);
  return (ti < 0 ? 99 : ti) - (tj < 0 ? 99 : tj);
}

export function isThisWeek(ts: Date | string | number): boolean {
  const time = ts instanceof Date ? ts.getTime() : new Date(ts).getTime();
  return Date.now() - time < 7 * 24 * 60 * 60 * 1000;
}
