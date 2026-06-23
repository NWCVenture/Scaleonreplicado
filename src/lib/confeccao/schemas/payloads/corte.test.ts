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
        rolosRecebidos: [
          { corId: "co1", pesoCortador: 12, folhasRendidas: 40 },
          { corId: "co1", pesoCortador: 12.5, folhasRendidas: 41 },
          { corId: "co1", pesoCortador: 13, folhasRendidas: 42 },
          { corId: "co2", pesoCortador: 11, folhasRendidas: 38 },
          { corId: "co2", pesoCortador: 11.5, folhasRendidas: 39 },
        ],
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

// ── RITM-34: rolosRecebidos ──────────────────────────────────────────

test("SubtaskCortePayload: aceita rolosRecebidos parcial em em_andamento", () => {
  const r = SubtaskCortePayloadSchema.safeParse({
    oficinas: [
      {
        oficinaId: "of1",
        modoSeparacao: "por_cor",
        rolosEnviadosPorCor: { azul: 10 },
        rolosRecebidos: [
          { corId: "azul", pesoCortador: 12.5, folhasRendidas: 40 },
          { corId: "azul", pesoCortador: 12.8, folhasRendidas: 41 },
          { corId: "azul", pesoCortador: 13.0, folhasRendidas: 42 },
          { corId: "azul", pesoCortador: 13.1, folhasRendidas: 42 },
          { corId: "azul", pesoCortador: 13.3, folhasRendidas: 43 },
        ],
      },
    ],
  });
  assert.equal(r.success, true);
});

test("ConcluirSubtaskCorte: rejeita corId em rolosRecebidos fora de enviadosPorCor (RITM-34)", () => {
  const r = ConcluirSubtaskCorteSchema.safeParse({
    oficinas: [
      {
        oficinaId: "of1",
        modoSeparacao: "por_cor",
        rolosEnviadosPorCor: { azul: 1, branco: 1 },
        rolosRecebidos: [
          { corId: "azul", pesoCortador: 12, folhasRendidas: 40 },
          { corId: "branco", pesoCortador: 11, folhasRendidas: 38 },
          // Vermelho: não foi enviado pra essa oficina → erro
          { corId: "vermelho", pesoCortador: 10, folhasRendidas: 35 },
        ],
        folhasEnfesto: 10,
        rendimentoTotal: 80,
        rendimentoPorTamanhoCor: [
          { tamanho: "M", corId: "azul", quantidade: 40 },
          { tamanho: "M", corId: "branco", quantidade: 40 },
        ],
        precoPorPeca: 2,
      },
    ],
  });
  assert.equal(r.success, false);
  if (!r.success) {
    assert.ok(r.error.issues.some((i) => /vermelho/i.test(i.message)));
  }
});

test("ConcluirSubtaskCorte: exige count match por cor (RITM-34)", () => {
  const r = ConcluirSubtaskCorteSchema.safeParse({
    oficinas: [
      {
        oficinaId: "of1",
        modoSeparacao: "por_cor",
        rolosEnviadosPorCor: { azul: 10 },
        rolosRecebidos: [
          { corId: "azul", pesoCortador: 12, folhasRendidas: 40 },
          { corId: "azul", pesoCortador: 12.5, folhasRendidas: 41 },
          { corId: "azul", pesoCortador: 13, folhasRendidas: 42 },
          { corId: "azul", pesoCortador: 13.2, folhasRendidas: 42 },
          { corId: "azul", pesoCortador: 13.5, folhasRendidas: 43 },
          { corId: "azul", pesoCortador: 13.7, folhasRendidas: 44 },
          { corId: "azul", pesoCortador: 13.9, folhasRendidas: 44 },
          { corId: "azul", pesoCortador: 14, folhasRendidas: 45 },
          // só 8 rolos informados, mas enviados=10
        ],
        folhasEnfesto: 50,
        rendimentoTotal: 400,
        rendimentoPorTamanhoCor: [
          { tamanho: "M", corId: "azul", quantidade: 400 },
        ],
        precoPorPeca: 2,
      },
    ],
  });
  assert.equal(r.success, false);
  if (!r.success) {
    assert.ok(
      r.error.issues.some((i) =>
        /faltam 2 rolo\(s\)/i.test(i.message),
      ),
    );
  }
});

test("ConcluirSubtaskCorte: aceita oficina com rolosRecebidos completos (RITM-34)", () => {
  const r = ConcluirSubtaskCorteSchema.safeParse({
    oficinas: [
      {
        oficinaId: "of1",
        modoSeparacao: "por_cor",
        rolosEnviadosPorCor: { azul: 2, branco: 1 },
        rolosRecebidos: [
          { corId: "azul", pesoCortador: 12, folhasRendidas: 40 },
          { corId: "azul", pesoCortador: 12.5, folhasRendidas: 41 },
          { corId: "branco", pesoCortador: 11, folhasRendidas: 38 },
        ],
        folhasEnfesto: 10,
        rendimentoTotal: 120,
        rendimentoPorTamanhoCor: [
          { tamanho: "M", corId: "azul", quantidade: 80 },
          { tamanho: "M", corId: "branco", quantidade: 40 },
        ],
        precoPorPeca: 2.5,
      },
    ],
  });
  assert.equal(r.success, true);
});

test("ConcluirSubtaskCorte: rejeita pesoCortador <= 0 (RITM-34)", () => {
  const r = ConcluirSubtaskCorteSchema.safeParse({
    oficinas: [
      {
        oficinaId: "of1",
        modoSeparacao: "por_cor",
        rolosEnviadosPorCor: { azul: 1 },
        rolosRecebidos: [
          { corId: "azul", pesoCortador: 0, folhasRendidas: 40 },
        ],
        folhasEnfesto: 10,
        rendimentoTotal: 40,
        rendimentoPorTamanhoCor: [
          { tamanho: "M", corId: "azul", quantidade: 40 },
        ],
        precoPorPeca: 2,
      },
    ],
  });
  assert.equal(r.success, false);
});
