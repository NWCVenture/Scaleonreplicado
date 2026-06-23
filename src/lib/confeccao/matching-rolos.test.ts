import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calcularMatchingRolos,
  TOLERANCIA_MATCHING_PADRAO,
  totalRolosRecebidos,
} from "./matching-rolos";
import type { SubtaskCompraPayload } from "./schemas/payloads/compra";
import type { SubtaskCortePayload } from "./schemas/payloads/corte";

function compraSimples(
  pesos: number[],
  distribuicao: Array<{ oficinaId: string; qtd: number }>,
  toleranciaPct?: number,
): SubtaskCompraPayload {
  return {
    fornecedores: [
      {
        fornecedorId: "f1",
        cores: [
          {
            corId: "azul",
            kgsContratados: pesos.reduce((s, p) => s + p, 0),
            qtdRolosContratados: pesos.length,
            precoPorKg: 25,
            pesosRolos: pesos,
          },
        ],
      },
    ],
    distribuicaoOficinas: distribuicao.map((d) => ({
      oficinaId: d.oficinaId,
      rolosPorCor: { azul: d.qtd },
    })),
    toleranciaMatchingPct: toleranciaPct,
  };
}

function corteSimples(
  oficinas: Array<{
    oficinaId: string;
    enviados: number;
    pesosCort: number[];
  }>,
): SubtaskCortePayload {
  return {
    oficinas: oficinas.map((o) => ({
      oficinaId: o.oficinaId,
      modoSeparacao: "por_cor" as const,
      rolosEnviadosPorCor: { azul: o.enviados },
      rolosRecebidos: o.pesosCort.map((p) => ({
        corId: "azul",
        pesoCortador: p,
        folhasRendidas: 40,
      })),
    })),
  };
}

test("matching simples: 5 pares com diff uniforme, todos sem alerta (tol=5%)", () => {
  const compra = compraSimples(
    [13.0, 13.1, 13.2, 13.3, 13.4],
    [{ oficinaId: "of1", qtd: 5 }],
    5,
  );
  const corte = corteSimples([
    { oficinaId: "of1", enviados: 5, pesosCort: [12.9, 13.0, 13.1, 13.2, 13.3] },
  ]);

  const m = calcularMatchingRolos(compra, corte);
  assert.equal(m.length, 1);
  assert.equal(m[0].pares.length, 5);
  for (const p of m[0].pares) {
    assert.ok(p.diffKg !== null && Math.abs(p.diffKg + 0.1) < 1e-9);
    assert.equal(p.alerta, false);
    assert.equal(p.forneOrfao, false);
    assert.equal(p.cortOrfao, false);
  }
  assert.ok(m[0].diffTotalKg + 0.5 < 1e-9 || Math.abs(m[0].diffTotalKg + 0.5) < 1e-9);
});

test("matching com alerta: 1 rolo fora da tolerância", () => {
  const compra = compraSimples(
    [10, 10, 10],
    [{ oficinaId: "of1", qtd: 3 }],
    5,
  );
  const corte = corteSimples([
    { oficinaId: "of1", enviados: 3, pesosCort: [10, 10, 10.9] },
  ]);
  const m = calcularMatchingRolos(compra, corte);
  // Após sort asc, cortador=[10, 10, 10.9] → 3o par é 10 vs 10.9 → +9% > 5%
  assert.equal(m[0].pares[2].alerta, true);
  assert.equal(m[0].pares[0].alerta, false);
  assert.equal(m[0].pares[1].alerta, false);
});

test("matching com órfão fornecedor (cortador faltando rolos)", () => {
  const compra = compraSimples(
    [10, 11, 12, 13, 14],
    [{ oficinaId: "of1", qtd: 5 }],
  );
  const corte = corteSimples([
    { oficinaId: "of1", enviados: 5, pesosCort: [10, 11, 12] },
  ]);
  const m = calcularMatchingRolos(compra, corte);
  assert.equal(m[0].pares.length, 5);
  // Pares 1-3 ok
  for (let i = 0; i < 3; i++) {
    assert.equal(m[0].pares[i].forneOrfao, false);
    assert.equal(m[0].pares[i].cortOrfao, false);
  }
  // Pares 4-5: forneOrfao (cortador faltando)
  assert.equal(m[0].pares[3].forneOrfao, true);
  assert.equal(m[0].pares[3].pesoCortador, null);
  assert.equal(m[0].pares[3].pesoFornecedor, 13);
  assert.equal(m[0].pares[4].forneOrfao, true);
  assert.equal(m[0].pares[4].pesoCortador, null);
});

test("matching com órfão cortador (cortador devolveu rolo extra)", () => {
  const compra = compraSimples(
    [10, 11, 12],
    [{ oficinaId: "of1", qtd: 3 }],
  );
  const corte = corteSimples([
    {
      oficinaId: "of1",
      enviados: 3,
      pesosCort: [10, 11, 12, 13, 14],
    },
  ]);
  const m = calcularMatchingRolos(compra, corte);
  assert.equal(m[0].pares.length, 5);
  // Pares 4-5: cortOrfao
  assert.equal(m[0].pares[3].cortOrfao, true);
  assert.equal(m[0].pares[3].pesoFornecedor, null);
  assert.equal(m[0].pares[3].pesoCortador, 13);
  assert.equal(m[0].pares[4].cortOrfao, true);
});

test("distribuição entre oficinas: A recebe pesos mais leves, B mais pesados", () => {
  // 10 rolos no fornecedor: [13.0, 13.1, ..., 13.9]
  const pesos = Array.from({ length: 10 }, (_, i) => 13 + i * 0.1);
  const compra = compraSimples(pesos, [
    { oficinaId: "ofA", qtd: 6 },
    { oficinaId: "ofB", qtd: 4 },
  ]);
  // Cortador devolveu pesos idênticos pra cada oficina pra simplificar
  const corte = corteSimples([
    {
      oficinaId: "ofA",
      enviados: 6,
      pesosCort: [13.0, 13.1, 13.2, 13.3, 13.4, 13.5],
    },
    {
      oficinaId: "ofB",
      enviados: 4,
      pesosCort: [13.6, 13.7, 13.8, 13.9],
    },
  ]);
  const m = calcularMatchingRolos(compra, corte);
  assert.equal(m.length, 2);
  const matA = m.find((x) => x.oficinaId === "ofA")!;
  const matB = m.find((x) => x.oficinaId === "ofB")!;
  assert.equal(matA.pares.length, 6);
  assert.equal(matB.pares.length, 4);
  // Oficina A: forne 13.0..13.5
  assert.equal(matA.pares[0].pesoFornecedor, 13);
  assert.ok(Math.abs((matA.pares[5].pesoFornecedor ?? 0) - 13.5) < 1e-9);
  // Oficina B: forne 13.6..13.9
  assert.ok(Math.abs((matB.pares[0].pesoFornecedor ?? 0) - 13.6) < 1e-9);
  assert.ok(Math.abs((matB.pares[3].pesoFornecedor ?? 0) - 13.9) < 1e-9);
  // Diff zero em todos os pares
  for (const par of [...matA.pares, ...matB.pares]) {
    assert.ok(par.diffKg !== null && Math.abs(par.diffKg) < 1e-9);
    assert.equal(par.alerta, false);
  }
});

test("cor presente só em uma oficina não contamina a outra", () => {
  const compra: SubtaskCompraPayload = {
    fornecedores: [
      {
        fornecedorId: "f1",
        cores: [
          {
            corId: "azul",
            kgsContratados: 30,
            qtdRolosContratados: 3,
            precoPorKg: 25,
            pesosRolos: [10, 11, 12],
          },
          {
            corId: "branco",
            kgsContratados: 20,
            qtdRolosContratados: 2,
            precoPorKg: 25,
            pesosRolos: [9, 10],
          },
        ],
      },
    ],
    distribuicaoOficinas: [
      { oficinaId: "ofA", rolosPorCor: { azul: 3 } },
      { oficinaId: "ofB", rolosPorCor: { branco: 2 } },
    ],
  };
  const corte: SubtaskCortePayload = {
    oficinas: [
      {
        oficinaId: "ofA",
        modoSeparacao: "por_cor",
        rolosEnviadosPorCor: { azul: 3 },
        rolosRecebidos: [
          { corId: "azul", pesoCortador: 10, folhasRendidas: 30 },
          { corId: "azul", pesoCortador: 11, folhasRendidas: 30 },
          { corId: "azul", pesoCortador: 12, folhasRendidas: 30 },
        ],
      },
      {
        oficinaId: "ofB",
        modoSeparacao: "por_cor",
        rolosEnviadosPorCor: { branco: 2 },
        rolosRecebidos: [
          { corId: "branco", pesoCortador: 9, folhasRendidas: 30 },
          { corId: "branco", pesoCortador: 10, folhasRendidas: 30 },
        ],
      },
    ],
  };
  const m = calcularMatchingRolos(compra, corte);
  assert.equal(m.length, 2);
  const a = m.find((x) => x.oficinaId === "ofA" && x.corId === "azul")!;
  const b = m.find((x) => x.oficinaId === "ofB" && x.corId === "branco")!;
  assert.ok(a);
  assert.ok(b);
  // Não tem entry "ofA + branco" nem "ofB + azul"
  assert.equal(
    m.some((x) => x.oficinaId === "ofA" && x.corId === "branco"),
    false,
  );
});

test("matching usa tolerância default (5%) se não definida", () => {
  const compra = compraSimples(
    [10],
    [{ oficinaId: "of1", qtd: 1 }],
    // sem toleranciaMatchingPct
  );
  const corte = corteSimples([
    { oficinaId: "of1", enviados: 1, pesosCort: [10.6] }, // +6% > 5%
  ]);
  assert.equal(TOLERANCIA_MATCHING_PADRAO, 5);
  const m = calcularMatchingRolos(compra, corte);
  assert.equal(m[0].pares[0].alerta, true);
});

test("matching reage a tolerância 2%: rolos antes ok com 3% viram alerta", () => {
  const pesosForne = [10, 10];
  const pesosCort = [10.3, 10.3]; // +3%
  const compra5 = compraSimples(pesosForne, [{ oficinaId: "of1", qtd: 2 }], 5);
  const compra2 = compraSimples(pesosForne, [{ oficinaId: "of1", qtd: 2 }], 2);
  const corte = corteSimples([
    { oficinaId: "of1", enviados: 2, pesosCort },
  ]);
  const m5 = calcularMatchingRolos(compra5, corte);
  const m2 = calcularMatchingRolos(compra2, corte);
  assert.equal(m5[0].pares[0].alerta, false);
  assert.equal(m2[0].pares[0].alerta, true);
});

test("payload sem distribuição → matching vazio", () => {
  const compra: SubtaskCompraPayload = {
    fornecedores: [
      {
        fornecedorId: "f1",
        cores: [
          {
            corId: "azul",
            kgsContratados: 10,
            qtdRolosContratados: 1,
            precoPorKg: 25,
            pesosRolos: [10],
          },
        ],
      },
    ],
    // sem distribuicaoOficinas
  };
  const m = calcularMatchingRolos(compra, null);
  assert.equal(m.length, 0);
});

test("totalRolosRecebidos soma cross-oficina", () => {
  const corte: SubtaskCortePayload = {
    oficinas: [
      {
        oficinaId: "ofA",
        modoSeparacao: "por_cor",
        rolosEnviadosPorCor: { azul: 2 },
        rolosRecebidos: [
          { corId: "azul", pesoCortador: 10, folhasRendidas: 30 },
        ],
      },
      {
        oficinaId: "ofB",
        modoSeparacao: "por_cor",
        rolosEnviadosPorCor: { branco: 2 },
        rolosRecebidos: [
          { corId: "branco", pesoCortador: 9, folhasRendidas: 30 },
          { corId: "branco", pesoCortador: 10, folhasRendidas: 30 },
        ],
      },
    ],
  };
  assert.equal(totalRolosRecebidos(corte), 3);
  assert.equal(totalRolosRecebidos(null), 0);
});

test("matching com cortador parcial (3 informados de 5 esperados) → render mostra parciais com órfãos", () => {
  const compra = compraSimples(
    [10, 11, 12, 13, 14],
    [{ oficinaId: "of1", qtd: 5 }],
  );
  // Cortador só informou 3 pesos
  const corte = corteSimples([
    { oficinaId: "of1", enviados: 5, pesosCort: [10, 11, 12] },
  ]);
  const m = calcularMatchingRolos(compra, corte);
  assert.equal(m[0].pares.length, 5);
  assert.equal(m[0].totalForne, 10 + 11 + 12 + 13 + 14);
  assert.equal(m[0].totalCort, 10 + 11 + 12);
});
