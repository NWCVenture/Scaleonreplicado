"use client";

// ─── Shared PDF utilities for Pedidos Urgentes + Expedição Diária ──────────
// Processes label PDFs (Upseller/TikTok/ML) extracted manually by the user.
// Detects per-page: tracking ID, carrier (iMile/JadLog/J&T), kit type,
// products (LUA/NBA/etc), CPF; groups pages by SKU principal × kitType ×
// size for selective printing on a Zebra ZD220 thermal printer.
//
// Importa pdfjs/pdf-lib do `pdf-worker.ts` (bundled). Antes usávamos CDN
// pra pdf.js, mas isso colidia com `pdfjs-dist` que o kit-organizer e o
// verificador-etiquetas importam: o pacote v5 faz `globalThis.pdfjsLib =
// {...}` na inicialização e clobberava a v3 do CDN, gerando o erro
// "API version X does not match Worker version Y".

import {
  pdfjs,
  PDFDocument,
  StandardFonts,
  rgb,
  degrees,
} from "./pdf-worker";

export const PRODUCTS = ["LUA", "NBA", "BOB", "PUFFER", "CJ", "SOL"] as const;
export const TAMANHO_ORDER = ["PP", "P", "M", "G", "GG", "EGG", "XG", "XXG"] as const;
export const SEM_TAMANHO_LABEL = "Sem tamanho";
export const UNITARIO_LABEL = "Unitário";
export const NAO_CADASTRADO_ID = "__nao_cadastrado__";
export const NAO_CADASTRADO_LABEL = "(SKU não cadastrado no sistema)";
export const MISTO_PREFIX = "Misto: ";
export const CARRIER_ORDER = ["iMile", "JadLog", "J&T", "Outro"] as const;

export type PageInfo = {
  index: number;
  pageNum: number;
  isKit: boolean;
  products: string[];
  kitType: string | null;
  size: string | null;
  skus: string[];
  totalQtd: number | null;
  trackingId: string;
  jadlogBarcode: string;
  jtBarcode: string;
  carrierFromPDF: string;
  cpfFromPDF: string;
};

// Folha da árvore (nível 4): tamanho. Único nível com checkbox direta —
// downloaded/selection nos níveis acima são derivados.
export type SizeLeaf = {
  id: string; // "<carrier>::<skuId>::<qtdLabel>::<size>"
  size: string;
  pageIndexes: number[];
  downloaded: boolean;
};

// Nível 3: QTD (Unitário, KIT N, MIX N).
export type QtdSubGroup = {
  id: string; // "<carrier>::<skuId>::<qtdLabel>"
  label: string; // "Unitário" | "KIT 2" | "MIX 5"
  kitType: string | null; // null = Unitário
  pageIndexes: number[];
  subGroups: SizeLeaf[];
  downloaded: boolean;
};

// Nível 2: SKU principal (modelo cadastrado), "Misto: X + Y", ou "(SKU não
// cadastrado no sistema)".
export type SkuSubGroup = {
  id: string; // "<carrier>::<skuId>"
  label: string;
  isMisto: boolean;
  isUnregistered: boolean;
  products: string[];
  pageIndexes: number[];
  subGroups: QtdSubGroup[];
  downloaded: boolean;
};

// Nível 1: Transportadora (iMile / JadLog / J&T / Outro).
export type CarrierGroup = {
  id: string; // "<carrier>"
  label: string;
  carrier: string;
  pageIndexes: number[];
  subGroups: SkuSubGroup[];
  downloaded: boolean;
};

// Alias mantido pra reduzir churn em callers. `FilterGroup` agora é o
// container de transportadora (nível 1).
export type FilterGroup = CarrierGroup;

export type AnalyzeOptions = {
  // Lista de modelos cadastrados na conta. Usada pra expandir o regex
  // de detecção além da lista hardcoded `PRODUCTS`. Quando ausente ou
  // vazia, cai pra `PRODUCTS`.
  models?: readonly string[];
};

// Mantido por back-compat — pdfjs-dist e pdf-lib são importados
// estaticamente em pdf-worker.ts, então não há nada pra aguardar.
export async function loadPDFLibraries(): Promise<void> {
  // no-op
}

export async function mergePDFs(files: File[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create();
  for (const file of files) {
    const buf = await file.arrayBuffer();
    const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    pages.forEach((p) => merged.addPage(p));
  }
  return merged.save();
}

export async function analyzePDFPages(
  file: File | Uint8Array,
  onProgress: (val: number, text: string) => void,
  options: AnalyzeOptions = {},
): Promise<PageInfo[]> {
  // Conjunto de modelos usado na detecção: união de PRODUCTS (seed
  // hardcoded) + modelos vindos da conta. Garante detecção correta de
  // modelos novos cadastrados pelo usuário sem perder os antigos.
  const detectionModels = (() => {
    const set = new Set<string>(PRODUCTS as readonly string[]);
    for (const m of options.models ?? []) {
      const trimmed = m.trim().toUpperCase();
      if (trimmed) set.add(trimmed);
    }
    return Array.from(set);
  })();
  let data: ArrayBuffer;
  if (file instanceof File) {
    data = await file.arrayBuffer();
  } else {
    // pdf.js detacha o ArrayBuffer — passamos uma cópia para preservar o original
    data = new Uint8Array(file).buffer;
  }
  const pdf = await pdfjs.getDocument({ data }).promise;
  const total = pdf.numPages;
  const pages: PageInfo[] = [];

  for (let i = 0; i < total; i++) {
    const progress = 15 + Math.round(((i + 1) / total) * 70);
    onProgress(progress, `Analisando página ${i + 1} de ${total}…`);

    const page = await pdf.getPage(i + 1);
    const content = await page.getTextContent();
    // TextContent.items pode conter TextItem (com `str`) e TextMarkedContent
    // (sem `str`); filtra antes de concatenar.
    const text = content.items
      .map((it) => ("str" in it ? it.str : ""))
      .join(" ");

    // Extração de Tracking ID (Código de Rastreamento). Aplicada DEPOIS
    // da detecção de transportadora pra usar o padrão correto. Tentativa
    // em camadas: label explícito → barcode da transportadora → fallback
    // genérico (só pra iMile, que não tem padrão fixo público).
    // Falhar a extração NÃO é fatal: a etiqueta entra na fila normal, mas
    // não participa da dedup por tracking ID.
    const labeledTrack = text.match(
      /(?:C[oó]digo\s+de\s+Rastreamento|Tracking(?:\s+Number|\s+ID)?|Rastreio|AWB)\s*[:#]?\s*([A-Z0-9]{8,30})/i,
    );
    let trackingId = labeledTrack ? labeledTrack[1] : "";

    const bensMatch = text.match(
      /IDENTIFICA[CÇ][AÃ]O\s+DOS\s+BENS([\s\S]*?)(?:\d{2}-\d{2}-\d{4}|Total\s+\d|$)/i,
    );
    const bensText = bensMatch ? bensMatch[1] : "";

    const products: string[] = [];
    for (const p of detectionModels) {
      if (new RegExp(`\\b${p}\\b`, "i").test(bensText)) products.push(p);
    }

    // Kit type — qualquer quantidade (KIT 2, KIT 10, MIX 5, etc)
    const kitMatch = text.match(/\b(KIT\s*\d+|MIX\s*\d+)\b/i);
    const kitType = kitMatch
      ? kitMatch[1].replace(/\s+/, " ").toUpperCase()
      : null;

    // SKUs completos no formato "MODELO COR TAM" (ex: "LUA AZ GG")
    const skus: string[] = [];
    const tamanhoGroup = TAMANHO_ORDER.join("|");
    const produtoGroup = detectionModels.join("|");
    const skuRegex = new RegExp(
      `\\b(${produtoGroup})\\s+([A-Z]{2,4})\\s+(${tamanhoGroup})\\b`,
      "gi",
    );
    let skuMatch: RegExpExecArray | null;
    while ((skuMatch = skuRegex.exec(bensText)) !== null) {
      const normalized = `${skuMatch[1]} ${skuMatch[2]} ${skuMatch[3]}`.toUpperCase();
      if (!skus.includes(normalized)) skus.push(normalized);
    }

    // Tamanho dominante — prioriza o tamanho do primeiro SKU detectado; caso nenhum SKU
    // tenha sido capturado, tenta extrair um token de tamanho isolado no bensText.
    let size: string | null = null;
    if (skus.length > 0) {
      const parts = skus[0].split(/\s+/);
      size = parts[2] || null;
    }
    if (!size) {
      const loneSize = bensText.match(
        new RegExp(`\\b(${tamanhoGroup})\\b`, "i"),
      );
      if (loneSize) size = loneSize[1].toUpperCase();
    }

    let carrierFromPDF = "Outro";
    if (/imile/i.test(text)) carrierFromPDF = "iMile";
    else if (/jadlog/i.test(text)) carrierFromPDF = "JadLog";
    else if (/j&t|j\s*&\s*t express|999880/i.test(text)) carrierFromPDF = "J&T";

    let jadlogBarcode = "";
    if (carrierFromPDF === "JadLog") {
      const jm = text.match(/\b(139\d{8,}?)(?:\$|\b)/);
      if (jm) jadlogBarcode = jm[1];
    }

    let jtBarcode = "";
    if (carrierFromPDF === "J&T") {
      const jt = text.match(/\b(999880\d{6,}?)(?:\$|\b)/);
      if (jt) jtBarcode = jt[1];
    }

    let cpfFromPDF = "";
    const cpfMatch =
      text.match(/CPF[\/\s]*CNPJ[:\s]*([\d.\-\/]+)/i) ||
      text.match(/\b(\d{3}\.\d{3}\.\d{3}-\d{2})\b/) ||
      text.match(/\b(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\b/);
    if (cpfMatch) cpfFromPDF = cpfMatch[1].replace(/\D/g, "");

    // Fallback do trackingId — quando o label "Código de Rastreamento"
    // não aparece, usa o barcode específico da transportadora (mais
    // confiável que regex genérico, que pegaria CPF/CNPJ/telefone).
    if (!trackingId && jtBarcode) trackingId = jtBarcode;
    if (!trackingId && jadlogBarcode) trackingId = jadlogBarcode;
    if (!trackingId && carrierFromPDF === "iMile") {
      // iMile não tem prefixo único conhecido; pega a sequência numérica
      // mais longa do PDF, descartando o CPF detectado pra não confundir.
      const cpfDigits = cpfFromPDF;
      const candidates = Array.from(text.matchAll(/\b(\d{12,18})\b/g))
        .map((m) => m[1])
        .filter((d) => d !== cpfDigits);
      if (candidates.length > 0) {
        // Pega a maior sequência (geralmente o AWB tem 13-14 dígitos).
        candidates.sort((a, b) => b.length - a.length);
        trackingId = candidates[0];
      }
    }

    // QTD total da DDC (campo "Total N" no fim da Declaração de Conteúdo).
    // É a fonte de verdade pra "quantas unidades nesta sacola" — regex de
    // SKU não serve porque nomes como "KIT 3 SOL 1 AZ 2 PT P" contêm KIT
    // mesmo sendo 1 unidade promocional.
    const totalMatch = text.match(/\bTotal\s+(\d+)\b/i);
    const totalQtd = totalMatch ? parseInt(totalMatch[1], 10) : null;

    pages.push({
      index: i,
      pageNum: i + 1,
      isKit: kitType !== null,
      products,
      kitType,
      size,
      skus,
      totalQtd,
      trackingId,
      jadlogBarcode,
      jtBarcode,
      carrierFromPDF,
      cpfFromPDF,
    });
  }
  onProgress(85, "Agrupando resultados…");
  return pages;
}

function kitTypeOrder(kt: string | null): [number, number] {
  // Unitários primeiro (kt = null), depois KIT N ordenado por N, depois MIX N
  if (kt === null) return [0, 0];
  const m = kt.match(/^(KIT|MIX)\s*(\d+)/i);
  if (!m) return [3, 0];
  const family = m[1].toUpperCase() === "KIT" ? 1 : 2;
  return [family, parseInt(m[2], 10)];
}

function sizeOrder(size: string): number {
  const idx = (TAMANHO_ORDER as readonly string[]).indexOf(size);
  return idx < 0 ? 99 : idx;
}

type PageClassification = {
  groupId: string;
  groupLabel: string;
  isMisto: boolean;
  isUnregistered: boolean;
  products: string[];
};

// Decide o "SKU principal" de uma página com base nos modelos cadastrados.
// - 0 modelos cadastrados detectados → grupo "Não cadastrado"
// - 1 modelo → grupo daquele modelo
// - 2+ modelos distintos cadastrados → grupo "Misto: X + Y"
function classifyPage(
  page: PageInfo,
  registered: Set<string>,
): PageClassification {
  const detected = page.products.filter((p) => registered.has(p));

  if (detected.length === 0) {
    return {
      groupId: NAO_CADASTRADO_ID,
      groupLabel: NAO_CADASTRADO_LABEL,
      isMisto: false,
      isUnregistered: true,
      products: [...page.products],
    };
  }

  if (detected.length === 1) {
    return {
      groupId: detected[0],
      groupLabel: detected[0],
      isMisto: false,
      isUnregistered: false,
      products: detected,
    };
  }

  const sorted = [...detected].sort();
  return {
    groupId: `__misto__::${sorted.join("+")}`,
    groupLabel: `${MISTO_PREFIX}${sorted.join(" + ")}`,
    isMisto: true,
    isUnregistered: false,
    products: sorted,
  };
}

function carrierOrder(c: string): number {
  const idx = (CARRIER_ORDER as readonly string[]).indexOf(c);
  return idx < 0 ? 99 : idx;
}

export function buildFilterGroups(
  pages: PageInfo[],
  registeredModels: readonly string[] | null = null,
): CarrierGroup[] {
  // Conjunto de modelos cadastrados na conta. Quando vazio, cai pra
  // PRODUCTS pra preservar comportamento antigo (todos cadastrados).
  const registered = new Set<string>(
    registeredModels && registeredModels.length > 0
      ? registeredModels.map((m) => m.trim().toUpperCase())
      : (PRODUCTS as readonly string[]),
  );

  const carriers = new Map<string, CarrierGroup>();

  for (const page of pages) {
    const carrier = page.carrierFromPDF || "Outro";
    const cls = classifyPage(page, registered);
    const skuId = `${carrier}::${cls.groupId}`;
    const qtdLabel = page.kitType ?? UNITARIO_LABEL;
    const qtdId = `${skuId}::${qtdLabel}`;
    const sizeKey = page.size ?? SEM_TAMANHO_LABEL;
    const sizeId = `${qtdId}::${sizeKey}`;

    let cg = carriers.get(carrier);
    if (!cg) {
      cg = {
        id: carrier,
        label: carrier,
        carrier,
        pageIndexes: [],
        subGroups: [],
        downloaded: false,
      };
      carriers.set(carrier, cg);
    }
    cg.pageIndexes.push(page.index);

    let sku = cg.subGroups.find((s) => s.id === skuId);
    if (!sku) {
      sku = {
        id: skuId,
        label: cls.groupLabel,
        isMisto: cls.isMisto,
        isUnregistered: cls.isUnregistered,
        products: [],
        pageIndexes: [],
        subGroups: [],
        downloaded: false,
      };
      cg.subGroups.push(sku);
    }
    sku.pageIndexes.push(page.index);
    for (const p of cls.products) {
      if (!sku.products.includes(p)) sku.products.push(p);
    }

    let qtd = sku.subGroups.find((q) => q.id === qtdId);
    if (!qtd) {
      qtd = {
        id: qtdId,
        label: qtdLabel,
        kitType: page.kitType,
        pageIndexes: [],
        subGroups: [],
        downloaded: false,
      };
      sku.subGroups.push(qtd);
    }
    qtd.pageIndexes.push(page.index);

    let leaf = qtd.subGroups.find((s) => s.id === sizeId);
    if (!leaf) {
      leaf = {
        id: sizeId,
        size: sizeKey,
        pageIndexes: [],
        downloaded: false,
      };
      qtd.subGroups.push(leaf);
    }
    leaf.pageIndexes.push(page.index);
  }

  // Ordena: tamanhos asc, QTDs por kitType, SKUs (cadastrados→Misto→Não cad).
  for (const cg of carriers.values()) {
    for (const sku of cg.subGroups) {
      for (const qtd of sku.subGroups) {
        qtd.subGroups.sort((a, b) => {
          if (a.size === SEM_TAMANHO_LABEL) return 1;
          if (b.size === SEM_TAMANHO_LABEL) return -1;
          return sizeOrder(a.size) - sizeOrder(b.size);
        });
      }
      sku.subGroups.sort((a, b) => {
        const [afa, ana] = kitTypeOrder(a.kitType);
        const [afb, anb] = kitTypeOrder(b.kitType);
        if (afa !== afb) return afa - afb;
        return ana - anb;
      });
    }
    cg.subGroups.sort((a, b) => {
      const aRank = a.isUnregistered ? 2 : a.isMisto ? 1 : 0;
      const bRank = b.isUnregistered ? 2 : b.isMisto ? 1 : 0;
      if (aRank !== bRank) return aRank - bRank;
      return a.label.localeCompare(b.label);
    });
  }

  // Transportadoras: iMile → JadLog → J&T → Outro (qualquer outra ao final).
  return Array.from(carriers.values()).sort((a, b) => {
    const ord = carrierOrder(a.carrier) - carrierOrder(b.carrier);
    if (ord !== 0) return ord;
    return a.label.localeCompare(b.label);
  });
}

function sortPagesForPrint(pages: PageInfo[]): PageInfo[] {
  return [...pages].sort((a, b) => {
    const sa = a.size ? sizeOrder(a.size) : 98;
    const sb = b.size ? sizeOrder(b.size) : 98;
    if (sa !== sb) return sa - sb;
    const skuA = a.skus[0] ?? "";
    const skuB = b.skus[0] ?? "";
    return skuA.localeCompare(skuB);
  });
}

export type GeneratedPDF = {
  bytes: Uint8Array;
  fileName: string;
  pageCount: number;
};

export type ModelImageMap = Record<string, string>;

export async function generateFilteredPDF(
  sourceBytes: Uint8Array,
  pagesToInclude: PageInfo[],
  label: string,
  modelImages: ModelImageMap = {},
): Promise<GeneratedPDF> {
  // Ordenar páginas por (tamanho, SKU) antes de copiar — requisito:
  // "etiquetas devem ficar sempre ordenadas por tamanho e SKU, mesmo em grupos misturados"
  const sortedPages = sortPagesForPrint(pagesToInclude);
  const pageIndexes = sortedPages.map((p) => p.index);

  // Cópia defensiva — evita detach do buffer entre múltiplas chamadas
  const srcDoc = await PDFDocument.load(new Uint8Array(sourceBytes), {
    ignoreEncryption: true,
  });
  const newDoc = await PDFDocument.create();
  const copied = await newDoc.copyPages(srcDoc, pageIndexes);

  // Carrega e embute as imagens de cada modelo uma única vez. Tipo é a
  // união de PDFImage retornada por embedPng/embedJpg.
  type EmbeddedImage = Awaited<ReturnType<typeof newDoc.embedPng>>;
  const embeddedModelImages = new Map<string, EmbeddedImage>();
  const neededModels = new Set<string>();
  for (const p of pagesToInclude) p.products.forEach((m) => neededModels.add(m));
  for (const model of neededModels) {
    const url = modelImages[model];
    if (!url) continue;
    try {
      const resp = await fetch(url);
      if (!resp.ok) continue;
      const imgBytes = new Uint8Array(await resp.arrayBuffer());
      const isPng = /\.png(\?|$)/i.test(url) || imgBytes[0] === 0x89;
      const embed = isPng
        ? await newDoc.embedPng(imgBytes)
        : await newDoc.embedJpg(imgBytes);
      embeddedModelImages.set(model, embed);
    } catch {
      // Ignora — usa fallback vetorial
    }
  }

  for (let i = 0; i < copied.length; i++) {
    const page = copied[i];
    const pageInfo = sortedPages[i];
    newDoc.addPage(page);
    const { width } = page.getSize();

    // Quadrado preto — canto superior DIREITO (na visualização impressa).
    // O conteúdo do Upseller é desenhado com rotação 90° CCW (textos usam
    // rotate 270°), então o "visual top-right" da etiqueta corresponde à
    // mediabox bottom-right, não top-right. Condição: QTD total da DDC > 1
    // (o campo "Total N" — nome do SKU pode conter KIT mesmo sendo 1 un).
    if (pageInfo.totalQtd != null && pageInfo.totalQtd > 1) {
      const size = 15;
      const margin = 10;
      page.drawRectangle({
        x: width - margin - size,
        y: margin,
        width: size,
        height: size,
        color: rgb(0, 0, 0),
      });
    }

    const hasLua = pageInfo.products.includes("LUA");
    const hasNba = pageInfo.products.includes("NBA");
    let alertText = "";
    if (hasLua && hasNba) alertText = "ATENÇÃO: MANGA LONGA E REGATA";
    else if (hasLua) alertText = "ATENÇÃO: MANGA LONGA";
    else if (hasNba) alertText = "ATENÇÃO: REGATA";

    if (alertText) {
      const font = await newDoc.embedFont(StandardFonts.HelveticaBold);
      page.drawText(alertText, {
        x: 10,
        y: 200,
        size: 8,
        font,
        color: rgb(0, 0, 0),
        rotate: degrees(270),
      });
    }

    // Figuras no canto inferior DIREITO (visualização impressa) —
    // mediabox bottom-left na mesma lógica do quadrado. Só desenha pra
    // modelos com imagem cadastrada em modelo_principal — sem fallback
    // vetorial (era confuso e burocrático).
    const iconRadius = 10;
    const iconSize = iconRadius * 2; // 20pt de largura/altura
    const iconMargin = 12;
    const iconSpacing = 28;
    const iconX = iconMargin + iconRadius;

    const toDraw: Array<{ model: string; embed: EmbeddedImage }> = [];
    for (const model of pageInfo.products) {
      const embed = embeddedModelImages.get(model);
      if (embed) toDraw.push({ model, embed });
    }

    toDraw.forEach((item, idx) => {
      const cx = iconX;
      const cy = iconMargin + iconRadius + idx * iconSpacing;
      page.drawImage(item.embed, {
        x: cx - iconRadius,
        y: cy - iconRadius,
        width: iconSize,
        height: iconSize,
      });
    });
  }

  const bytes = await newDoc.save();
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const fileName = `Etiquetas_${label}_${dd}-${mm}-${yyyy}.pdf`;
  return { bytes, fileName, pageCount: pagesToInclude.length };
}

// Dispara download no browser a partir de bytes já gerados
export function triggerDownloadPDF(bytes: Uint8Array, fileName: string): void {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

// Wrapper que mantém compatibilidade com callers antigos (gera + baixa)
export async function downloadFilteredPDF(
  sourceBytes: Uint8Array,
  pagesToInclude: PageInfo[],
  label: string,
  modelImages: ModelImageMap = {},
): Promise<GeneratedPDF> {
  const generated = await generateFilteredPDF(
    sourceBytes,
    pagesToInclude,
    label,
    modelImages,
  );
  triggerDownloadPDF(generated.bytes, generated.fileName);
  return generated;
}
