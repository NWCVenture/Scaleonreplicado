// Testes da tabela ingestao_run (Central de Envios — RITM-02).
// Cobre RLS, NOT NULL, enums, cascade, índice parcial.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { sql, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./index";
import { conta, ingestaoRun, user } from "./schema";

function matchDbError(pattern: RegExp) {
  return (err: unknown): true => {
    const e = err as { message?: string; cause?: { message?: string } };
    const combined = `${e?.message ?? ""} ${e?.cause?.message ?? ""}`;
    assert.match(combined, pattern);
    return true;
  };
}

const CONTA_A = "ir-test-A";
const CONTA_B = "ir-test-B";
const USER_A = "ir-test-user-A";
const TEST_ROLE = "tenant_test_ir";

const IR_TABLES = ["ingestao_run"];

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
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ${IR_TABLES.join(", ")} TO ${TEST_ROLE}`,
    ),
  );
  await db.execute(sql.raw(`GRANT USAGE ON SCHEMA public TO ${TEST_ROLE}`));
}

async function runAsTenant<T>(
  contaId: string,
  fn: (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  ) => Promise<T>,
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
        nome: "IR Test A",
        emailPrincipal: "ir-a@test.com",
        plano: "enterprise",
        status: "ativa",
      },
      {
        id: CONTA_B,
        nome: "IR Test B",
        emailPrincipal: "ir-b@test.com",
        plano: "enterprise",
        status: "ativa",
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(user)
    .values({
      id: USER_A,
      name: "IR Test User A",
      email: "ir-user-a@test.com",
      emailVerified: true,
    })
    .onConflictDoNothing();

  for (const t of IR_TABLES) {
    await db.execute(sql.raw(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY`));
  }
});

after(async () => {
  for (const t of IR_TABLES) {
    await db.execute(sql.raw(`ALTER TABLE ${t} NO FORCE ROW LEVEL SECURITY`));
  }
  // Cascade da conta limpa ingestao_run. user fica órfão por ON DELETE
  // restrict — então DELETE manual de runs primeiro.
  await db.delete(ingestaoRun).where(eq(ingestaoRun.usuarioId, USER_A));
  await db.delete(conta).where(eq(conta.id, CONTA_A));
  await db.delete(conta).where(eq(conta.id, CONTA_B));
  await db.delete(user).where(eq(user.id, USER_A));
});

// 1 — RLS por conta_id
test("RLS: ingestao_run inserido em A não é visível em B", async () => {
  const runId = nanoid();
  await runAsTenant(CONTA_A, async (tx) => {
    await tx.insert(ingestaoRun).values({
      id: runId,
      contaId: CONTA_A,
      usuarioId: USER_A,
      tipo: "tiktok_csv",
      arquivoNome: "test.csv",
      arquivoBlobUrl: "https://example.com/test.csv",
      arquivoTamanhoBytes: 100,
    });
  });

  const visiveisB = await runAsTenant(CONTA_B, (tx) =>
    tx.select().from(ingestaoRun),
  );
  assert.equal(
    visiveisB.filter((r) => r.id === runId).length,
    0,
    "Run de A vazou pra B",
  );

  const visiveisA = await runAsTenant(CONTA_A, (tx) =>
    tx.select().from(ingestaoRun),
  );
  assert.equal(visiveisA.filter((r) => r.id === runId).length, 1);
});

// 2 — usuario_id NOT NULL
test("NOT NULL: insert sem usuario_id falha", async () => {
  await assert.rejects(
    () =>
      db.execute(sql`
        INSERT INTO ingestao_run (id, conta_id, tipo, arquivo_nome, arquivo_blob_url, arquivo_tamanho_bytes)
        VALUES (${nanoid()}, ${CONTA_A}, 'tiktok_csv', 'x.csv', 'https://x', 1)
      `),
    matchDbError(/usuario_id|null value in column/),
  );
});

// 3 — status default = pendente
test("Default: status sem set vira 'pendente'", async () => {
  const runId = nanoid();
  await db.insert(ingestaoRun).values({
    id: runId,
    contaId: CONTA_A,
    usuarioId: USER_A,
    tipo: "tiktok_csv",
    arquivoNome: "default.csv",
    arquivoBlobUrl: "https://example.com/default.csv",
    arquivoTamanhoBytes: 1,
  });
  const [row] = await db
    .select()
    .from(ingestaoRun)
    .where(eq(ingestaoRun.id, runId));
  assert.equal(row.status, "pendente");
  assert.equal(row.startedAt, null);
  assert.equal(row.finishedAt, null);
  await db.delete(ingestaoRun).where(eq(ingestaoRun.id, runId));
});

// 4 — UPDATE pendente → processando
test("Transição: UPDATE pendente → processando com startedAt", async () => {
  const runId = nanoid();
  await db.insert(ingestaoRun).values({
    id: runId,
    contaId: CONTA_A,
    usuarioId: USER_A,
    tipo: "tiktok_csv",
    arquivoNome: "t.csv",
    arquivoBlobUrl: "https://example.com/t.csv",
    arquivoTamanhoBytes: 1,
  });
  const startedAt = new Date();
  await db
    .update(ingestaoRun)
    .set({ status: "processando", startedAt })
    .where(eq(ingestaoRun.id, runId));
  const [row] = await db
    .select()
    .from(ingestaoRun)
    .where(eq(ingestaoRun.id, runId));
  assert.equal(row.status, "processando");
  assert.ok(row.startedAt);
  await db.delete(ingestaoRun).where(eq(ingestaoRun.id, runId));
});

// 5 — jsonb resultado aceita shape arbitrário
test("jsonb: resultado aceita array de objetos sem validação no banco", async () => {
  const runId = nanoid();
  await db.insert(ingestaoRun).values({
    id: runId,
    contaId: CONTA_A,
    usuarioId: USER_A,
    tipo: "tiktok_csv",
    arquivoNome: "r.csv",
    arquivoBlobUrl: "https://example.com/r.csv",
    arquivoTamanhoBytes: 1,
    status: "concluido",
    totalLinhas: 2,
    linhasValidas: 2,
    linhasDescartadas: 0,
    resultado: [
      { orderId: "1", quantidade: 1 },
      { orderId: "2", quantidade: 5 },
    ] as unknown as Record<string, unknown>,
    descartesResumo: { status_diferente_filtro: 0 },
  });
  const [row] = await db
    .select()
    .from(ingestaoRun)
    .where(eq(ingestaoRun.id, runId));
  assert.ok(Array.isArray(row.resultado));
  assert.equal((row.resultado as { orderId: string }[]).length, 2);
  assert.deepEqual(row.descartesResumo, { status_diferente_filtro: 0 });
  await db.delete(ingestaoRun).where(eq(ingestaoRun.id, runId));
});

// 6 — Cascade do conta
test("Cascade: DELETE conta apaga ingestao_run dessa conta", async () => {
  const tmpContaId = "ir-test-tmp";
  await db.insert(conta).values({
    id: tmpContaId,
    nome: "tmp",
    emailPrincipal: "tmp@test.com",
    plano: "enterprise",
    status: "ativa",
  });
  const runId = nanoid();
  await db.insert(ingestaoRun).values({
    id: runId,
    contaId: tmpContaId,
    usuarioId: USER_A,
    tipo: "tiktok_csv",
    arquivoNome: "c.csv",
    arquivoBlobUrl: "https://example.com/c.csv",
    arquivoTamanhoBytes: 1,
  });
  await db.delete(conta).where(eq(conta.id, tmpContaId));
  const rows = await db
    .select()
    .from(ingestaoRun)
    .where(eq(ingestaoRun.id, runId));
  assert.equal(rows.length, 0);
});

// 7 — Enum status rejeita valor desconhecido
test("Enum: status='processando2' rejeitado pelo Postgres", async () => {
  await assert.rejects(
    () =>
      db.execute(sql`
        INSERT INTO ingestao_run (id, conta_id, usuario_id, tipo, arquivo_nome, arquivo_blob_url, arquivo_tamanho_bytes, status)
        VALUES (${nanoid()}, ${CONTA_A}, ${USER_A}, 'tiktok_csv', 'x.csv', 'https://x', 1, 'processando2')
      `),
    matchDbError(/invalid input value for enum/),
  );
});

// 8 — Índice parcial só indexa pendente/processando
test("Índice parcial idx_ingestao_run_status_ativo cobre só pendente/processando", async () => {
  const def = await db.execute<{ indexdef: string }>(
    sql`SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_ingestao_run_status_ativo'`,
  );
  assert.equal(def.length, 1);
  assert.match(def[0].indexdef, /WHERE.*status.*pendente.*processando/i);
});
