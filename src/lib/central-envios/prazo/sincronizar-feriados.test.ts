// Testes do sync BrasilAPI. Usa fetch mockado e DB local.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { conta, feriado } from "@/lib/db/schema";
import { sincronizarFeriadosNacionais } from "./sincronizar-feriados";

const CONTA_TEST = `ce-feriado-${nanoid(6)}`;

function fakeFetch(
  status: number,
  body: unknown,
): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

function fakeFetchThrow(): typeof fetch {
  return (async () => {
    throw new Error("connection_refused");
  }) as unknown as typeof fetch;
}

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
      nome: "Feriado Test",
      emailPrincipal: `feriado-${nanoid(4)}@test.com`,
      plano: "enterprise",
      status: "ativa",
    })
    .onConflictDoNothing();
});

after(async () => {
  await db.delete(conta).where(eq(conta.id, CONTA_TEST));
});

test("Sync com 2 feriados válidos → 2 inseridos", async () => {
  const fetch = fakeFetch(200, [
    { date: "2026-01-01", name: "Confraternização Universal", type: "national" },
    { date: "2026-04-21", name: "Tiradentes", type: "national" },
  ]);
  const r = await runInConta((tx) =>
    sincronizarFeriadosNacionais(tx, CONTA_TEST, 2026, fetch),
  );
  assert.equal(r.inseridos, 2);
  assert.equal(r.atualizados, 0);
  assert.equal(r.pulados, 0);

  await db
    .delete(feriado)
    .where(and(eq(feriado.contaId, CONTA_TEST), eq(feriado.data, "2026-01-01")));
  await db
    .delete(feriado)
    .where(and(eq(feriado.contaId, CONTA_TEST), eq(feriado.data, "2026-04-21")));
});

test("Sync rodado 2× → 2ª chamada não duplica", async () => {
  const lista = [
    { date: "2026-09-07", name: "Independência do Brasil", type: "national" },
  ];
  const fetch = fakeFetch(200, lista);
  const r1 = await runInConta((tx) =>
    sincronizarFeriadosNacionais(tx, CONTA_TEST, 2026, fetch),
  );
  assert.equal(r1.inseridos, 1);
  const r2 = await runInConta((tx) =>
    sincronizarFeriadosNacionais(tx, CONTA_TEST, 2026, fetch),
  );
  assert.equal(r2.inseridos, 0);
  assert.equal(r2.pulados, 1);

  await db
    .delete(feriado)
    .where(and(eq(feriado.contaId, CONTA_TEST), eq(feriado.data, "2026-09-07")));
});

test("Feriado existente com fonte='manual' NÃO é tocado", async () => {
  await db.insert(feriado).values({
    id: nanoid(),
    contaId: CONTA_TEST,
    data: "2026-10-12",
    descricao: "Padroeira Nacional",
    fonte: "manual",
  });
  const fetch = fakeFetch(200, [
    { date: "2026-10-12", name: "Nossa Senhora Aparecida", type: "national" },
  ]);
  const r = await runInConta((tx) =>
    sincronizarFeriadosNacionais(tx, CONTA_TEST, 2026, fetch),
  );
  assert.equal(r.inseridos, 0);
  assert.equal(r.pulados, 1);
  assert.equal(r.atualizados, 0);

  // Confirma que continua manual
  const [row] = await db
    .select()
    .from(feriado)
    .where(and(eq(feriado.contaId, CONTA_TEST), eq(feriado.data, "2026-10-12")));
  assert.equal(row.fonte, "manual");
  assert.equal(row.descricao, "Padroeira Nacional");

  await db.delete(feriado).where(eq(feriado.id, row.id));
});

test("Feriado nacional_api com descrição diferente é atualizado", async () => {
  await db.insert(feriado).values({
    id: nanoid(),
    contaId: CONTA_TEST,
    data: "2026-11-15",
    descricao: "Antiga descrição",
    fonte: "nacional_api",
    referenciaExterna: "antiga",
  });
  const fetch = fakeFetch(200, [
    { date: "2026-11-15", name: "Proclamação da República", type: "national" },
  ]);
  const r = await runInConta((tx) =>
    sincronizarFeriadosNacionais(tx, CONTA_TEST, 2026, fetch),
  );
  assert.equal(r.atualizados, 1);
  const [row] = await db
    .select()
    .from(feriado)
    .where(and(eq(feriado.contaId, CONTA_TEST), eq(feriado.data, "2026-11-15")));
  assert.equal(row.descricao, "Proclamação da República");

  await db.delete(feriado).where(eq(feriado.id, row.id));
});

test("Fetch HTTP 503 → throw sync_falhou", async () => {
  const fetch = fakeFetch(503, { error: "down" });
  await assert.rejects(
    () =>
      runInConta((tx) =>
        sincronizarFeriadosNacionais(tx, CONTA_TEST, 2026, fetch),
      ),
    /sync_falhou/,
  );
});

test("Fetch network error → throw sync_falhou", async () => {
  const fetch = fakeFetchThrow();
  await assert.rejects(
    () =>
      runInConta((tx) =>
        sincronizarFeriadosNacionais(tx, CONTA_TEST, 2026, fetch),
      ),
    /sync_falhou/,
  );
});

test("Payload inválido (não-array) → throw sync_falhou", async () => {
  const fetch = fakeFetch(200, { foo: "bar" });
  await assert.rejects(
    () =>
      runInConta((tx) =>
        sincronizarFeriadosNacionais(tx, CONTA_TEST, 2026, fetch),
      ),
    /sync_falhou/,
  );
});
