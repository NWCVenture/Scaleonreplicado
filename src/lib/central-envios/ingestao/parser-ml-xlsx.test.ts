// Testes do parser ML XLSX.
//
// Fixtures geradas em código (não commitamos XLSX binário no repo).
// Estrutura: linhas 0-4 = metadata, linha 5 = header, linhas 6+ = dados.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  parsearMlXlsx,
  ParserError,
  MAX_INPUT_BYTES,
} from "./parser-ml-xlsx";

const HEADER_ML = [
  "N.º de venda",
  "Data da venda",
  "SKU",
  "Variação",
  "Estado",
  "Unidades",
  "Comprador",
  "N.º de envio",
] as const;

const METADATA_LINHAS = [
  ["Vendas BR — Mercado Livre y Mercado Shops"],
  ["Conta: NWC"],
  [""],
  ["Período: 2026-06-01 a 2026-06-05"],
  [""],
];

// Monta um Buffer XLSX a partir de:
//   - metadata fixa (5 linhas)
//   - header (pode ser customizado pra testes de coluna ausente)
//   - linhas de dados (arrays alinhados ao header)
function montarXlsx(linhas: unknown[][], header: readonly string[] = HEADER_ML): Buffer {
  const aoa = [...METADATA_LINHAS, [...header], ...linhas];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Vendas");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

test("XLSX básico — 2 linhas válidas", () => {
  const buf = montarXlsx([
    [
      "2000000000000001",
      new Date(Date.UTC(2026, 5, 5, 17, 42, 0)), // 2026-06-05 17:42 UTC = 14:42 SP
      "SKU-A",
      "Cor: AA / Tamanho: M",
      "Em separação",
      1,
      "buyer1",
      "ME1000000000BR",
    ],
    [
      "2000000000000002",
      new Date(Date.UTC(2026, 5, 5, 18, 0, 0)),
      "SKU-B",
      "Cor: BB",
      "coleta do dia 7 de junho",
      2,
      "buyer2",
      "ME1000000000BR2",
    ],
  ]);

  const r = parsearMlXlsx(buf);
  assert.equal(r.totalLinhas, 2);
  assert.equal(r.linhasValidas, 2);
  assert.equal(r.linhasDescartadas, 0);

  const p0 = r.pedidos[0];
  assert.equal(p0.canal, "mercado_livre");
  assert.equal(p0.numeroVenda, "2000000000000001");
  assert.equal(p0.numeroEnvio, "ME1000000000BR");
  assert.equal(p0.sku, "SKU-A");
  assert.equal(p0.unidades, 1);
  assert.equal(p0.estado, "Em separação");
  assert.equal(p0.variacao, "Cor: AA / Tamanho: M");
  assert.equal(p0.comprador, "buyer1");
});

test("Metadata nas linhas 1-5 não vaza pra dados", () => {
  const buf = montarXlsx([
    [
      "2000000000000001",
      new Date(),
      "SKU-A",
      "",
      "",
      1,
      "buyer1",
      "ME1",
    ],
  ]);
  const r = parsearMlXlsx(buf);
  // Se metadata vazasse: r.totalLinhas seria > 1 OU header não bateria.
  assert.equal(r.totalLinhas, 1);
  assert.equal(r.linhasValidas, 1);
});

test("Linha 'Pacote de 3 produtos' → descarte pacote_diversos", () => {
  const buf = montarXlsx([
    [
      "2000000000000001",
      new Date(),
      "Pacote de 3 produtos",
      "",
      "",
      3,
      "buyer1",
      "ME1",
    ],
    [
      "2000000000000002",
      new Date(),
      "SKU-A",
      "",
      "",
      1,
      "buyer1",
      "ME2",
    ],
  ]);
  const r = parsearMlXlsx(buf);
  assert.equal(r.totalLinhas, 2);
  assert.equal(r.linhasValidas, 1);
  assert.equal(r.descartesResumo.pacote_diversos, 1);
});

test("Dedup intra-arquivo: mesmo N.º de venda → mantém primeiro", () => {
  const buf = montarXlsx([
    [
      "2000000000000001",
      new Date(),
      "SKU-A",
      "",
      "",
      1,
      "buyer1",
      "ME1",
    ],
    [
      "2000000000000001",
      new Date(),
      "SKU-A-DUP",
      "",
      "",
      9,
      "buyer1",
      "ME1",
    ],
  ]);
  const r = parsearMlXlsx(buf);
  assert.equal(r.totalLinhas, 2);
  assert.equal(r.linhasValidas, 1);
  assert.equal(r.descartesResumo.dedup_intra_arquivo, 1);
  // Manteve o primeiro (SKU-A), não o DUP
  assert.equal(r.pedidos[0].sku, "SKU-A");
});

test("N.º de venda vazio → descarte numero_venda_vazio", () => {
  const buf = montarXlsx([
    ["", new Date(), "SKU-A", "", "", 1, "buyer1", "ME1"],
  ]);
  const r = parsearMlXlsx(buf);
  assert.equal(r.linhasValidas, 0);
  assert.equal(r.descartesResumo.numero_venda_vazio, 1);
});

test("Unidades 0 / -1 / 'abc' → descarte quantidade_invalida", () => {
  const buf = montarXlsx([
    ["2000000000000001", new Date(), "SKU-A", "", "", 0, "b", "ME1"],
    ["2000000000000002", new Date(), "SKU-B", "", "", -1, "b", "ME2"],
    ["2000000000000003", new Date(), "SKU-C", "", "", "abc", "b", "ME3"],
  ]);
  const r = parsearMlXlsx(buf);
  assert.equal(r.linhasValidas, 0);
  assert.equal(r.descartesResumo.quantidade_invalida, 3);
});

test("Coluna obrigatória ausente (SKU removida) → ParserError colunas_ausentes", () => {
  const headerSemSku: readonly string[] = HEADER_ML.filter((c) => c !== "SKU");
  const buf = montarXlsx(
    [
      [
        "2000000000000001",
        new Date(),
        "Cor: AA",
        "",
        1,
        "buyer1",
        "ME1",
      ],
    ],
    headerSemSku,
  );
  assert.throws(
    () => parsearMlXlsx(buf),
    (err: unknown) => {
      assert.ok(err instanceof ParserError);
      assert.equal((err as ParserError).codigo, "colunas_ausentes");
      assert.match((err as ParserError).message, /SKU/);
      return true;
    },
  );
});

test("Colunas opcionais ausentes → parser segue, campos null", () => {
  // Mantém só as 4 obrigatórias
  const headerMinimo = ["N.º de venda", "Data da venda", "SKU", "Unidades"];
  const buf = montarXlsx(
    [["2000000000000001", new Date(), "SKU-A", 1]],
    headerMinimo,
  );
  const r = parsearMlXlsx(buf);
  assert.equal(r.linhasValidas, 1);
  assert.equal(r.pedidos[0].variacao, null);
  assert.equal(r.pedidos[0].estado, null);
  assert.equal(r.pedidos[0].comprador, null);
  assert.equal(r.pedidos[0].numeroEnvio, null);
});

test("Data da venda como Date nativo → dataVendaIso é ISO UTC", () => {
  const d = new Date(Date.UTC(2026, 5, 5, 17, 42, 0));
  const buf = montarXlsx([
    ["2000000000000001", d, "SKU-A", "", "", 1, "b", "ME1"],
  ]);
  const r = parsearMlXlsx(buf);
  assert.equal(r.pedidos[0].dataVendaIso, "2026-06-05T17:42:00.000Z");
});

test("Data da venda como string pt-BR '05/06/2026 14:42:00' → ISO SP UTC-3", () => {
  // 14:42 local SP + 3h = 17:42 UTC
  const buf = montarXlsx([
    [
      "2000000000000001",
      "05/06/2026 14:42:00",
      "SKU-A",
      "",
      "",
      1,
      "b",
      "ME1",
    ],
  ]);
  const r = parsearMlXlsx(buf);
  assert.equal(r.pedidos[0].dataVendaIso, "2026-06-05T17:42:00.000Z");
  assert.equal(r.pedidos[0].dataVendaRaw, "05/06/2026 14:42:00");
});

test("Data da venda em formato desconhecido → dataVendaIso null, raw preservado", () => {
  const buf = montarXlsx([
    [
      "2000000000000001",
      "2026-W23-FRI",
      "SKU-A",
      "",
      "",
      1,
      "b",
      "ME1",
    ],
  ]);
  const r = parsearMlXlsx(buf);
  assert.equal(r.pedidos[0].dataVendaIso, null);
  assert.equal(r.pedidos[0].dataVendaRaw, "2026-W23-FRI");
});

test("1000 linhas — parse rápido", () => {
  const linhas: unknown[][] = [];
  const baseDate = Date.UTC(2026, 5, 5, 17, 42, 0);
  for (let i = 0; i < 1000; i++) {
    linhas.push([
      `2000000000${String(i).padStart(6, "0")}`,
      new Date(baseDate + i * 60_000),
      `SKU-${i % 10}`,
      "",
      "",
      1,
      `b${i}`,
      `ME${i}`,
    ]);
  }
  const buf = montarXlsx(linhas);
  const inicio = Date.now();
  const r = parsearMlXlsx(buf);
  const duracao = Date.now() - inicio;
  assert.equal(r.linhasValidas, 1000);
  assert.ok(duracao < 3000, `parse de 1000 linhas levou ${duracao}ms (esperado < 3000)`);
});

test("Idempotência: 2 chamadas com mesmo Buffer → deepStrictEqual", () => {
  const buf = montarXlsx([
    [
      "2000000000000001",
      new Date(Date.UTC(2026, 5, 5, 17, 42, 0)),
      "SKU-A",
      "",
      "",
      1,
      "b",
      "ME1",
    ],
  ]);
  const r1 = parsearMlXlsx(buf);
  const r2 = parsearMlXlsx(buf);
  assert.deepStrictEqual(r1, r2);
});

test("Input > MAX_INPUT_BYTES → ParserError arquivo_muito_grande", () => {
  const buf = Buffer.alloc(MAX_INPUT_BYTES + 1, 0x00);
  assert.throws(
    () => parsearMlXlsx(buf),
    (err: unknown) => {
      assert.ok(err instanceof ParserError);
      assert.equal((err as ParserError).codigo, "arquivo_muito_grande");
      return true;
    },
  );
});

test("Estado com 'coleta do dia X de Y' → vem literal (RITM-06 extrai prazo)", () => {
  const buf = montarXlsx([
    [
      "2000000000000001",
      new Date(),
      "SKU-A",
      "",
      "coleta do dia 7 de junho",
      1,
      "b",
      "ME1",
    ],
  ]);
  const r = parsearMlXlsx(buf);
  assert.equal(r.pedidos[0].estado, "coleta do dia 7 de junho");
});

test("Encoding: coluna 'N.º' (U+00BA, ordinal) é reconhecida no header", () => {
  // Sanity check — confirma que o caractere está sendo preservado na
  // round-trip XLSX. Se algum dia o xlsx normalizar pra U+00B0
  // (degree), os testes principais falham em "colunas_ausentes" e
  // este teste explicita o motivo.
  const buf = montarXlsx([
    [
      "2000000000000001",
      new Date(),
      "SKU-A",
      "",
      "",
      1,
      "b",
      "ME1",
    ],
  ]);
  // Confirma que o header gerado contém o caractere U+00BA
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const headerRow = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    range: 5,
    raw: true,
  })[0] as string[];
  assert.ok(headerRow.some((c) => c === "N.º de venda"));
  assert.ok(headerRow.some((c) => c === "N.º de envio"));
});
