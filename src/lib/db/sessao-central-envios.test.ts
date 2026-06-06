// Testes da tabela sessao_central_envios (RITM-07).
// Cobre: RLS, unique partial, default status, cascade, encerro, TTL marker.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./index";
import { conta, sessaoCentralEnvios, user } from "./schema";

function matchDbError(pattern: RegExp) {
  return (err: unknown): true => {
    const e = err as { message?: string; cause?: { message?: string } };
    const combined = `${e?.message ?? ""} ${e?.cause?.message ?? ""}`;
    assert.match(combined, pattern);
    return true;
  };
}

const CONTA_A = `sce-A-${nanoid(6)}`;
const CONTA_B = `sce-B-${nanoid(6)}`;
const USER_A = `sce-u-A-${nanoid(6)}`;
const TEST_ROLE = "tenant_test_sce";
const TABELAS = ["sessao_central_envios"];

async function ensureTestRole() {
  const exists = await db.execute(
    sql`SELECT 1 FROM pg_roles WHERE rolname = ${TEST_ROLE}`,
  );
  if (exists.length === 0) {
    await db.execute(
      sql.raw(`CREATE ROLE ${TEST_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS`),
    );
  }
  await db.execute(
    sql.raw(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ${TABELAS.join(", ")} TO ${TEST_ROLE}`,
    ),
  );
  await db.execute(sql.raw(`GRANT USAGE ON SCHEMA public TO ${TEST_ROLE}`));
}

async function runAsTenant<T>(
  contaId: string,
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL ROLE ${TEST_ROLE}`));
    await tx.execute(
      sql`SELECT set_config('app.conta_atual', ${contaId}, true)`,
    );
    const out = await fn(tx);
    await tx.execute(sql`RESET ROLE`);
    return out;
  });
}

before(async () => {
  await ensureTestRole();
  await db
    .insert(conta)
    .values([
      {
        id: CONTA_A,
        nome: "SCE A",
        emailPrincipal: `sce-a-${nanoid(4)}@test.com`,
        plano: "enterprise",
        status: "ativa",
      },
      {
        id: CONTA_B,
        nome: "SCE B",
        emailPrincipal: `sce-b-${nanoid(4)}@test.com`,
        plano: "enterprise",
        status: "ativa",
      },
    ])
    .onConflictDoNothing();
  await db
    .insert(user)
    .values({
      id: USER_A,
      name: "SCE user",
      email: `sce-u-${nanoid(4)}@test.com`,
      emailVerified: true,
    })
    .onConflictDoNothing();
  for (const t of TABELAS) {
    await db.execute(sql.raw(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY`));
  }
});

after(async () => {
  for (const t of TABELAS) {
    await db.execute(sql.raw(`ALTER TABLE ${t} NO FORCE ROW LEVEL SECURITY`));
  }
  await db
    .delete(sessaoCentralEnvios)
    .where(eq(sessaoCentralEnvios.usuarioId, USER_A));
  await db.delete(conta).where(eq(conta.id, CONTA_A));
  await db.delete(conta).where(eq(conta.id, CONTA_B));
  await db.delete(user).where(eq(user.id, USER_A));
});

test("RLS: sessão inserida em A não é visível em B", async () => {
  const sId = nanoid();
  await runAsTenant(CONTA_A, async (tx) => {
    await tx.insert(sessaoCentralEnvios).values({
      id: sId,
      contaId: CONTA_A,
      usuarioId: USER_A,
    });
  });
  const visiveisB = await runAsTenant(CONTA_B, (tx) =>
    tx.select().from(sessaoCentralEnvios),
  );
  assert.equal(visiveisB.filter((s) => s.id === sId).length, 0);
});

test("Unique partial: 2 ativas pro mesmo usuário falham", async () => {
  // Primeiro encerra qualquer ativa anterior
  await db
    .update(sessaoCentralEnvios)
    .set({ status: "encerrada", encerrouEm: new Date() })
    .where(eq(sessaoCentralEnvios.usuarioId, USER_A));

  await db.insert(sessaoCentralEnvios).values({
    id: nanoid(),
    contaId: CONTA_A,
    usuarioId: USER_A,
    status: "ativa",
  });
  await assert.rejects(
    () =>
      db.insert(sessaoCentralEnvios).values({
        id: nanoid(),
        contaId: CONTA_A,
        usuarioId: USER_A,
        status: "ativa",
      }),
    matchDbError(/uq_sessao_ce_ativa_por_usuario/),
  );
});

test("Default: status='ativa', tipoVisualizacao='dashboard'", async () => {
  await db
    .update(sessaoCentralEnvios)
    .set({ status: "encerrada", encerrouEm: new Date() })
    .where(eq(sessaoCentralEnvios.usuarioId, USER_A));
  const id = nanoid();
  await db.insert(sessaoCentralEnvios).values({
    id,
    contaId: CONTA_A,
    usuarioId: USER_A,
  });
  const [row] = await db
    .select()
    .from(sessaoCentralEnvios)
    .where(eq(sessaoCentralEnvios.id, id));
  assert.equal(row.status, "ativa");
  assert.equal(row.tipoVisualizacao, "dashboard");
  assert.deepEqual(row.arquivosIngeridos, []);
  assert.deepEqual(row.estatisticas, {});
});

test("Encerro: status='encerrada' + motivo + encerrouEm", async () => {
  const id = nanoid();
  // Encerra a anterior pra abrir slot
  await db
    .update(sessaoCentralEnvios)
    .set({ status: "encerrada", encerrouEm: new Date() })
    .where(eq(sessaoCentralEnvios.usuarioId, USER_A));
  await db.insert(sessaoCentralEnvios).values({
    id,
    contaId: CONTA_A,
    usuarioId: USER_A,
  });
  await db
    .update(sessaoCentralEnvios)
    .set({
      status: "encerrada",
      encerrouEm: new Date(),
      encerradaMotivo: "finalizada",
    })
    .where(eq(sessaoCentralEnvios.id, id));
  const [row] = await db
    .select()
    .from(sessaoCentralEnvios)
    .where(eq(sessaoCentralEnvios.id, id));
  assert.equal(row.status, "encerrada");
  assert.equal(row.encerradaMotivo, "finalizada");
  assert.ok(row.encerrouEm);
});

test("Enum encerro: motivo inválido rejeita", async () => {
  const id = nanoid();
  await db
    .update(sessaoCentralEnvios)
    .set({ status: "encerrada", encerrouEm: new Date() })
    .where(eq(sessaoCentralEnvios.usuarioId, USER_A));
  await db.insert(sessaoCentralEnvios).values({
    id,
    contaId: CONTA_A,
    usuarioId: USER_A,
  });
  await assert.rejects(
    () =>
      db.execute(sql`
        UPDATE sessao_central_envios
        SET status='encerrada', encerrada_motivo='invalida'
        WHERE id=${id}
      `),
    matchDbError(/invalid input value for enum/),
  );
});

test("Cascade conta → sessões removidas", async () => {
  const tmpContaId = `sce-tmp-${nanoid(6)}`;
  await db.insert(conta).values({
    id: tmpContaId,
    nome: "tmp",
    emailPrincipal: `tmp-${nanoid(4)}@test.com`,
    plano: "enterprise",
    status: "ativa",
  });
  const sId = nanoid();
  await db.insert(sessaoCentralEnvios).values({
    id: sId,
    contaId: tmpContaId,
    usuarioId: USER_A,
    status: "encerrada",
    encerrouEm: new Date(),
  });
  await db.delete(conta).where(eq(conta.id, tmpContaId));
  const rows = await db
    .select()
    .from(sessaoCentralEnvios)
    .where(eq(sessaoCentralEnvios.id, sId));
  assert.equal(rows.length, 0);
});
