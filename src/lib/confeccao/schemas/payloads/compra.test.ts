// Testes do schema/helpers da subtask Compra (OPBUY) — RITM-29 (multi-fornecedor + spill rolos).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agruparKgContratadoPorCor,
  agruparPesoRecebidoPorCor,
  agruparRolosContratadosPorCor,
  calcularCustoTotal,
  calcularPesoRealTotal,
  calcularPesoContratadoTotal,
  ConcluirSubtaskCompraSchema,
  SubtaskCompraPayloadSchema,
} from "./compra";

// ──────────────────────────────────────────────────────────────────────
// Schema parsing
// ──────────────────────────────────────────────────────────────────────

test("SubtaskCompraPayload: aceita payload vazio", () => {
  const r = SubtaskCompraPayloadSchema.safeParse({});
  assert.equal(r.success, true);
});

test("SubtaskCompraPayload: aceita 1 fornecedor com cores parciais", () => {
  const r = SubtaskCompraPayloadSchema.safeParse({
    fornecedores: [
      {
        fornecedorId: "f1",
        cores: [
          {
            corId: "c-az",
            kgsContratados: 100,
            qtdRolosContratados: 5,
            precoPorKg: 25,
            pesosRolos: [20, 19.5],
          },
        ],
      },
    ],
    tipoTecidoId: "t1",
    destinatarioCorteId: "of-corte",
  });
  assert.equal(r.success, true);
});

test("SubtaskCompraPayload: aceita 2 fornecedores", () => {
  const r = SubtaskCompraPayloadSchema.safeParse({
    fornecedores: [
      {
        fornecedorId: "f1",
        cores: [
          {
            corId: "c-az",
            kgsContratados: 100,
            qtdRolosContratados: 5,
            precoPorKg: 25,
            pesosRolos: [],
          },
        ],
      },
      {
        fornecedorId: "f2",
        cores: [
          {
            corId: "c-az",
            kgsContratados: 50,
            qtdRolosContratados: 3,
            precoPorKg: 23,
            pesosRolos: [],
          },
        ],
      },
    ],
  });
  assert.equal(r.success, true);
});

test("SubtaskCompraPayload: rejeita kgsContratados negativo", () => {
  const r = SubtaskCompraPayloadSchema.safeParse({
    fornecedores: [
      {
        fornecedorId: "f1",
        cores: [
          {
            corId: "c-az",
            kgsContratados: -5,
            qtdRolosContratados: 1,
            precoPorKg: 25,
            pesosRolos: [],
          },
        ],
      },
    ],
  });
  assert.equal(r.success, false);
});

// ──────────────────────────────────────────────────────────────────────
// Conclusão — refinements
// ──────────────────────────────────────────────────────────────────────

test("ConcluirSubtaskCompra: aceita payload válido completo", () => {
  const r = ConcluirSubtaskCompraSchema.safeParse({
    fornecedores: [
      {
        fornecedorId: "f1",
        cores: [
          {
            corId: "c-az",
            kgsContratados: 100,
            qtdRolosContratados: 3,
            precoPorKg: 25,
            pesosRolos: [33, 34, 33],
          },
        ],
      },
    ],
    destinatarioCorteId: "of-corte",
    tipoTecidoId: "t1",
    gramaturaGM2: 220,
    larguraRoloCm: 180,
  });
  assert.equal(r.success, true);
});

test("ConcluirSubtaskCompra: rejeita quando pesos.length != qtdRolosContratados", () => {
  const r = ConcluirSubtaskCompraSchema.safeParse({
    fornecedores: [
      {
        fornecedorId: "f1",
        cores: [
          {
            corId: "c-az",
            kgsContratados: 100,
            qtdRolosContratados: 5,
            precoPorKg: 25,
            pesosRolos: [33, 34], // 2 pesos pra 5 rolos
          },
        ],
      },
    ],
    destinatarioCorteId: "of-corte",
    tipoTecidoId: "t1",
    gramaturaGM2: 220,
    larguraRoloCm: 180,
  });
  assert.equal(r.success, false);
  if (!r.success) {
    assert.match(r.error.issues[0].message, /não bate/);
  }
});

test("ConcluirSubtaskCompra: rejeita cor duplicada dentro do mesmo fornecedor", () => {
  const r = ConcluirSubtaskCompraSchema.safeParse({
    fornecedores: [
      {
        fornecedorId: "f1",
        cores: [
          {
            corId: "c-az",
            kgsContratados: 100,
            qtdRolosContratados: 1,
            precoPorKg: 25,
            pesosRolos: [100],
          },
          {
            corId: "c-az", // duplicada
            kgsContratados: 50,
            qtdRolosContratados: 1,
            precoPorKg: 26,
            pesosRolos: [50],
          },
        ],
      },
    ],
    destinatarioCorteId: "of-corte",
    tipoTecidoId: "t1",
    gramaturaGM2: 220,
    larguraRoloCm: 180,
  });
  assert.equal(r.success, false);
  if (!r.success) {
    assert.match(r.error.issues[0].message, /Cor duplicada/);
  }
});

test("ConcluirSubtaskCompra: aceita mesma cor entre fornecedores distintos", () => {
  const r = ConcluirSubtaskCompraSchema.safeParse({
    fornecedores: [
      {
        fornecedorId: "f1",
        cores: [
          {
            corId: "c-az",
            kgsContratados: 100,
            qtdRolosContratados: 1,
            precoPorKg: 25,
            pesosRolos: [100],
          },
        ],
      },
      {
        fornecedorId: "f2",
        cores: [
          {
            corId: "c-az", // ok — outro fornecedor
            kgsContratados: 50,
            qtdRolosContratados: 1,
            precoPorKg: 26,
            pesosRolos: [50],
          },
        ],
      },
    ],
    destinatarioCorteId: "of-corte",
    tipoTecidoId: "t1",
    gramaturaGM2: 220,
    larguraRoloCm: 180,
  });
  assert.equal(r.success, true);
});

test("ConcluirSubtaskCompra: rejeita fornecedor duplicado", () => {
  const r = ConcluirSubtaskCompraSchema.safeParse({
    fornecedores: [
      {
        fornecedorId: "f1",
        cores: [
          {
            corId: "c-az",
            kgsContratados: 100,
            qtdRolosContratados: 1,
            precoPorKg: 25,
            pesosRolos: [100],
          },
        ],
      },
      {
        fornecedorId: "f1", // duplicado
        cores: [
          {
            corId: "c-pt",
            kgsContratados: 50,
            qtdRolosContratados: 1,
            precoPorKg: 26,
            pesosRolos: [50],
          },
        ],
      },
    ],
    destinatarioCorteId: "of-corte",
    tipoTecidoId: "t1",
    gramaturaGM2: 220,
    larguraRoloCm: 180,
  });
  assert.equal(r.success, false);
  if (!r.success) {
    assert.match(r.error.issues[0].message, /Fornecedor duplicado/);
  }
});

// ──────────────────────────────────────────────────────────────────────
// Helpers de agregação
// ──────────────────────────────────────────────────────────────────────

const PAYLOAD_2_FORNECEDORES = {
  fornecedores: [
    {
      fornecedorId: "f1",
      cores: [
        {
          corId: "c-az",
          kgsContratados: 100,
          qtdRolosContratados: 3,
          precoPorKg: 25,
          pesosRolos: [33, 34, 33], // 100kg real
        },
        {
          corId: "c-pt",
          kgsContratados: 200,
          qtdRolosContratados: 5,
          precoPorKg: 28,
          pesosRolos: [40, 40, 40, 40, 40], // 200kg
        },
      ],
    },
    {
      fornecedorId: "f2",
      cores: [
        {
          corId: "c-az", // mesma cor, outro fornecedor
          kgsContratados: 50,
          qtdRolosContratados: 2,
          precoPorKg: 22,
          pesosRolos: [25, 25], // 50kg
        },
      ],
    },
  ],
};

test("calcularPesoContratadoTotal: soma todos contratados cross-fornecedor", () => {
  // 100 + 200 + 50 = 350
  assert.equal(calcularPesoContratadoTotal(PAYLOAD_2_FORNECEDORES), 350);
});

test("calcularPesoRealTotal: soma todos pesos cross-fornecedor", () => {
  // 100 + 200 + 50 = 350
  assert.equal(calcularPesoRealTotal(PAYLOAD_2_FORNECEDORES), 350);
});

test("calcularCustoTotal: peso real × preço por cor, somado", () => {
  // f1: 100*25 + 200*28 = 2500 + 5600 = 8100
  // f2: 50*22 = 1100
  // total = 9200
  assert.equal(calcularCustoTotal(PAYLOAD_2_FORNECEDORES), 9200);
});

test("agruparPesoRecebidoPorCor: agrega cross-fornecedor", () => {
  const m = agruparPesoRecebidoPorCor(PAYLOAD_2_FORNECEDORES);
  assert.equal(m.get("c-az"), 150); // 100 do f1 + 50 do f2
  assert.equal(m.get("c-pt"), 200);
});

test("agruparKgContratadoPorCor: agrega cross-fornecedor", () => {
  const m = agruparKgContratadoPorCor(PAYLOAD_2_FORNECEDORES);
  assert.equal(m.get("c-az"), 150); // 100 + 50
  assert.equal(m.get("c-pt"), 200);
});

test("agruparRolosContratadosPorCor: agrega cross-fornecedor", () => {
  const m = agruparRolosContratadosPorCor(PAYLOAD_2_FORNECEDORES);
  assert.equal(m.get("c-az"), 5); // 3 + 2
  assert.equal(m.get("c-pt"), 5);
});

test("helpers: payload null/undefined retornam 0/Map vazio", () => {
  assert.equal(calcularPesoContratadoTotal(null), 0);
  assert.equal(calcularPesoRealTotal(undefined), 0);
  assert.equal(calcularCustoTotal(null), 0);
  assert.equal(agruparPesoRecebidoPorCor(null).size, 0);
  assert.equal(agruparRolosContratadosPorCor(undefined).size, 0);
});
