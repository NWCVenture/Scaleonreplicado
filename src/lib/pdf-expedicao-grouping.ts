// ─── Pure grouping logic for Expedição Diária ──────────────────────────────
// Tipos, constantes e `buildFilterGroups` que NÃO dependem de pdfjs/pdf-lib.
// Separado de `pdf-expedicao-utils.ts` pra permitir testes em Node sem o
// shim de DOMMatrix (que pdfjs-dist exige no top-level).

export const PRODUCTS = ["LUA", "NBA", "BOB", "PUFFER", "CJ", "SOL"] as const;
export const TAMANHO_ORDER = [
  "PP",
  "P",
  "M",
  "G",
  "GG",
  "EGG",
  "XG",
  "XXG",
] as const;
export const SEM_TAMANHO_LABEL = "Sem tamanho";
export const SEM_COR_LABEL = "Sem cor";
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
  color: string | null;
  skus: string[];
  totalQtd: number | null;
  trackingId: string;
  jadlogBarcode: string;
  jtBarcode: string;
  carrierFromPDF: string;
  cpfFromPDF: string;
};

// Folha da árvore (nível 5): tamanho. Único nível com checkbox direta —
// downloaded/selection nos níveis acima são derivados.
export type SizeLeaf = {
  id: string; // "<carrier>::<skuId>::<qtdLabel>::<color>::<size>"
  size: string;
  pageIndexes: number[];
  downloaded: boolean;
};

// Nível 4: Cor.
export type ColorSubGroup = {
  id: string; // "<carrier>::<skuId>::<qtdLabel>::<color>"
  color: string;
  pageIndexes: number[];
  subGroups: SizeLeaf[];
  downloaded: boolean;
};

// Nível 3: QTD (Unitário, KIT N, MIX N).
export type QtdSubGroup = {
  id: string; // "<carrier>::<skuId>::<qtdLabel>"
  label: string; // "Unitário" | "KIT 2" | "MIX 5"
  kitType: string | null; // null = Unitário
  pageIndexes: number[];
  subGroups: ColorSubGroup[];
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

// Extrai SKUs, cor representativa e tamanho do trecho "IDENTIFICAÇÃO DOS BENS"
// de uma etiqueta. Cobre dois formatos observados na Upseller/TikTok/ML:
//
// 1. Strict — "MODELO COR TAM" (unitários e kits monocolor sem qty interno):
//    "LUA AZ GG". Qty implícita = 1.
//
// 2. Kit multi-cor — "KIT N MODELO (Qty? COR)+ TAM" (qty opcional por cor):
//    "KIT 3 LUA 2 PT 1 BR M" → 2 PT + 1 BR.
//    "KIT 2 LUA AZ CZ P"    → 1 AZ + 1 CZ (qty omitida = 1).
//
// Label canônica de cor:
//   - 1 cor distinta → cor crua, sem qty (ex: "PT"). Cobre unitário e
//     kit monocolor — qty redundante porque já está implícita no kitType.
//   - 2+ cores distintas → "qty1 COR1 + qty2 COR2 + ..." com cores em
//     ordem alfa (ex: "1 BR + 2 PT"). Mantém qty por cor pra distinguir
//     "2 CZ + 1 PT" de "1 CZ + 2 PT" — mesmas cores, kits diferentes.
//
// Função pura (sem PDF) pra ser testável em Node sem pdfjs/pdf-lib.
export function extractSkusAndColor(
  bensText: string,
  detectionModels: readonly string[],
): { skus: string[]; color: string | null; size: string | null } {
  const skus: string[] = [];
  // Map<cor, qty> — primeira ocorrência vence. Em geral cada cor aparece
  // só uma vez por etiqueta; defensivo contra duplo-match (overlapping).
  const colorEntries = new Map<string, number>();
  const tamanhoGroup = TAMANHO_ORDER.join("|");
  const produtoGroup = detectionModels.join("|");

  if (produtoGroup.length > 0) {
    // Strict: MODELO COR TAM. Qty implícita = 1.
    const strictRegex = new RegExp(
      `\\b(${produtoGroup})\\s+([A-Z]{2,4})\\s+(${tamanhoGroup})\\b`,
      "gi",
    );
    let m: RegExpExecArray | null;
    while ((m = strictRegex.exec(bensText)) !== null) {
      const cor = m[2].toUpperCase();
      const tam = m[3].toUpperCase();
      const modelo = m[1].toUpperCase();
      const normalized = `${modelo} ${cor} ${tam}`;
      if (!skus.includes(normalized)) skus.push(normalized);
      if (!colorEntries.has(cor)) colorEntries.set(cor, 1);
    }

    // Kit multi-cor: KIT N MODELO ((Q )?COR)+ TAM. Qty opcional — quando
    // o PDF lista "KIT 2 LUA AZ CZ P" sem qty antes das cores, cada uma
    // entra com qty=1. Quando há qty explícita, usa o valor capturado.
    const kitMultiRegex = new RegExp(
      `\\bKIT\\s*\\d+\\s+(${produtoGroup})\\s+((?:(?:\\d+\\s+)?[A-Z]{2,4}\\s+)+)(${tamanhoGroup})\\b`,
      "gi",
    );
    while ((m = kitMultiRegex.exec(bensText)) !== null) {
      const modelo = m[1].toUpperCase();
      const middle = m[2];
      const tam = m[3].toUpperCase();
      // Cada token = qty opcional + cor obrigatória.
      const innerRegex = /\b(?:(\d+)\s+)?([A-Z]{2,4})\b/g;
      let cm: RegExpExecArray | null;
      while ((cm = innerRegex.exec(middle)) !== null) {
        const qtyStr = cm[1];
        const cor = cm[2].toUpperCase();
        // Filtra falso-positivo: token "cor" coincidente com tamanho
        // conhecido (proteção contra "1 GG" embaralhado).
        if ((TAMANHO_ORDER as readonly string[]).includes(cor)) continue;
        const qty = qtyStr ? parseInt(qtyStr, 10) : 1;
        if (!Number.isFinite(qty) || qty <= 0) continue;
        if (!colorEntries.has(cor)) colorEntries.set(cor, qty);
        const normalized = `${modelo} ${cor} ${tam}`;
        if (!skus.includes(normalized)) skus.push(normalized);
      }
    }
  }

  let size: string | null = null;
  if (skus.length > 0) {
    const parts = skus[0].split(/\s+/);
    size = parts[2] || null;
  }

  let color: string | null = null;
  if (colorEntries.size === 1) {
    // Cor única — qty omitida (redundante; KIT N já no nível de cima).
    color = Array.from(colorEntries.keys())[0];
  } else if (colorEntries.size > 1) {
    // 2+ cores — ordem alfa por cor, cada entry "qty COR".
    color = Array.from(colorEntries.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cor, qty]) => `${qty} ${cor}`)
      .join(" + ");
  }

  return { skus, color, size };
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
    const colorKey = page.color ?? SEM_COR_LABEL;
    const colorId = `${qtdId}::${colorKey}`;
    const sizeKey = page.size ?? SEM_TAMANHO_LABEL;
    const sizeId = `${colorId}::${sizeKey}`;

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

    let color = qtd.subGroups.find((c) => c.id === colorId);
    if (!color) {
      color = {
        id: colorId,
        color: colorKey,
        pageIndexes: [],
        subGroups: [],
        downloaded: false,
      };
      qtd.subGroups.push(color);
    }
    color.pageIndexes.push(page.index);

    let leaf = color.subGroups.find((s) => s.id === sizeId);
    if (!leaf) {
      leaf = {
        id: sizeId,
        size: sizeKey,
        pageIndexes: [],
        downloaded: false,
      };
      color.subGroups.push(leaf);
    }
    leaf.pageIndexes.push(page.index);
  }

  // Ordena: tamanhos asc, cores alfa (Sem cor por último), QTDs por kitType,
  // SKUs (cadastrados→Misto→Não cad).
  for (const cg of carriers.values()) {
    for (const sku of cg.subGroups) {
      for (const qtd of sku.subGroups) {
        for (const color of qtd.subGroups) {
          color.subGroups.sort((a, b) => {
            if (a.size === SEM_TAMANHO_LABEL) return 1;
            if (b.size === SEM_TAMANHO_LABEL) return -1;
            return sizeOrder(a.size) - sizeOrder(b.size);
          });
        }
        qtd.subGroups.sort((a, b) => {
          if (a.color === SEM_COR_LABEL) return 1;
          if (b.color === SEM_COR_LABEL) return -1;
          return a.color.localeCompare(b.color);
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
