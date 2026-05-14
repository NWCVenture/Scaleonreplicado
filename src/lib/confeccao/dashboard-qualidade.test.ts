import { test } from "node:test";
import assert from "node:assert/strict";
import {
  montarDashboardQualidade,
  type DashboardQualidadeInput,
  type OficinaQualidadeRaw,
  type RetiradaQualidadeRaw,
  type SubconferenciaQualidadeRaw,
  type SubtaskCosturaQualidadeRaw,
  type TipoDefeito,
} from "./dashboard-qualidade";

const PERIODO_DE = new Date("2026-05-01T00:00:00Z");
const PERIODO_ATE = new Date("2026-05-31T23:59:59Z");

function scBase(
  over: Partial<SubconferenciaQualidadeRaw> = {},
): SubconferenciaQualidadeRaw {
  return {
    id: "sc1",
    numero: "OP05260001-CONF-RET01",
    retiradaId: "ret1",
    opNumero: "OP05260001",
    produtoId: "prod-camiseta",
    status: "concluida",
    aprovadas: { M: { preto: 90 } },
    reprovadas: { M: { preto: 10 } },
    tiposDefeito: ["rebarba"],
    divergenciaConfirmada: false,
    oficinaResponsavelDivergenciaId: null,
    concluidaEm: new Date("2026-05-10T12:00:00Z"),
    dataInspecao: new Date("2026-05-10T11:30:00Z"),
    ...over,
  };
}

function retBase(
  over: Partial<RetiradaQualidadeRaw> = {},
): RetiradaQualidadeRaw {
  return {
    id: "ret1",
    subtaskCosturaId: "stcos1",
    oficinaId: "of1",
    tipo: "final",
    dataRetirada: new Date("2026-05-10T10:00:00Z"),
    canceladaEm: null,
    ...over,
  };
}

function stBase(
  over: Partial<SubtaskCosturaQualidadeRaw> = {},
): SubtaskCosturaQualidadeRaw {
  return {
    id: "stcos1",
    iniciadaEm: new Date("2026-05-01T08:00:00Z"),
    payload: {
      oficinas: [{ oficinaId: "of1", prazoProducao: "2026-05-12T00:00:00Z" }],
    },
    ...over,
  };
}

function ofs(over: OficinaQualidadeRaw[] = []): OficinaQualidadeRaw[] {
  const defaults: OficinaQualidadeRaw[] = [
    { id: "of1", nome: "Oficina 1" },
    { id: "of2", nome: "Oficina 2" },
  ];
  return over.length > 0 ? over : defaults;
}

function input(
  over: Partial<DashboardQualidadeInput> = {},
): DashboardQualidadeInput {
  return {
    periodoDe: PERIODO_DE,
    periodoAte: PERIODO_ATE,
    subconferencias: [],
    retiradas: [],
    subtasksCostura: [],
    oficinas: ofs(),
    ...over,
  };
}

test("vazio → KPIs zerados, ranking vazio, topDefeitos vazio", () => {
  const out = montarDashboardQualidade(input());
  assert.equal(out.kpis.oficinasAvaliadas, 0);
  assert.equal(out.kpis.aprovacaoMedia, 0);
  assert.equal(out.kpis.pontualidadeMedia, 0);
  assert.equal(out.ranking.length, 0);
  assert.equal(out.topDefeitos.length, 0);
  assert.deepEqual(out.detalhePorOficina, {});
});

test("1 oficina com 2 subconferências → aprovação calculada corretamente", () => {
  const out = montarDashboardQualidade(
    input({
      subconferencias: [
        scBase({
          id: "sc1",
          aprovadas: { M: { preto: 80 } },
          reprovadas: { M: { preto: 20 } },
        }),
        scBase({
          id: "sc2",
          numero: "OP05260001-CONF-RET02",
          retiradaId: "ret2",
          aprovadas: { G: { branco: 50 } },
          reprovadas: { G: { branco: 0 } },
          concluidaEm: new Date("2026-05-15T12:00:00Z"),
        }),
      ],
      retiradas: [retBase(), retBase({ id: "ret2", tipo: "parcial" })],
      subtasksCostura: [stBase()],
    }),
  );
  assert.equal(out.ranking.length, 1);
  const r = out.ranking[0];
  assert.equal(r.oficinaId, "of1");
  assert.equal(r.pecasAvaliadas, 150);
  // 130 aprovadas / 150 = 0.866...
  assert.ok(Math.abs(r.aprovacao - 130 / 150) < 1e-9);
  assert.equal(out.kpis.oficinasAvaliadas, 1);
  assert.ok(Math.abs(out.kpis.aprovacaoMedia - 130 / 150) < 1e-9);
});

test("retirada cancelada → ignorada em todos os cálculos", () => {
  const out = montarDashboardQualidade(
    input({
      subconferencias: [
        scBase({ id: "sc1" }),
        scBase({
          id: "sc2",
          numero: "OP05260001-CONF-RET02",
          retiradaId: "ret2",
          aprovadas: { M: { preto: 0 } },
          reprovadas: { M: { preto: 50 } },
          tiposDefeito: ["furo"],
        }),
      ],
      retiradas: [
        retBase(),
        retBase({
          id: "ret2",
          canceladaEm: new Date("2026-05-09T00:00:00Z"),
        }),
      ],
      subtasksCostura: [stBase()],
    }),
  );
  // Só conta sc1 (90 aprov + 10 rep). sc2 está ligada a retirada cancelada.
  assert.equal(out.ranking.length, 1);
  assert.equal(out.ranking[0].pecasAvaliadas, 100);
  assert.ok(Math.abs(out.ranking[0].aprovacao - 0.9) < 1e-9);
  // Top defeito do sc2 (furo) também é ignorado.
  assert.equal(out.topDefeitos.length, 1);
  assert.equal(out.topDefeitos[0].tipo, "rebarba");
});

test("sem prazoProducao em nenhuma retirada → pontualidade null", () => {
  const out = montarDashboardQualidade(
    input({
      subconferencias: [scBase()],
      retiradas: [retBase()],
      subtasksCostura: [
        stBase({ payload: { oficinas: [{ oficinaId: "of1" }] } }),
      ],
    }),
  );
  assert.equal(out.ranking[0].pontualidade, null);
  assert.equal(out.kpis.pontualidadeMedia, 0);
});

test("subconferência incompleta (sem aprovadas/reprovadas) → ignorada", () => {
  const out = montarDashboardQualidade(
    input({
      subconferencias: [
        scBase({ id: "sc1" }),
        scBase({
          id: "sc2",
          retiradaId: "ret2",
          aprovadas: null,
          reprovadas: null,
        }),
        scBase({
          id: "sc3",
          retiradaId: "ret3",
          status: "em_andamento",
        }),
      ],
      retiradas: [retBase(), retBase({ id: "ret2" }), retBase({ id: "ret3" })],
      subtasksCostura: [stBase()],
    }),
  );
  // Só sc1 vale; sc2 (sem matriz) e sc3 (em_andamento) ignoradas.
  assert.equal(out.ranking.length, 1);
  assert.equal(out.ranking[0].pecasAvaliadas, 100);
});

test("divergência confirmada → conta na oficina responsável, não na da retirada", () => {
  // Subconferência foi feita pela of1 (oficina da retirada), mas a divergência
  // é responsabilidade da of2. of2 deve aparecer no ranking com 1 divergência
  // mesmo sem ter subconferência própria (porque o agg só ganha entrada de
  // divergência se já houver agg pra ela). Pra of2 aparecer mesmo, ela
  // precisa ter pelo menos peças avaliadas ou divergência.
  const out = montarDashboardQualidade(
    input({
      subconferencias: [
        scBase({
          divergenciaConfirmada: true,
          oficinaResponsavelDivergenciaId: "of2",
        }),
      ],
      retiradas: [retBase()],
      subtasksCostura: [stBase()],
    }),
  );
  const r1 = out.ranking.find((x) => x.oficinaId === "of1");
  const r2 = out.ranking.find((x) => x.oficinaId === "of2");
  assert.ok(r1, "of1 deve aparecer (tem subconferência)");
  assert.equal(r1.divergenciasConfirmadas, 0);
  assert.ok(r2, "of2 deve aparecer (tem divergência atribuída)");
  assert.equal(r2.pecasAvaliadas, 0);
  assert.equal(r2.divergenciasConfirmadas, 1);
});

test("top defeitos: ordenação descendente e percentual sobre total de marcações", () => {
  const out = montarDashboardQualidade(
    input({
      subconferencias: [
        scBase({
          id: "sc1",
          tiposDefeito: ["rebarba", "mancha"],
        }),
        scBase({
          id: "sc2",
          retiradaId: "ret2",
          tiposDefeito: ["rebarba", "furo"],
        }),
        scBase({
          id: "sc3",
          retiradaId: "ret3",
          tiposDefeito: ["rebarba"],
        }),
      ],
      retiradas: [retBase(), retBase({ id: "ret2" }), retBase({ id: "ret3" })],
      subtasksCostura: [stBase()],
    }),
  );
  // 5 marcações no total: rebarba×3, mancha×1, furo×1.
  assert.equal(out.topDefeitos.length, 3);
  assert.equal(out.topDefeitos[0].tipo, "rebarba");
  assert.equal(out.topDefeitos[0].contagem, 3);
  assert.ok(Math.abs(out.topDefeitos[0].percentual - 3 / 5) < 1e-9);
  assert.equal(out.topDefeitos[1].contagem, 1);
  assert.equal(out.topDefeitos[2].contagem, 1);
});

test("pontualidade: retirada antes do prazo conta, depois não", () => {
  const out = montarDashboardQualidade(
    input({
      subconferencias: [
        scBase({ id: "sc1" }),
        scBase({
          id: "sc2",
          retiradaId: "ret2",
          aprovadas: { M: { preto: 100 } },
          reprovadas: { M: { preto: 0 } },
        }),
      ],
      retiradas: [
        retBase({
          id: "ret1",
          // dia 10 <= prazo 12 → on time
          dataRetirada: new Date("2026-05-10T10:00:00Z"),
        }),
        retBase({
          id: "ret2",
          subtaskCosturaId: "stcos2",
          // dia 15 > prazo 12 → atrasada
          dataRetirada: new Date("2026-05-15T10:00:00Z"),
        }),
      ],
      subtasksCostura: [
        stBase({ id: "stcos1" }),
        stBase({ id: "stcos2" }),
      ],
    }),
  );
  // 1 de 2 retiradas finais foram no prazo
  assert.equal(out.ranking[0].pontualidade, 0.5);
  assert.equal(out.kpis.pontualidadeMedia, 0.5);
});

test("filtro de produto restringe ranking", () => {
  const out = montarDashboardQualidade(
    input({
      produtoIdFiltro: "prod-camiseta",
      subconferencias: [
        scBase({ id: "sc1", produtoId: "prod-camiseta" }),
        scBase({
          id: "sc2",
          retiradaId: "ret2",
          produtoId: "prod-blusa",
          aprovadas: { M: { preto: 200 } },
          reprovadas: { M: { preto: 0 } },
        }),
      ],
      retiradas: [retBase(), retBase({ id: "ret2", oficinaId: "of2" })],
      subtasksCostura: [stBase()],
    }),
  );
  // Só sc1 passa. of2 nem aparece no ranking.
  assert.equal(out.ranking.length, 1);
  assert.equal(out.ranking[0].oficinaId, "of1");
  assert.equal(out.ranking[0].pecasAvaliadas, 100);
});

test("filtro de oficina restringe ranking + divergências", () => {
  const out = montarDashboardQualidade(
    input({
      oficinaIdFiltro: "of1",
      subconferencias: [
        scBase({
          id: "sc1",
          divergenciaConfirmada: true,
          // Esta divergência é de responsabilidade da of2 e deve ser
          // descartada pelo filtro de oficina (filtro = of1).
          oficinaResponsavelDivergenciaId: "of2",
        }),
        scBase({
          id: "sc2",
          retiradaId: "ret2",
        }),
      ],
      retiradas: [
        retBase({ id: "ret1", oficinaId: "of1" }),
        // ret2 é da of2 → também filtrada
        retBase({ id: "ret2", oficinaId: "of2" }),
      ],
      subtasksCostura: [stBase()],
    }),
  );
  assert.equal(out.ranking.length, 1);
  assert.equal(out.ranking[0].oficinaId, "of1");
  // Divergência foi atribuída à of2, mas filtro é of1 → não conta.
  assert.equal(out.ranking[0].divergenciasConfirmadas, 0);
});

test("ordenação default: aprovação desc; empate → peças avaliadas desc", () => {
  const out = montarDashboardQualidade(
    input({
      subconferencias: [
        scBase({
          id: "sc1",
          // of1: 100/100 = 100%
          aprovadas: { M: { preto: 100 } },
          reprovadas: {},
        }),
        scBase({
          id: "sc2",
          retiradaId: "ret2",
          // of2: 200/200 = 100% (mesmo aprovação, mais peças)
          aprovadas: { M: { preto: 200 } },
          reprovadas: {},
        }),
        scBase({
          id: "sc3",
          retiradaId: "ret3",
          // of3: 50/100 = 50%
          aprovadas: { M: { preto: 50 } },
          reprovadas: { M: { preto: 50 } },
        }),
      ],
      retiradas: [
        retBase({ id: "ret1", oficinaId: "of1" }),
        retBase({ id: "ret2", oficinaId: "of2" }),
        retBase({ id: "ret3", oficinaId: "of3" }),
      ],
      subtasksCostura: [stBase()],
      oficinas: [
        { id: "of1", nome: "A" },
        { id: "of2", nome: "B" },
        { id: "of3", nome: "C" },
      ],
    }),
  );
  // Esperado: of2 (100%, 200), of1 (100%, 100), of3 (50%).
  assert.equal(out.ranking[0].oficinaId, "of2");
  assert.equal(out.ranking[1].oficinaId, "of1");
  assert.equal(out.ranking[2].oficinaId, "of3");
});

test("detalhe por oficina: subconferências ordenadas por concluidaEm desc", () => {
  const out = montarDashboardQualidade(
    input({
      subconferencias: [
        scBase({
          id: "sc1",
          concluidaEm: new Date("2026-05-05T00:00:00Z"),
        }),
        scBase({
          id: "sc2",
          retiradaId: "ret2",
          concluidaEm: new Date("2026-05-20T00:00:00Z"),
        }),
        scBase({
          id: "sc3",
          retiradaId: "ret3",
          concluidaEm: new Date("2026-05-12T00:00:00Z"),
        }),
      ],
      retiradas: [retBase(), retBase({ id: "ret2" }), retBase({ id: "ret3" })],
      subtasksCostura: [stBase()],
    }),
  );
  const lista = out.detalhePorOficina["of1"];
  assert.equal(lista.length, 3);
  assert.deepEqual(
    lista.map((d) => d.subconferenciaId),
    ["sc2", "sc3", "sc1"],
  );
});

test("período: subconferências fora do range são ignoradas", () => {
  const out = montarDashboardQualidade(
    input({
      subconferencias: [
        // antes do período
        scBase({
          id: "sc1",
          concluidaEm: new Date("2026-04-30T00:00:00Z"),
        }),
        // dentro
        scBase({
          id: "sc2",
          retiradaId: "ret2",
          concluidaEm: new Date("2026-05-15T00:00:00Z"),
        }),
        // depois
        scBase({
          id: "sc3",
          retiradaId: "ret3",
          concluidaEm: new Date("2026-06-01T00:00:00Z"),
        }),
      ],
      retiradas: [retBase(), retBase({ id: "ret2" }), retBase({ id: "ret3" })],
      subtasksCostura: [stBase()],
    }),
  );
  assert.equal(out.ranking.length, 1);
  // 1 subconferência conta — 100 peças
  assert.equal(out.ranking[0].pecasAvaliadas, 100);
});

test("tempo médio: só conta retiradas tipo=final com iniciadaEm cadastrado", () => {
  const out = montarDashboardQualidade(
    input({
      subconferencias: [
        scBase({ id: "sc1" }), // final + iniciada
        scBase({ id: "sc2", retiradaId: "ret2" }), // parcial (não conta)
        scBase({ id: "sc3", retiradaId: "ret3" }), // final mas sem iniciada
      ],
      retiradas: [
        retBase({
          id: "ret1",
          tipo: "final",
          dataRetirada: new Date("2026-05-11T08:00:00Z"),
        }),
        retBase({
          id: "ret2",
          tipo: "parcial",
          dataRetirada: new Date("2026-05-20T08:00:00Z"),
        }),
        retBase({
          id: "ret3",
          subtaskCosturaId: "stcos2",
          tipo: "final",
          dataRetirada: new Date("2026-05-25T08:00:00Z"),
        }),
      ],
      subtasksCostura: [
        stBase({ id: "stcos1", iniciadaEm: new Date("2026-05-01T08:00:00Z") }),
        // sem iniciada
        stBase({ id: "stcos2", iniciadaEm: null }),
      ],
    }),
  );
  // Só ret1 entra no cálculo: 10 dias (11-1).
  // Como sc1, sc2 e sc3 vão pra agg da of1, ranking tem 1 oficina,
  // tempoMedioDias = 10.
  assert.equal(out.ranking.length, 1);
  assert.ok(out.ranking[0].tempoMedioDias !== null);
  assert.ok(Math.abs((out.ranking[0].tempoMedioDias as number) - 10) < 0.01);
});

// Garante o tipo enum exportado é compatível com strings esperadas.
test("TipoDefeito enum compatível", () => {
  const t: TipoDefeito = "rebarba";
  assert.equal(t, "rebarba");
});
