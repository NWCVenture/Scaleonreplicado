import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  conta,
  confeccaoLalamove,
  confeccaoLalamoveWebhookEvent,
  confeccaoNota,
  confeccaoOrdemProducao,
  confeccaoProduto,
  confeccaoSubtask,
  user,
  usuarioConta,
} from "@/lib/db/schema";
import { processarWebhookEvent } from "./webhook-processor";

const CONTA = "wh-test-conta";
const USR = "wh-test-user";

let subtaskId: string;

before(async () => {
  await db
    .insert(conta)
    .values({
      id: CONTA,
      nome: "WH Test",
      emailPrincipal: "wh@test.com",
      plano: "enterprise",
      status: "ativa",
    })
    .onConflictDoNothing();
  await db
    .insert(user)
    .values({
      id: USR,
      name: "User WH",
      email: "user-wh@test.com",
      role: "admin",
    })
    .onConflictDoNothing();
  await db
    .insert(usuarioConta)
    .values({
      id: `uc-${USR}-${CONTA}`,
      usuarioId: USR,
      contaId: CONTA,
      papel: "admin",
      ativo: true,
    })
    .onConflictDoNothing();

  const [prod] = await db
    .insert(confeccaoProduto)
    .values({
      id: `prod-wh-${Date.now()}`,
      contaId: CONTA,
      nome: "Produto WH",
    })
    .onConflictDoNothing()
    .returning();
  const produtoId =
    prod?.id ??
    (
      await db
        .select({ id: confeccaoProduto.id })
        .from(confeccaoProduto)
        .where(eq(confeccaoProduto.contaId, CONTA))
        .limit(1)
    )[0].id;

  const [op] = await db
    .insert(confeccaoOrdemProducao)
    .values({
      id: `op-wh-${Date.now()}`,
      contaId: CONTA,
      numero: "OP05260701",
      sequencialGlobal: 701,
      produtoId,
      criadaPorId: USR,
      atribuidoAId: USR,
    })
    .onConflictDoNothing()
    .returning();
  const opId =
    op?.id ??
    (
      await db
        .select({ id: confeccaoOrdemProducao.id })
        .from(confeccaoOrdemProducao)
        .where(eq(confeccaoOrdemProducao.numero, "OP05260701"))
        .limit(1)
    )[0].id;

  const [sub] = await db
    .insert(confeccaoSubtask)
    .values({
      id: `sub-wh-${Date.now()}`,
      contaId: CONTA,
      ordemProducaoId: opId,
      numero: "OPCOR0701",
      idInterno: "OPCOR-0526-0701",
      prefixo: "OPCOR",
      ordemSequencial: 3,
      status: "pendente",
    })
    .onConflictDoNothing()
    .returning();
  subtaskId =
    sub?.id ??
    (
      await db
        .select({ id: confeccaoSubtask.id })
        .from(confeccaoSubtask)
        .where(eq(confeccaoSubtask.idInterno, "OPCOR-0526-0701"))
        .limit(1)
    )[0].id;
});

after(async () => {
  await db
    .delete(confeccaoLalamoveWebhookEvent)
    .where(eq(confeccaoLalamoveWebhookEvent.contaId, CONTA));
  await db
    .delete(confeccaoLalamove)
    .where(eq(confeccaoLalamove.contaId, CONTA));
  await db.delete(confeccaoNota).where(eq(confeccaoNota.contaId, CONTA));
  await db
    .delete(confeccaoSubtask)
    .where(eq(confeccaoSubtask.contaId, CONTA));
  await db
    .delete(confeccaoOrdemProducao)
    .where(eq(confeccaoOrdemProducao.contaId, CONTA));
  await db
    .delete(confeccaoProduto)
    .where(eq(confeccaoProduto.contaId, CONTA));
});

// ─── helpers ──────────────────────────────────────────────────────────────

async function criarLalamoveApi(opts: {
  status?: typeof confeccaoLalamove.$inferSelect.status;
  orderIdApi?: string;
}): Promise<string> {
  const id = `lm-wh-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const orderIdApi = opts.orderIdApi ?? `OID-WH-${id}`;
  await db.insert(confeccaoLalamove).values({
    id,
    contaId: CONTA,
    subtaskId,
    tipo: "principal",
    origemSolicitacao: "api",
    status: opts.status ?? "procurando_motorista",
    origemEndereco: { rua: "Av X", numero: "100" },
    origemLat: "-23.55",
    origemLng: "-46.63",
    destinoEndereco: { rua: "Av Y", numero: "200" },
    destinoLat: "-23.56",
    destinoLng: "-46.64",
    serviceType: "MOTORCYCLE",
    quotationIdApi: `QID-${id}`,
    orderIdApi,
    contatoOrigemNome: "Origem",
    contatoOrigemTelefone: "+5511999998888",
    contatoDestinoNome: "Destino",
    contatoDestinoTelefone: "+5511988887777",
  });
  return id;
}

async function gravarEvento(opts: {
  evento: "ORDER_STATUS_CHANGED" | "DRIVER_ASSIGNED" | "OUTROS";
  orderIdApi: string;
  data?: Record<string, unknown>;
  lalamoveId?: string;
  contaId?: string;
}): Promise<string> {
  const id = `wh-evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await db.insert(confeccaoLalamoveWebhookEvent).values({
    id,
    lalamoveId: opts.lalamoveId ?? null,
    contaId: opts.contaId ?? null,
    evento: opts.evento,
    orderIdApi: opts.orderIdApi,
    payload: { event: opts.evento, data: opts.data ?? {} },
  });
  return id;
}

// ─── tests ────────────────────────────────────────────────────────────────

test("ORDER_STATUS_CHANGED → PICKED_UP atualiza status='coletado' + data_coleta + nota", async () => {
  const lalamoveId = await criarLalamoveApi({ status: "a_caminho_coleta" });
  const orderIdApi = `OID-PU-${lalamoveId}`;
  // Reaproveita orderIdApi do lalamove pra match
  await db
    .update(confeccaoLalamove)
    .set({ orderIdApi })
    .where(eq(confeccaoLalamove.id, lalamoveId));

  const eventoId = await gravarEvento({
    evento: "ORDER_STATUS_CHANGED",
    orderIdApi,
    data: { orderId: orderIdApi, status: "PICKED_UP", timestamp: "ts-1" },
  });

  const r = await db.transaction((tx) =>
    processarWebhookEvent(tx, { eventoId }),
  );
  assert.equal(r.status, "ok");
  assert.equal(r.statusNovo, "coletado");

  const [lm] = await db
    .select()
    .from(confeccaoLalamove)
    .where(eq(confeccaoLalamove.id, lalamoveId));
  assert.equal(lm.status, "coletado");
  assert.ok(lm.dataColeta, "data_coleta foi preenchida");

  const [evt] = await db
    .select()
    .from(confeccaoLalamoveWebhookEvent)
    .where(eq(confeccaoLalamoveWebhookEvent.id, eventoId));
  assert.equal(evt.processado, true);
});

test("DRIVER_ASSIGNED preenche driver_* e avança de procurando_motorista → motorista_designado", async () => {
  const lalamoveId = await criarLalamoveApi({ status: "procurando_motorista" });
  const [lmAntes] = await db
    .select({ orderIdApi: confeccaoLalamove.orderIdApi })
    .from(confeccaoLalamove)
    .where(eq(confeccaoLalamove.id, lalamoveId));

  const eventoId = await gravarEvento({
    evento: "DRIVER_ASSIGNED",
    orderIdApi: lmAntes.orderIdApi!,
    data: {
      orderId: lmAntes.orderIdApi!,
      driverId: "DRV-1",
      driverName: "João da Silva",
      driverPhone: "+5511970000000",
      driverPlateNumber: "ABC1234",
      timestamp: "ts-2",
    },
  });

  await db.transaction((tx) => processarWebhookEvent(tx, { eventoId }));

  const [lm] = await db
    .select()
    .from(confeccaoLalamove)
    .where(eq(confeccaoLalamove.id, lalamoveId));
  assert.equal(lm.driverIdApi, "DRV-1");
  assert.equal(lm.driverNome, "João da Silva");
  assert.equal(lm.driverPlaca, "ABC1234");
  assert.equal(lm.status, "motorista_designado");
});

test("evento já processado → noop, retorna 'duplicado'", async () => {
  const lalamoveId = await criarLalamoveApi({});
  const [lmAntes] = await db
    .select({ orderIdApi: confeccaoLalamove.orderIdApi })
    .from(confeccaoLalamove)
    .where(eq(confeccaoLalamove.id, lalamoveId));
  const eventoId = await gravarEvento({
    evento: "ORDER_STATUS_CHANGED",
    orderIdApi: lmAntes.orderIdApi!,
    data: { status: "ON_GOING", timestamp: "ts-dup-1" },
  });

  await db.transaction((tx) => processarWebhookEvent(tx, { eventoId }));
  const r2 = await db.transaction((tx) =>
    processarWebhookEvent(tx, { eventoId }),
  );
  assert.equal(r2.status, "duplicado");
});

test("orderId desconhecido → marca processado com erro 'lalamove_nao_encontrado'", async () => {
  const eventoId = await gravarEvento({
    evento: "ORDER_STATUS_CHANGED",
    orderIdApi: "OID-DOESNT-EXIST",
    data: { status: "ON_GOING", timestamp: "ts-orphan" },
  });

  const r = await db.transaction((tx) =>
    processarWebhookEvent(tx, { eventoId }),
  );
  assert.equal(r.status, "lalamove_nao_encontrado");

  const [evt] = await db
    .select()
    .from(confeccaoLalamoveWebhookEvent)
    .where(eq(confeccaoLalamoveWebhookEvent.id, eventoId));
  assert.equal(evt.processado, true);
  assert.equal(evt.erroProcessamento, "lalamove_nao_encontrado");
});

test("status API desconhecido → noop, marca processado sem mudança", async () => {
  const lalamoveId = await criarLalamoveApi({ status: "procurando_motorista" });
  const [lmAntes] = await db
    .select({
      orderIdApi: confeccaoLalamove.orderIdApi,
      statusAntes: confeccaoLalamove.status,
    })
    .from(confeccaoLalamove)
    .where(eq(confeccaoLalamove.id, lalamoveId));

  const eventoId = await gravarEvento({
    evento: "ORDER_STATUS_CHANGED",
    orderIdApi: lmAntes.orderIdApi!,
    data: { status: "NEW_FUTURE_STATUS", timestamp: "ts-unk" },
  });

  await db.transaction((tx) => processarWebhookEvent(tx, { eventoId }));

  const [lm] = await db
    .select({ status: confeccaoLalamove.status })
    .from(confeccaoLalamove)
    .where(eq(confeccaoLalamove.id, lalamoveId));
  assert.equal(lm.status, lmAntes.statusAntes); // sem mudança
});

test("evento 'OUTROS' → marca processado sem alterar lalamove", async () => {
  const lalamoveId = await criarLalamoveApi({});
  const [lmAntes] = await db
    .select()
    .from(confeccaoLalamove)
    .where(eq(confeccaoLalamove.id, lalamoveId));

  const eventoId = await gravarEvento({
    evento: "OUTROS",
    orderIdApi: lmAntes.orderIdApi!,
    data: { whatever: "yes", timestamp: "ts-outros" },
  });

  const r = await db.transaction((tx) =>
    processarWebhookEvent(tx, { eventoId }),
  );
  assert.equal(r.status, "ok");

  const [lmDepois] = await db
    .select()
    .from(confeccaoLalamove)
    .where(eq(confeccaoLalamove.id, lalamoveId));
  assert.equal(lmDepois.status, lmAntes.status);
});

test("lalamoveId NULL no evento → resolve via lookup do orderIdApi", async () => {
  const lalamoveId = await criarLalamoveApi({});
  const [lmAntes] = await db
    .select({ orderIdApi: confeccaoLalamove.orderIdApi })
    .from(confeccaoLalamove)
    .where(eq(confeccaoLalamove.id, lalamoveId));

  // Evento criado sem lalamoveId/contaId (race scenario)
  const eventoId = await gravarEvento({
    evento: "ORDER_STATUS_CHANGED",
    orderIdApi: lmAntes.orderIdApi!,
    data: { status: "COMPLETED", timestamp: "ts-resolve" },
  });

  await db.transaction((tx) => processarWebhookEvent(tx, { eventoId }));

  const [evt] = await db
    .select()
    .from(confeccaoLalamoveWebhookEvent)
    .where(eq(confeccaoLalamoveWebhookEvent.id, eventoId));
  assert.equal(evt.lalamoveId, lalamoveId);
  assert.equal(evt.contaId, CONTA);
});
