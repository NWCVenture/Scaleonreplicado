import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ConcluirSubtaskCosturaSchema,
  pecasCortadasPorTamCor,
  SubtaskCosturaPayloadSchema,
  validarEtiquetagem,
  validarSaldoPecasVsCorte,
} from "./costura";

test("SubtaskCosturaPayload: aceita vazio", () => {
  const r = SubtaskCosturaPayloadSchema.safeParse({});
  assert.equal(r.success, true);
});

test("ConcluirSubtaskCostura: aceita oficina finalizada completa", () => {
  const r = ConcluirSubtaskCosturaSchema.safeParse({
    oficinas: [
      {
        oficinaId: "of1",
        prazoProducao: new Date().toISOString(),
        pecasEnviadasPorTamanhoCor: [
          { tamanho: "M", corId: "co1", quantidade: 100 },
        ],
        etiquetagem: [
          { tamanhoEtiqueta: "M", quantidade: 100, fonteGradeCorte: "M" },
        ],
        precoPorPeca: 5,
        statusInterno: "finalizada",
      },
    ],
  });
  assert.equal(r.success, true);
});

test("ConcluirSubtaskCostura: rejeita oficina não finalizada", () => {
  const r = ConcluirSubtaskCosturaSchema.safeParse({
    oficinas: [
      {
        oficinaId: "of1",
        prazoProducao: new Date().toISOString(),
        pecasEnviadasPorTamanhoCor: [
          { tamanho: "M", corId: "co1", quantidade: 100 },
        ],
        etiquetagem: [
          { tamanhoEtiqueta: "M", quantidade: 100, fonteGradeCorte: "M" },
        ],
        precoPorPeca: 5,
        statusInterno: "em_producao",
      },
    ],
  });
  assert.equal(r.success, false);
});

test("ConcluirSubtaskCostura: rejeita etiquetagem que excede peças da fonte", () => {
  const r = ConcluirSubtaskCosturaSchema.safeParse({
    oficinas: [
      {
        oficinaId: "of1",
        prazoProducao: new Date().toISOString(),
        pecasEnviadasPorTamanhoCor: [
          { tamanho: "M", corId: "co1", quantidade: 100 },
        ],
        etiquetagem: [
          // 100 M etiquetadas como P (excede)
          { tamanhoEtiqueta: "P", quantidade: 100, fonteGradeCorte: "M" },
          // + 100 M etiquetadas como M (vai dar 200 total a partir de M, mas só 100 enviadas)
          { tamanhoEtiqueta: "M", quantidade: 100, fonteGradeCorte: "M" },
        ],
        precoPorPeca: 5,
        statusInterno: "finalizada",
      },
    ],
  });
  assert.equal(r.success, false);
});

test("validarEtiquetagem: etiquetagem cruzada válida", () => {
  const r = validarEtiquetagem({
    oficinaId: "of1",
    statusInterno: "finalizada",
    pecasEnviadasPorTamanhoCor: [
      { tamanho: "M", corId: "co1", quantidade: 200 },
      { tamanho: "G", corId: "co1", quantidade: 400 },
      { tamanho: "GG", corId: "co1", quantidade: 200 },
    ],
    etiquetagem: [
      { tamanhoEtiqueta: "P", quantidade: 100, fonteGradeCorte: "M" },
      { tamanhoEtiqueta: "M", quantidade: 100, fonteGradeCorte: "M" },
      { tamanhoEtiqueta: "G", quantidade: 400, fonteGradeCorte: "G" },
      { tamanhoEtiqueta: "GG", quantidade: 100, fonteGradeCorte: "GG" },
      { tamanhoEtiqueta: "EGG", quantidade: 100, fonteGradeCorte: "GG" },
    ],
  });
  assert.equal(r.ok, true);
});

test("validarEtiquetagem: fonte sobre-usada → erro", () => {
  const r = validarEtiquetagem({
    oficinaId: "of1",
    statusInterno: "finalizada",
    pecasEnviadasPorTamanhoCor: [
      { tamanho: "M", corId: "co1", quantidade: 100 },
    ],
    etiquetagem: [
      { tamanhoEtiqueta: "P", quantidade: 80, fonteGradeCorte: "M" },
      { tamanhoEtiqueta: "M", quantidade: 80, fonteGradeCorte: "M" }, // 160 > 100
    ],
  });
  assert.equal(r.ok, false);
});

test("validarSaldoPecasVsCorte: dentro do disponível → ok", () => {
  const disponivel = new Map([
    ["M|co1", 100],
    ["G|co1", 200],
  ]);
  const r = validarSaldoPecasVsCorte(
    [
      {
        oficinaId: "of1",
        statusInterno: "enviado",
        pecasEnviadasPorTamanhoCor: [
          { tamanho: "M", corId: "co1", quantidade: 50 },
          { tamanho: "G", corId: "co1", quantidade: 100 },
        ],
      },
      {
        oficinaId: "of2",
        statusInterno: "enviado",
        pecasEnviadasPorTamanhoCor: [
          { tamanho: "M", corId: "co1", quantidade: 30 },
          { tamanho: "G", corId: "co1", quantidade: 80 },
        ],
      },
    ],
    disponivel,
  );
  assert.equal(r.ok, true);
});

test("validarSaldoPecasVsCorte: excede → erro", () => {
  const disponivel = new Map([["M|co1", 100]]);
  const r = validarSaldoPecasVsCorte(
    [
      {
        oficinaId: "of1",
        statusInterno: "enviado",
        pecasEnviadasPorTamanhoCor: [
          { tamanho: "M", corId: "co1", quantidade: 60 },
        ],
      },
      {
        oficinaId: "of2",
        statusInterno: "enviado",
        pecasEnviadasPorTamanhoCor: [
          { tamanho: "M", corId: "co1", quantidade: 50 },
        ],
      },
    ],
    disponivel,
  );
  assert.equal(r.ok, false);
});

test("pecasCortadasPorTamCor: soma todas as oficinas do Corte", () => {
  const mapa = pecasCortadasPorTamCor({
    oficinas: [
      {
        rendimentoPorTamanhoCor: [
          { tamanho: "M", corId: "co1", quantidade: 50 },
          { tamanho: "G", corId: "co1", quantidade: 100 },
        ],
      },
      {
        rendimentoPorTamanhoCor: [
          { tamanho: "M", corId: "co1", quantidade: 30 },
        ],
      },
    ],
  });
  assert.equal(mapa.get("M|co1"), 80);
  assert.equal(mapa.get("G|co1"), 100);
});
