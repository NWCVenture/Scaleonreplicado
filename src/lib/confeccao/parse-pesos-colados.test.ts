// Testes do parser de pesos colados do Excel (RITM-30).

import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePesosColados } from "./parse-pesos-colados";

test("texto vazio → array vazio", () => {
  assert.deepEqual(parsePesosColados(""), []);
});

test("um único valor", () => {
  assert.deepEqual(parsePesosColados("12.5"), [12.5]);
});

test("coluna do Excel (\\r\\n entre células)", () => {
  // Excel Windows copia células de coluna com \r\n no fim de cada
  assert.deepEqual(parsePesosColados("12.5\r\n13.1\r\n14.0\r\n"), [
    12.5, 13.1, 14.0,
  ]);
});

test("coluna com \\n simples", () => {
  assert.deepEqual(parsePesosColados("12.5\n13.1\n14"), [12.5, 13.1, 14]);
});

test("linha do Excel (\\t entre células)", () => {
  assert.deepEqual(parsePesosColados("12.5\t13.1\t14"), [12.5, 13.1, 14]);
});

test("vírgula brasileira como decimal", () => {
  assert.deepEqual(parsePesosColados("12,5\n13,1\n14"), [12.5, 13.1, 14]);
});

test("filtra NaN e lixo entre valores", () => {
  assert.deepEqual(parsePesosColados("12.5\nabc\n13.1\nxyz"), [12.5, 13.1]);
});

test("filtra vazios entre valores", () => {
  assert.deepEqual(parsePesosColados("12.5\n\n13.1\n\n\n14"), [
    12.5, 13.1, 14,
  ]);
});

test("filtra negativos", () => {
  assert.deepEqual(parsePesosColados("12.5\n-3\n13.1"), [12.5, 13.1]);
});

test("aceita zero", () => {
  // zero é peso plausível (rolo vazio? marker?) — caller decide
  assert.deepEqual(parsePesosColados("12.5\n0\n13.1"), [12.5, 0, 13.1]);
});

test("trim de espaços ao redor", () => {
  assert.deepEqual(parsePesosColados("  12.5  \n  13.1  "), [12.5, 13.1]);
});

test("Infinity e -Infinity filtrados", () => {
  assert.deepEqual(parsePesosColados("12.5\nInfinity\n-Infinity\n13"), [
    12.5, 13,
  ]);
});

test("paste de 30 valores (caso realista)", () => {
  const linhas = Array.from({ length: 30 }, (_, i) => `${(13 + i * 0.05).toFixed(2)}`);
  const texto = linhas.join("\r\n");
  const result = parsePesosColados(texto);
  assert.equal(result.length, 30);
  assert.equal(result[0], 13);
  assert.equal(result[29], 14.45);
});
