import { test } from "node:test";
import assert from "node:assert/strict";
import { calcularCustosOP } from "./custos";

test("calcularCustosOP: OP vazia → tudo zero, sem erro", () => {
  const r = calcularCustosOP({
    temVies: false,
    lalamoves: [],
    subconferencias: [],
  });
  assert.equal(r.tecido, 0);
  assert.equal(r.risco, 0);
  assert.equal(r.corte, 0);
  assert.equal(r.vies, 0);
  assert.equal(r.costura, 0);
  assert.equal(r.lalamovesTotal, 0);
  assert.equal(r.custoTotal, 0);
  assert.equal(r.pecasProduzidas, 0);
  assert.equal(r.pecasAprovadas, 0);
  assert.equal(r.custoPorPecaProduzida, null);
  assert.equal(r.custoPorPecaAprovada, null);
  assert.equal(r.perdas, 0);
});

test("calcularCustosOP: tecido = sum por cor (peso × precoPorKg) — multi-fornecedor", () => {
  const r = calcularCustosOP({
    temVies: false,
    compra: {
      gramaturaGM2: 200,
      larguraRoloCm: 180,
      fornecedores: [
        {
          fornecedorId: "f1",
          cores: [
            {
              corId: "c1",
              kgsContratados: 22,
              qtdRolosContratados: 2,
              precoPorKg: 30,
              pesosRolos: [10, 12], // 22 × 30 = 660
            },
            {
              corId: "c2",
              kgsContratados: 8,
              qtdRolosContratados: 1,
              precoPorKg: 30,
              pesosRolos: [8], // 8 × 30 = 240
            },
          ],
        },
      ],
    },
    lalamoves: [],
    subconferencias: [],
  });
  // 660 + 240 = 900
  assert.equal(r.tecido, 900);
  assert.equal(r.custoTotal, 900);
});

test("calcularCustosOP: risco usa valorServico", () => {
  const r = calcularCustosOP({
    temVies: false,
    risco: { valorServico: 250 },
    lalamoves: [],
    subconferencias: [],
  });
  assert.equal(r.risco, 250);
});

test("calcularCustosOP: corte agrega preço × peças por oficina", () => {
  const r = calcularCustosOP({
    temVies: false,
    corte: {
      oficinas: [
        {
          oficinaId: "of1",
          modoSeparacao: "por_cor",
          rolosEnviadosPorCor: { c1: 3 },
          precoPorPeca: 5,
          rendimentoPorTamanhoCor: [
            { tamanho: "M", corId: "c1", quantidade: 40 },
            { tamanho: "G", corId: "c1", quantidade: 20 },
          ],
        },
        {
          oficinaId: "of2",
          modoSeparacao: "sem_separacao",
          rolosEnviadosPorCor: { c2: 2 },
          precoPorPeca: 4,
          rendimentoPorTamanhoCor: [
            { tamanho: "M", corId: "c2", quantidade: 30 },
          ],
        },
      ],
    },
    lalamoves: [],
    subconferencias: [],
  });
  // of1: 5 × 60 = 300; of2: 4 × 30 = 120
  assert.equal(r.corte, 420);
});

test("calcularCustosOP: temVies=false ignora payload OPVIE mesmo se presente", () => {
  const r = calcularCustosOP({
    temVies: false,
    vies: { precoPorMetro: 2, metragemProduzidaM: 50 },
    lalamoves: [],
    subconferencias: [],
  });
  assert.equal(r.vies, 0);
  assert.equal(r.custoTotal, 0);
});

test("calcularCustosOP: temVies=true inclui custo de viés", () => {
  const r = calcularCustosOP({
    temVies: true,
    vies: { precoPorMetro: 2, metragemProduzidaM: 50 },
    lalamoves: [],
    subconferencias: [],
  });
  assert.equal(r.vies, 100);
});

test("calcularCustosOP: costura soma preço × peças e produz pecasProduzidas", () => {
  const r = calcularCustosOP({
    temVies: false,
    costura: {
      oficinas: [
        {
          oficinaId: "of1",
          statusInterno: "finalizada",
          precoPorPeca: 3,
          pecasEnviadasPorTamanhoCor: [
            { tamanho: "M", corId: "c1", quantidade: 50 },
            { tamanho: "G", corId: "c1", quantidade: 30 },
          ],
        },
        {
          oficinaId: "of2",
          statusInterno: "finalizada",
          precoPorPeca: 2.5,
          pecasEnviadasPorTamanhoCor: [
            { tamanho: "M", corId: "c2", quantidade: 40 },
          ],
        },
      ],
    },
    lalamoves: [],
    subconferencias: [],
  });
  // of1: 3 × 80 = 240; of2: 2.5 × 40 = 100; total = 340
  assert.equal(r.costura, 340);
  // pecas produzidas: 80 + 40 = 120
  assert.equal(r.pecasProduzidas, 120);
});

test("calcularCustosOP: lalamoves separa principais/outros, ignora cancelados", () => {
  const r = calcularCustosOP({
    temVies: false,
    lalamoves: [
      { tipo: "principal", valor: 30, canceladaEm: null },
      { tipo: "principal", valor: 25, canceladaEm: null },
      { tipo: "outros", valor: 12, canceladaEm: null },
      { tipo: "principal", valor: 100, canceladaEm: new Date() }, // cancelado
      { tipo: "outros", valor: null, canceladaEm: null }, // sem valor
    ],
    subconferencias: [],
  });
  assert.equal(r.lalamovesPrincipais, 55);
  assert.equal(r.lalamovesOutros, 12);
  assert.equal(r.lalamovesTotal, 67);
});

test("calcularCustosOP: subconferencias concluidas somam pecasAprovadas; em_andamento ignoradas", () => {
  const r = calcularCustosOP({
    temVies: false,
    lalamoves: [],
    subconferencias: [
      {
        status: "concluida",
        aprovadas: {
          M: { c1: 40, c2: 20 },
          G: { c1: 30 },
        },
      },
      {
        status: "em_andamento",
        aprovadas: { M: { c1: 999 } }, // ignorado
      },
      {
        status: "concluida",
        aprovadas: null, // null ok
      },
    ],
  });
  assert.equal(r.pecasAprovadas, 90);
});

test("calcularCustosOP: custo total agrega tudo e calcula por peça", () => {
  const r = calcularCustosOP({
    temVies: true,
    compra: {
      gramaturaGM2: 200,
      larguraRoloCm: 180,
      fornecedores: [
        {
          fornecedorId: "f1",
          cores: [
            {
              corId: "c1",
              kgsContratados: 20,
              qtdRolosContratados: 2,
              precoPorKg: 20,
              pesosRolos: [10, 10], // 20kg × 20 = 400
            },
          ],
        },
      ],
    },
    risco: { valorServico: 100 },
    corte: {
      oficinas: [
        {
          oficinaId: "of1",
          modoSeparacao: "por_cor",
          rolosEnviadosPorCor: { c1: 2 },
          precoPorPeca: 2,
          rendimentoPorTamanhoCor: [
            { tamanho: "M", corId: "c1", quantidade: 50 },
          ],
        },
      ],
    },
    vies: { precoPorMetro: 1, metragemProduzidaM: 30 }, // 30
    costura: {
      oficinas: [
        {
          oficinaId: "of1",
          statusInterno: "finalizada",
          precoPorPeca: 3,
          pecasEnviadasPorTamanhoCor: [
            { tamanho: "M", corId: "c1", quantidade: 50 },
          ],
        },
      ],
    },
    lalamoves: [{ tipo: "principal", valor: 70, canceladaEm: null }],
    subconferencias: [
      {
        status: "concluida",
        aprovadas: { M: { c1: 45 } },
      },
    ],
  });
  // tecido 400 + risco 100 + corte 100 + vies 30 + costura 150 + lala 70 = 850
  assert.equal(r.custoTotal, 850);
  assert.equal(r.pecasProduzidas, 50);
  assert.equal(r.pecasAprovadas, 45);
  // 850 / 50 = 17.00
  assert.equal(r.custoPorPecaProduzida, 17);
  // 850 / 45 = 18.888... → 18.89
  assert.equal(r.custoPorPecaAprovada, 18.89);
});

test("calcularCustosOP: perdas = kgMedio × precoKg × qtdDescartada", () => {
  const r = calcularCustosOP({
    temVies: false,
    compra: {
      gramaturaGM2: 200,
      larguraRoloCm: 180,
      fornecedores: [
        {
          fornecedorId: "f1",
          cores: [
            {
              corId: "c1",
              kgsContratados: 36,
              qtdRolosContratados: 3,
              precoPorKg: 20,
              pesosRolos: [10, 12, 14], // média 12kg
            },
          ],
        },
      ],
    },
    corte: {
      oficinas: [
        {
          oficinaId: "of1",
          modoSeparacao: "por_cor",
          rolosEnviadosPorCor: { c1: 3 },
          precoPorPeca: 1,
          rendimentoPorTamanhoCor: [],
          rolosDescartados: [
            { corId: "c1", qtdRolos: 2, justificativa: "mancha" },
          ],
        },
      ],
    },
    lalamoves: [],
    subconferencias: [],
  });
  // perdas = 12 × 20 × 2 = 480 (não soma no custoTotal)
  assert.equal(r.perdas, 480);
  // custoTotal tem tecido 36×20=720, corte 0
  assert.equal(r.custoTotal, 720);
});

test("calcularCustosOP: precoPorPeca undefined em oficina não soma", () => {
  const r = calcularCustosOP({
    temVies: false,
    corte: {
      oficinas: [
        {
          oficinaId: "of1",
          modoSeparacao: "por_cor",
          rolosEnviadosPorCor: { c1: 3 },
          rendimentoPorTamanhoCor: [
            { tamanho: "M", corId: "c1", quantidade: 50 },
          ],
        },
      ],
    },
    lalamoves: [],
    subconferencias: [],
  });
  assert.equal(r.corte, 0);
});
