// Testes de dias úteis (puro, sem DB).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adicionarDiasUteis,
  ajustarParaDiaUtil,
  dataCivilSP,
  ehDiaUtil,
  hojeIsoSP,
  somarDias,
} from "./dias-uteis";

test("dataCivilSP: 17:42 UTC → 14:42 SP, mesmo dia", () => {
  assert.equal(dataCivilSP("2026-06-05T17:42:00.000Z"), "2026-06-05");
});

test("dataCivilSP: 02:00 UTC → 23:00 SP do dia anterior", () => {
  assert.equal(dataCivilSP("2026-06-05T02:00:00.000Z"), "2026-06-04");
});

test("dataCivilSP: virada de ano no UTC ainda cai em 31/12 SP", () => {
  // 2026-01-01T01:00Z = 2025-12-31T22:00 SP
  assert.equal(dataCivilSP("2026-01-01T01:00:00.000Z"), "2025-12-31");
});

test("ehDiaUtil: sábado (2026-06-06) → false", () => {
  assert.equal(ehDiaUtil("2026-06-06", new Set()), false);
});

test("ehDiaUtil: segunda (2026-06-08) → true", () => {
  assert.equal(ehDiaUtil("2026-06-08", new Set()), true);
});

test("ehDiaUtil: feriado cadastrado → false", () => {
  assert.equal(ehDiaUtil("2026-01-01", new Set(["2026-01-01"])), false);
});

test("ajustarParaDiaUtil: sábado vai pra segunda", () => {
  assert.equal(ajustarParaDiaUtil("2026-06-06", new Set()), "2026-06-08");
});

test("ajustarParaDiaUtil: domingo + feriado seg vai pra terça", () => {
  assert.equal(
    ajustarParaDiaUtil("2026-06-07", new Set(["2026-06-08"])),
    "2026-06-09",
  );
});

test("ajustarParaDiaUtil: dia útil retorna o próprio", () => {
  assert.equal(ajustarParaDiaUtil("2026-06-09", new Set()), "2026-06-09");
});

test("adicionarDiasUteis: quarta + 2 = sexta", () => {
  // 2026-06-03 é quarta
  assert.equal(adicionarDiasUteis("2026-06-03", 2, new Set()), "2026-06-05");
});

test("adicionarDiasUteis: sexta + 2 = terça (pula fim de semana)", () => {
  // 2026-06-05 é sexta
  assert.equal(adicionarDiasUteis("2026-06-05", 2, new Set()), "2026-06-09");
});

test("adicionarDiasUteis: pula feriado intermediário", () => {
  // qua + 2, mas qui é feriado → vira sexta
  assert.equal(
    adicionarDiasUteis("2026-06-03", 2, new Set(["2026-06-04"])),
    "2026-06-08",
  );
});

test("adicionarDiasUteis: n=0 só ajusta pra próximo dia útil", () => {
  // sábado + 0 = segunda
  assert.equal(adicionarDiasUteis("2026-06-06", 0, new Set()), "2026-06-08");
  // segunda + 0 = segunda
  assert.equal(adicionarDiasUteis("2026-06-08", 0, new Set()), "2026-06-08");
});

test("somarDias: virada de mês", () => {
  assert.equal(somarDias("2026-06-30", 1), "2026-07-01");
  assert.equal(somarDias("2026-06-30", -1), "2026-06-29");
});

test("hojeIsoSP: retorna YYYY-MM-DD válido", () => {
  const h = hojeIsoSP();
  assert.match(h, /^\d{4}-\d{2}-\d{2}$/);
});
