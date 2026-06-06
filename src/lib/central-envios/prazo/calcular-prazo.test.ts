// Testes do dispatcher principal `calcularPrazo`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { calcularPrazo } from "./calcular-prazo";
import { chaveRegraCanal, type ContextoPrazo, type RegraPrazoSnapshot } from "./types";

function ctxFixture(opts: {
  regrasDefault?: RegraPrazoSnapshot[];
  regrasCanal?: RegraPrazoSnapshot[];
  feriados?: string[];
  hojeIso?: string;
}): ContextoPrazo {
  return {
    regrasDefaultPorPlataforma: new Map(
      (opts.regrasDefault ?? []).map((r) => [r.plataforma, r] as const),
    ),
    regrasPorCanal: new Map(
      (opts.regrasCanal ?? []).map(
        (r) =>
          [chaveRegraCanal(r.plataforma, r.canalVendaId!), r] as const,
      ),
    ),
    feriadosSet: new Set(opts.feriados ?? []),
    hojeIso: opts.hojeIso ?? "2026-06-05",
  };
}

function regra(over: Partial<RegraPrazoSnapshot>): RegraPrazoSnapshot {
  return {
    id: "r1",
    plataforma: "tiktok_shop",
    canalVendaId: null,
    estrategia: "DIAS_UTEIS_POS_VENDA",
    diasUteis: 2,
    campoPrazo: null,
    regexPrazo: null,
    fallbackHoje: false,
    ativo: true,
    ...over,
  };
}

test("DIAS_UTEIS_POS_VENDA: criado qua → prazo sex", () => {
  const ctx = ctxFixture({
    regrasDefault: [regra({})],
  });
  const r = calcularPrazo(
    {
      plataforma: "tiktok_shop",
      canalVendaId: null,
      criadoEmIso: "2026-06-03T13:00:00.000Z", // qua 10:00 SP
      camposExtras: {},
    },
    ctx,
  );
  assert.equal(r.status, "CALCULADO");
  assert.equal(r.origem, "dias_uteis_pos_venda");
  assert.equal(r.prazoIso, "2026-06-05");
});

test("DIAS_UTEIS_POS_VENDA: sem criadoEmIso e sem fallback → SEM_DATA", () => {
  const ctx = ctxFixture({ regrasDefault: [regra({})] });
  const r = calcularPrazo(
    {
      plataforma: "tiktok_shop",
      canalVendaId: null,
      criadoEmIso: null,
      camposExtras: {},
    },
    ctx,
  );
  assert.equal(r.status, "SEM_DATA");
});

test("DIAS_UTEIS_POS_VENDA: sem criadoEmIso mas fallbackHoje=true → HOJE", () => {
  const ctx = ctxFixture({
    regrasDefault: [regra({ fallbackHoje: true })],
    hojeIso: "2026-06-05",
  });
  const r = calcularPrazo(
    {
      plataforma: "tiktok_shop",
      canalVendaId: null,
      criadoEmIso: null,
      camposExtras: {},
    },
    ctx,
  );
  assert.equal(r.status, "HOJE");
  assert.equal(r.prazoIso, "2026-06-05");
  assert.equal(r.origem, "fallback_hoje");
});

test("CAMPO_EXPLICITO: extrai data de 'coleta do dia 7 de junho'", () => {
  const ctx = ctxFixture({
    regrasDefault: [
      regra({
        plataforma: "mercado_livre",
        estrategia: "CAMPO_EXPLICITO",
        diasUteis: null,
        campoPrazo: "Estado",
        regexPrazo: "coleta do dia (\\d+) de (\\w+)",
        fallbackHoje: true,
      }),
    ],
    hojeIso: "2026-06-05",
  });
  const r = calcularPrazo(
    {
      plataforma: "mercado_livre",
      canalVendaId: null,
      criadoEmIso: "2026-06-05T13:00:00.000Z",
      camposExtras: { Estado: "coleta do dia 7 de junho" },
    },
    ctx,
  );
  assert.equal(r.status, "CALCULADO");
  assert.equal(r.origem, "campo_explicito");
  assert.equal(r.prazoIso, "2026-06-08"); // 7 = sábado → ajusta pra segunda
});

test("CAMPO_EXPLICITO sem campo no pedido + fallback → HOJE", () => {
  const ctx = ctxFixture({
    regrasDefault: [
      regra({
        plataforma: "mercado_livre",
        estrategia: "CAMPO_EXPLICITO",
        diasUteis: null,
        campoPrazo: "Estado",
        regexPrazo: "coleta do dia (\\d+) de (\\w+)",
        fallbackHoje: true,
      }),
    ],
    hojeIso: "2026-06-05",
  });
  const r = calcularPrazo(
    {
      plataforma: "mercado_livre",
      canalVendaId: null,
      criadoEmIso: "2026-06-05T13:00:00.000Z",
      camposExtras: { Estado: null },
    },
    ctx,
  );
  assert.equal(r.status, "HOJE");
});

test("CAMPO_EXPLICITO sem fallback + campo ausente → SEM_DATA", () => {
  const ctx = ctxFixture({
    regrasDefault: [
      regra({
        plataforma: "mercado_livre",
        estrategia: "CAMPO_EXPLICITO",
        diasUteis: null,
        campoPrazo: "Estado",
        regexPrazo: "coleta do dia (\\d+) de (\\w+)",
        fallbackHoje: false,
      }),
    ],
  });
  const r = calcularPrazo(
    {
      plataforma: "mercado_livre",
      canalVendaId: null,
      criadoEmIso: "2026-06-05T13:00:00.000Z",
      camposExtras: {},
    },
    ctx,
  );
  assert.equal(r.status, "SEM_DATA");
});

test("HIBRIDO: campo presente → usa CAMPO_EXPLICITO", () => {
  const ctx = ctxFixture({
    regrasDefault: [
      regra({
        plataforma: "shopee",
        estrategia: "HIBRIDO",
        diasUteis: 2,
        campoPrazo: "Estado",
        regexPrazo: "coleta do dia (\\d+) de (\\w+)",
        fallbackHoje: true,
      }),
    ],
    hojeIso: "2026-06-05",
  });
  const r = calcularPrazo(
    {
      plataforma: "shopee",
      canalVendaId: null,
      criadoEmIso: "2026-06-03T13:00:00.000Z",
      camposExtras: { Estado: "coleta do dia 7 de junho" },
    },
    ctx,
  );
  assert.equal(r.origem, "campo_explicito");
  assert.equal(r.prazoIso, "2026-06-08");
});

test("HIBRIDO: campo ausente → cai em DIAS_UTEIS_POS_VENDA", () => {
  const ctx = ctxFixture({
    regrasDefault: [
      regra({
        plataforma: "shopee",
        estrategia: "HIBRIDO",
        diasUteis: 1,
        campoPrazo: "Estado",
        regexPrazo: "coleta do dia (\\d+) de (\\w+)",
        fallbackHoje: true,
      }),
    ],
  });
  // criado qua → +1 dia útil = qui
  const r = calcularPrazo(
    {
      plataforma: "shopee",
      canalVendaId: null,
      criadoEmIso: "2026-06-03T13:00:00.000Z",
      camposExtras: {},
    },
    ctx,
  );
  assert.equal(r.origem, "dias_uteis_pos_venda");
  assert.equal(r.prazoIso, "2026-06-04");
});

test("HIBRIDO: campo e dias falham + fallback=false → SEM_DATA", () => {
  const ctx = ctxFixture({
    regrasDefault: [
      regra({
        plataforma: "shopee",
        estrategia: "HIBRIDO",
        diasUteis: 1,
        campoPrazo: "Estado",
        regexPrazo: "coleta do dia (\\d+) de (\\w+)",
        fallbackHoje: false,
      }),
    ],
  });
  const r = calcularPrazo(
    {
      plataforma: "shopee",
      canalVendaId: null,
      criadoEmIso: null,
      camposExtras: {},
    },
    ctx,
  );
  assert.equal(r.status, "SEM_DATA");
});

test("Lookup canal-específico tem precedência sobre default", () => {
  const default_ = regra({ plataforma: "tiktok_shop", diasUteis: 2 });
  const especifica = regra({
    id: "r2",
    plataforma: "tiktok_shop",
    canalVendaId: "canal-x",
    diasUteis: 5,
  });
  const ctx = ctxFixture({
    regrasDefault: [default_],
    regrasCanal: [especifica],
  });
  const r = calcularPrazo(
    {
      plataforma: "tiktok_shop",
      canalVendaId: "canal-x",
      criadoEmIso: "2026-06-03T13:00:00.000Z", // qua
      camposExtras: {},
    },
    ctx,
  );
  // qua + 5 dias úteis = qua seguinte = 2026-06-10
  assert.equal(r.prazoIso, "2026-06-10");
});

test("Plataforma sem nenhuma regra cadastrada → SEM_DATA", () => {
  const ctx = ctxFixture({});
  const r = calcularPrazo(
    {
      plataforma: "tiktok_shop",
      canalVendaId: null,
      criadoEmIso: "2026-06-05T13:00:00.000Z",
      camposExtras: {},
    },
    ctx,
  );
  assert.equal(r.status, "SEM_DATA");
});

test("Regra inativa → SEM_DATA", () => {
  const ctx = ctxFixture({
    regrasDefault: [regra({ ativo: false })],
  });
  const r = calcularPrazo(
    {
      plataforma: "tiktok_shop",
      canalVendaId: null,
      criadoEmIso: "2026-06-05T13:00:00.000Z",
      camposExtras: {},
    },
    ctx,
  );
  assert.equal(r.status, "SEM_DATA");
});

test("DIAS_UTEIS pula feriado", () => {
  const ctx = ctxFixture({
    regrasDefault: [regra({ diasUteis: 2 })],
    feriados: ["2026-06-04"], // qui
  });
  const r = calcularPrazo(
    {
      plataforma: "tiktok_shop",
      canalVendaId: null,
      criadoEmIso: "2026-06-03T13:00:00.000Z", // qua
      camposExtras: {},
    },
    ctx,
  );
  assert.equal(r.prazoIso, "2026-06-08"); // pula qui feriado → sex+1 = seg
});
