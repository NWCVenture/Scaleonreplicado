// Testes da extração de códigos de pacote bipados na Coletas.
// Casos reais: etiquetas TikTok Shop / iMile BR de 2026-07-01.

import { test } from "node:test";
import assert from "node:assert/strict";
import { detectCarrier, extractShippingIds } from "./coletas-utils";

const IMILE = "3320050630194"; // Código de Rastreamento da etiqueta
const IMILE_2 = "3320050633898";
const NFE = "35260762667680000159550020000392051130498240"; // chave NF-e, código de barras de baixo
const N_REF = "3458775777017841284"; // "N° de Ref" impresso na etiqueta
const ML = "40000000000";
const SHOPEE = "BR1234567890123";

test("extractShippingIds: rastreio iMile bipado sozinho", () => {
  assert.deepEqual(extractShippingIds(IMILE), [IMILE]);
});

test("extractShippingIds: aceita Enter/CR do leitor no fim", () => {
  assert.deepEqual(extractShippingIds(`${IMILE}\n`), [IMILE]);
  assert.deepEqual(extractShippingIds(`${IMILE}\r\n`), [IMILE]);
});

test("extractShippingIds: chave da NF-e não vira pacote", () => {
  // Antes: 3 pacotes falsos (35260762667680, 00015955002000, 03920511304982)
  assert.deepEqual(extractShippingIds(NFE), []);
});

test("extractShippingIds: Nº de Ref não vira pacote", () => {
  // Antes: 1 pacote falso (34587757770178)
  assert.deepEqual(extractShippingIds(N_REF), []);
});

test("extractShippingIds: duas leituras coladas sem separador não viram código falso", () => {
  // Antes: 33200506301943 — o primeiro código com um dígito do segundo
  assert.deepEqual(extractShippingIds(IMILE + IMILE_2), []);
});

test("extractShippingIds: duas leituras separadas por Enter ou espaço", () => {
  assert.deepEqual(extractShippingIds(`${IMILE}\n${IMILE_2}\n`), [IMILE, IMILE_2]);
  assert.deepEqual(extractShippingIds(`${IMILE} ${IMILE_2}`), [IMILE, IMILE_2]);
});

test("extractShippingIds: 13-14 dígitos começando com 4 saem inteiros", () => {
  // Antes: cortado para 11 dígitos na alternativa do Mercado Livre
  assert.deepEqual(extractShippingIds("4099001122334"), ["4099001122334"]);
  assert.deepEqual(extractShippingIds("40990011223344"), ["40990011223344"]);
});

test("extractShippingIds: 15 dígitos ou mais não são recortados", () => {
  assert.deepEqual(extractShippingIds("881234567890123"), []);
});

test("extractShippingIds: Mercado Livre e Shopee continuam funcionando", () => {
  assert.deepEqual(extractShippingIds(ML), [ML]);
  assert.deepEqual(extractShippingIds(SHOPEE), [SHOPEE]);
  assert.deepEqual(extractShippingIds("BR123456789012X"), ["BR123456789012X"]);
});

test("extractShippingIds: código dentro de texto com separadores", () => {
  assert.deepEqual(extractShippingIds(`rastreio: ${IMILE}; ref`), [IMILE]);
});

test("detectCarrier: rastreio iMile com prefixo cadastrado", () => {
  const padroes = [{ id: "imile", transportadora: "TTK-IMILE", prefixos: ["3320"] }];
  assert.equal(detectCarrier(IMILE, padroes), "TTK_IMILE");
  assert.equal(detectCarrier(IMILE, []), "DESCONHECIDA");
});
