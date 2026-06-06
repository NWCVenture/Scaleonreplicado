// Testes do parser de prazo explícito (texto livre → YYYY-MM-DD).

import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePrazoExplicito } from "./parse-prazo-explicito";

const REGEX_ML = "coleta do dia (\\d+) de (\\w+)";

test("'coleta do dia 7 de junho' → 2026-06-07", () => {
  assert.equal(parsePrazoExplicito("coleta do dia 7 de junho", REGEX_ML, 2026, 6), "2026-06-07");
});

test("'coleta do dia 31 de dezembro' → 2026-12-31", () => {
  assert.equal(
    parsePrazoExplicito("coleta do dia 31 de dezembro", REGEX_ML, 2026, 11),
    "2026-12-31",
  );
});

test("'coleta do dia 5 de janeiro' anoBase=2026 mesAtual=09 → 2027-01-05 (próximo ano)", () => {
  assert.equal(
    parsePrazoExplicito("coleta do dia 5 de janeiro", REGEX_ML, 2026, 9),
    "2027-01-05",
  );
});

test("Mês abreviado 'jun' aceito", () => {
  assert.equal(parsePrazoExplicito("coleta do dia 7 de jun", REGEX_ML, 2026, 6), "2026-06-07");
});

test("Mês com acento 'março' aceito", () => {
  assert.equal(parsePrazoExplicito("coleta do dia 1 de março", REGEX_ML, 2026, 3), "2026-03-01");
});

test("Mês inválido → null", () => {
  assert.equal(parsePrazoExplicito("coleta do dia 7 de fevreio", REGEX_ML, 2026, 6), null);
});

test("Texto sem match → null", () => {
  assert.equal(parsePrazoExplicito("nada relevante aqui", REGEX_ML, 2026, 6), null);
});

test("Regex inválida → null", () => {
  assert.equal(parsePrazoExplicito("qualquer", "([", 2026, 6), null);
});

test("Day = 32 → null", () => {
  assert.equal(parsePrazoExplicito("coleta do dia 32 de junho", REGEX_ML, 2026, 6), null);
});

test("Day > diasNoMes (30 de fevereiro) → null", () => {
  assert.equal(parsePrazoExplicito("coleta do dia 30 de fevereiro", REGEX_ML, 2026, 6), null);
});

test("Texto vazio → null", () => {
  assert.equal(parsePrazoExplicito("", REGEX_ML, 2026, 6), null);
});

test("Case insensitive ('COLETA DO DIA 7 DE JUNHO') → 2026-06-07", () => {
  assert.equal(
    parsePrazoExplicito("COLETA DO DIA 7 DE JUNHO", REGEX_ML, 2026, 6),
    "2026-06-07",
  );
});
