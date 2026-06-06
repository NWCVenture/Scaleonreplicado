// Testes do composer da sessão. Cria contas + ingestao_run inline,
// monta contextos sintéticos (cadastro/explosão/prazo) e chama o
// composer dentro de uma transação tenant.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import {
  canalRegraPrazo,
  conta,
  ingestaoRun,
  user,
} from "@/lib/db/schema";
import { processarSessao } from "./composer";
import type { ContextoCadastro, ModeloSnapshot } from "../normalizacao/types";
import type { ContextoExplosao } from "../explosao/types";
import type { ContextoPrazo } from "../prazo/types";

const CONTA_TEST = `ce-comp-${nanoid(6)}`;
const USER_TEST = `ce-comp-u-${nanoid(6)}`;

async function runInConta<T>(
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
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
      nome: "Composer Test",
      emailPrincipal: `comp-${nanoid(4)}@test.com`,
      plano: "enterprise",
      status: "ativa",
    })
    .onConflictDoNothing();

  await db
    .insert(user)
    .values({
      id: USER_TEST,
      name: "Composer User",
      email: `comp-u-${nanoid(4)}@test.com`,
      emailVerified: true,
    })
    .onConflictDoNothing();

  await db.insert(canalRegraPrazo).values([
    {
      id: nanoid(),
      contaId: CONTA_TEST,
      canalVendaId: null,
      plataforma: "tiktok_shop",
      estrategia: "DIAS_UTEIS_POS_VENDA",
      diasUteis: 2,
      fallbackHoje: false,
      ativo: true,
    },
    {
      id: nanoid(),
      contaId: CONTA_TEST,
      canalVendaId: null,
      plataforma: "mercado_livre",
      estrategia: "CAMPO_EXPLICITO",
      campoPrazo: "Estado",
      regexPrazo: "coleta do dia (\\d+) de (\\w+)",
      fallbackHoje: true,
      ativo: true,
    },
  ]);
});

after(async () => {
  // ingestao_run cascade via conta; sessao tb. Mas user é restrict.
  await db.delete(ingestaoRun).where(eq(ingestaoRun.contaId, CONTA_TEST));
  await db.delete(conta).where(eq(conta.id, CONTA_TEST));
  await db.delete(user).where(eq(user.id, USER_TEST));
});

// ----- fixtures sintéticas de contexto -----

function ctxFixture(): {
  ctxCadastro: ContextoCadastro;
  ctxExplosao: ContextoExplosao;
  ctxPrazo: ContextoPrazo;
} {
  const modelos: ModeloSnapshot[] = [
    {
      id: "m1",
      codigo: "MOD1",
      corPadrao: "CORP",
      exigeTamanho: true,
      corMixDefault: null,
      cores: ["COR1", "COR2"],
      tamanhos: ["TAM1", "TAM2"],
    },
  ];
  const ctxCadastro: ContextoCadastro = {
    modelos,
    modelosPorCodigo: new Map(modelos.map((m) => [m.codigo, m])),
    coresGlobais: new Set(["COR1", "COR2", "CORP"]),
    tamanhosGlobais: new Set(["TAM1", "TAM2"]),
    aliasesGlobais: { cor: new Map(), tamanho: new Map() },
    aliasesPorModelo: new Map(),
  };
  const ctxExplosao: ContextoExplosao = {
    cadastro: ctxCadastro,
    kitRegrasPorCanonical: new Map(),
    kitRegrasComProblema: [],
  };
  // hoje fixo pra estabilidade
  const ctxPrazo: ContextoPrazo = {
    regrasDefaultPorPlataforma: new Map([
      [
        "tiktok_shop",
        {
          id: "rp-tk",
          plataforma: "tiktok_shop",
          canalVendaId: null,
          estrategia: "DIAS_UTEIS_POS_VENDA",
          diasUteis: 2,
          campoPrazo: null,
          regexPrazo: null,
          fallbackHoje: false,
          ativo: true,
        },
      ],
      [
        "mercado_livre",
        {
          id: "rp-ml",
          plataforma: "mercado_livre",
          canalVendaId: null,
          estrategia: "CAMPO_EXPLICITO",
          diasUteis: null,
          campoPrazo: "Estado",
          regexPrazo: "coleta do dia (\\d+) de (\\w+)",
          fallbackHoje: true,
          ativo: true,
        },
      ],
    ]),
    regrasPorCanal: new Map(),
    feriadosSet: new Set(),
    hojeIso: "2026-06-05",
  };
  return { ctxCadastro, ctxExplosao, ctxPrazo };
}

async function inserirRun(
  args: { id: string; tipo: "tiktok_csv" | "ml_xlsx"; resultado: unknown[] },
): Promise<void> {
  await db.insert(ingestaoRun).values({
    id: args.id,
    contaId: CONTA_TEST,
    usuarioId: USER_TEST,
    tipo: args.tipo,
    arquivoNome: `${args.id}.csv`,
    arquivoBlobUrl: `https://example.com/${args.id}`,
    arquivoTamanhoBytes: 1,
    status: "concluido",
    totalLinhas: args.resultado.length,
    linhasValidas: args.resultado.length,
    linhasDescartadas: 0,
    resultado: args.resultado,
  });
}

// ----- testes -----

test("Run TT com 2 pedidos AVULSO → 2 PedidoEnriquecido OK + linhasExplodidas", async () => {
  const runId = nanoid();
  await inserirRun({
    id: runId,
    tipo: "tiktok_csv",
    resultado: [
      {
        canal: "tiktok_shop",
        orderId: "TT-1",
        trackingId: "T1",
        sellerSku: "MOD1 COR1 TAM1",
        quantidade: 1,
        buyerUsername: "b1",
        criadoEm: "2026-06-03T13:00:00.000Z",
        orderStatus: "A ser enviado",
        orderSubstatus: null,
      },
      {
        canal: "tiktok_shop",
        orderId: "TT-2",
        trackingId: "T2",
        sellerSku: "MOD1 COR2 TAM2",
        quantidade: 1,
        buyerUsername: "b2",
        criadoEm: "2026-06-03T14:00:00.000Z",
        orderStatus: "A ser enviado",
        orderSubstatus: null,
      },
    ],
  });

  const ctxs = ctxFixture();
  const r = await runInConta((tx) =>
    processarSessao({
      tx,
      runIds: [runId],
      sessaoAtual: { arquivosIngeridos: [], dados: [] },
      ...ctxs,
    }),
  );

  assert.equal(r.dados.length, 2);
  assert.equal(r.dados[0].parsed.kind, "OK");
  assert.equal(r.dados[0].linhasExplodidas.length, 1);
  assert.equal(r.dados[0].prazo.status, "CALCULADO");
  assert.equal(r.estatisticas.totalPedidos, 2);
  assert.equal(r.estatisticas.totalAmbiguos, 0);
});

test("Pedido com SKU inválido → AMBIGUO", async () => {
  const runId = nanoid();
  await inserirRun({
    id: runId,
    tipo: "tiktok_csv",
    resultado: [
      {
        canal: "tiktok_shop",
        orderId: "TT-AMB",
        trackingId: null,
        sellerSku: "XYZ desconhecido",
        quantidade: 1,
        buyerUsername: "b",
        criadoEm: "2026-06-03T13:00:00.000Z",
        orderStatus: "A ser enviado",
        orderSubstatus: null,
      },
    ],
  });

  const r = await runInConta((tx) =>
    processarSessao({
      tx,
      runIds: [runId],
      sessaoAtual: { arquivosIngeridos: [], dados: [] },
      ...ctxFixture(),
    }),
  );
  assert.equal(r.dados[0].parsed.kind, "AMBIGUO");
  assert.equal(r.dados[0].linhasExplodidas.length, 0);
  assert.equal(r.estatisticas.totalAmbiguos, 1);
});

test("Pedido KIT N=2 → 1 linha explodida com qtd=2 × quantidadeRaw", async () => {
  const runId = nanoid();
  await inserirRun({
    id: runId,
    tipo: "tiktok_csv",
    resultado: [
      {
        canal: "tiktok_shop",
        orderId: "TT-KIT",
        trackingId: null,
        sellerSku: "KIT 2 MOD1 COR1 TAM1",
        quantidade: 3,
        buyerUsername: "b",
        criadoEm: "2026-06-03T13:00:00.000Z",
        orderStatus: "A ser enviado",
        orderSubstatus: null,
      },
    ],
  });

  const r = await runInConta((tx) =>
    processarSessao({
      tx,
      runIds: [runId],
      sessaoAtual: { arquivosIngeridos: [], dados: [] },
      ...ctxFixture(),
    }),
  );
  assert.equal(r.dados[0].linhasExplodidas.length, 1);
  // qtd do kit (2) × quantidadeRaw (3) = 6
  assert.equal(r.dados[0].linhasExplodidas[0].qtd, 6);
});

test("Pedido ML com campo Estado → prazo CAMPO_EXPLICITO", async () => {
  const runId = nanoid();
  await inserirRun({
    id: runId,
    tipo: "ml_xlsx",
    resultado: [
      {
        canal: "mercado_livre",
        numeroVenda: "ML-1",
        numeroEnvio: "ME-1",
        sku: "MOD1 COR1 TAM1",
        variacao: null,
        estado: "coleta do dia 7 de junho",
        unidades: 1,
        comprador: "b",
        dataVendaIso: "2026-06-03T13:00:00.000Z",
        dataVendaRaw: "...",
      },
    ],
  });
  const r = await runInConta((tx) =>
    processarSessao({
      tx,
      runIds: [runId],
      sessaoAtual: { arquivosIngeridos: [], dados: [] },
      ...ctxFixture(),
    }),
  );
  assert.equal(r.dados[0].prazo.origem, "campo_explicito");
});

test("Merge 2 runs: dedup por (canal, orderId) mantém primeiro", async () => {
  const runId1 = nanoid();
  const runId2 = nanoid();
  await inserirRun({
    id: runId1,
    tipo: "tiktok_csv",
    resultado: [
      {
        canal: "tiktok_shop",
        orderId: "DUP",
        trackingId: "T1",
        sellerSku: "MOD1 COR1 TAM1",
        quantidade: 1,
        buyerUsername: "b1",
        criadoEm: "2026-06-03T13:00:00.000Z",
        orderStatus: "A ser enviado",
        orderSubstatus: null,
      },
    ],
  });
  await inserirRun({
    id: runId2,
    tipo: "tiktok_csv",
    resultado: [
      {
        canal: "tiktok_shop",
        orderId: "DUP",
        trackingId: "T2",
        sellerSku: "MOD1 COR2 TAM2",
        quantidade: 9,
        buyerUsername: "b2",
        criadoEm: "2026-06-03T14:00:00.000Z",
        orderStatus: "A ser enviado",
        orderSubstatus: null,
      },
    ],
  });

  const r = await runInConta((tx) =>
    processarSessao({
      tx,
      runIds: [runId1, runId2],
      sessaoAtual: { arquivosIngeridos: [], dados: [] },
      ...ctxFixture(),
    }),
  );
  assert.equal(r.dados.length, 1);
  assert.equal(r.dados[0].trackingId, "T1"); // primeiro venceu
});

test("Idempotência: runId já em arquivosIngeridos é pulado", async () => {
  const runId = nanoid();
  await inserirRun({
    id: runId,
    tipo: "tiktok_csv",
    resultado: [
      {
        canal: "tiktok_shop",
        orderId: "IDM",
        trackingId: "T",
        sellerSku: "MOD1 COR1 TAM1",
        quantidade: 1,
        buyerUsername: "b",
        criadoEm: "2026-06-03T13:00:00.000Z",
        orderStatus: "A ser enviado",
        orderSubstatus: null,
      },
    ],
  });

  const r1 = await runInConta((tx) =>
    processarSessao({
      tx,
      runIds: [runId],
      sessaoAtual: { arquivosIngeridos: [], dados: [] },
      ...ctxFixture(),
    }),
  );
  // Re-chama com o mesmo runId — composer pula porque já está em
  // arquivosIngeridos.
  const r2 = await runInConta((tx) =>
    processarSessao({
      tx,
      runIds: [runId],
      sessaoAtual: {
        arquivosIngeridos: r1.arquivosIngeridos,
        dados: r1.dados,
      },
      ...ctxFixture(),
    }),
  );
  assert.equal(r2.arquivosIngeridos.length, 1);
  assert.equal(r2.dados.length, 1);
});

test("Estatísticas: totalAtrasados e totalHoje", async () => {
  const runId = nanoid();
  await inserirRun({
    id: runId,
    tipo: "tiktok_csv",
    resultado: [
      // Criado há 2 semanas, prazo será 2026-05-21 ou similar → atrasado
      {
        canal: "tiktok_shop",
        orderId: "ATR",
        trackingId: null,
        sellerSku: "MOD1 COR1 TAM1",
        quantidade: 1,
        buyerUsername: "b",
        criadoEm: "2026-05-20T13:00:00.000Z",
        orderStatus: "A ser enviado",
        orderSubstatus: null,
      },
    ],
  });
  const r = await runInConta((tx) =>
    processarSessao({
      tx,
      runIds: [runId],
      sessaoAtual: { arquivosIngeridos: [], dados: [] },
      ...ctxFixture(),
    }),
  );
  // hoje = 2026-06-05; prazo será bem antes
  assert.equal(r.estatisticas.totalAtrasados, 1);
  assert.equal(r.estatisticas.totalHoje, 0);
});

test("Pedido ML sem campo Estado + fallback → HOJE", async () => {
  const runId = nanoid();
  await inserirRun({
    id: runId,
    tipo: "ml_xlsx",
    resultado: [
      {
        canal: "mercado_livre",
        numeroVenda: "ML-NO-EST",
        numeroEnvio: null,
        sku: "MOD1 COR1 TAM1",
        variacao: null,
        estado: null, // sem campo
        unidades: 1,
        comprador: "b",
        dataVendaIso: "2026-06-03T13:00:00.000Z",
        dataVendaRaw: "...",
      },
    ],
  });
  const r = await runInConta((tx) =>
    processarSessao({
      tx,
      runIds: [runId],
      sessaoAtual: { arquivosIngeridos: [], dados: [] },
      ...ctxFixture(),
    }),
  );
  assert.equal(r.dados[0].prazo.status, "HOJE");
});

test("Sem regra de prazo para plataforma → SEM_DATA", async () => {
  const runId = nanoid();
  await inserirRun({
    id: runId,
    tipo: "tiktok_csv",
    resultado: [
      {
        canal: "tiktok_shop",
        orderId: "SD-1",
        trackingId: null,
        sellerSku: "MOD1 COR1 TAM1",
        quantidade: 1,
        buyerUsername: "b",
        criadoEm: "2026-06-03T13:00:00.000Z",
        orderStatus: "A ser enviado",
        orderSubstatus: null,
      },
    ],
  });
  // ctx sem regra de prazo nenhuma
  const ctxs = ctxFixture();
  ctxs.ctxPrazo.regrasDefaultPorPlataforma = new Map();
  const r = await runInConta((tx) =>
    processarSessao({
      tx,
      runIds: [runId],
      sessaoAtual: { arquivosIngeridos: [], dados: [] },
      ...ctxs,
    }),
  );
  assert.equal(r.dados[0].prazo.status, "SEM_DATA");
  assert.equal(r.estatisticas.totalSemData, 1);
});

test("Run com status != 'concluido' é ignorado pelo composer", async () => {
  const runId = nanoid();
  await db.insert(ingestaoRun).values({
    id: runId,
    contaId: CONTA_TEST,
    usuarioId: USER_TEST,
    tipo: "tiktok_csv",
    arquivoNome: "pendente.csv",
    arquivoBlobUrl: "https://example.com",
    arquivoTamanhoBytes: 1,
    status: "pendente",
  });
  const r = await runInConta((tx) =>
    processarSessao({
      tx,
      runIds: [runId],
      sessaoAtual: { arquivosIngeridos: [], dados: [] },
      ...ctxFixture(),
    }),
  );
  assert.equal(r.dados.length, 0);
  assert.equal(r.arquivosIngeridos.length, 0);
});
