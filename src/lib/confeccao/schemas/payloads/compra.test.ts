import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calcularCustoTotal,
  calcularPesoTotal,
  ConcluirSubtaskCompraSchema,
  SubtaskCompraPayloadSchema,
} from "./compra";

test("SubtaskCompraPayload: aceita payload vazio", () => {
  const r = SubtaskCompraPayloadSchema.safeParse({});
  assert.equal(r.success, true);
});

test("SubtaskCompraPayload: aceita só pre", () => {
  const r = SubtaskCompraPayloadSchema.safeParse({
    pre: {
      fornecedorId: "f1",
      tipoTecidoId: "t1",
      destinatarioCorteId: "c1",
      cores: [{ corId: "co1", kgsSolicitados: 10 }],
    },
  });
  assert.equal(r.success, true);
});

test("SubtaskCompraPayload: rejeita kgsSolicitados negativo", () => {
  const r = SubtaskCompraPayloadSchema.safeParse({
    pre: {
      fornecedorId: "f1",
      tipoTecidoId: "t1",
      destinatarioCorteId: "c1",
      cores: [{ corId: "co1", kgsSolicitados: -5 }],
    },
  });
  assert.equal(r.success, false);
});

test("ConcluirSubtaskCompra: rejeita cor em pos que não está em pre", () => {
  const r = ConcluirSubtaskCompraSchema.safeParse({
    pre: {
      fornecedorId: "f1",
      tipoTecidoId: "t1",
      destinatarioCorteId: "c1",
      cores: [{ corId: "co1", kgsSolicitados: 10 }],
    },
    pos: {
      rolosRecebidos: [{ corId: "co_FANTASMA", pesos: [5.5] }],
      precoKgEfetivo: 25,
      gramaturaGM2: 180,
      larguraRoloCm: 165,
    },
  });
  assert.equal(r.success, false);
});

test("ConcluirSubtaskCompra: aceita payload válido completo", () => {
  const r = ConcluirSubtaskCompraSchema.safeParse({
    pre: {
      fornecedorId: "f1",
      tipoTecidoId: "t1",
      destinatarioCorteId: "c1",
      cores: [
        { corId: "co1", kgsSolicitados: 10 },
        { corId: "co2", kgsSolicitados: 5 },
      ],
    },
    pos: {
      rolosRecebidos: [
        { corId: "co1", pesos: [6.5, 4.2] },
        { corId: "co2", pesos: [5.1] },
      ],
      precoKgEfetivo: 25.5,
      gramaturaGM2: 180,
      larguraRoloCm: 165,
    },
  });
  assert.equal(r.success, true);
});

test("calcularPesoTotal: soma de todos os pesos", () => {
  const total = calcularPesoTotal({
    rolosRecebidos: [
      { corId: "co1", pesos: [6.5, 4.2] },
      { corId: "co2", pesos: [5.1] },
    ],
    precoKgEfetivo: 25,
    gramaturaGM2: 180,
    larguraRoloCm: 165,
  });
  // 6.5 + 4.2 + 5.1 = 15.8
  assert.ok(Math.abs(total - 15.8) < 0.001);
});

test("calcularCustoTotal: peso × preço", () => {
  const custo = calcularCustoTotal({
    rolosRecebidos: [
      { corId: "co1", pesos: [10] },
    ],
    precoKgEfetivo: 25.5,
    gramaturaGM2: 180,
    larguraRoloCm: 165,
  });
  assert.equal(custo, 255);
});
