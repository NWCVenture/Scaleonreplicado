// Smoke do loader contra DB local.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { canalRegraPrazo, conta, feriado, canaisVenda } from "@/lib/db/schema";
import { carregarContextoPrazo } from "./carregar-contexto-prazo";
import { hojeIsoSP } from "./dias-uteis";

const CONTA_TEST = `ce-prazo-${nanoid(6)}`;
const CANAL_ID = nanoid();

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
      nome: "Prazo Test",
      emailPrincipal: `prazo-${nanoid(4)}@test.com`,
      plano: "enterprise",
      status: "ativa",
    })
    .onConflictDoNothing();

  // Canal de venda específico
  await db.insert(canaisVenda).values({
    id: CANAL_ID,
    contaId: CONTA_TEST,
    plataforma: "tiktok_shop",
    identificadorLoja: "loja-x",
    nomeExibicao: "Loja X",
  });

  // Regra default da plataforma TikTok
  await db.insert(canalRegraPrazo).values({
    id: nanoid(),
    contaId: CONTA_TEST,
    canalVendaId: null,
    plataforma: "tiktok_shop",
    estrategia: "DIAS_UTEIS_POS_VENDA",
    diasUteis: 2,
    fallbackHoje: false,
    ativo: true,
  });

  // Regra específica do canal
  await db.insert(canalRegraPrazo).values({
    id: nanoid(),
    contaId: CONTA_TEST,
    canalVendaId: CANAL_ID,
    plataforma: "tiktok_shop",
    estrategia: "DIAS_UTEIS_POS_VENDA",
    diasUteis: 5,
    fallbackHoje: false,
    ativo: true,
  });

  // Feriado deste ano
  const ano = hojeIsoSP().slice(0, 4);
  await db.insert(feriado).values({
    id: nanoid(),
    contaId: CONTA_TEST,
    data: `${ano}-12-25`,
    descricao: "Natal",
    fonte: "manual",
  });
});

after(async () => {
  await db.delete(conta).where(eq(conta.id, CONTA_TEST));
});

test("Snapshot tem regras default e específicas separadas", async () => {
  const ctx = await runInConta((tx) => carregarContextoPrazo(tx));
  assert.ok(ctx.regrasDefaultPorPlataforma.get("tiktok_shop"));
  const especifica = Array.from(ctx.regrasPorCanal.values()).find(
    (r) => r.canalVendaId === CANAL_ID,
  );
  assert.ok(especifica);
  assert.equal(especifica.diasUteis, 5);
  assert.equal(ctx.regrasDefaultPorPlataforma.get("tiktok_shop")!.diasUteis, 2);
});

test("Feriado do ano atual está no Set", async () => {
  const ctx = await runInConta((tx) => carregarContextoPrazo(tx));
  const ano = hojeIsoSP().slice(0, 4);
  assert.equal(ctx.feriadosSet.has(`${ano}-12-25`), true);
});

test("hojeIso é YYYY-MM-DD válido", async () => {
  const ctx = await runInConta((tx) => carregarContextoPrazo(tx));
  assert.match(ctx.hojeIso, /^\d{4}-\d{2}-\d{2}$/);
});
