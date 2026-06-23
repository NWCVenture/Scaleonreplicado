import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePesoFolhasColados } from "./parse-peso-folhas-colados";

test("1 coluna (só pesos): folhas null em todos", () => {
  const r = parsePesoFolhasColados("12,5\n13,1\n12,8");
  assert.deepEqual(r, [
    { peso: 12.5, folhas: null },
    { peso: 13.1, folhas: null },
    { peso: 12.8, folhas: null },
  ]);
});

test("2 colunas (peso + folhas via tab)", () => {
  const r = parsePesoFolhasColados("12,5\t40\n13,1\t42\n12,8\t41");
  assert.deepEqual(r, [
    { peso: 12.5, folhas: 40 },
    { peso: 13.1, folhas: 42 },
    { peso: 12.8, folhas: 41 },
  ]);
});

test("misturado: algumas linhas com folhas, outras só peso", () => {
  const r = parsePesoFolhasColados("12,5\t40\n13,1\n12,8\t41");
  assert.deepEqual(r, [
    { peso: 12.5, folhas: 40 },
    { peso: 13.1, folhas: null },
    { peso: 12.8, folhas: 41 },
  ]);
});

test("linhas vazias e lixo são filtrados", () => {
  const r = parsePesoFolhasColados("\n12,5\t40\n\n  \n13,1\t42\n");
  assert.equal(r.length, 2);
});

test("peso inválido descarta linha", () => {
  const r = parsePesoFolhasColados("abc\t40\n13,1\t42\n0\t10\n-5\t5");
  assert.deepEqual(r, [{ peso: 13.1, folhas: 42 }]);
});

test("folhas inválido vira null", () => {
  const r = parsePesoFolhasColados("12,5\tabc\n13,1\t-5");
  assert.deepEqual(r, [
    { peso: 12.5, folhas: null },
    { peso: 13.1, folhas: null },
  ]);
});

test("vazio → []", () => {
  assert.deepEqual(parsePesoFolhasColados(""), []);
});
