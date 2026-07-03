import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AtualizarSubconferenciaSchema,
  compararMatrizes,
  derivarAprovadas,
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

test("derivarAprovadas: recebidas − defeitos, por célula", () => {
  const r = derivarAprovadas(
    { M: { co1: 100, co2: 50 }, G: { co1: 30 } },
    { M: { co1: 10 } },
  );
  assert.deepEqual(r, { M: { co1: 90, co2: 50 }, G: { co1: 30 } });
});

test("derivarAprovadas: defeito maior que recebido → 0 (clamp)", () => {
  const r = derivarAprovadas({ M: { co1: 5 } }, { M: { co1: 8 } });
  assert.deepEqual(r, { M: { co1: 0 } });
});

test("derivarAprovadas: sem defeitos (null) → cópia das recebidas", () => {
  const r = derivarAprovadas({ M: { co1: 100 } }, null);
  assert.deepEqual(r, { M: { co1: 100 } });
});

test("validarPodeConcluirSubconferencia: contagem + destinação → ok", () => {
  const r = validarPodeConcluirSubconferencia({
    pecasRecebidas: { M: { co1: 100 } },
    reprovadas: { M: { co1: 10 } },
    localizacaoArmazem: "Prateleira A",
    destinoReprovadas: "doacao",
  });
  assert.equal(r.ok, true);
});

test("validarPodeConcluirSubconferencia: defeitos não são obrigatórios", () => {
  const r = validarPodeConcluirSubconferencia({
    pecasRecebidas: { M: { co1: 100 } },
    reprovadas: null,
    localizacaoArmazem: "Prateleira A",
    destinoReprovadas: null,
  });
  assert.equal(r.ok, true);
});

test("validarPodeConcluirSubconferencia: sem contagem → erro", () => {
  const r = validarPodeConcluirSubconferencia({
    pecasRecebidas: null,
    reprovadas: null,
    localizacaoArmazem: "Prateleira A",
    destinoReprovadas: null,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.mensagem, /contagem/i);
});

test("validarPodeConcluirSubconferencia: defeitos sem destino → erro", () => {
  const r = validarPodeConcluirSubconferencia({
    pecasRecebidas: { M: { co1: 100 } },
    reprovadas: { M: { co1: 10 } },
    localizacaoArmazem: "Prateleira A",
    destinoReprovadas: null,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.mensagem, /destino/i);
});

test("validarPodeConcluirSubconferencia: aprovadas derivadas sem localização → erro", () => {
  const r = validarPodeConcluirSubconferencia({
    pecasRecebidas: { M: { co1: 100 } },
    reprovadas: null,
    localizacaoArmazem: null,
    destinoReprovadas: null,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.mensagem, /localiza/i);
});

test("validarPodeConcluirSubconferencia: defeitos excedem recebido → erro", () => {
  const r = validarPodeConcluirSubconferencia({
    pecasRecebidas: { M: { co1: 100 } },
    reprovadas: { M: { co1: 120 } },
    localizacaoArmazem: "Prateleira A",
    destinoReprovadas: "descarte",
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.mensagem, /excedem/i);
});
