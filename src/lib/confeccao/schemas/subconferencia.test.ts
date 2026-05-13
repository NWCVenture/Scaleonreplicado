import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AtualizarSubconferenciaSchema,
  compararMatrizes,
  somarMatriz,
  validarPodeConcluirSubconferencia,
} from "./subconferencia";

test("AtualizarSubconferenciaSchema: aceita payload parcial (só matriz)", () => {
  const r = AtualizarSubconferenciaSchema.safeParse({
    pecasRecebidas: { M: { co1: 100 } },
  });
  assert.equal(r.success, true);
});

test("AtualizarSubconferenciaSchema: rejeita tipo de defeito inválido", () => {
  const r = AtualizarSubconferenciaSchema.safeParse({
    tiposDefeito: ["rebarba", "x_inexistente"],
  });
  assert.equal(r.success, false);
});

test("AtualizarSubconferenciaSchema: aceita justificativa de edição", () => {
  const r = AtualizarSubconferenciaSchema.safeParse({
    pecasRecebidas: { M: { co1: 110 } },
    justificativaEdicao: "Erro de digitação corrigido",
  });
  assert.equal(r.success, true);
});

test("somarMatriz: soma todas células", () => {
  const total = somarMatriz({
    M: { co1: 100, co2: 50 },
    G: { co1: 200 },
  });
  assert.equal(total, 350);
});

test("somarMatriz: matriz vazia → 0", () => {
  assert.equal(somarMatriz({}), 0);
});

test("compararMatrizes: detecta divergência positiva e negativa", () => {
  const recebidas = { M: { co1: 102, co2: 48 } };
  const esperadas = { M: { co1: 100, co2: 50 } };
  const d = compararMatrizes(recebidas, esperadas);
  assert.equal(d.length, 2);
  const co1 = d.find((x) => x.corId === "co1");
  const co2 = d.find((x) => x.corId === "co2");
  assert.equal(co1?.diferenca, 2);
  assert.equal(co2?.diferenca, -2);
});

test("compararMatrizes: sem divergência → array vazio", () => {
  const m = { M: { co1: 100 } };
  assert.equal(compararMatrizes(m, m).length, 0);
});

test("compararMatrizes: célula presente só em uma matriz", () => {
  const recebidas = { M: { co1: 50 } };
  const esperadas = { M: { co1: 50, co2: 30 } };
  const d = compararMatrizes(recebidas, esperadas);
  assert.equal(d.length, 1);
  assert.equal(d[0].corId, "co2");
  assert.equal(d[0].diferenca, -30);
});

test("validarPodeConcluirSubconferencia: payload completo → ok", () => {
  const r = validarPodeConcluirSubconferencia({
    pecasRecebidas: { M: { co1: 100 } },
    responsavelInspecaoId: "u1",
    aprovadas: { M: { co1: 90 } },
    reprovadas: { M: { co1: 10 } },
    dataInspecao: new Date(),
    localizacaoArmazem: "Prateleira A",
    destinoReprovadas: "doacao",
  });
  assert.equal(r.ok, true);
});

test("validarPodeConcluirSubconferencia: sem contagem → erro", () => {
  const r = validarPodeConcluirSubconferencia({
    pecasRecebidas: null,
    responsavelInspecaoId: "u1",
    aprovadas: { M: { co1: 90 } },
    reprovadas: null,
    dataInspecao: new Date(),
    localizacaoArmazem: "Prateleira A",
    destinoReprovadas: null,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.mensagem, /contagem/i);
});

test("validarPodeConcluirSubconferencia: reprovadas sem destino → erro", () => {
  const r = validarPodeConcluirSubconferencia({
    pecasRecebidas: { M: { co1: 100 } },
    responsavelInspecaoId: "u1",
    aprovadas: { M: { co1: 90 } },
    reprovadas: { M: { co1: 10 } },
    dataInspecao: new Date(),
    localizacaoArmazem: "Prateleira A",
    destinoReprovadas: null,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.mensagem, /destino/i);
});

test("validarPodeConcluirSubconferencia: aprovadas sem localização → erro", () => {
  const r = validarPodeConcluirSubconferencia({
    pecasRecebidas: { M: { co1: 100 } },
    responsavelInspecaoId: "u1",
    aprovadas: { M: { co1: 100 } },
    reprovadas: null,
    dataInspecao: new Date(),
    localizacaoArmazem: null,
    destinoReprovadas: null,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.mensagem, /localiza/i);
});
