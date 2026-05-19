import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  conta,
  confeccaoLalamove,
  confeccaoLalamoveCotacao,
  confeccaoNota,
  confeccaoOrdemProducao,
  confeccaoProduto,
  confeccaoSubtask,
  user,
  usuarioConta,
} from "@/lib/db/schema";
import {
  cotarLalamove,
  CotacaoError,
} from "./cotacao";
import type { LalamoveResponse } from "./client";

const CONTA = "cot-test-conta";
const USR = "cot-test-user";

let opId: string;
let subtaskId: string;

// Liga a feature flag em todos os testes desta suite.
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
      nome: "Cotacao Test",
      emailPrincipal: "cot@test.com",
      plano: "enterprise",
      status: "ativa",
    })
    .onConflictDoNothing();
  await db
    .insert(user)
    .values({
      id: USR,
      name: "User Cot",
      email: "user-cot@test.com",
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
      id: `prod-cot-${Date.now()}`,
      contaId: CONTA,
      nome: "Produto Cotacao",
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
      id: `op-cot-${Date.now()}`,
      contaId: CONTA,
      numero: "OP05260801",
      sequencialGlobal: 801,
      produtoId,
      criadaPorId: USR,
      atribuidoAId: USR,
    })
    .onConflictDoNothing()
    .returning();
  opId =
    op?.id ??
    (
      await db
        .select({ id: confeccaoOrdemProducao.id })
        .from(confeccaoOrdemProducao)
        .where(eq(confeccaoOrdemProducao.numero, "OP05260801"))
        .limit(1)
    )[0].id;

  const [sub] = await db
    .insert(confeccaoSubtask)
    .values({
      id: `sub-cot-${Date.now()}`,
      contaId: CONTA,
      ordemProducaoId: opId,
      numero: "OPCOR0801",
      idInterno: "OPCOR-0526-0801",
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
        .where(eq(confeccaoSubtask.idInterno, "OPCOR-0526-0801"))
        .limit(1)
    )[0].id;
});

after(async () => {
  await db
    .delete(confeccaoLalamoveCotacao)
    .where(eq(confeccaoLalamoveCotacao.contaId, CONTA));
  await db
    .delete(confeccaoLalamove)
    .where(eq(confeccaoLalamove.contaId, CONTA));
  await db
    .delete(confeccaoNota)
    .where(eq(confeccaoNota.contaId, CONTA));
  await db
    .delete(confeccaoSubtask)
    .where(eq(confeccaoSubtask.contaId, CONTA));
  await db
    .delete(confeccaoOrdemProducao)
    .where(eq(confeccaoOrdemProducao.contaId, CONTA));
  await db
    .delete(confeccaoProduto)
    .where(eq(confeccaoProduto.contaId, CONTA));
  // Restaura envs
  for (const [k, v] of Object.entries(ENV_BACKUP)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// Helpers
function fakeHttpOk(): typeof import("./client").lalamoveRequest {
  const fn = async () =>
    ({
      data: {
        quotationId: `QID-${Date.now()}`,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        serviceType: "MOTORCYCLE",
        language: "pt_BR",
        specialRequests: [],
        stops: [
          {
            stopId: "stop_a",
            coordinates: { lat: "-23.55", lng: "-46.63" },
            address: "Origem",
          },
          {
            stopId: "stop_b",
            coordinates: { lat: "-23.56", lng: "-46.64" },
            address: "Destino",
          },
        ],
        priceBreakdown: { total: "12.50", currency: "BRL" },
        distance: { value: "5300", unit: "m" },
      },
      meta: { requestId: "req-abc-123" },
    }) as LalamoveResponse<unknown>;
  return fn as unknown as typeof import("./client").lalamoveRequest;
}

function fakeHttpError(): typeof import("./client").lalamoveRequest {
  const fn = async () => {
    const { LalamoveApiError } = await import("./client");
    throw new LalamoveApiError(
      400,
      "ERR_INVALID_FIELD",
      "req-err-1",
      [{ id: "ERR_INVALID_FIELD", message: "serviceType inválido" }],
      "Lalamove 400 ERR_INVALID_FIELD",
    );
  };
  return fn as unknown as typeof import("./client").lalamoveRequest;
}

async function criarLalamove(over: Partial<typeof confeccaoLalamove.$inferInsert> = {}) {
  const id = `lm-cot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await db.insert(confeccaoLalamove).values({
    id,
    contaId: CONTA,
    subtaskId,
    tipo: "principal",
    origemSolicitacao: "manual",
    status: "rascunho",
    origemEndereco: { rua: "Av X", numero: "100", cidade: "São Paulo" },
    origemLat: "-23.55",
    origemLng: "-46.63",
    destinoEndereco: { rua: "Av Y", numero: "200", cidade: "São Paulo" },
    destinoLat: "-23.56",
    destinoLng: "-46.64",
    ...over,
  });
  return id;
}

test("cota com sucesso → INSERT cotação + UPDATE lalamove + nota de auditoria", async () => {
  const lalamoveId = await criarLalamove();

  const result = await db.transaction((tx) =>
    cotarLalamove(tx, {
      contaId: CONTA,
      lalamoveId,
      criadaPorId: USR,
      serviceType: "MOTORCYCLE",
      httpRequest: fakeHttpOk(),
    }),
  );

  assert.equal(result.moeda, "BRL");
  assert.equal(result.valorCotado, 12.5);
  assert.equal(result.distanciaMetros, 5300);

  const [lm] = await db
    .select()
    .from(confeccaoLalamove)
    .where(eq(confeccaoLalamove.id, lalamoveId));
  assert.equal(lm.status, "cotado");
  assert.equal(lm.origemSolicitacao, "api");
  assert.equal(lm.serviceType, "MOTORCYCLE");
  assert.equal(lm.valor, 12.5);

  const cotacoes = await db
    .select()
    .from(confeccaoLalamoveCotacao)
    .where(eq(confeccaoLalamoveCotacao.lalamoveId, lalamoveId));
  assert.equal(cotacoes.length, 1);
  assert.equal(cotacoes[0].status, "valida");

  const notas = await db
    .select()
    .from(confeccaoNota)
    .where(eq(confeccaoNota.subtaskId, subtaskId));
  const auditoria = notas.find((n) =>
    n.conteudo.includes("Cotação Lalamove criada via API"),
  );
  assert.ok(auditoria, "nota de auditoria criada");
  assert.ok(
    auditoria!.conteudo.includes("req-abc-123"),
    "requestId no conteúdo da nota",
  );
});

test("lalamove com status entregue → CotacaoError lalamove_estado_invalido", async () => {
  const lalamoveId = await criarLalamove({ status: "entregue" });

  await assert.rejects(
    () =>
      db.transaction((tx) =>
        cotarLalamove(tx, {
          contaId: CONTA,
          lalamoveId,
          criadaPorId: USR,
          serviceType: "MOTORCYCLE",
          httpRequest: fakeHttpOk(),
        }),
      ),
    (err: unknown) =>
      err instanceof CotacaoError && err.code === "lalamove_estado_invalido",
  );
});

test("endereço sem coordenadas → CotacaoError, sem chamar API", async () => {
  const lalamoveId = await criarLalamove({
    origemLat: null,
    origemLng: null,
  });

  let httpCalled = false;
  const trackingHttp = (async () => {
    httpCalled = true;
    throw new Error("não deveria ser chamado");
  }) as unknown as typeof import("./client").lalamoveRequest;

  await assert.rejects(
    () =>
      db.transaction((tx) =>
        cotarLalamove(tx, {
          contaId: CONTA,
          lalamoveId,
          criadaPorId: USR,
          serviceType: "MOTORCYCLE",
          httpRequest: trackingHttp,
        }),
      ),
    (err: unknown) =>
      err instanceof CotacaoError && err.code === "endereco_sem_coordenadas",
  );
  assert.equal(httpCalled, false);
});

test("feature flag off → CotacaoError feature_flag_off", async () => {
  setEnv("LALAMOVE_FEATURE_FLAG", "false");
  const lalamoveId = await criarLalamove();

  await assert.rejects(
    () =>
      db.transaction((tx) =>
        cotarLalamove(tx, {
          contaId: CONTA,
          lalamoveId,
          criadaPorId: USR,
          serviceType: "MOTORCYCLE",
          httpRequest: fakeHttpOk(),
        }),
      ),
    (err: unknown) =>
      err instanceof CotacaoError && err.code === "feature_flag_off",
  );

  // Restaura pra próximos testes.
  setEnv("LALAMOVE_FEATURE_FLAG", "true");
});

test("API retorna 4xx → CotacaoError api_erro com requestId", async () => {
  const lalamoveId = await criarLalamove();

  await assert.rejects(
    () =>
      db.transaction((tx) =>
        cotarLalamove(tx, {
          contaId: CONTA,
          lalamoveId,
          criadaPorId: USR,
          serviceType: "INVALIDO",
          httpRequest: fakeHttpError(),
        }),
      ),
    (err: unknown) => {
      return (
        err instanceof CotacaoError &&
        err.code === "api_erro" &&
        (err.extra?.requestId === "req-err-1" ||
          err.message.includes("ERR_INVALID_FIELD"))
      );
    },
  );
});

test("re-cotar lalamove já em status cotado → cria nova cotação, mantém antiga no banco", async () => {
  const lalamoveId = await criarLalamove();

  // Primeira cotação
  await db.transaction((tx) =>
    cotarLalamove(tx, {
      contaId: CONTA,
      lalamoveId,
      criadaPorId: USR,
      serviceType: "MOTORCYCLE",
      httpRequest: fakeHttpOk(),
    }),
  );

  // Segunda — status já é "cotado" agora
  await db.transaction((tx) =>
    cotarLalamove(tx, {
      contaId: CONTA,
      lalamoveId,
      criadaPorId: USR,
      serviceType: "MOTORCYCLE",
      httpRequest: fakeHttpOk(),
    }),
  );

  const cotacoes = await db
    .select()
    .from(confeccaoLalamoveCotacao)
    .where(eq(confeccaoLalamoveCotacao.lalamoveId, lalamoveId));
  assert.equal(cotacoes.length, 2);
});
