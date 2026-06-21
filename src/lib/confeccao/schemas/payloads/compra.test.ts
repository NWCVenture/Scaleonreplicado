// Testes do schema/helpers da subtask Compra (OPBUY) — RITM-29 (multi-fornecedor + spill rolos) + RITM-32 (distribuição multi-oficina).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agruparKgContratadoPorCor,
  agruparPesoRecebidoPorCor,
  agruparRolosAtribuidosPorCor,
  agruparRolosContratadosPorCor,
  calcularCustoTotal,
  calcularPesoRealTotal,
  calcularPesoContratadoTotal,
  calcularSaldoDistribuicao,
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

test("SubtaskCompraPayload: aceita distribuicaoOficinas parcial (rascunho)", () => {
  const r = SubtaskCompraPayloadSchema.safeParse({
    distribuicaoOficinas: [
      { oficinaId: "of-A", rolosPorCor: { "c-az": 5 } },
      // oficina vazia em rascunho é aceita; validação só na conclusão
      { oficinaId: "of-B", rolosPorCor: {} },
    ],
  });
  assert.equal(r.success, true);
});

test("SubtaskCompraPayload: rejeita rolosPorCor com valor negativo", () => {
  const r = SubtaskCompraPayloadSchema.safeParse({
    distribuicaoOficinas: [
      { oficinaId: "of-A", rolosPorCor: { "c-az": -1 } },
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
    distribuicaoOficinas: [
      { oficinaId: "of-corte", rolosPorCor: { "c-az": 3 } },
    ],
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
    distribuicaoOficinas: [
      { oficinaId: "of-corte", rolosPorCor: { "c-az": 5 } },
    ],
    tipoTecidoId: "t1",
    gramaturaGM2: 220,
    larguraRoloCm: 180,
  });
  assert.equal(r.success, false);
  if (!r.success) {
    assert.ok(
      r.error.issues.some((i) => /não bate/.test(i.message)),
      "esperava mensagem de pesos != qtdRolos",
    );
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
    distribuicaoOficinas: [
      { oficinaId: "of-corte", rolosPorCor: { "c-az": 2 } },
    ],
    tipoTecidoId: "t1",
    gramaturaGM2: 220,
    larguraRoloCm: 180,
  });
  assert.equal(r.success, false);
  if (!r.success) {
    assert.ok(r.error.issues.some((i) => /Cor duplicada/.test(i.message)));
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
    distribuicaoOficinas: [
      { oficinaId: "of-corte", rolosPorCor: { "c-az": 2 } },
    ],
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
    distribuicaoOficinas: [
      { oficinaId: "of-corte", rolosPorCor: { "c-az": 1, "c-pt": 1 } },
    ],
    tipoTecidoId: "t1",
    gramaturaGM2: 220,
    larguraRoloCm: 180,
  });
  assert.equal(r.success, false);
  if (!r.success) {
    assert.ok(
      r.error.issues.some((i) => /Fornecedor duplicado/.test(i.message)),
    );
  }
});

// ── Distribuição (RITM-32) ───────────────────────────────────────────

test("ConcluirSubtaskCompra: rejeita sem distribuicaoOficinas", () => {
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
    // sem distribuicaoOficinas
    tipoTecidoId: "t1",
    gramaturaGM2: 220,
    larguraRoloCm: 180,
  });
  assert.equal(r.success, false);
});

test("ConcluirSubtaskCompra: rejeita oficina duplicada", () => {
  const r = ConcluirSubtaskCompraSchema.safeParse({
    fornecedores: [
      {
        fornecedorId: "f1",
        cores: [
          {
            corId: "c-az",
            kgsContratados: 100,
            qtdRolosContratados: 4,
            precoPorKg: 25,
            pesosRolos: [25, 25, 25, 25],
          },
        ],
      },
    ],
    distribuicaoOficinas: [
      { oficinaId: "of-A", rolosPorCor: { "c-az": 2 } },
      { oficinaId: "of-A", rolosPorCor: { "c-az": 2 } }, // duplicada
    ],
    tipoTecidoId: "t1",
    gramaturaGM2: 220,
    larguraRoloCm: 180,
  });
  assert.equal(r.success, false);
  if (!r.success) {
    assert.ok(
      r.error.issues.some((i) => /Oficina duplicada/.test(i.message)),
    );
  }
});

test("ConcluirSubtaskCompra: rejeita oficina-fantasma (zero rolos)", () => {
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
    distribuicaoOficinas: [
      { oficinaId: "of-A", rolosPorCor: { "c-az": 3 } },
      { oficinaId: "of-B", rolosPorCor: { "c-az": 0 } }, // fantasma
    ],
    tipoTecidoId: "t1",
    gramaturaGM2: 220,
    larguraRoloCm: 180,
  });
  assert.equal(r.success, false);
  if (!r.success) {
    assert.ok(
      r.error.issues.some((i) =>
        /precisa receber ao menos 1 rolo/.test(i.message),
      ),
    );
  }
});

test("ConcluirSubtaskCompra: rejeita saldo positivo (faltam rolos a atribuir)", () => {
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
            pesosRolos: [20, 20, 20, 20, 20],
          },
        ],
      },
    ],
    distribuicaoOficinas: [
      { oficinaId: "of-A", rolosPorCor: { "c-az": 3 } }, // só 3 de 5
    ],
    tipoTecidoId: "t1",
    gramaturaGM2: 220,
    larguraRoloCm: 180,
  });
  assert.equal(r.success, false);
  if (!r.success) {
    assert.ok(
      r.error.issues.some((i) => /sem destino/.test(i.message)),
      "esperava mensagem 'sem destino'",
    );
  }
});

test("ConcluirSubtaskCompra: rejeita saldo negativo (atribuído além do contratado)", () => {
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
    distribuicaoOficinas: [
      { oficinaId: "of-A", rolosPorCor: { "c-az": 5 } }, // 5 > contratado 3
    ],
    tipoTecidoId: "t1",
    gramaturaGM2: 220,
    larguraRoloCm: 180,
  });
  assert.equal(r.success, false);
  if (!r.success) {
    assert.ok(
      r.error.issues.some((i) => /além do contratado/.test(i.message)),
    );
  }
});

test("ConcluirSubtaskCompra: aceita split em múltiplas oficinas com saldo zerado", () => {
  const r = ConcluirSubtaskCompraSchema.safeParse({
    fornecedores: [
      {
        fornecedorId: "f1",
        cores: [
          {
            corId: "c-az",
            kgsContratados: 200,
            qtdRolosContratados: 5,
            precoPorKg: 25,
            pesosRolos: [40, 40, 40, 40, 40],
          },
          {
            corId: "c-pt",
            kgsContratados: 100,
            qtdRolosContratados: 3,
            precoPorKg: 28,
            pesosRolos: [34, 33, 33],
          },
        ],
      },
    ],
    distribuicaoOficinas: [
      { oficinaId: "of-A", rolosPorCor: { "c-az": 3, "c-pt": 1 } },
      { oficinaId: "of-B", rolosPorCor: { "c-az": 2, "c-pt": 2 } },
    ],
    tipoTecidoId: "t1",
    gramaturaGM2: 220,
    larguraRoloCm: 180,
  });
  assert.equal(r.success, true);
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

// ── Helpers de distribuição (RITM-32) ────────────────────────────────

test("agruparRolosAtribuidosPorCor: soma cross-oficinas", () => {
  const m = agruparRolosAtribuidosPorCor({
    distribuicaoOficinas: [
      { oficinaId: "of-A", rolosPorCor: { "c-az": 3, "c-pt": 1 } },
      { oficinaId: "of-B", rolosPorCor: { "c-az": 2, "c-pt": 2 } },
    ],
  });
  assert.equal(m.get("c-az"), 5);
  assert.equal(m.get("c-pt"), 3);
});

test("agruparRolosAtribuidosPorCor: null/undefined → Map vazio", () => {
  assert.equal(agruparRolosAtribuidosPorCor(null).size, 0);
  assert.equal(agruparRolosAtribuidosPorCor(undefined).size, 0);
  assert.equal(agruparRolosAtribuidosPorCor({}).size, 0);
});

test("calcularSaldoDistribuicao: saldo zerado quando bate contratado", () => {
  const saldos = calcularSaldoDistribuicao({
    fornecedores: PAYLOAD_2_FORNECEDORES.fornecedores,
    distribuicaoOficinas: [
      { oficinaId: "of-A", rolosPorCor: { "c-az": 3, "c-pt": 3 } },
      { oficinaId: "of-B", rolosPorCor: { "c-az": 2, "c-pt": 2 } },
    ],
  });
  assert.deepEqual(saldos.get("c-az"), {
    contratado: 5,
    atribuido: 5,
    saldo: 0,
  });
  assert.deepEqual(saldos.get("c-pt"), {
    contratado: 5,
    atribuido: 5,
    saldo: 0,
  });
});

test("calcularSaldoDistribuicao: saldo positivo quando faltam atribuir", () => {
  const saldos = calcularSaldoDistribuicao({
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
    ],
    distribuicaoOficinas: [
      { oficinaId: "of-A", rolosPorCor: { "c-az": 2 } },
    ],
  });
  assert.deepEqual(saldos.get("c-az"), {
    contratado: 5,
    atribuido: 2,
    saldo: 3,
  });
});

test("calcularSaldoDistribuicao: inclui cor atribuída mas não contratada", () => {
  const saldos = calcularSaldoDistribuicao({
    fornecedores: [],
    distribuicaoOficinas: [
      { oficinaId: "of-A", rolosPorCor: { "c-fantasma": 2 } },
    ],
  });
  assert.deepEqual(saldos.get("c-fantasma"), {
    contratado: 0,
    atribuido: 2,
    saldo: -2,
  });
});
