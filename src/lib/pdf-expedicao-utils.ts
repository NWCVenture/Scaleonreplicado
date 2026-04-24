// ─── Shared PDF utilities for Pedidos Urgentes + Expedição Diária ──────────
// Processes label PDFs (Upseller/TikTok/ML) extracted manually by the user.
// Detects per-page: tracking ID, carrier (iMile/JadLog/J&T), kit type,
// products (LUA/NBA/etc), CPF; groups pages by product × kitType for
// selective printing on a Zebra ZD220 thermal printer.

declare global {
  interface Window {
    pdfjsLib?: unknown;
    PDFLib?: unknown;
  }
}

export const PRODUCTS = ["LUA", "NBA", "BOB", "PUFFER", "CJ", "SOL"] as const;
export const TAMANHO_ORDER = ["PP", "P", "M", "G", "GG", "EGG", "XG", "XXG"] as const;
export const SEM_TAMANHO_LABEL = "Sem tamanho";

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

export type SizeSubGroup = {
  id: string; // "KIT 2::M"
  size: string; // "M", "GG", "Sem tamanho"
  pageIndexes: number[];
  downloaded: boolean;
};

export type FilterGroup = {
  id: string; // "KIT 2" ou "Unitários"
  label: string; // texto exibido
  products: string[]; // agregado de todos subgrupos
  kitType: string | null; // null = Unitários
  pageIndexes: number[]; // flatten de todos subgrupos
  subGroups: SizeSubGroup[];
  downloaded: boolean; // true quando todos subgrupos estão baixados
};

export async function loadPDFLibraries(): Promise<void> {
  const inject = (src: string) =>
    new Promise<void>((res, rej) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        res();
        return;
      }
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => res();
      s.onerror = () => rej(new Error(`Failed to load ${src}`));
      document.head.appendChild(s);
    });

  await inject(
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
  );
  await inject(
    "https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js",
  );

  await new Promise<void>((res) => {
    const poll = setInterval(() => {
      if (window.pdfjsLib && window.PDFLib) {
        clearInterval(poll);
        res();
      }
    }, 100);
  });

  const pdfjs = window.pdfjsLib as {
    GlobalWorkerOptions: { workerSrc: string };
  };
  if (pdfjs) {
    pdfjs.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }
}

export async function mergePDFs(files: File[]): Promise<Uint8Array> {
  const { PDFDocument } = window.PDFLib as {
    PDFDocument: { create: () => Promise<unknown> };
  };
  const merged = (await PDFDocument.create()) as {
    copyPages: (doc: unknown, idx: number[]) => Promise<unknown[]>;
    addPage: (p: unknown) => void;
    save: () => Promise<Uint8Array>;
  };
  for (const file of files) {
    const buf = await file.arrayBuffer();
    const lib = window.PDFLib as {
      PDFDocument: {
        load: (b: ArrayBuffer, o: object) => Promise<unknown>;
      };
    };
    const doc = (await lib.PDFDocument.load(buf, {
      ignoreEncryption: true,
    })) as {
      getPageIndices: () => number[];
    };
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    pages.forEach((p) => merged.addPage(p));
  }
  return merged.save();
}

export async function analyzePDFPages(
  file: File | Uint8Array,
  onProgress: (val: number, text: string) => void,
): Promise<PageInfo[]> {
  const pdfjsLib = window.pdfjsLib as {
    getDocument: (o: { data: ArrayBuffer }) => {
      promise: Promise<{
        numPages: number;
        getPage: (n: number) => Promise<{
          getTextContent: () => Promise<{ items: Array<{ str: string }> }>;
        }>;
      }>;
    };
  };

  let data: ArrayBuffer;
  if (file instanceof File) {
    data = await file.arrayBuffer();
  } else {
    // pdf.js detacha o ArrayBuffer — passamos uma cópia para preservar o original
    data = new Uint8Array(file).buffer;
  }
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const total = pdf.numPages;
  const pages: PageInfo[] = [];

  for (let i = 0; i < total; i++) {
    const progress = 15 + Math.round(((i + 1) / total) * 70);
    onProgress(progress, `Analisando página ${i + 1} de ${total}…`);

    const page = await pdf.getPage(i + 1);
    const content = await page.getTextContent();
    const text = content.items.map((it) => it.str).join(" ");

    const trackMatch = text.match(
      /C[oó]digo\s+de\s+Rastreamento[:\s]+(\d{12,14})/i,
    );
    const trackingId = trackMatch ? trackMatch[1] : "";

    const bensMatch = text.match(
      /IDENTIFICA[CÇ][AÃ]O\s+DOS\s+BENS([\s\S]*?)(?:\d{2}-\d{2}-\d{4}|Total\s+\d|$)/i,
    );
    const bensText = bensMatch ? bensMatch[1] : "";

    const products: string[] = [];
    for (const p of PRODUCTS) {
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
    const produtoGroup = PRODUCTS.join("|");
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

export function buildFilterGroups(pages: PageInfo[]): FilterGroup[] {
  // Agrupa por kitType (top-level) e, dentro, por tamanho (sub-level)
  const groups = new Map<string, FilterGroup>();

  for (const page of pages) {
    const parentId = page.kitType ?? "Unitários";
    const parentLabel = page.kitType ?? "Unitários";
    const sizeKey = page.size ?? SEM_TAMANHO_LABEL;
    const subId = `${parentId}::${sizeKey}`;

    let parent = groups.get(parentId);
    if (!parent) {
      parent = {
        id: parentId,
        label: parentLabel,
        products: [],
        kitType: page.kitType,
        pageIndexes: [],
        subGroups: [],
        downloaded: false,
      };
      groups.set(parentId, parent);
    }

    for (const p of page.products) {
      if (!parent.products.includes(p)) parent.products.push(p);
    }
    parent.pageIndexes.push(page.index);

    let sub = parent.subGroups.find((s) => s.id === subId);
    if (!sub) {
      sub = {
        id: subId,
        size: sizeKey,
        pageIndexes: [],
        downloaded: false,
      };
      parent.subGroups.push(sub);
    }
    sub.pageIndexes.push(page.index);
  }

  // Ordena subgrupos por tamanho (Sem tamanho por último)
  for (const parent of groups.values()) {
    parent.subGroups.sort((a, b) => {
      if (a.size === SEM_TAMANHO_LABEL) return 1;
      if (b.size === SEM_TAMANHO_LABEL) return -1;
      return sizeOrder(a.size) - sizeOrder(b.size);
    });
  }

  // Ordena grupos pais: Unitários → KIT N asc → MIX N asc
  return Array.from(groups.values()).sort((a, b) => {
    const [afa, ana] = kitTypeOrder(a.kitType);
    const [afb, anb] = kitTypeOrder(b.kitType);
    if (afa !== afb) return afa - afb;
    return ana - anb;
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
  addMoon: boolean,
  addBasketball: boolean,
  modelImages: ModelImageMap = {},
): Promise<GeneratedPDF> {
  const lib = window.PDFLib as {
    PDFDocument: {
      load: (b: Uint8Array, o: object) => Promise<unknown>;
      create: () => Promise<unknown>;
    };
    rgb: (r: number, g: number, b: number) => unknown;
    degrees: (d: number) => unknown;
    StandardFonts: { HelveticaBold: unknown };
  };
  const { PDFDocument, rgb, degrees, StandardFonts } = lib;

  // Ordenar páginas por (tamanho, SKU) antes de copiar — requisito:
  // "etiquetas devem ficar sempre ordenadas por tamanho e SKU, mesmo em grupos misturados"
  const sortedPages = sortPagesForPrint(pagesToInclude);
  const pageIndexes = sortedPages.map((p) => p.index);

  // Cópia defensiva — evita detach do buffer entre múltiplas chamadas
  const srcDoc = (await PDFDocument.load(new Uint8Array(sourceBytes), {
    ignoreEncryption: true,
  })) as unknown;
  const newDoc = (await PDFDocument.create()) as {
    copyPages: (doc: unknown, idx: number[]) => Promise<unknown[]>;
    addPage: (p: unknown) => void;
    embedFont: (f: unknown) => Promise<unknown>;
    embedPng: (b: Uint8Array) => Promise<unknown>;
    embedJpg: (b: Uint8Array) => Promise<unknown>;
    save: () => Promise<Uint8Array>;
  };
  const copied = await newDoc.copyPages(srcDoc, pageIndexes);

  // Carrega e embute as imagens de cada modelo uma única vez
  const embeddedModelImages = new Map<string, unknown>();
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
    const rawPage = copied[i];
    const pageInfo = sortedPages[i];
    newDoc.addPage(rawPage);
    const page = rawPage as {
      getSize: () => { width: number; height: number };
      drawRectangle: (o: {
        x: number;
        y: number;
        width: number;
        height: number;
        color: unknown;
      }) => void;
      drawText: (t: string, o: object) => void;
      drawCircle: (o: {
        x: number;
        y: number;
        size: number;
        color?: unknown;
        borderColor?: unknown;
        borderWidth?: number;
      }) => void;
      drawLine: (o: {
        start: { x: number; y: number };
        end: { x: number; y: number };
        thickness: number;
        color: unknown;
      }) => void;
      drawImage: (
        img: unknown,
        o: { x: number; y: number; width: number; height: number },
      ) => void;
    };
    const { width, height } = page.getSize();

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
    // mediabox bottom-left na mesma lógica do quadrado. Progressão
    // horizontal no display = progressão vertical (+y) na mediabox.
    const iconRadius = 10;
    const iconSize = iconRadius * 2; // 20pt de largura/altura para imagem
    const iconMargin = 12;
    const iconSpacing = 28;
    const iconX = iconMargin + iconRadius;

    const toDraw: Array<
      | { kind: "image"; model: string; embed: unknown }
      | { kind: "moon" }
      | { kind: "ball" }
    > = [];

    for (const model of pageInfo.products) {
      const embed = embeddedModelImages.get(model);
      if (embed) {
        toDraw.push({ kind: "image", model, embed });
      } else if (model === "LUA" && addMoon) {
        toDraw.push({ kind: "moon" });
      } else if (model === "NBA" && addBasketball) {
        toDraw.push({ kind: "ball" });
      }
    }

    toDraw.forEach((item, idx) => {
      const cx = iconX;
      const cy = iconMargin + iconRadius + idx * iconSpacing;
      if (item.kind === "image") {
        page.drawImage(item.embed, {
          x: cx - iconRadius,
          y: cy - iconRadius,
          width: iconSize,
          height: iconSize,
        });
      } else if (item.kind === "moon") {
        page.drawCircle({ x: cx, y: cy, size: iconRadius, color: rgb(0, 0, 0) });
        page.drawCircle({
          x: cx + 4,
          y: cy + 3,
          size: iconRadius - 2,
          color: rgb(1, 1, 1),
        });
      } else {
        page.drawCircle({
          x: cx,
          y: cy,
          size: iconRadius,
          borderColor: rgb(0, 0, 0),
          borderWidth: 1,
        });
        page.drawLine({
          start: { x: cx, y: cy - iconRadius },
          end: { x: cx, y: cy + iconRadius },
          thickness: 1,
          color: rgb(0, 0, 0),
        });
        page.drawLine({
          start: { x: cx - iconRadius, y: cy },
          end: { x: cx + iconRadius, y: cy },
          thickness: 1,
          color: rgb(0, 0, 0),
        });
      }
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
  addMoon: boolean,
  addBasketball: boolean,
  modelImages: ModelImageMap = {},
): Promise<GeneratedPDF> {
  const generated = await generateFilteredPDF(
    sourceBytes,
    pagesToInclude,
    label,
    addMoon,
    addBasketball,
    modelImages,
  );
  triggerDownloadPDF(generated.bytes, generated.fileName);
  return generated;
}
