import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calcularSaldosCompra,
  calcularSaldosCorte,
  calcularSaldosCostura,
  calcularSaldosOP,
  validarSaldoRetirada,
} from "./saldos";

test("calcularSaldosCompra: payload vazio → tudo zero", () => {
  const s = calcularSaldosCompra(null);
  assert.deepEqual(s.rolosPorCor, {});
  assert.deepEqual(s.kgsPorCor, {});
});

test("calcularSaldosCompra: soma rolos (pesos.length) e KGs por cor — multi-fornecedor (RITM-29)", () => {
  const s = calcularSaldosCompra({
    gramaturaGM2: 180,
    larguraRoloCm: 165,
    fornecedores: [
      {
        fornecedorId: "f1",
        cores: [
          {
            corId: "co1",
            kgsContratados: 30,
            qtdRolosContratados: 3,
            precoPorKg: 25,
            pesosRolos: [12.5, 11.8, 13.0],
          },
          {
            corId: "co2",
            kgsContratados: 10,
            qtdRolosContratados: 1,
            precoPorKg: 25,
            pesosRolos: [10.5],
          },
        ],
      },
    ],
  });
  assert.equal(s.rolosPorCor.co1, 3);
  assert.equal(s.rolosPorCor.co2, 1);
  assert.ok(Math.abs(s.kgsPorCor.co1 - 37.3) < 0.01);
  assert.equal(s.kgsPorCor.co2, 10.5);
});

test("calcularSaldosCorte: agrega oficinas + saldo de rolos pós-corte", () => {
  const compra = {
    rolosPorCor: { co1: 10 },
    kgsPorCor: { co1: 100 },
  };
  const s = calcularSaldosCorte(
    {
      oficinas: [
        {
          oficinaId: "of1",
          modoSeparacao: "por_cor",
          rolosEnviadosPorCor: { co1: 6 },
          rolosDescartados: [
            { corId: "co1", qtdRolos: 1, justificativa: "Defeito" },
          ],
          rendimentoPorTamanhoCor: [
            { tamanho: "M", corId: "co1", quantidade: 500 },
          ],
        },
        {
          oficinaId: "of2",
          modoSeparacao: "por_cor",
          rolosEnviadosPorCor: { co1: 3 },
          rendimentoPorTamanhoCor: [
            { tamanho: "G", corId: "co1", quantidade: 200 },
          ],
        },
      ],
    },
    compra,
  );
  assert.equal(s.rolosEnviadosPorCor.co1, 9);
  assert.equal(s.rolosDescartadosPorCor.co1, 1);
  assert.equal(s.pecasCortadas.M?.co1, 500);
  assert.equal(s.pecasCortadas.G?.co1, 200);
  // 10 - 9 - 1 = 0
  assert.equal(s.saldoRolosPorCor.co1, 0);
});

test("calcularSaldosCostura: peças enviadas e retiradas; saldo por oficina", () => {
  const corteSaldos = {
    rolosEnviadosPorCor: { co1: 10 },
    rolosDescartadosPorCor: {},
    pecasCortadas: { M: { co1: 1000 } },
    saldoRolosPorCor: { co1: 0 },
  };
  const s = calcularSaldosCostura(
    {
      oficinas: [
        {
          oficinaId: "of-A",
          statusInterno: "em_producao",
          pecasEnviadasPorTamanhoCor: [
            { tamanho: "M", corId: "co1", quantidade: 600 },
          ],
        },
        {
          oficinaId: "of-B",
          statusInterno: "em_producao",
          pecasEnviadasPorTamanhoCor: [
            { tamanho: "M", corId: "co1", quantidade: 400 },
          ],
        },
      ],
    },
    [
      {
        oficinaId: "of-A",
        pecasPorTamanhoCor: { M: { co1: 200 } },
        canceladaEm: null,
      },
      {
        oficinaId: "of-A",
        pecasPorTamanhoCor: { M: { co1: 100 } },
        canceladaEm: null,
      },
    ],
    corteSaldos,
  );

  assert.equal(s.pecasEnviadasTotais.M?.co1, 1000);
  assert.equal(s.saldoPecasParaCostura.M?.co1, 0); // tudo enviado
  assert.equal(s.pecasRetiradasPorOficina["of-A"]?.M?.co1, 300);
  assert.equal(s.saldoPecasPorOficina["of-A"]?.M?.co1, 300); // 600 - 300
  assert.equal(s.saldoPecasPorOficina["of-B"]?.M?.co1, 400); // 400 - 0
});

test("calcularSaldosCostura: retiradas canceladas não somam", () => {
  const corteSaldos = {
    rolosEnviadosPorCor: {},
    rolosDescartadosPorCor: {},
    pecasCortadas: { M: { co1: 100 } },
    saldoRolosPorCor: {},
  };
  const s = calcularSaldosCostura(
    {
      oficinas: [
        {
          oficinaId: "of-A",
          statusInterno: "em_producao",
          pecasEnviadasPorTamanhoCor: [
            { tamanho: "M", corId: "co1", quantidade: 100 },
          ],
        },
      ],
    },
    [
      {
        oficinaId: "of-A",
        pecasPorTamanhoCor: { M: { co1: 50 } },
        canceladaEm: new Date(), // cancelada — não soma
      },
    ],
    corteSaldos,
  );
  assert.equal(s.pecasRetiradasPorOficina["of-A"], undefined);
  assert.equal(s.saldoPecasPorOficina["of-A"]?.M?.co1, 100);
});

test("validarSaldoRetirada: dentro do disponível → ok", () => {
  const saldoCostura = {
    pecasEnviadasPorOficina: {},
    pecasEnviadasTotais: {},
    saldoPecasParaCostura: {},
    pecasRetiradasPorOficina: {},
    pecasRetiradasTotais: {},
    saldoPecasPorOficina: {
      "of-A": { M: { co1: 100 } },
    },
  };
  const r = validarSaldoRetirada({
    oficinaId: "of-A",
    pecasNovaRetirada: { M: { co1: 80 } },
    saldoCostura,
  });
  assert.equal(r.ok, true);
});

test("validarSaldoRetirada: excede saldo → erro", () => {
  const saldoCostura = {
    pecasEnviadasPorOficina: {},
    pecasEnviadasTotais: {},
    saldoPecasParaCostura: {},
    pecasRetiradasPorOficina: {},
    pecasRetiradasTotais: {},
    saldoPecasPorOficina: { "of-A": { M: { co1: 50 } } },
  };
  const r = validarSaldoRetirada({
    oficinaId: "of-A",
    pecasNovaRetirada: { M: { co1: 80 } },
    saldoCostura,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.mensagem, /disponíveis/);
});

test("validarSaldoRetirada: oficina sem envio → erro", () => {
  const saldoCostura = {
    pecasEnviadasPorOficina: {},
    pecasEnviadasTotais: {},
    saldoPecasParaCostura: {},
    pecasRetiradasPorOficina: {},
    pecasRetiradasTotais: {},
    saldoPecasPorOficina: {},
  };
  const r = validarSaldoRetirada({
    oficinaId: "of-fantasma",
    pecasNovaRetirada: { M: { co1: 1 } },
    saldoCostura,
  });
  assert.equal(r.ok, false);
});

test("calcularSaldosOP: integra compra + corte + costura", () => {
  const s = calcularSaldosOP({
    compra: {
      gramaturaGM2: 180,
      larguraRoloCm: 165,
      fornecedores: [
        {
          fornecedorId: "f1",
          cores: [
            {
              corId: "co1",
              kgsContratados: 30,
              qtdRolosContratados: 3,
              precoPorKg: 25,
              pesosRolos: [10, 10, 10],
            },
          ],
        },
      ],
    },
    corte: {
      oficinas: [
        {
          oficinaId: "of-c",
          modoSeparacao: "por_cor",
          rolosEnviadosPorCor: { co1: 3 },
          rendimentoPorTamanhoCor: [
            { tamanho: "M", corId: "co1", quantidade: 300 },
          ],
        },
      ],
    },
    costura: {
      oficinas: [
        {
          oficinaId: "of-s",
          statusInterno: "em_producao",
          pecasEnviadasPorTamanhoCor: [
            { tamanho: "M", corId: "co1", quantidade: 300 },
          ],
        },
      ],
    },
    retiradas: [
      {
        oficinaId: "of-s",
        pecasPorTamanhoCor: { M: { co1: 100 } },
        canceladaEm: null,
      },
    ],
  });

  assert.equal(s.compra.rolosPorCor.co1, 3);
  assert.equal(s.corte.rolosEnviadosPorCor.co1, 3);
  assert.equal(s.corte.saldoRolosPorCor.co1, 0);
  assert.equal(s.corte.pecasCortadas.M?.co1, 300);
  assert.equal(s.costura.pecasEnviadasTotais.M?.co1, 300);
  assert.equal(s.costura.saldoPecasParaCostura.M?.co1, 0);
  assert.equal(s.costura.saldoPecasPorOficina["of-s"]?.M?.co1, 200);
});
