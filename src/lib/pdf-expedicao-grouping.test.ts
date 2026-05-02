import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildFilterGroups,
  extractSkusAndColor,
  type PageInfo,
  SEM_COR_LABEL,
  SEM_TAMANHO_LABEL,
  UNITARIO_LABEL,
} from "./pdf-expedicao-grouping";

const MODELS = ["LUA", "NBA", "BOB"] as const;

function mkPage(partial: Partial<PageInfo> & { index: number }): PageInfo {
  return {
    pageNum: partial.index + 1,
    isKit: false,
    products: [],
    kitType: null,
    size: null,
    color: null,
    skus: [],
    totalQtd: null,
    trackingId: "",
    jadlogBarcode: "",
    jtBarcode: "",
    carrierFromPDF: "iMile",
    cpfFromPDF: "",
    ...partial,
  };
}

test("buildFilterGroups: cria 5 níveis (carrier → sku → qtd → color → size)", () => {
  const pages: PageInfo[] = [
    mkPage({
      index: 0,
      products: ["LUA"],
      color: "AZ",
      size: "P",
      carrierFromPDF: "iMile",
    }),
  ];
  const groups = buildFilterGroups(pages, ["LUA"]);

  assert.equal(groups.length, 1);
  const carrier = groups[0];
  assert.equal(carrier.label, "iMile");

  assert.equal(carrier.subGroups.length, 1);
  const sku = carrier.subGroups[0];
  assert.equal(sku.label, "LUA");

  assert.equal(sku.subGroups.length, 1);
  const qtd = sku.subGroups[0];
  assert.equal(qtd.label, UNITARIO_LABEL);

  assert.equal(qtd.subGroups.length, 1);
  const color = qtd.subGroups[0];
  assert.equal(color.color, "AZ");

  assert.equal(color.subGroups.length, 1);
  const leaf = color.subGroups[0];
  assert.equal(leaf.size, "P");
});

test("buildFilterGroups: leaf id inclui color no path", () => {
  const pages: PageInfo[] = [
    mkPage({
      index: 0,
      products: ["LUA"],
      color: "AZ",
      size: "P",
      carrierFromPDF: "iMile",
    }),
  ];
  const groups = buildFilterGroups(pages, ["LUA"]);
  const leaf = groups[0].subGroups[0].subGroups[0].subGroups[0].subGroups[0];
  assert.equal(leaf.id, "iMile::LUA::Unitário::AZ::P");
});

test("buildFilterGroups: page sem cor cai em 'Sem cor'", () => {
  const pages: PageInfo[] = [
    mkPage({
      index: 0,
      products: ["LUA"],
      color: null,
      size: "M",
      carrierFromPDF: "iMile",
    }),
  ];
  const groups = buildFilterGroups(pages, ["LUA"]);
  const color = groups[0].subGroups[0].subGroups[0].subGroups[0];
  assert.equal(color.color, SEM_COR_LABEL);
});

test("buildFilterGroups: page sem tamanho cai em 'Sem tamanho'", () => {
  const pages: PageInfo[] = [
    mkPage({
      index: 0,
      products: ["LUA"],
      color: "AZ",
      size: null,
      carrierFromPDF: "iMile",
    }),
  ];
  const groups = buildFilterGroups(pages, ["LUA"]);
  const leaf =
    groups[0].subGroups[0].subGroups[0].subGroups[0].subGroups[0];
  assert.equal(leaf.size, SEM_TAMANHO_LABEL);
});

test("buildFilterGroups: cores ordenadas alfa, 'Sem cor' por último", () => {
  const pages: PageInfo[] = [
    mkPage({ index: 0, products: ["LUA"], color: "VD", size: "P" }),
    mkPage({ index: 1, products: ["LUA"], color: null, size: "P" }),
    mkPage({ index: 2, products: ["LUA"], color: "AZ", size: "P" }),
    mkPage({ index: 3, products: ["LUA"], color: "PT", size: "P" }),
  ];
  const groups = buildFilterGroups(pages, ["LUA"]);
  const colors = groups[0].subGroups[0].subGroups[0].subGroups.map(
    (c) => c.color,
  );
  assert.deepEqual(colors, ["AZ", "PT", "VD", SEM_COR_LABEL]);
});

test("buildFilterGroups: tamanhos ordenados pela TAMANHO_ORDER", () => {
  const pages: PageInfo[] = [
    mkPage({ index: 0, products: ["LUA"], color: "AZ", size: "GG" }),
    mkPage({ index: 1, products: ["LUA"], color: "AZ", size: "P" }),
    mkPage({ index: 2, products: ["LUA"], color: "AZ", size: "M" }),
  ];
  const groups = buildFilterGroups(pages, ["LUA"]);
  const sizes = groups[0].subGroups[0].subGroups[0].subGroups[0].subGroups.map(
    (l) => l.size,
  );
  assert.deepEqual(sizes, ["P", "M", "GG"]);
});

test("buildFilterGroups: agrupa páginas com mesma cor numa única ColorSubGroup", () => {
  const pages: PageInfo[] = [
    mkPage({ index: 0, products: ["LUA"], color: "AZ", size: "P" }),
    mkPage({ index: 1, products: ["LUA"], color: "AZ", size: "M" }),
    mkPage({ index: 2, products: ["LUA"], color: "AZ", size: "G" }),
  ];
  const groups = buildFilterGroups(pages, ["LUA"]);
  const qtd = groups[0].subGroups[0].subGroups[0];
  assert.equal(qtd.subGroups.length, 1);
  assert.equal(qtd.subGroups[0].color, "AZ");
  assert.equal(qtd.subGroups[0].subGroups.length, 3);
  assert.deepEqual(qtd.subGroups[0].pageIndexes, [0, 1, 2]);
});

test("buildFilterGroups: separa cores diferentes do mesmo modelo", () => {
  const pages: PageInfo[] = [
    mkPage({ index: 0, products: ["LUA"], color: "AZ", size: "P" }),
    mkPage({ index: 1, products: ["LUA"], color: "PT", size: "P" }),
  ];
  const groups = buildFilterGroups(pages, ["LUA"]);
  const qtd = groups[0].subGroups[0].subGroups[0];
  assert.equal(qtd.subGroups.length, 2);
  assert.deepEqual(
    qtd.subGroups.map((c) => c.color).sort(),
    ["AZ", "PT"],
  );
});

test("buildFilterGroups: KIT 2 e Unitário viram QtdSubGroups distintos", () => {
  const pages: PageInfo[] = [
    mkPage({
      index: 0,
      products: ["LUA"],
      color: "AZ",
      size: "P",
      kitType: null,
    }),
    mkPage({
      index: 1,
      products: ["LUA"],
      color: "AZ",
      size: "P",
      kitType: "KIT 2",
      isKit: true,
    }),
  ];
  const groups = buildFilterGroups(pages, ["LUA"]);
  const sku = groups[0].subGroups[0];
  assert.equal(sku.subGroups.length, 2);
  // Unitário primeiro (kitTypeOrder)
  assert.equal(sku.subGroups[0].label, UNITARIO_LABEL);
  assert.equal(sku.subGroups[1].label, "KIT 2");
});

test("buildFilterGroups: pageIndexes acumula em todos os níveis", () => {
  const pages: PageInfo[] = [
    mkPage({ index: 0, products: ["LUA"], color: "AZ", size: "P" }),
    mkPage({ index: 1, products: ["LUA"], color: "AZ", size: "M" }),
    mkPage({ index: 2, products: ["LUA"], color: "PT", size: "P" }),
  ];
  const groups = buildFilterGroups(pages, ["LUA"]);
  assert.deepEqual(groups[0].pageIndexes, [0, 1, 2]);
  assert.deepEqual(groups[0].subGroups[0].pageIndexes, [0, 1, 2]);
  assert.deepEqual(groups[0].subGroups[0].subGroups[0].pageIndexes, [0, 1, 2]);
  // ColorSubGroup AZ tem [0,1]; PT tem [2]
  const colorAZ = groups[0].subGroups[0].subGroups[0].subGroups.find(
    (c) => c.color === "AZ",
  )!;
  const colorPT = groups[0].subGroups[0].subGroups[0].subGroups.find(
    (c) => c.color === "PT",
  )!;
  assert.deepEqual(colorAZ.pageIndexes, [0, 1]);
  assert.deepEqual(colorPT.pageIndexes, [2]);
});

// ─── extractSkusAndColor ──────────────────────────────────────────────────

test("extractSkusAndColor: unitário 'LUA AZ G' (formato strict)", () => {
  const result = extractSkusAndColor("LUA AZ G", MODELS);
  assert.equal(result.color, "AZ");
  assert.equal(result.size, "G");
  assert.deepEqual(result.skus, ["LUA AZ G"]);
});

test("extractSkusAndColor: kit multi-cor 'KIT 3 LUA 2 PT 1 BR M'", () => {
  const result = extractSkusAndColor("KIT 3 LUA 2 PT 1 BR M", MODELS);
  // Cor canônica preserva qty por cor, ordem alfa.
  assert.equal(result.color, "1 BR + 2 PT");
  assert.equal(result.size, "M");
  assert.equal(result.skus.length, 2);
  assert.ok(result.skus.includes("LUA PT M"));
  assert.ok(result.skus.includes("LUA BR M"));
});

test("extractSkusAndColor: distingue '2 CZ + 1 PT' de '1 CZ + 2 PT'", () => {
  // Mesmas cores, qtys trocadas → labels distintas (kits diferentes).
  const a = extractSkusAndColor("KIT 3 LUA 2 CZ 1 PT G", MODELS);
  const b = extractSkusAndColor("KIT 3 LUA 1 CZ 2 PT G", MODELS);
  assert.equal(a.color, "2 CZ + 1 PT");
  assert.equal(b.color, "1 CZ + 2 PT");
  assert.notEqual(a.color, b.color);
});

test("extractSkusAndColor: kit multi-cor com 3 cores", () => {
  const result = extractSkusAndColor("KIT 4 LUA 1 PT 2 BR 1 VD M", MODELS);
  assert.equal(result.color, "2 BR + 1 PT + 1 VD");
  assert.equal(result.size, "M");
});

test("extractSkusAndColor: kit cor única no formato multi (qty omitida)", () => {
  // Cor única → qty redundante (kitType já mostra "KIT 2"), label crua.
  const result = extractSkusAndColor("KIT 2 LUA 2 AZ M", MODELS);
  assert.equal(result.color, "AZ");
  assert.equal(result.size, "M");
  assert.deepEqual(result.skus, ["LUA AZ M"]);
});

test("extractSkusAndColor: kit multi-cor sem qty explícita → assume 1 por cor", () => {
  // "KIT 2 LUA AZ CZ P" — sem dígito antes das cores. Cada uma vira qty=1.
  const result = extractSkusAndColor("KIT 2 LUA AZ CZ P", MODELS);
  assert.equal(result.color, "1 AZ + 1 CZ");
  assert.equal(result.size, "P");
  assert.equal(result.skus.length, 2);
  assert.ok(result.skus.includes("LUA AZ P"));
  assert.ok(result.skus.includes("LUA CZ P"));
});

test("extractSkusAndColor: kit multi-cor com qty mista (algumas explícitas)", () => {
  // "KIT 3 LUA 2 PT BR M" — PT tem qty=2, BR sem qty (assume 1).
  const result = extractSkusAndColor("KIT 3 LUA 2 PT BR M", MODELS);
  assert.equal(result.color, "1 BR + 2 PT");
  assert.equal(result.size, "M");
});

test("extractSkusAndColor: nenhum SKU detectado → null", () => {
  const result = extractSkusAndColor("texto sem nada relevante", MODELS);
  assert.equal(result.color, null);
  assert.equal(result.size, null);
  assert.deepEqual(result.skus, []);
});

test("extractSkusAndColor: ignora token capturado que coincide com tamanho conhecido", () => {
  // Hipotético "KIT 2 LUA 1 GG 1 PT M" — "GG" coincide com tamanho. Tem
  // que ser ignorado pra não virar uma "cor" GG. Cor real é PT.
  const result = extractSkusAndColor("KIT 2 LUA 1 GG 1 PT M", MODELS);
  assert.equal(result.color, "PT");
  assert.equal(result.size, "M");
});

test("extractSkusAndColor: múltiplos SKUs strict no mesmo texto", () => {
  const result = extractSkusAndColor("LUA AZ M e BOB PT G", MODELS);
  assert.equal(result.skus.length, 2);
  assert.ok(result.skus.includes("LUA AZ M"));
  assert.ok(result.skus.includes("BOB PT G"));
  // Strict implica qty=1 por cor → "1 AZ + 1 PT".
  assert.equal(result.color, "1 AZ + 1 PT");
});

test("extractSkusAndColor: lista de modelos vazia → não captura nada", () => {
  const result = extractSkusAndColor("LUA AZ M", []);
  assert.equal(result.color, null);
  assert.equal(result.size, null);
  assert.deepEqual(result.skus, []);
});

test("extractSkusAndColor: kit multi-cor + texto extra ao redor", () => {
  // Bens text real tem outras palavras antes/depois do SKU.
  const result = extractSkusAndColor(
    "Kit Térmicas Long KIT 3 LUA 2 PT 1 BR M Lisa Fria",
    MODELS,
  );
  assert.equal(result.color, "1 BR + 2 PT");
  assert.equal(result.size, "M");
});
