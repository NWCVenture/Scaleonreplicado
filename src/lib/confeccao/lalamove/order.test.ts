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
  cancelarOrderLalamove,
  criarOrderLalamove,
  CriarOrderError,
} from "./order";
import type { LalamoveResponse } from "./client";

const CONTA = "order-test-conta";
const USR = "order-test-user";

let opId: string;
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
      nome: "Order Test",
      emailPrincipal: "order@test.com",
      plano: "enterprise",
      status: "ativa",
    })
    .onConflictDoNothing();
  await db
    .insert(user)
    .values({
      id: USR,
      name: "User Order",
      email: "user-order@test.com",
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
      id: `prod-order-${Date.now()}`,
      contaId: CONTA,
      nome: "Produto Order",
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
      id: `op-order-${Date.now()}`,
      contaId: CONTA,
      numero: "OP05260901",
      sequencialGlobal: 901,
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
        .where(eq(confeccaoOrdemProducao.numero, "OP05260901"))
        .limit(1)
    )[0].id;

  const [sub] = await db
    .insert(confeccaoSubtask)
    .values({
      id: `sub-order-${Date.now()}`,
      contaId: CONTA,
      ordemProducaoId: opId,
      numero: "OPCOR0901",
      idInterno: "OPCOR-0526-0901",
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
        .where(eq(confeccaoSubtask.idInterno, "OPCOR-0526-0901"))
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
  for (const [k, v] of Object.entries(ENV_BACKUP)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// ─── helpers ──────────────────────────────────────────────────────────────

async function criarLalamoveComCotacao(opts: {
  status?: typeof confeccaoLalamove.$inferSelect.status;
  cotacaoExpiraEmMs?: number; // offset from now; default +5min
  cotacaoStatus?: typeof confeccaoLalamoveCotacao.$inferSelect.status;
  contatoOrigem?: { nome: string | null; telefone: string | null };
  contatoDestino?: { nome: string | null; telefone: string | null };
  orderIdApi?: string;
}): Promise<{ lalamoveId: string; quotationId: string }> {
  const lalamoveId = `lm-order-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
  const quotationId = `QID-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
  // CHECK confeccao_lalamove_api_completo: quando origem=api e status não é
  // rascunho/cotado, precisa order_id_api preenchido. Auto-completa pro teste.
  const statusFinal = opts.status ?? "cotado";
  const orderIdApiFinal =
    opts.orderIdApi ??
    (statusFinal === "rascunho" || statusFinal === "cotado"
      ? null
      : `OID-AUTO-${lalamoveId}`);
  await db.insert(confeccaoLalamove).values({
    id: lalamoveId,
    contaId: CONTA,
    subtaskId,
    tipo: "principal",
    origemSolicitacao: "api",
    status: statusFinal,
    origemEndereco: { rua: "Av X", numero: "100", cidade: "São Paulo" },
    origemLat: "-23.55",
    origemLng: "-46.63",
    destinoEndereco: { rua: "Av Y", numero: "200", cidade: "São Paulo" },
    destinoLat: "-23.56",
    destinoLng: "-46.64",
    serviceType: "MOTORCYCLE",
    quotationIdApi: quotationId,
    // Quando opts.contatoOrigem está presente, usa o valor (mesmo null);
    // quando ausente, default. Isso preserva null explícito do teste.
    contatoOrigemNome:
      opts.contatoOrigem === undefined
        ? "Origem Padrão"
        : opts.contatoOrigem.nome,
    contatoOrigemTelefone:
      opts.contatoOrigem === undefined
        ? "+5511999998888"
        : opts.contatoOrigem.telefone,
    contatoDestinoNome:
      opts.contatoDestino === undefined
        ? "Destino Padrão"
        : opts.contatoDestino.nome,
    contatoDestinoTelefone:
      opts.contatoDestino === undefined
        ? "+5511977776666"
        : opts.contatoDestino.telefone,
    orderIdApi: orderIdApiFinal,
  });

  await db.insert(confeccaoLalamoveCotacao).values({
    id: `cot-${quotationId}`,
    contaId: CONTA,
    lalamoveId,
    quotationIdApi: quotationId,
    status: opts.cotacaoStatus ?? "valida",
    valorCotado: 12.5,
    moeda: "BRL",
    distanciaMetros: 5000,
    serviceType: "MOTORCYCLE",
    stopsApi: [
      { stopId: "stop_a", coordinates: { lat: "-23.55", lng: "-46.63" } },
      { stopId: "stop_b", coordinates: { lat: "-23.56", lng: "-46.64" } },
    ],
    requestPayload: {},
    responsePayload: {},
    expiraEm: new Date(Date.now() + (opts.cotacaoExpiraEmMs ?? 5 * 60_000)),
    criadaPorId: USR,
  });

  return { lalamoveId, quotationId };
}

function fakeOrderOk(orderId = `OID-${Date.now()}`) {
  const fn = async () =>
    ({
      data: {
        orderId,
        quotationId: "ignored",
        status: "ASSIGNING_DRIVER",
        shareLink: `https://share.lalamove.com/?id=${orderId}`,
        priceBreakdown: { base: "8.00", total: "10.50", currency: "BRL" },
        stops: [{ stopId: "stop_a" }, { stopId: "stop_b" }],
      },
      meta: { requestId: `req-${orderId}` },
    }) as LalamoveResponse<unknown>;
  return fn as unknown as typeof import("./client").lalamoveRequest;
}

function fakeApiError(status: number, errorId: string, message: string) {
  const fn = async () => {
    const { LalamoveApiError } = await import("./client");
    throw new LalamoveApiError(
      status,
      errorId,
      `req-err-${status}`,
      [{ id: errorId, message }],
      `Lalamove ${status} ${errorId}: ${message}`,
    );
  };
  return fn as unknown as typeof import("./client").lalamoveRequest;
}

// Re-cotação encadeada: o fake retorna primeiro uma cotação (POST /v3/quotations),
// depois o order (POST /v3/orders). Usa contador stateful.
function fakeRecotacaoEntaoOrder(orderId = `OID-${Date.now()}`) {
  let chamadas = 0;
  const newQuotationId = `QID-NEW-${Date.now()}`;
  const fn = async (args: { method: string; path: string }) => {
    chamadas++;
    if (args.path === "/v3/quotations") {
      return {
        data: {
          quotationId: newQuotationId,
          expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
          serviceType: "MOTORCYCLE",
          language: "pt_BR",
          specialRequests: [],
          stops: [
            {
              stopId: "stop_new_a",
              coordinates: { lat: "-23.55", lng: "-46.63" },
              address: "X",
            },
            {
              stopId: "stop_new_b",
              coordinates: { lat: "-23.56", lng: "-46.64" },
              address: "Y",
            },
          ],
          priceBreakdown: { total: "11.00", currency: "BRL" },
          distance: { value: "5000", unit: "m" },
        },
        meta: { requestId: `req-cot-${chamadas}` },
      } as LalamoveResponse<unknown>;
    }
    return {
      data: {
        orderId,
        quotationId: newQuotationId,
        status: "ASSIGNING_DRIVER",
        shareLink: `https://share.lalamove.com/?id=${orderId}`,
        priceBreakdown: { total: "11.00", currency: "BRL" },
        stops: [{ stopId: "stop_new_a" }, { stopId: "stop_new_b" }],
      },
      meta: { requestId: `req-order-${chamadas}` },
    } as LalamoveResponse<unknown>;
  };
  return fn as unknown as typeof import("./client").lalamoveRequest;
}

// ─── tests criarOrderLalamove ─────────────────────────────────────────────

test("criar order com cotação válida → UPDATE lalamove + cotação convertida_em_pedido + nota", async () => {
  const { lalamoveId } = await criarLalamoveComCotacao({});

  const result = await db.transaction((tx) =>
    criarOrderLalamove(tx, {
      contaId: CONTA,
      lalamoveId,
      criadaPorId: USR,
      httpRequest: fakeOrderOk("OID-OK-1"),
    }),
  );

  assert.equal(result.orderIdApi, "OID-OK-1");
  assert.ok(result.shareLink?.includes("share.lalamove.com"));
  assert.equal(result.novaCotacao, undefined);

  const [lm] = await db
    .select()
    .from(confeccaoLalamove)
    .where(eq(confeccaoLalamove.id, lalamoveId));
  assert.equal(lm.status, "procurando_motorista");
  assert.equal(lm.orderIdApi, "OID-OK-1");
  assert.ok(lm.shareLink);

  const cotacoes = await db
    .select()
    .from(confeccaoLalamoveCotacao)
    .where(eq(confeccaoLalamoveCotacao.lalamoveId, lalamoveId));
  assert.equal(cotacoes[0].status, "convertida_em_pedido");
});

test("status≠cotado → CriarOrderError lalamove_estado_invalido", async () => {
  const { lalamoveId } = await criarLalamoveComCotacao({
    status: "procurando_motorista",
  });

  await assert.rejects(
    () =>
      db.transaction((tx) =>
        criarOrderLalamove(tx, {
          contaId: CONTA,
          lalamoveId,
          criadaPorId: USR,
          httpRequest: fakeOrderOk(),
        }),
      ),
    (err: unknown) =>
      err instanceof CriarOrderError &&
      err.code === "lalamove_estado_invalido",
  );
});

test("contato vazio e sem override → CriarOrderError contato_incompleto, sem chamar API", async () => {
  const { lalamoveId } = await criarLalamoveComCotacao({
    contatoOrigem: { nome: null, telefone: null },
  });

  let httpCalled = false;
  const tracking = (async () => {
    httpCalled = true;
    throw new Error("não deveria ser chamado");
  }) as unknown as typeof import("./client").lalamoveRequest;

  await assert.rejects(
    () =>
      db.transaction((tx) =>
        criarOrderLalamove(tx, {
          contaId: CONTA,
          lalamoveId,
          criadaPorId: USR,
          httpRequest: tracking,
        }),
      ),
    (err: unknown) =>
      err instanceof CriarOrderError && err.code === "contato_incompleto",
  );
  assert.equal(httpCalled, false);
});

test("telefone fora do E.164 → CriarOrderError contato_incompleto", async () => {
  const { lalamoveId } = await criarLalamoveComCotacao({
    contatoOrigem: { nome: "Tem nome", telefone: "11999998888" }, // sem +55
  });

  await assert.rejects(
    () =>
      db.transaction((tx) =>
        criarOrderLalamove(tx, {
          contaId: CONTA,
          lalamoveId,
          criadaPorId: USR,
          httpRequest: fakeOrderOk(),
        }),
      ),
    (err: unknown) =>
      err instanceof CriarOrderError && err.code === "contato_incompleto",
  );
});

test("override de contato sobrepõe valor do registro", async () => {
  const { lalamoveId } = await criarLalamoveComCotacao({
    contatoOrigem: { nome: "Origem antiga", telefone: "+5511999990000" },
  });

  await db.transaction((tx) =>
    criarOrderLalamove(tx, {
      contaId: CONTA,
      lalamoveId,
      criadaPorId: USR,
      contatoOrigem: { nome: "Origem nova", telefoneE164: "+5511988882222" },
      httpRequest: fakeOrderOk("OID-OVR-1"),
    }),
  );

  const [lm] = await db
    .select()
    .from(confeccaoLalamove)
    .where(eq(confeccaoLalamove.id, lalamoveId));
  assert.equal(lm.contatoOrigemNome, "Origem nova");
  assert.equal(lm.contatoOrigemTelefone, "+5511988882222");
});

test("cotação expirada → re-cota silenciosamente e segue", async () => {
  const { lalamoveId } = await criarLalamoveComCotacao({
    cotacaoExpiraEmMs: -1000, // já expirou
  });

  const result = await db.transaction((tx) =>
    criarOrderLalamove(tx, {
      contaId: CONTA,
      lalamoveId,
      criadaPorId: USR,
      httpRequest: fakeRecotacaoEntaoOrder("OID-RECOT-1"),
    }),
  );

  assert.equal(result.orderIdApi, "OID-RECOT-1");
  assert.ok(result.novaCotacao);
  assert.equal(result.novaCotacao!.valorCotado, 11);

  // Cotação antiga deve estar "expirada", a nova "convertida_em_pedido"
  const cotacoes = await db
    .select()
    .from(confeccaoLalamoveCotacao)
    .where(eq(confeccaoLalamoveCotacao.lalamoveId, lalamoveId));
  assert.equal(cotacoes.length, 2);
  const statuses = cotacoes.map((c) => c.status).sort();
  assert.deepEqual(statuses, ["convertida_em_pedido", "expirada"]);
});

test("API retorna 4xx → CriarOrderError api_erro com requestId", async () => {
  const { lalamoveId } = await criarLalamoveComCotacao({});

  await assert.rejects(
    () =>
      db.transaction((tx) =>
        criarOrderLalamove(tx, {
          contaId: CONTA,
          lalamoveId,
          criadaPorId: USR,
          httpRequest: fakeApiError(
            422,
            "ERR_QUOTATION_NOT_FOUND",
            "quotation inválida",
          ),
        }),
      ),
    (err: unknown) =>
      err instanceof CriarOrderError &&
      err.code === "api_erro" &&
      err.extra?.requestId === "req-err-422",
  );
});

// ─── tests cancelarOrderLalamove ──────────────────────────────────────────

test("cancelar sem orderIdApi → noop, retorna sem_order_id", async () => {
  const { lalamoveId } = await criarLalamoveComCotacao({});

  const r = await db.transaction((tx) =>
    cancelarOrderLalamove(tx, {
      contaId: CONTA,
      lalamoveId,
      canceladaPorId: USR,
      motivo: "teste sem order",
      httpRequest: (async () => {
        throw new Error("não deveria chamar API");
      }) as unknown as typeof import("./client").lalamoveRequest,
    }),
  );
  assert.equal(r.cancelado, false);
  assert.equal(r.motivo, "sem_order_id");
});

test("cancelar com status='coletado' → status_nao_cancelavel", async () => {
  const { lalamoveId } = await criarLalamoveComCotacao({
    status: "coletado",
    orderIdApi: "OID-COLETADO-1",
  });

  const r = await db.transaction((tx) =>
    cancelarOrderLalamove(tx, {
      contaId: CONTA,
      lalamoveId,
      canceladaPorId: USR,
      motivo: "teste",
      httpRequest: (async () => {
        throw new Error("não deveria chamar API");
      }) as unknown as typeof import("./client").lalamoveRequest,
    }),
  );
  assert.equal(r.cancelado, false);
  assert.equal(r.motivo, "status_nao_cancelavel");
});

test("cancelar com sucesso → status='cancelado' + nota com requestId", async () => {
  const { lalamoveId } = await criarLalamoveComCotacao({
    status: "procurando_motorista",
    orderIdApi: "OID-CANCEL-1",
  });

  const r = await db.transaction((tx) =>
    cancelarOrderLalamove(tx, {
      contaId: CONTA,
      lalamoveId,
      canceladaPorId: USR,
      motivo: "operador cancelou",
      httpRequest: (async () => ({
        data: null,
        meta: { requestId: "req-del-1" },
      })) as unknown as typeof import("./client").lalamoveRequest,
    }),
  );
  assert.equal(r.cancelado, true);
  assert.equal(r.motivo, "api_ok");
  assert.equal(r.requestIdApi, "req-del-1");

  const [lm] = await db
    .select()
    .from(confeccaoLalamove)
    .where(eq(confeccaoLalamove.id, lalamoveId));
  assert.equal(lm.status, "cancelado");
  assert.equal(lm.cancelamentoMotivo, "operador cancelou");
  assert.ok(lm.canceladaEm);
});

test("cancelar com 404 da API → idempotente, marca como api_ok", async () => {
  const { lalamoveId } = await criarLalamoveComCotacao({
    status: "procurando_motorista",
    orderIdApi: "OID-404-1",
  });

  const r = await db.transaction((tx) =>
    cancelarOrderLalamove(tx, {
      contaId: CONTA,
      lalamoveId,
      canceladaPorId: USR,
      motivo: "retry",
      httpRequest: fakeApiError(404, "ERR_NOT_FOUND", "order não existe"),
    }),
  );
  assert.equal(r.motivo, "api_ok");
  const [lm] = await db
    .select()
    .from(confeccaoLalamove)
    .where(eq(confeccaoLalamove.id, lalamoveId));
  assert.equal(lm.status, "cancelado");
});

test("cancelar com falha (não-404) da API → status interno cancelado + motivo=api_falhou", async () => {
  const { lalamoveId } = await criarLalamoveComCotacao({
    status: "procurando_motorista",
    orderIdApi: "OID-FAIL-1",
  });

  const r = await db.transaction((tx) =>
    cancelarOrderLalamove(tx, {
      contaId: CONTA,
      lalamoveId,
      canceladaPorId: USR,
      motivo: "teste falha",
      httpRequest: fakeApiError(500, "ERR_INTERNAL", "lalamove offline"),
    }),
  );
  assert.equal(r.cancelado, true);
  assert.equal(r.motivo, "api_falhou");

  const [lm] = await db
    .select()
    .from(confeccaoLalamove)
    .where(eq(confeccaoLalamove.id, lalamoveId));
  assert.equal(lm.status, "cancelado");
});
