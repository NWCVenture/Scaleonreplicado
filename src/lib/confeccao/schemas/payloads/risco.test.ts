import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ConcluirSubtaskRiscoSchema,
  SubtaskRiscoPayloadSchema,
  validarLarguraVsRolo,
} from "./risco";

test("SubtaskRiscoPayload: aceita payload vazio (rascunho)", () => {
  const r = SubtaskRiscoPayloadSchema.safeParse({});
  assert.equal(r.success, true);
});

test("SubtaskRiscoPayload: rejeita rendimento > 100%", () => {
  const r = SubtaskRiscoPayloadSchema.safeParse({
    rendimentoPercentual: 105,
  });
  assert.equal(r.success, false);
});

test("ConcluirSubtaskRisco: aceita payload válido", () => {
  const r = ConcluirSubtaskRiscoSchema.safeParse({
    fornecedorRiscoId: "f1",
    tamanhos: [
      { tamanho: "M", proporcao: 4 },
      { tamanho: "G", proporcao: 5 },
      { tamanho: "GG", proporcao: 3 },
    ],
    rendimentoPercentual: 87.5,
    comprimentoM: 12,
    larguraCm: 160,
    valorServico: 350,
  });
  assert.equal(r.success, true);
});

test("ConcluirSubtaskRisco: rejeita tamanho duplicado na grade", () => {
  const r = ConcluirSubtaskRiscoSchema.safeParse({
    fornecedorRiscoId: "f1",
    tamanhos: [
      { tamanho: "M", proporcao: 4 },
      { tamanho: "M", proporcao: 2 },
    ],
    rendimentoPercentual: 90,
    comprimentoM: 10,
    larguraCm: 160,
    valorServico: 200,
  });
  assert.equal(r.success, false);
});

test("ConcluirSubtaskRisco: rejeita sem fornecedor", () => {
  const r = ConcluirSubtaskRiscoSchema.safeParse({
    tamanhos: [{ tamanho: "M", proporcao: 4 }],
    rendimentoPercentual: 90,
    comprimentoM: 10,
    larguraCm: 160,
    valorServico: 200,
  });
  assert.equal(r.success, false);
});

test("validarLarguraVsRolo: largura ≤ rolo → ok", () => {
  const r = validarLarguraVsRolo(160, 165);
  assert.equal(r.ok, true);
});

test("validarLarguraVsRolo: largura > rolo → erro", () => {
  const r = validarLarguraVsRolo(170, 165);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.match(r.mensagem, /excede/);
  }
});

test("validarLarguraVsRolo: largura == rolo (limite exato) → ok", () => {
  const r = validarLarguraVsRolo(165, 165);
  assert.equal(r.ok, true);
});

test("validarLarguraVsRolo: largura do rolo NULL → erro explicativo", () => {
  const r = validarLarguraVsRolo(160, null);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.match(r.mensagem, /Compra/);
  }
});
