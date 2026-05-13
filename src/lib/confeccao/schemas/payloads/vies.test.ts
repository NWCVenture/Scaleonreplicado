import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calcularCustoVies,
  ConcluirSubtaskViesSchema,
  SubtaskViesPayloadSchema,
} from "./vies";

test("SubtaskViesPayload: aceita payload vazio", () => {
  const r = SubtaskViesPayloadSchema.safeParse({});
  assert.equal(r.success, true);
});

test("ConcluirSubtaskVies: aceita payload completo", () => {
  const r = ConcluirSubtaskViesSchema.safeParse({
    fornecedorViesId: "f1",
    tamanhoBandeiraCm: 8,
    tipoTecidoId: "t1",
    corId: "c1",
    metragemProduzidaM: 250.5,
    precoPorMetro: 1.2,
  });
  assert.equal(r.success, true);
});

test("ConcluirSubtaskVies: rejeita sem fornecedor", () => {
  const r = ConcluirSubtaskViesSchema.safeParse({
    tamanhoBandeiraCm: 8,
    tipoTecidoId: "t1",
    corId: "c1",
    metragemProduzidaM: 100,
    precoPorMetro: 1.2,
  });
  assert.equal(r.success, false);
});

test("ConcluirSubtaskVies: rejeita metragem zero", () => {
  const r = ConcluirSubtaskViesSchema.safeParse({
    fornecedorViesId: "f1",
    tamanhoBandeiraCm: 8,
    tipoTecidoId: "t1",
    corId: "c1",
    metragemProduzidaM: 0,
    precoPorMetro: 1.2,
  });
  assert.equal(r.success, false);
});

test("ConcluirSubtaskVies: rejeita bandeira > 500cm", () => {
  const r = ConcluirSubtaskViesSchema.safeParse({
    fornecedorViesId: "f1",
    tamanhoBandeiraCm: 600,
    tipoTecidoId: "t1",
    corId: "c1",
    metragemProduzidaM: 100,
    precoPorMetro: 1.2,
  });
  assert.equal(r.success, false);
});

test("calcularCustoVies: metragem × preço", () => {
  const c = calcularCustoVies({
    metragemProduzidaM: 250,
    precoPorMetro: 1.5,
  });
  assert.equal(c, 375);
});

test("calcularCustoVies: preço zero → custo zero", () => {
  const c = calcularCustoVies({
    metragemProduzidaM: 100,
    precoPorMetro: 0,
  });
  assert.equal(c, 0);
});
