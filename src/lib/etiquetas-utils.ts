import { generateId } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

export interface PlanilhaItem {
  idPedido: string;
  sku: string;
  quantidade: number;
  trackingNumber?: string;
  productName?: string;
  variationName?: string;
}

export type FormatoPlanilha = "export_order" | "lista_empacotamento" | "auto";

export interface ParsedSpreadsheetResult {
  formato: FormatoPlanilha;
  mapaPorId: Map<string, PlanilhaItem>;
  mapaPorSku: Map<string, PlanilhaItem[]>;
  mapaPorTracking: Map<string, PlanilhaItem>;
  totalItens: number;
}

export interface EtiquetaAssociadaLocal {
  id: string;
  etiqueta: string;
  sku: string;
  quantidade: number;
}

// ── Spreadsheet Detection & Parsing ──────────────────────────────────────────

export function detectAndParseSpreadsheet(
  data: any[][],
): ParsedSpreadsheetResult {
  const header = data[0] || [];
  const isListaEmpacotamento = header.some(
    (col: any) =>
      String(col || "")
        .toLowerCase()
        .includes("tracking_number") ||
      String(col || "")
        .toLowerCase()
        .includes("order_sn") ||
      String(col || "")
        .toLowerCase()
        .includes("product_info"),
  );

  const mapaPorId = new Map<string, PlanilhaItem>();
  const mapaPorSku = new Map<string, PlanilhaItem[]>();
  const mapaPorTracking = new Map<string, PlanilhaItem>();

  if (isListaEmpacotamento) {
    parseListaEmpacotamento(data, mapaPorId, mapaPorSku, mapaPorTracking);

    return {
      formato: "lista_empacotamento",
      mapaPorId,
      mapaPorSku,
      mapaPorTracking,
      totalItens: Array.from(mapaPorSku.values()).flat().length,
    };
  }

  parseExportOrder(data, mapaPorId, mapaPorSku);

  return {
    formato: "export_order",
    mapaPorId,
    mapaPorSku,
    mapaPorTracking,
    totalItens: mapaPorId.size,
  };
}

function parseListaEmpacotamento(
  data: any[][],
  mapaPorId: Map<string, PlanilhaItem>,
  mapaPorSku: Map<string, PlanilhaItem[]>,
  mapaPorTracking: Map<string, PlanilhaItem>,
): void {
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length < 3) continue;

    const trackingNumber = String(row[0] || "")
      .trim()
      .replace(/^"|"$/g, "");
    const orderSn = String(row[1] || "")
      .trim()
      .replace(/^"|"$/g, "");
    const productInfo = String(row[2] || "")
      .trim()
      .replace(/^"|"$/g, "");

    if (!orderSn || !productInfo) continue;

    const skuMatch = productInfo.match(/SKU Reference No\.:\s*([^;]+)/i);
    const sku = skuMatch ? skuMatch[1].trim() : "";

    const qtyMatch = productInfo.match(/Quantity:\s*(\d+)/i);
    const quantidade = qtyMatch ? parseInt(qtyMatch[1]) : 1;

    const productNameMatch = productInfo.match(/Product Name:([^;]+)/i);
    const productName = productNameMatch ? productNameMatch[1].trim() : "";

    const variationMatch = productInfo.match(/Variation Name:([^;]+)/i);
    const variationName = variationMatch ? variationMatch[1].trim() : "";

    if (!sku || !orderSn) continue;

    const item: PlanilhaItem = {
      idPedido: orderSn,
      sku,
      quantidade,
      trackingNumber,
      productName,
      variationName,
    };

    mapaPorId.set(orderSn, item);

    if (trackingNumber) {
      mapaPorTracking.set(trackingNumber, item);
    }

    if (!mapaPorSku.has(sku)) {
      mapaPorSku.set(sku, []);
    }
    mapaPorSku.get(sku)!.push(item);
  }
}

function parseExportOrder(
  data: any[][],
  mapaPorId: Map<string, PlanilhaItem>,
  mapaPorSku: Map<string, PlanilhaItem[]>,
): void {
  const colunaAIndex = 0; // ID do Pedido
  const colunaADIndex = 29; // SKU
  const colunaAHIndex = 33; // Quantidade

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[colunaAIndex]) continue;

    const idPedido = String(row[colunaAIndex] || "").trim();
    const sku = row[colunaADIndex] ? String(row[colunaADIndex]).trim() : "";
    const quantidadeStr = row[colunaAHIndex]
      ? String(row[colunaAHIndex]).trim()
      : "0";
    const quantidade = parseInt(quantidadeStr) || 0;

    if (!idPedido || !sku) continue;

    const existente = mapaPorId.get(idPedido);
    if (existente) {
      if (existente.sku === sku) {
        mapaPorId.set(idPedido, {
          idPedido,
          sku,
          quantidade: existente.quantidade + quantidade,
        });
      }
      // Different SKU for same ID — keep first occurrence
      continue;
    }

    const item: PlanilhaItem = { idPedido, sku, quantidade };
    mapaPorId.set(idPedido, item);

    if (!mapaPorSku.has(sku)) {
      mapaPorSku.set(sku, []);
    }
    mapaPorSku.get(sku)!.push(item);
  }
}

// ── Bipagem Processing ───────────────────────────────────────────────────────

export function processarBipagem(
  input: string,
  formato: FormatoPlanilha,
  mapaPorId: Map<string, PlanilhaItem>,
  mapaPorSku: Map<string, PlanilhaItem[]>,
  mapaPorTracking: Map<string, PlanilhaItem>,
  existing: EtiquetaAssociadaLocal[],
): { novas: EtiquetaAssociadaLocal[]; naoEncontradas: string[] } {
  const linhas = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const novas: EtiquetaAssociadaLocal[] = [];
  const naoEncontradas: string[] = [];

  linhas.forEach((linhaTrim) => {
    // Check if already associated
    if (existing.some((e) => e.etiqueta === linhaTrim || e.sku === linhaTrim)) {
      return;
    }

    let item: PlanilhaItem | null = null;
    let etiquetaUsada = linhaTrim;

    if (formato === "lista_empacotamento") {
      // 1. Try tracking number
      item = mapaPorTracking.get(linhaTrim) || null;
      if (item) {
        etiquetaUsada = item.idPedido;
      } else {
        // 2. Try order_sn
        item = mapaPorId.get(linhaTrim) || null;
        if (item) {
          etiquetaUsada = linhaTrim;
        } else {
          // 3. Try SKU
          const itensPorSku = mapaPorSku.get(linhaTrim);
          if (itensPorSku && itensPorSku.length > 0) {
            item = itensPorSku[0];
            etiquetaUsada = item.idPedido;
          }
        }
      }
    } else {
      // export_order: match by ID only
      item = mapaPorId.get(linhaTrim) || null;
      etiquetaUsada = linhaTrim;
    }

    if (item) {
      novas.push({
        id: generateId(),
        etiqueta: etiquetaUsada,
        sku: item.sku,
        quantidade: item.quantidade,
      });
    } else {
      naoEncontradas.push(linhaTrim);
    }
  });

  return { novas, naoEncontradas };
}

// ── CSV Export ───────────────────────────────────────────────────────────────

export function exportarCSV(
  associacoes: {
    etiqueta: string;
    sku: string;
    quantidade: number;
    createdAt: string;
  }[],
): void {
  const header = "ID do Pedido,SKU,Quantidade,Data/Hora\n";
  const rows = associacoes
    .map((e) => {
      const dataHora = new Date(e.createdAt).toLocaleString("pt-BR");
      return `"${e.etiqueta}","${e.sku}","${e.quantidade}","${dataHora}"`;
    })
    .join("\n");

  const csv = header + rows;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;

  const date = new Date();
  const dateStr = `${date.getDate().toString().padStart(2, "0")}-${(date.getMonth() + 1).toString().padStart(2, "0")}-${date.getFullYear()}`;
  a.download = `Associacoes_Etiquetas_${dateStr}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Clipboard Copy ───────────────────────────────────────────────────────────

export async function copiarAssociacoes(
  associacoes: { etiqueta: string; sku: string; quantidade: number }[],
): Promise<void> {
  const texto = associacoes
    .map((e) => `${e.etiqueta}\t${e.sku}\t${e.quantidade}`)
    .join("\n");
  await navigator.clipboard.writeText(texto);
}

// ── ZPL Conversion ───────────────────────────────────────────────────────────

export async function convertZplToImage(
  zpl: string,
): Promise<Uint8Array | null> {
  try {
    const response = await fetch(
      "https://api.labelary.com/v1/printers/8dpmm/labels/4x6/0/",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: zpl,
      },
    );

    if (!response.ok) return null;

    const blob = await response.blob();
    if (blob.size === 0) return null;

    const arrayBuffer = await blob.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  } catch {
    return null;
  }
}

// ── ZPL Manual Parsing (fallback) ────────────────────────────────────────────

export function parseZplManual(
  zplContent: string,
  pageHeight: number,
): Array<{
  text: string;
  x: number;
  y: number;
  size: number;
  bold: boolean;
}> {
  const textos: Array<{
    text: string;
    x: number;
    y: number;
    size: number;
    bold: boolean;
  }> = [];

  let currentX = 20;
  let currentY = pageHeight - 30;
  let currentFontSize = 10;
  let currentBold = false;

  const zplLines = zplContent.split("\n");
  for (const line of zplLines) {
    const foMatch = line.match(/\^FO(\d+),(\d+)/);
    if (foMatch) {
      const zplX = parseInt(foMatch[1]);
      const zplY = parseInt(foMatch[2]);
      // Convert ZPL dots to PDF points (203 DPI = 8 dots/mm)
      currentX = (zplX / 8) * 2.8346;
      currentY = pageHeight - (zplY / 8) * 2.8346;
    }

    const aMatch = line.match(/\^A([A-Z])(\d+),(\d+)/);
    if (aMatch) {
      currentFontSize = parseInt(aMatch[3]) || 10;
      currentBold = aMatch[1] === "B";
    }

    const fdMatch = line.match(/\^FD(.+?)\^FS/);
    if (fdMatch) {
      const texto = fdMatch[1].replace(/\^/g, "").trim();
      if (texto) {
        textos.push({
          text: texto,
          x: currentX,
          y: currentY,
          size: currentFontSize,
          bold: currentBold,
        });
        currentY -= currentFontSize + 5;
      }
    }
  }

  return textos;
}
