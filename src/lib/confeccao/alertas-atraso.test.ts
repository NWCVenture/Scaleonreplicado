import { test } from "node:test";
import assert from "node:assert/strict";
import {
  montarAlertasAtraso,
  type AlertasAtrasoInput,
  type LogExistenteRaw,
  type OficinaRaw,
  type OpRaw,
  type SubtaskCosturaRaw,
  type UsuarioRaw,
} from "./alertas-atraso";

const AGORA = new Date("2026-05-14T12:00:00Z");
const AGORA_DIA_ISO = new Date("2026-05-14T00:00:00Z").toISOString();

// Helpers compactos.
function user(
  id: string,
  name = `User ${id}`,
  email = `${id}@x.com`,
): UsuarioRaw {
  return { id, name, email };
}

function op(over: Partial<OpRaw> = {}): OpRaw {
  return {
    id: "op1",
    numero: "OP05260001",
    status: "em_andamento",
    ...over,
  };
}

function st(over: Partial<SubtaskCosturaRaw> = {}): SubtaskCosturaRaw {
  return {
    id: "stcos1",
    ordemProducaoId: "op1",
    atribuidoAId: "u_atrib",
    payload: {
      oficinas: [
        {
          oficinaId: "of1",
          // Próximo do agora — vai cair dentro de uma janela específica
          // dependendo do prazoProducao escolhido por cada teste.
          prazoProducao: "2026-05-14T18:00:00Z", // +6h: dentro de 24h
          statusInterno: "em_producao",
        },
      ],
    },
    ...over,
  };
}

function ofs(): OficinaRaw[] {
  return [
    { id: "of1", nome: "Oficina A" },
    { id: "of2", nome: "Oficina B" },
  ];
}

function base(over: Partial<AlertasAtrasoInput> = {}): AlertasAtrasoInput {
  return {
    agora: AGORA,
    ops: [op()],
    subtasksCostura: [st()],
    oficinas: ofs(),
    usuarios: [user("u_atrib", "Atribuído")],
    adminsIds: [],
    logExistente: [],
    ...over,
  };
}

test("vazio → []", () => {
  assert.deepEqual(
    montarAlertasAtraso({
      agora: AGORA,
      ops: [],
      subtasksCostura: [],
      oficinas: [],
      usuarios: [],
      adminsIds: [],
      logExistente: [],
    }),
    [],
  );
});

test("oficina vencendo em <24h → 1 alerta vencendo_24h, só atribuído", () => {
  const out = montarAlertasAtraso(base());
  assert.equal(out.length, 1);
  assert.equal(out[0].tipoAlerta, "vencendo_24h");
  assert.equal(out[0].oficinaId, "of1");
  assert.equal(out[0].destinatarios.length, 1);
  assert.equal(out[0].destinatarios[0].id, "u_atrib");
  assert.equal(out[0].dataReferenciaISO, AGORA_DIA_ISO);
});

test("oficina vencida → 1 alerta vencido com admins incluídos", () => {
  const adminA = user("u_admin_a", "Admin A");
  const adminB = user("u_admin_b", "Admin B");
  const subtask = st();
  // Sobrescreve prazo pra ontem
  (subtask.payload as { oficinas: { prazoProducao: string }[] }).oficinas[0].prazoProducao =
    "2026-05-13T00:00:00Z";
  const out = montarAlertasAtraso(
    base({
      subtasksCostura: [subtask],
      usuarios: [user("u_atrib"), adminA, adminB],
      adminsIds: ["u_admin_a", "u_admin_b"],
    }),
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].tipoAlerta, "vencido");
  const ids = out[0].destinatarios.map((d) => d.id).sort();
  assert.deepEqual(ids, ["u_admin_a", "u_admin_b", "u_atrib"]);
  // 12h após meia-noite do dia 13 = 1.5 dia depois. floor(36h/24h) = 1
  assert.equal(out[0].diasAtraso, 1);
});

test("oficina finalizada → ignorada mesmo com prazo vencido", () => {
  const subtask = st();
  const oficinasPayload = (
    subtask.payload as { oficinas: { prazoProducao: string; statusInterno: string }[] }
  ).oficinas;
  oficinasPayload[0].prazoProducao = "2026-05-13T00:00:00Z";
  oficinasPayload[0].statusInterno = "finalizada";

  const out = montarAlertasAtraso(base({ subtasksCostura: [subtask] }));
  assert.equal(out.length, 0);
});

test("oficina sem prazoProducao → ignorada", () => {
  const subtask = st({
    payload: {
      oficinas: [{ oficinaId: "of1", statusInterno: "em_producao" }],
    },
  });
  const out = montarAlertasAtraso(base({ subtasksCostura: [subtask] }));
  assert.equal(out.length, 0);
});

test("já tem log do mesmo dia → ignorado (idempotência)", () => {
  const logExistente: LogExistenteRaw[] = [
    {
      subtaskId: "stcos1",
      oficinaId: "of1",
      tipoAlerta: "vencendo_24h",
      dataReferenciaISO: AGORA_DIA_ISO,
    },
  ];
  const out = montarAlertasAtraso(base({ logExistente }));
  assert.equal(out.length, 0);
});

test("log de dia anterior não bloqueia alerta de hoje", () => {
  const logExistente: LogExistenteRaw[] = [
    {
      subtaskId: "stcos1",
      oficinaId: "of1",
      tipoAlerta: "vencendo_24h",
      dataReferenciaISO: new Date("2026-05-13T00:00:00Z").toISOString(),
    },
  ];
  const out = montarAlertasAtraso(base({ logExistente }));
  assert.equal(out.length, 1);
});

test("atribuído é admin → não duplica destinatário", () => {
  const subtask = st();
  const oficinasPayload = (
    subtask.payload as { oficinas: { prazoProducao: string }[] }
  ).oficinas;
  oficinasPayload[0].prazoProducao = "2026-05-13T00:00:00Z";

  const out = montarAlertasAtraso(
    base({
      subtasksCostura: [subtask],
      usuarios: [user("u_atrib", "AdminAtrib")],
      adminsIds: ["u_atrib"],
    }),
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].destinatarios.length, 1);
  assert.equal(out[0].destinatarios[0].id, "u_atrib");
});

test("OP cancelada ou concluída → ignoradas", () => {
  const out = montarAlertasAtraso(
    base({
      ops: [op({ status: "cancelada" })],
    }),
  );
  assert.equal(out.length, 0);

  const out2 = montarAlertasAtraso(
    base({
      ops: [op({ status: "concluida" })],
    }),
  );
  assert.equal(out2.length, 0);
});

test("prazo > 24h no futuro → ignorado (longe demais)", () => {
  const subtask = st({
    payload: {
      oficinas: [
        {
          oficinaId: "of1",
          // 3 dias no futuro
          prazoProducao: "2026-05-17T12:00:00Z",
          statusInterno: "em_producao",
        },
      ],
    },
  });
  const out = montarAlertasAtraso(base({ subtasksCostura: [subtask] }));
  assert.equal(out.length, 0);
});

test("vencendo_24h: sem atribuído → ignorado (sem destinatário)", () => {
  const subtask = st({ atribuidoAId: null });
  const out = montarAlertasAtraso(
    base({
      subtasksCostura: [subtask],
      usuarios: [],
      adminsIds: [],
    }),
  );
  assert.equal(out.length, 0);
});

test("vencido: sem atribuído mas com admins → dispara com admins só", () => {
  const subtask = st({ atribuidoAId: null });
  const oficinasPayload = (
    subtask.payload as { oficinas: { prazoProducao: string }[] }
  ).oficinas;
  oficinasPayload[0].prazoProducao = "2026-05-13T00:00:00Z";
  const out = montarAlertasAtraso(
    base({
      subtasksCostura: [subtask],
      usuarios: [user("u_admin")],
      adminsIds: ["u_admin"],
    }),
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].destinatarios.length, 1);
  assert.equal(out[0].destinatarios[0].id, "u_admin");
});

test("múltiplas oficinas no payload → um alerta por oficina aplicável", () => {
  const subtask = st({
    payload: {
      oficinas: [
        {
          oficinaId: "of1",
          // dentro de 24h → vencendo_24h
          prazoProducao: "2026-05-14T18:00:00Z",
          statusInterno: "em_producao",
        },
        {
          oficinaId: "of2",
          // vencida há 2 dias
          prazoProducao: "2026-05-12T12:00:00Z",
          statusInterno: "em_producao",
        },
      ],
    },
  });
  const out = montarAlertasAtraso(
    base({
      subtasksCostura: [subtask],
      adminsIds: ["u_admin"],
      usuarios: [user("u_atrib"), user("u_admin")],
    }),
  );
  assert.equal(out.length, 2);
  const tiposPorOficina = Object.fromEntries(
    out.map((a) => [a.oficinaId, a.tipoAlerta]),
  );
  assert.equal(tiposPorOficina["of1"], "vencendo_24h");
  assert.equal(tiposPorOficina["of2"], "vencido");
});

test("nomes de oficinas preenchidos no output", () => {
  const out = montarAlertasAtraso(base());
  assert.equal(out[0].oficinaNome, "Oficina A");
});
