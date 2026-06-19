import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ConcluirSubtaskCorteSchema,
  rolosCompradosPorCorDeCompra,
  SubtaskCortePayloadSchema,
  validarSaldoRolos,
} from "./corte";

test("SubtaskCortePayload: aceita payload vazio", () => {
  const r = SubtaskCortePayloadSchema.safeParse({});
  assert.equal(r.success, true);
});

test("ConcluirSubtaskCorte: aceita oficina completa", () => {
  const r = ConcluirSubtaskCorteSchema.safeParse({
    oficinas: [
      {
        oficinaId: "of1",
        modoSeparacao: "por_cor",
        rolosEnviadosPorCor: { co1: 3, co2: 2 },
        folhasEnfesto: 10,
        rendimentoTotal: 120,
        rendimentoPorTamanhoCor: [
          { tamanho: "M", corId: "co1", quantidade: 40 },
          { tamanho: "G", corId: "co1", quantidade: 20 },
          { tamanho: "M", corId: "co2", quantidade: 30 },
          { tamanho: "G", corId: "co2", quantidade: 30 },
        ],
        precoPorPeca: 2.5,
      },
    ],
  });
  assert.equal(r.success, true);
});

test("ConcluirSubtaskCorte: rejeita oficinas vazias", () => {
  const r = ConcluirSubtaskCorteSchema.safeParse({ oficinas: [] });
  assert.equal(r.success, false);
});

test("ConcluirSubtaskCorte: rejeita oficina duplicada", () => {
  const r = ConcluirSubtaskCorteSchema.safeParse({
    oficinas: [
      {
        oficinaId: "of1",
        modoSeparacao: "por_cor",
        rolosEnviadosPorCor: { co1: 2 },
        folhasEnfesto: 5,
        rendimentoTotal: 50,
        rendimentoPorTamanhoCor: [
          { tamanho: "M", corId: "co1", quantidade: 50 },
        ],
        precoPorPeca: 2,
      },
      {
        oficinaId: "of1", // duplicada
        modoSeparacao: "sem_separacao",
        rolosEnviadosPorCor: { co1: 1 },
        folhasEnfesto: 2,
        rendimentoTotal: 20,
        rendimentoPorTamanhoCor: [
          { tamanho: "M", corId: "co1", quantidade: 20 },
        ],
        precoPorPeca: 2,
      },
    ],
  });
  assert.equal(r.success, false);
});

test("ConcluirSubtaskCorte: rejeita oficina sem nenhum rolo enviado", () => {
  const r = ConcluirSubtaskCorteSchema.safeParse({
    oficinas: [
      {
        oficinaId: "of1",
        modoSeparacao: "por_cor",
        rolosEnviadosPorCor: { co1: 0 },
        folhasEnfesto: 5,
        rendimentoTotal: 50,
        rendimentoPorTamanhoCor: [
          { tamanho: "M", corId: "co1", quantidade: 50 },
        ],
        precoPorPeca: 2,
      },
    ],
  });
  assert.equal(r.success, false);
});

test("validarSaldoRolos: soma dentro do disponível → ok", () => {
  const disponivel = new Map([
    ["co1", 10],
    ["co2", 5],
  ]);
  const r = validarSaldoRolos(
    [
      {
        oficinaId: "of1",
        modoSeparacao: "por_cor",
        rolosEnviadosPorCor: { co1: 6, co2: 3 },
      },
      {
        oficinaId: "of2",
        modoSeparacao: "por_cor",
        rolosEnviadosPorCor: { co1: 4, co2: 2 },
      },
    ],
    disponivel,
  );
  assert.equal(r.ok, true);
});

test("validarSaldoRolos: soma excede → erro", () => {
  const disponivel = new Map([["co1", 5]]);
  const r = validarSaldoRolos(
    [
      {
        oficinaId: "of1",
        modoSeparacao: "por_cor",
        rolosEnviadosPorCor: { co1: 4 },
      },
      {
        oficinaId: "of2",
        modoSeparacao: "por_cor",
        rolosEnviadosPorCor: { co1: 3 },
      },
    ],
    disponivel,
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.mensagem, /co1/);
});

test("validarSaldoRolos: cor sem disponível → erro", () => {
  const r = validarSaldoRolos(
    [
      {
        oficinaId: "of1",
        modoSeparacao: "por_cor",
        rolosEnviadosPorCor: { co_FANTASMA: 1 },
      },
    ],
    new Map(),
  );
  assert.equal(r.ok, false);
});

test("rolosCompradosPorCorDeCompra: conta pesosRolos como rolos — multi-fornecedor (RITM-29)", () => {
  const mapa = rolosCompradosPorCorDeCompra({
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
  assert.equal(mapa.get("co1"), 3);
  assert.equal(mapa.get("co2"), 1);
});

test("rolosCompradosPorCorDeCompra: payload null → mapa vazio", () => {
  const mapa = rolosCompradosPorCorDeCompra(null);
  assert.equal(mapa.size, 0);
});
