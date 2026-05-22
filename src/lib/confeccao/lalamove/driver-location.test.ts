import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  conta,
  confeccaoLalamove,
  confeccaoOrdemProducao,
  confeccaoProduto,
  confeccaoSubtask,
  user,
  usuarioConta,
} from "@/lib/db/schema";
import { sincronizarLocalizacaoMotoristas } from "./driver-location";
import type { LalamoveResponse } from "./client";

const CONTA = "drv-test-conta";
const USR = "drv-test-user";

let subtaskId: string;

const ENV_BACKUP: Record<string, string | undefined> = {};
function setEnv(k: string, v: string | undefined) {
  if (!(k in ENV_BACKUP)) ENV_BACKUP[k] = process.env[k];
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
}

before(async () => {
  setEnv("LALAMOVE_FEATURE_FLAG", "true");
  setEnv("LALAMOVE_API_HOST", "https://rest.sandbox.lalamove.com");
  setEnv("LALAMOVE_API_KEY", "pk_test_demo");
  setEnv("LALAMOVE_API_SECRET", "sk_test_demo_secret");
  setEnv("LALAMOVE_MARKET", "BR");

  await db
    .insert(conta)
    .values({
      id: CONTA,
      nome: "Driver Test",
      emailPrincipal: "drv@test.com",
      plano: "enterprise",
      status: "ativa",
    })
    .onConflictDoNothing();
  await db
    .insert(user)
    .values({
      id: USR,
      name: "User Drv",
      email: "user-drv@test.com",
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
    .values({ id: `prod-drv-${Date.now()}`, contaId: CONTA, nome: "Produto Drv" })
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
      id: `op-drv-${Date.now()}`,
      contaId: CONTA,
      numero: "OP05260601",
      sequencialGlobal: 601,
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
        .where(eq(confeccaoOrdemProducao.numero, "OP05260601"))
        .limit(1)
    )[0].id;

  const [sub] = await db
    .insert(confeccaoSubtask)
    .values({
      id: `sub-drv-${Date.now()}`,
      contaId: CONTA,
      ordemProducaoId: opId,
      numero: "OPCOR0601",
      idInterno: "OPCOR-0526-0601",
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
        .where(eq(confeccaoSubtask.idInterno, "OPCOR-0526-0601"))
        .limit(1)
    )[0].id;
});

after(async () => {
  await db
    .delete(confeccaoLalamove)
    .where(eq(confeccaoLalamove.contaId, CONTA));
  await db
    .delete(confeccaoSubtask)
    .where(eq(confeccaoSubtask.contaId, CONTA));
  await db
    .delete(confeccaoOrdemProducao)
    .where(eq(confeccaoOrdemProducao.contaId, CONTA));
  await db
    .delete(confeccaoProduto)
    .where(eq(confeccaoProduto.contaId, CONTA));
  for (const [k, v] of Object.entries(ENV_BACKUP)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

async function criarLalamoveComDriver(opts: {
  status?: typeof confeccaoLalamove.$inferSelect.status;
  driverIdApi?: string | null;
  orderIdApi?: string;
}): Promise<string> {
  const id = `lm-drv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await db.insert(confeccaoLalamove).values({
    id,
    contaId: CONTA,
    subtaskId,
    tipo: "principal",
    origemSolicitacao: "api",
    status: opts.status ?? "a_caminho_coleta",
    origemEndereco: { rua: "Av X" },
    origemLat: "-23.55",
    origemLng: "-46.63",
    destinoEndereco: { rua: "Av Y" },
    destinoLat: "-23.56",
    destinoLng: "-46.64",
    serviceType: "MOTORCYCLE",
    quotationIdApi: `QID-${id}`,
    orderIdApi: opts.orderIdApi ?? `OID-${id}`,
    driverIdApi: opts.driverIdApi === undefined ? "DRV-1" : opts.driverIdApi,
  });
  return id;
}

function fakeLocationOk(lat: string, lng: string) {
  const fn = async () =>
    ({
      data: { lat, lng, updatedAt: new Date().toISOString() },
      meta: { requestId: "req-loc" },
    }) as LalamoveResponse<unknown>;
  return fn as unknown as typeof import("./client").lalamoveRequest;
}

function fakeApiError(status: number) {
  const fn = async () => {
    const { LalamoveApiError } = await import("./client");
    throw new LalamoveApiError(
      status,
      `ERR_${status}`,
      "req-err",
      [{ id: `ERR_${status}`, message: "x" }],
      `Lalamove ${status}`,
    );
  };
  return fn as unknown as typeof import("./client").lalamoveRequest;
}

// ─── tests ────────────────────────────────────────────────────────────────

test("nenhum lalamove ativo → result vazio", async () => {
  const r = await sincronizarLocalizacaoMotoristas({
    httpRequest: fakeLocationOk("-23.55", "-46.63"),
  });
  assert.equal(r.consultados, 0);
  assert.equal(r.atualizados, 0);
});

test("lalamove ativo com driver → atualiza last_driver_lat/lng/location_at", async () => {
  const lmId = await criarLalamoveComDriver({});

  const r = await sincronizarLocalizacaoMotoristas({
    httpRequest: fakeLocationOk("-23.561414", "-46.655881"),
  });
  assert.equal(r.consultados, 1);
  assert.equal(r.atualizados, 1);

  const [lm] = await db
    .select()
    .from(confeccaoLalamove)
    .where(eq(confeccaoLalamove.id, lmId));
  assert.equal(lm.lastDriverLat, "-23.561414");
  assert.equal(lm.lastDriverLng, "-46.655881");
  assert.ok(lm.lastDriverLocationAt);

  // Cleanup pra próximos testes
  await db.delete(confeccaoLalamove).where(eq(confeccaoLalamove.id, lmId));
});

test("API 404 → conta como semDriverDisponivel, sem atualizar", async () => {
  const lmId = await criarLalamoveComDriver({});

  const r = await sincronizarLocalizacaoMotoristas({
    httpRequest: fakeApiError(404),
  });
  assert.equal(r.consultados, 1);
  assert.equal(r.semDriverDisponivel, 1);
  assert.equal(r.atualizados, 0);
  assert.equal(r.erros, 0);

  const [lm] = await db
    .select()
    .from(confeccaoLalamove)
    .where(eq(confeccaoLalamove.id, lmId));
  assert.equal(lm.lastDriverLat, null);

  await db.delete(confeccaoLalamove).where(eq(confeccaoLalamove.id, lmId));
});

test("API 500 → conta como erro, processo continua", async () => {
  const lmId = await criarLalamoveComDriver({});

  const r = await sincronizarLocalizacaoMotoristas({
    httpRequest: fakeApiError(500),
  });
  assert.equal(r.consultados, 1);
  assert.equal(r.erros, 1);
  assert.equal(r.atualizados, 0);

  await db.delete(confeccaoLalamove).where(eq(confeccaoLalamove.id, lmId));
});

test("lalamove sem driverIdApi → ignorado", async () => {
  const lmId = await criarLalamoveComDriver({ driverIdApi: null });

  let httpCalls = 0;
  const tracking = (async () => {
    httpCalls++;
    return { data: {}, meta: { requestId: "x" } } as LalamoveResponse<unknown>;
  }) as unknown as typeof import("./client").lalamoveRequest;

  const r = await sincronizarLocalizacaoMotoristas({ httpRequest: tracking });
  assert.equal(r.consultados, 0);
  assert.equal(httpCalls, 0);

  await db.delete(confeccaoLalamove).where(eq(confeccaoLalamove.id, lmId));
});

test("lalamove status='procurando_motorista' → ignorado (sem driver ainda)", async () => {
  const lmId = await criarLalamoveComDriver({
    status: "procurando_motorista",
    driverIdApi: null,
  });
  const r = await sincronizarLocalizacaoMotoristas({
    httpRequest: fakeLocationOk("0", "0"),
  });
  assert.equal(r.consultados, 0);
  await db.delete(confeccaoLalamove).where(eq(confeccaoLalamove.id, lmId));
});

test("response com coordinates aninhado também aceito", async () => {
  const lmId = await criarLalamoveComDriver({});
  const fn = (async () =>
    ({
      data: { coordinates: { lat: "-23.99", lng: "-46.99" } },
      meta: { requestId: "x" },
    }) as LalamoveResponse<unknown>) as unknown as typeof import("./client").lalamoveRequest;

  await sincronizarLocalizacaoMotoristas({ httpRequest: fn });

  const [lm] = await db
    .select()
    .from(confeccaoLalamove)
    .where(eq(confeccaoLalamove.id, lmId));
  assert.equal(lm.lastDriverLat, "-23.99");
  assert.equal(lm.lastDriverLng, "-46.99");

  await db.delete(confeccaoLalamove).where(eq(confeccaoLalamove.id, lmId));
});

test("response sem lat/lng → conta como semDriverDisponivel", async () => {
  const lmId = await criarLalamoveComDriver({});
  const fn = (async () =>
    ({
      data: {},
      meta: { requestId: "x" },
    }) as LalamoveResponse<unknown>) as unknown as typeof import("./client").lalamoveRequest;

  const r = await sincronizarLocalizacaoMotoristas({ httpRequest: fn });
  assert.equal(r.semDriverDisponivel, 1);
  assert.equal(r.atualizados, 0);

  await db.delete(confeccaoLalamove).where(eq(confeccaoLalamove.id, lmId));
});
