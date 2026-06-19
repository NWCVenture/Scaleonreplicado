// Testes de integração dos helpers `contexto` + `persistir` (RITM-17).
// Usam banco local (Docker) sob RLS.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import {
  centralEnviosBipagemPacote,
  centralEnviosNotificacao,
  conta,
  sessaoCentralEnvios,
  transportadoraPadrao,
  user,
} from "@/lib/db/schema";
import { classificarBipe } from "./classificador";
import { montarContextoClassificacao } from "./contexto";
import {
  persistirBipe,
  persistirDecisaoCancelado,
} from "./persistir";
import type { PedidoEnriquecido } from "@/lib/central-envios/sessao/types";

const CONTA_TEST = `ce-bip-${nanoid(6)}`;
const USER_A = `ce-bip-ua-${nanoid(6)}`;
const USER_B = `ce-bip-ub-${nanoid(6)}`;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function runInConta<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.conta_atual', ${CONTA_TEST}, true)`,
    );
    return fn(tx);
  });
}

before(async () => {
  await db
    .insert(conta)
    .values({
      id: CONTA_TEST,
      nome: "Bipagem Test",
      emailPrincipal: `bip-${nanoid(4)}@test.com`,
      plano: "enterprise",
      status: "ativa",
    })
    .onConflictDoNothing();

  for (const uid of [USER_A, USER_B]) {
    await db
      .insert(user)
      .values({
        id: uid,
        name: `User ${uid.slice(-4)}`,
        email: `${uid}@test.com`,
        emailVerified: true,
      })
      .onConflictDoNothing();
  }

  // Padrões de carrier de TT JDLOG
  await db.insert(transportadoraPadrao).values({
    id: nanoid(),
    transportadora: "TTK_JDLOG",
    prefixos: ["999881"],
    contaId: CONTA_TEST,
  });
});

after(async () => {
  await db
    .delete(centralEnviosNotificacao)
    .where(eq(centralEnviosNotificacao.contaId, CONTA_TEST));
  await db
    .delete(centralEnviosBipagemPacote)
    .where(eq(centralEnviosBipagemPacote.contaId, CONTA_TEST));
  await db
    .delete(sessaoCentralEnvios)
    .where(eq(sessaoCentralEnvios.contaId, CONTA_TEST));
  await db
    .delete(transportadoraPadrao)
    .where(eq(transportadoraPadrao.contaId, CONTA_TEST));
  await db.delete(conta).where(eq(conta.id, CONTA_TEST));
  await db.delete(user).where(eq(user.id, USER_A));
  await db.delete(user).where(eq(user.id, USER_B));
});

// ──────────────────────────────────────────────────────────────
// fixtures
// ──────────────────────────────────────────────────────────────

function pedidoFake(
  trackingId: string | null,
  orderId: string,
  orderStatus = "A ser enviado",
): PedidoEnriquecido {
  return {
    origemRunId: "run-1",
    canal: "tiktok_shop",
    orderId,
    trackingId,
    skuRaw: "MOD1 COR1 TAM1",
    quantidadeRaw: 1,
    criadoEmIso: "2026-06-03T13:00:00.000Z",
    comprador: "fulano",
    camposExtras: { orderStatus, orderSubstatus: null },
    parsed: {
      kind: "OK",
      modeloCodigo: "MOD1",
      tamanho: "TAM1",
      qtdKit: 1,
      canonical: "MOD1 COR1 TAM1",
      cores: [{ cor: "COR1", qtd: 1 }],
      skuKind: "AVULSO",
    },
    linhasExplodidas: [
      { modeloCodigo: "MOD1", cor: "COR1", tamanho: "TAM1", qtd: 1 },
    ],
    explosaoErro: null,
    prazo: {
      status: "CALCULADO",
      prazoIso: "2026-06-05",
      origem: "dias_uteis_pos_venda",
      detalhes: "",
    },
  };
}

async function criarSessao(usuarioId: string, dados: PedidoEnriquecido[]) {
  const id = nanoid();
  await db.insert(sessaoCentralEnvios).values({
    id,
    contaId: CONTA_TEST,
    usuarioId,
    dados,
  });
  return id;
}

const TK_OK = "9998811111111";
const TK_CANCEL = "9998812222222";

// ──────────────────────────────────────────────────────────────
// Testes
// ──────────────────────────────────────────────────────────────

test("POST OK persiste linha com categoria=OK", async () => {
  const pedido = pedidoFake(TK_OK, "ORD-OK-1");
  const sessaoId = await criarSessao(USER_A, [pedido]);

  const out = await runInConta(async (tx) => {
    const ctx = await montarContextoClassificacao({
      tx,
      contaId: CONTA_TEST,
      sessaoId,
      dados: [pedido],
    });
    const [resultado] = classificarBipe(TK_OK, ctx);
    return persistirBipe({
      tx,
      contaId: CONTA_TEST,
      sessaoId,
      usuarioId: USER_A,
      resultado,
    });
  });

  assert.equal(out.persistido, true);
  assert.equal(out.categoriaPersistida, "OK");
  assert.ok(out.bipagemId);

  const [row] = await db
    .select()
    .from(centralEnviosBipagemPacote)
    .where(eq(centralEnviosBipagemPacote.id, out.bipagemId!));
  assert.equal(row.categoria, "OK");
  assert.equal(row.trackingId, TK_OK);
  assert.equal(row.orderId, "ORD-OK-1");
  assert.equal(row.transportadora, "TTK_JDLOG");
});

test("CANCELADO bloqueante NÃO persiste", async () => {
  const pedido = pedidoFake(TK_CANCEL, "ORD-CANCEL-1", "Cancelado");
  const sessaoId = await criarSessao(USER_A, [pedido]);

  const out = await runInConta(async (tx) => {
    const ctx = await montarContextoClassificacao({
      tx,
      contaId: CONTA_TEST,
      sessaoId,
      dados: [pedido],
    });
    const [resultado] = classificarBipe(TK_CANCEL, ctx);
    return persistirBipe({
      tx,
      contaId: CONTA_TEST,
      sessaoId,
      usuarioId: USER_A,
      resultado,
    });
  });

  assert.equal(out.persistido, false);
  assert.equal(out.bipagemId, null);

  const rows = await db
    .select()
    .from(centralEnviosBipagemPacote)
    .where(eq(centralEnviosBipagemPacote.sessaoId, sessaoId));
  assert.equal(rows.length, 0);
});

test("FORA_LOTE persiste com orderId=null", async () => {
  const sessaoId = await criarSessao(USER_A, []); // sem CSV

  const out = await runInConta(async (tx) => {
    const ctx = await montarContextoClassificacao({
      tx,
      contaId: CONTA_TEST,
      sessaoId,
      dados: [],
    });
    const [resultado] = classificarBipe(TK_OK, ctx);
    return persistirBipe({
      tx,
      contaId: CONTA_TEST,
      sessaoId,
      usuarioId: USER_A,
      resultado,
    });
  });

  assert.equal(out.persistido, true);
  assert.equal(out.categoriaPersistida, "FORA_LOTE");

  const [row] = await db
    .select()
    .from(centralEnviosBipagemPacote)
    .where(eq(centralEnviosBipagemPacote.id, out.bipagemId!));
  assert.equal(row.categoria, "FORA_LOTE");
  assert.equal(row.orderId, null);
  assert.equal(row.trackingId, TK_OK);
});

test("DESCONHECIDA persiste com trackingId=null", async () => {
  const sessaoId = await criarSessao(USER_A, []);

  const out = await runInConta(async (tx) => {
    const ctx = await montarContextoClassificacao({
      tx,
      contaId: CONTA_TEST,
      sessaoId,
      dados: [],
    });
    const [resultado] = classificarBipe("texto-sem-id", ctx);
    return persistirBipe({
      tx,
      contaId: CONTA_TEST,
      sessaoId,
      usuarioId: USER_A,
      resultado,
    });
  });

  assert.equal(out.categoriaPersistida, "DESCONHECIDA");

  const [row] = await db
    .select()
    .from(centralEnviosBipagemPacote)
    .where(eq(centralEnviosBipagemPacote.id, out.bipagemId!));
  assert.equal(row.trackingId, null);
  assert.equal(row.transportadora, null);
});

test("Cross-session: OK em 2 sessões cria duplicação + notificação na OUTRA sessão", async () => {
  const tk = "9998813333333";
  const pedido = pedidoFake(tk, "ORD-XS-1");
  const sessaoA = await criarSessao(USER_A, [pedido]);
  const sessaoB = await criarSessao(USER_B, [pedido]);

  // A bipou primeiro
  await runInConta(async (tx) => {
    const ctx = await montarContextoClassificacao({
      tx,
      contaId: CONTA_TEST,
      sessaoId: sessaoA,
      dados: [pedido],
    });
    const [r] = classificarBipe(tk, ctx);
    await persistirBipe({
      tx,
      contaId: CONTA_TEST,
      sessaoId: sessaoA,
      usuarioId: USER_A,
      resultado: r,
    });
  });

  // B bipa o mesmo depois — deveria detectar e notificar A
  const outB = await runInConta(async (tx) => {
    const ctx = await montarContextoClassificacao({
      tx,
      contaId: CONTA_TEST,
      sessaoId: sessaoB,
      dados: [pedido],
    });
    const [r] = classificarBipe(tk, ctx);
    return persistirBipe({
      tx,
      contaId: CONTA_TEST,
      sessaoId: sessaoB,
      usuarioId: USER_B,
      resultado: r,
    });
  });

  assert.equal(outB.duplicacoesCrossSessao.length, 1);
  assert.equal(outB.duplicacoesCrossSessao[0].outraSessaoId, sessaoA);
  assert.equal(outB.duplicacoesCrossSessao[0].outroUsuarioId, USER_A);

  const notifs = await db
    .select()
    .from(centralEnviosNotificacao)
    .where(eq(centralEnviosNotificacao.sessaoDestinoId, sessaoA));
  assert.equal(notifs.length, 1);
  assert.equal(notifs[0].tipo, "DUPLICACAO_CROSS_SESSAO");
});

test("Cross-session NÃO dispara para FORA_LOTE", async () => {
  const tk = "9998814444444";
  // Nem A nem B têm esse tk no CSV
  const sessaoA = await criarSessao(USER_A, []);
  const sessaoB = await criarSessao(USER_B, []);

  await runInConta(async (tx) => {
    const ctx = await montarContextoClassificacao({
      tx,
      contaId: CONTA_TEST,
      sessaoId: sessaoA,
      dados: [],
    });
    const [r] = classificarBipe(tk, ctx);
    await persistirBipe({
      tx,
      contaId: CONTA_TEST,
      sessaoId: sessaoA,
      usuarioId: USER_A,
      resultado: r,
    });
  });

  const outB = await runInConta(async (tx) => {
    const ctx = await montarContextoClassificacao({
      tx,
      contaId: CONTA_TEST,
      sessaoId: sessaoB,
      dados: [],
    });
    const [r] = classificarBipe(tk, ctx);
    return persistirBipe({
      tx,
      contaId: CONTA_TEST,
      sessaoId: sessaoB,
      usuarioId: USER_B,
      resultado: r,
    });
  });

  assert.equal(outB.duplicacoesCrossSessao.length, 0);

  // Nenhuma notificação criada
  const notifs = await db
    .select()
    .from(centralEnviosNotificacao)
    .where(
      and(
        eq(centralEnviosNotificacao.contaId, CONTA_TEST),
        eq(centralEnviosNotificacao.sessaoDestinoId, sessaoA),
      ),
    );
  assert.equal(notifs.length, 0);
});

test("Decisão RETIRADO insere categoria=CANCELADO_RETIRADO", async () => {
  const tk = "9998815555555";
  const pedido = pedidoFake(tk, "ORD-DEC-1", "Cancelado");
  const sessaoId = await criarSessao(USER_A, [pedido]);

  const out = await runInConta(async (tx) => {
    const ctx = await montarContextoClassificacao({
      tx,
      contaId: CONTA_TEST,
      sessaoId,
      dados: [pedido],
    });
    const [r] = classificarBipe(tk, ctx);
    assert.equal(r.categoria, "CANCELADO");
    return persistirDecisaoCancelado({
      tx,
      contaId: CONTA_TEST,
      sessaoId,
      usuarioId: USER_A,
      resultado: r,
      acao: "RETIRADO",
    });
  });

  assert.equal(out.categoriaPersistida, "CANCELADO_RETIRADO");
  assert.equal(out.duplicacoesCrossSessao.length, 0); // RETIRADO não dispara cross

  const [row] = await db
    .select()
    .from(centralEnviosBipagemPacote)
    .where(eq(centralEnviosBipagemPacote.id, out.bipagemId!));
  assert.equal(row.categoria, "CANCELADO_RETIRADO");
  assert.equal(row.acaoCancelado, "RETIRADO");
});

test("Decisão ENVIADO_MESMO_ASSIM dispara cross-session se outra sessão bipou OK", async () => {
  const tk = "9998816666666";
  const pedido = pedidoFake(tk, "ORD-DEC-2");
  const sessaoOK = await criarSessao(USER_A, [pedido]);

  // A bipa OK primeiro
  await runInConta(async (tx) => {
    const ctx = await montarContextoClassificacao({
      tx,
      contaId: CONTA_TEST,
      sessaoId: sessaoOK,
      dados: [pedido],
    });
    const [r] = classificarBipe(tk, ctx);
    await persistirBipe({
      tx,
      contaId: CONTA_TEST,
      sessaoId: sessaoOK,
      usuarioId: USER_A,
      resultado: r,
    });
  });

  // B vê o pedido como cancelado e decide ENVIAR MESMO ASSIM
  const pedidoCancelado = pedidoFake(tk, "ORD-DEC-2", "Cancelado");
  const sessaoB = await criarSessao(USER_B, [pedidoCancelado]);
  const out = await runInConta(async (tx) => {
    const ctx = await montarContextoClassificacao({
      tx,
      contaId: CONTA_TEST,
      sessaoId: sessaoB,
      dados: [pedidoCancelado],
    });
    const [r] = classificarBipe(tk, ctx);
    return persistirDecisaoCancelado({
      tx,
      contaId: CONTA_TEST,
      sessaoId: sessaoB,
      usuarioId: USER_B,
      resultado: r,
      acao: "ENVIADO_MESMO_ASSIM",
    });
  });

  assert.equal(out.categoriaPersistida, "CANCELADO_ENVIADO_MESMO_ASSIM");
  // Detectou que A já bipou esse tracking
  assert.equal(out.duplicacoesCrossSessao.length, 1);
  assert.equal(out.duplicacoesCrossSessao[0].outraSessaoId, sessaoOK);
});

test("DUPLICADO intra-sessão é persistido (auditoria de tentativas)", async () => {
  const tk = "9998817777777";
  const pedido = pedidoFake(tk, "ORD-DUP-1");
  const sessaoId = await criarSessao(USER_A, [pedido]);

  // 1º bipe: OK
  await runInConta(async (tx) => {
    const ctx = await montarContextoClassificacao({
      tx,
      contaId: CONTA_TEST,
      sessaoId,
      dados: [pedido],
    });
    const [r] = classificarBipe(tk, ctx);
    await persistirBipe({
      tx,
      contaId: CONTA_TEST,
      sessaoId,
      usuarioId: USER_A,
      resultado: r,
    });
  });

  // 2º bipe: DUPLICADO
  const out2 = await runInConta(async (tx) => {
    const ctx = await montarContextoClassificacao({
      tx,
      contaId: CONTA_TEST,
      sessaoId,
      dados: [pedido],
    });
    const [r] = classificarBipe(tk, ctx);
    assert.equal(r.categoria, "DUPLICADO");
    return persistirBipe({
      tx,
      contaId: CONTA_TEST,
      sessaoId,
      usuarioId: USER_A,
      resultado: r,
    });
  });

  assert.equal(out2.persistido, true);
  assert.equal(out2.categoriaPersistida, "DUPLICADO");

  const rows = await db
    .select()
    .from(centralEnviosBipagemPacote)
    .where(
      and(
        eq(centralEnviosBipagemPacote.sessaoId, sessaoId),
        eq(centralEnviosBipagemPacote.trackingId, tk),
      ),
    );
  assert.equal(rows.length, 2);
});
