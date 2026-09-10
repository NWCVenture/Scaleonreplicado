// Testes do contrato da etiqueta de fardo. Lógica pura — não toca o banco.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_QR_LEN,
  contarCampos,
  normalizarSku,
  temIdentidade,
  validarQR,
} from "./fardo-qr";

// Payloads reais, no formato que os scanners da operação emitem (separador `{`
// e `Ç` no lugar de `:` — layout US traduzido pra ABNT2).
const V3 =
  "LUA CZ M{NARCISIO LOTE 124{60{F-20260904-PJFCV{2026-09-04T12Ç30Ç08.332Z{Beatriz Melo{7b16f0cf-003c-40ef-80cf-1ed66342cb6f";
const V2 = "LUA CZ M{NARCISIO LOTE 124{60{F-20260904-PJFCV";
const V1 = "SOL BR M{ESTOQUE PADRAO{40";

// ============================================================
// normalizarSku
// ============================================================

test("normalizarSku: maiúsculas, bordas e espaços internos colapsados", () => {
  assert.equal(normalizarSku("lua cz m"), "LUA CZ M");
  assert.equal(normalizarSku("LUA  CZ  M"), "LUA CZ M");
  assert.equal(normalizarSku("  Lua Cz M  "), "LUA CZ M");
  assert.equal(normalizarSku("LUA\tCZ\nM"), "LUA CZ M");
});

test("normalizarSku: as 4 grafias observadas no banco convergem", () => {
  const observadas = ["LUA CZ M", "LUA  CZ  M", "lua cz m", "Lua Cz M"];
  const canonicas = new Set(observadas.map(normalizarSku));
  assert.equal(canonicas.size, 1, "deveriam virar um único SKU");
  assert.equal([...canonicas][0], "LUA CZ M");
});

// ============================================================
// contarCampos
// ============================================================

test("contarCampos: reconhece as três versões", () => {
  assert.equal(contarCampos(V1), 3);
  assert.equal(contarCampos(V2), 4);
  assert.equal(contarCampos(V3), 7);
});

test("contarCampos: `}`, `{` e `|` são equivalentes", () => {
  assert.equal(contarCampos("A}B}3"), 3);
  assert.equal(contarCampos("A{B{3"), 3);
  assert.equal(contarCampos("A|B|3"), 3);
});

test("contarCampos: separador solto no início é ignorado", () => {
  assert.equal(contarCampos("{LUA CZ M{LOTE{60"), 3);
});

// ============================================================
// validarQR — casos válidos
// ============================================================

test("validarQR: v3 devolve identidade completa", () => {
  const r = validarQR(V3);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.fardo.versao, 3);
  assert.equal(r.fardo.sku, "LUA CZ M");
  assert.equal(r.fardo.lote, "NARCISIO LOTE 124");
  assert.equal(r.fardo.quantidade, 60);
  assert.equal(r.fardo.codigoFardo, "F-20260904-PJFCV");
  assert.equal(r.fardo.fardoUuid, "7b16f0cf-003c-40ef-80cf-1ed66342cb6f");
});

test("validarQR: v2 tem codigoFardo mas não uuid", () => {
  const r = validarQR(V2);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.fardo.versao, 2);
  assert.equal(r.fardo.codigoFardo, "F-20260904-PJFCV");
  assert.equal(r.fardo.fardoUuid, null);
});

test("validarQR: v1 não tem identidade nenhuma", () => {
  const r = validarQR(V1);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.fardo.versao, 1);
  assert.equal(r.fardo.codigoFardo, null);
  assert.equal(r.fardo.fardoUuid, null);
});

test("validarQR: SKU é normalizado na entrada", () => {
  const r = validarQR("lua  cz  m{NARCISIO LOTE 124{60");
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.fardo.sku, "LUA CZ M");
});

test("validarQR: qrCode preservado como veio (só bordas aparadas)", () => {
  const r = validarQR(`  ${V3}  `);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.fardo.qrCode, V3);
});

// ============================================================
// validarQR — casos recusados
// ============================================================

test("validarQR: vazio é recusado", () => {
  for (const entrada of ["", "   ", "\n"]) {
    const r = validarQR(entrada);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.motivo, "vazio");
  }
});

test("validarQR: bloco colado de várias etiquetas é recusado", () => {
  // Regressão do caso real: 24 linhas coladas de uma vez viraram um único
  // registro de 2.660 caracteres — 23 etiquetas descartadas em silêncio.
  const bloco = Array.from({ length: 24 }, () => V3).join(" ");
  const r = validarQR(bloco);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.motivo, "tamanho-excedido");
});

test("validarQR: excesso de campos é recusado mesmo dentro do tamanho", () => {
  const r = validarQR("A{B{3{D{E{F{G{H");
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.motivo, "campos-invalidos");
  assert.match(r.detalhe, /8 campo/);
});

test("validarQR: 5 e 6 campos não são versões conhecidas", () => {
  for (const entrada of ["A{B{3{D{E", "A{B{3{D{E{F"]) {
    const r = validarQR(entrada);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.motivo, "campos-invalidos");
  }
});

test("validarQR: menos de 3 campos é recusado", () => {
  const r = validarQR("LUA CZ M{LOTE");
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.motivo, "campos-invalidos");
});

test("validarQR: quantidade não numérica é recusada", () => {
  const r = validarQR("LUA CZ M{NARCISIO LOTE 124{abc");
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.motivo, "nao-parseavel");
});

test("validarQR: exatamente no limite passa, um a mais não", () => {
  const cauda = "{LOTE{60";
  const noLimite = "S".repeat(MAX_QR_LEN - cauda.length) + cauda;
  assert.equal(noLimite.length, MAX_QR_LEN);
  assert.equal(validarQR(noLimite).ok, true);

  const acima = "S".repeat(MAX_QR_LEN - cauda.length + 1) + cauda;
  const r = validarQR(acima);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.motivo, "tamanho-excedido");
});

// ============================================================
// temIdentidade
// ============================================================

test("temIdentidade: v2 e v3 são deduplicáveis, v1 não", () => {
  for (const [payload, esperado] of [
    [V3, true],
    [V2, true],
    [V1, false],
  ] as const) {
    const r = validarQR(payload);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(temIdentidade(r.fardo), esperado);
  }
});
