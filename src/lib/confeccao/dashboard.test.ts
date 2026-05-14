import { test } from "node:test";
import assert from "node:assert/strict";
import { montarDashboard, type DashboardInput } from "./dashboard";

function opBase(over: Partial<DashboardInput["ops"][number]> = {}) {
  return {
    id: "op1",
    numero: "OP05260001",
    status: "em_andamento" as const,
    produtoId: "p1",
    produtoNome: "Camiseta",
    atribuidoNome: "Ana",
    createdAt: new Date("2026-05-01T10:00:00Z"),
    updatedAt: new Date("2026-05-10T10:00:00Z"),
    concluidaEm: null,
    subtasksTotal: 5,
    subtasksConcluidas: 1,
    ...over,
  };
}

function stBase(over: Partial<DashboardInput["subtasks"][number]> = {}) {
  return {
    id: "st1",
    ordemProducaoId: "op1",
    prefixo: "OPBUY" as const,
    status: "em_andamento" as const,
    ordemSequencial: 1,
    payload: {},
    ...over,
  };
}

test("montarDashboard: OPs vazias → KPIs zerados, sem erros", () => {
  const out = montarDashboard({
    agora: new Date("2026-05-14T12:00:00Z"),
    ops: [],
    subtasks: [],
    lalamoves: [],
    subconferencias: [],
  });
  assert.equal(out.kpis.opsAbertas, 0);
  assert.equal(out.kpis.opsEmAtraso, 0);
  assert.equal(out.kpis.opsConcluidasMes, 0);
  assert.equal(out.opsPorEtapa.length, 6);
  assert.deepEqual(
    out.opsPorEtapa.map((p) => p.total),
    [0, 0, 0, 0, 0, 0],
  );
  assert.equal(out.lalamovesAtivos.length, 0);
  assert.equal(out.opsAtivas.length, 0);
});

test("montarDashboard: opsPorEtapa agrupa pela primeira subtask em_andamento/pendente", () => {
  const out = montarDashboard({
    agora: new Date("2026-05-14T12:00:00Z"),
    ops: [opBase({ id: "op1" }), opBase({ id: "op2", numero: "OP05260002" })],
    subtasks: [
      stBase({ id: "s1", ordemProducaoId: "op1", prefixo: "OPBUY", status: "concluida", ordemSequencial: 1 }),
      stBase({ id: "s2", ordemProducaoId: "op1", prefixo: "OPRIS", status: "em_andamento", ordemSequencial: 2 }),
      stBase({ id: "s3", ordemProducaoId: "op2", prefixo: "OPBUY", status: "pendente", ordemSequencial: 1 }),
    ],
    lalamoves: [],
    subconferencias: [],
  });
  const porEtapa = Object.fromEntries(
    out.opsPorEtapa.map((p) => [p.prefixo, p.total]),
  );
  assert.equal(porEtapa.OPRIS, 1);
  assert.equal(porEtapa.OPBUY, 1);
  assert.equal(porEtapa.OPCONF, 0);
});

test("montarDashboard: opsEmAtraso conta OP com oficina de costura vencida não finalizada", () => {
  const out = montarDashboard({
    agora: new Date("2026-05-14T12:00:00Z"),
    ops: [opBase({ id: "op1" }), opBase({ id: "op2", numero: "OP05260002" })],
    subtasks: [
      stBase({
        id: "sew1",
        ordemProducaoId: "op1",
        prefixo: "OPSEW",
        ordemSequencial: 5,
        payload: {
          oficinas: [
            {
              oficinaId: "of1",
              statusInterno: "em_producao",
              prazoProducao: "2026-05-10T00:00:00Z", // vencido
            },
          ],
        },
      }),
      stBase({
        id: "sew2",
        ordemProducaoId: "op2",
        prefixo: "OPSEW",
        ordemSequencial: 5,
        payload: {
          oficinas: [
            {
              oficinaId: "of2",
              statusInterno: "em_producao",
              prazoProducao: "2026-06-01T00:00:00Z", // futuro
            },
          ],
        },
      }),
    ],
    lalamoves: [],
    subconferencias: [],
  });
  assert.equal(out.kpis.opsEmAtraso, 1);
  assert.equal(out.alertas.oficinasEmAtraso.length, 1);
  assert.equal(out.alertas.oficinasEmAtraso[0].opNumero, "OP05260001");
});

test("montarDashboard: oficina finalizada com prazo vencido não conta como atraso", () => {
  const out = montarDashboard({
    agora: new Date("2026-05-14T12:00:00Z"),
    ops: [opBase()],
    subtasks: [
      stBase({
        prefixo: "OPSEW",
        ordemSequencial: 5,
        payload: {
          oficinas: [
            {
              oficinaId: "of1",
              statusInterno: "finalizada",
              prazoProducao: "2026-05-01T00:00:00Z",
            },
          ],
        },
      }),
    ],
    lalamoves: [],
    subconferencias: [],
  });
  assert.equal(out.kpis.opsEmAtraso, 0);
  assert.equal(out.alertas.oficinasEmAtraso.length, 0);
});

test("montarDashboard: opsConcluidasMes filtra por janela default (mês corrente)", () => {
  const agora = new Date("2026-05-14T12:00:00Z");
  const out = montarDashboard({
    agora,
    ops: [
      opBase({
        id: "op1",
        status: "concluida",
        concluidaEm: new Date("2026-05-05T00:00:00Z"),
      }),
      opBase({
        id: "op2",
        status: "concluida",
        concluidaEm: new Date("2026-04-30T00:00:00Z"),
      }),
      opBase({
        id: "op3",
        status: "concluida",
        concluidaEm: null,
      }),
    ],
    subtasks: [],
    lalamoves: [],
    subconferencias: [],
  });
  assert.equal(out.kpis.opsConcluidasMes, 1);
});

test("montarDashboard: período custom override o mês corrente", () => {
  const agora = new Date("2026-05-14T12:00:00Z");
  const out = montarDashboard({
    agora,
    periodoDe: new Date("2026-04-01T00:00:00Z"),
    periodoAte: new Date("2026-04-30T23:59:59Z"),
    ops: [
      opBase({
        id: "op1",
        status: "concluida",
        concluidaEm: new Date("2026-04-15T00:00:00Z"),
      }),
      opBase({
        id: "op2",
        status: "concluida",
        concluidaEm: new Date("2026-05-05T00:00:00Z"),
      }),
    ],
    subtasks: [],
    lalamoves: [],
    subconferencias: [],
  });
  assert.equal(out.kpis.opsConcluidasMes, 1);
});

test("montarDashboard: filtro produtoId restringe TODAS as métricas", () => {
  const agora = new Date("2026-05-14T12:00:00Z");
  const out = montarDashboard({
    agora,
    produtoIdFiltro: "pX",
    ops: [
      opBase({ id: "op1", produtoId: "pX" }),
      opBase({ id: "op2", numero: "OP05260002", produtoId: "pY" }),
    ],
    subtasks: [
      stBase({ id: "s1", ordemProducaoId: "op1", status: "em_andamento" }),
      stBase({ id: "s2", ordemProducaoId: "op2", status: "em_andamento" }),
    ],
    lalamoves: [],
    subconferencias: [],
  });
  assert.equal(out.kpis.opsAbertas, 1);
  assert.equal(out.opsPorEtapa[0].total, 1);
});

test("montarDashboard: filtro fornecedorId casa via payload OPBUY.pre.fornecedorId", () => {
  const agora = new Date("2026-05-14T12:00:00Z");
  const out = montarDashboard({
    agora,
    fornecedorIdFiltro: "fAcme",
    ops: [
      opBase({ id: "op1" }),
      opBase({ id: "op2", numero: "OP05260002" }),
    ],
    subtasks: [
      stBase({
        id: "s1",
        ordemProducaoId: "op1",
        prefixo: "OPBUY",
        status: "em_andamento",
        payload: {
          pre: { fornecedorId: "fAcme", destinatarioCorteId: "fCorte" },
        },
      }),
      stBase({
        id: "s2",
        ordemProducaoId: "op2",
        prefixo: "OPBUY",
        status: "em_andamento",
        payload: {
          pre: { fornecedorId: "fOutro", destinatarioCorteId: "fCorte" },
        },
      }),
    ],
    lalamoves: [],
    subconferencias: [],
  });
  assert.equal(out.kpis.opsAbertas, 1);
});

test("montarDashboard: lalamoves ativos só inclui status ativo e não cancelado, com lat/lng", () => {
  const out = montarDashboard({
    agora: new Date("2026-05-14T12:00:00Z"),
    ops: [opBase()],
    subtasks: [stBase()],
    lalamoves: [
      {
        id: "l1",
        status: "procurando_motorista",
        ordemProducaoNumero: "OP05260001",
        conteudoDescricao: "Tecido",
        valor: 30,
        dataSolicitacao: new Date("2026-05-14T11:00:00Z"),
        origemLat: -23.5,
        origemLng: -46.6,
        destinoLat: null,
        destinoLng: null,
        lastDriverLat: null,
        lastDriverLng: null,
        canceladaEm: null,
      },
      {
        id: "l2",
        status: "entregue", // não-ativo
        ordemProducaoNumero: "OP05260001",
        conteudoDescricao: null,
        valor: null,
        dataSolicitacao: new Date("2026-05-14T11:00:00Z"),
        origemLat: -23.5,
        origemLng: -46.6,
        destinoLat: null,
        destinoLng: null,
        lastDriverLat: null,
        lastDriverLng: null,
        canceladaEm: null,
      },
      {
        id: "l3",
        status: "a_caminho_coleta",
        ordemProducaoNumero: "OP05260001",
        conteudoDescricao: null,
        valor: 50,
        dataSolicitacao: new Date("2026-05-14T11:00:00Z"),
        origemLat: null,
        origemLng: null,
        destinoLat: null,
        destinoLng: null,
        lastDriverLat: null,
        lastDriverLng: null,
        canceladaEm: null,
      },
      {
        id: "l4",
        status: "procurando_motorista",
        ordemProducaoNumero: "OP05260001",
        conteudoDescricao: null,
        valor: 40,
        dataSolicitacao: new Date("2026-05-14T11:00:00Z"),
        origemLat: -23.5,
        origemLng: -46.6,
        destinoLat: null,
        destinoLng: null,
        lastDriverLat: null,
        lastDriverLng: null,
        canceladaEm: new Date("2026-05-14T11:30:00Z"),
      },
    ],
    subconferencias: [],
  });
  assert.equal(out.lalamovesAtivos.length, 1);
  assert.equal(out.lalamovesAtivos[0].id, "l1");
});

test("montarDashboard: lalamove preferencia lastDriverLat sobre origem", () => {
  const out = montarDashboard({
    agora: new Date("2026-05-14T12:00:00Z"),
    ops: [opBase()],
    subtasks: [stBase()],
    lalamoves: [
      {
        id: "l1",
        status: "a_caminho_coleta",
        ordemProducaoNumero: "OP05260001",
        conteudoDescricao: null,
        valor: 30,
        dataSolicitacao: new Date("2026-05-14T11:00:00Z"),
        origemLat: -23.5,
        origemLng: -46.6,
        destinoLat: -23.6,
        destinoLng: -46.7,
        lastDriverLat: -23.55,
        lastDriverLng: -46.65,
        canceladaEm: null,
      },
    ],
    subconferencias: [],
  });
  assert.equal(out.lalamovesAtivos[0].fonte, "driver");
  assert.equal(out.lalamovesAtivos[0].lat, -23.55);
});

test("montarDashboard: alerta lalamoveTempoAlto dispara após 30min de procurando_motorista", () => {
  const agora = new Date("2026-05-14T12:00:00Z");
  const out = montarDashboard({
    agora,
    ops: [opBase()],
    subtasks: [stBase()],
    lalamoves: [
      {
        id: "lA",
        status: "procurando_motorista",
        ordemProducaoNumero: "OP05260001",
        conteudoDescricao: "Tecido",
        valor: 30,
        dataSolicitacao: new Date("2026-05-14T11:00:00Z"), // 60min atrás
        origemLat: -23.5,
        origemLng: -46.6,
        destinoLat: null,
        destinoLng: null,
        lastDriverLat: null,
        lastDriverLng: null,
        canceladaEm: null,
      },
      {
        id: "lB",
        status: "procurando_motorista",
        ordemProducaoNumero: "OP05260001",
        conteudoDescricao: null,
        valor: 30,
        dataSolicitacao: new Date("2026-05-14T11:50:00Z"), // 10min atrás
        origemLat: -23.5,
        origemLng: -46.6,
        destinoLat: null,
        destinoLng: null,
        lastDriverLat: null,
        lastDriverLng: null,
        canceladaEm: null,
      },
    ],
    subconferencias: [],
  });
  assert.equal(out.alertas.lalamoveTempoAlto.length, 1);
  assert.equal(out.alertas.lalamoveTempoAlto[0].id, "lA");
  assert.ok(out.alertas.lalamoveTempoAlto[0].minutosAguardando >= 60);
});

test("montarDashboard: conferenciasDivergentes filtra divergenciaConfirmada=true e não concluida", () => {
  const out = montarDashboard({
    agora: new Date("2026-05-14T12:00:00Z"),
    ops: [opBase()],
    subtasks: [stBase()],
    lalamoves: [],
    subconferencias: [
      {
        id: "sc1",
        numero: "OP05260001-CONF-RET01",
        ordemProducaoNumero: "OP05260001",
        status: "em_andamento",
        divergenciaConfirmada: true,
        oficinaResponsavelDivergenciaNome: "Oficina X",
      },
      {
        id: "sc2",
        numero: "OP05260001-CONF-RET02",
        ordemProducaoNumero: "OP05260001",
        status: "em_andamento",
        divergenciaConfirmada: false,
        oficinaResponsavelDivergenciaNome: null,
      },
      {
        id: "sc3",
        numero: "OP05260001-CONF-RET03",
        ordemProducaoNumero: "OP05260001",
        status: "concluida",
        divergenciaConfirmada: true,
        oficinaResponsavelDivergenciaNome: "Oficina Y",
      },
    ],
  });
  assert.equal(out.alertas.conferenciasDivergentes.length, 1);
  assert.equal(out.alertas.conferenciasDivergentes[0].id, "sc1");
});

test("montarDashboard: opsAtivas top 10 ordenadas por updatedAt desc", () => {
  const ops = Array.from({ length: 12 }, (_, i) =>
    opBase({
      id: `op${i}`,
      numero: `OP052600${String(i + 1).padStart(2, "0")}`,
      updatedAt: new Date(2026, 4, i + 1),
    }),
  );
  const out = montarDashboard({
    agora: new Date("2026-05-14T12:00:00Z"),
    ops,
    subtasks: [],
    lalamoves: [],
    subconferencias: [],
  });
  assert.equal(out.opsAtivas.length, 10);
  // mais recente primeiro: op11 (dia 12)
  assert.equal(out.opsAtivas[0].id, "op11");
});
