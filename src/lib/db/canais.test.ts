import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { sql, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./index";
import {
  conta,
  canaisVenda,
  credenciaisOauthTiktok,
} from "./schema";

function matchDbError(pattern: RegExp) {
  return (err: unknown): true => {
    const e = err as { message?: string; cause?: { message?: string } };
    const combined = `${e?.message ?? ""} ${e?.cause?.message ?? ""}`;
    assert.match(combined, pattern);
    return true;
  };
}

const CONTA_A = "canais-test-A";
const CONTA_B = "canais-test-B";
const TEST_ROLE = "tenant_test";

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
      `GRANT SELECT, INSERT, UPDATE, DELETE ON canais_venda, credenciais_oauth_tiktok, eventos_webhook_tiktok, log_sincronizacao_canal, sku_canal TO ${TEST_ROLE}`,
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

  // Cria duas contas de teste
  await db
    .insert(conta)
    .values([
      {
        id: CONTA_A,
        nome: "Canais Test A",
        emailPrincipal: "a@test.com",
        plano: "enterprise",
        status: "ativa",
      },
      {
        id: CONTA_B,
        nome: "Canais Test B",
        emailPrincipal: "b@test.com",
        plano: "enterprise",
        status: "ativa",
      },
    ])
    .onConflictDoNothing();

  // Liga FORCE temporariamente pra RLS valer mesmo pro owner/superuser
  await db.execute(sql`ALTER TABLE canais_venda FORCE ROW LEVEL SECURITY`);
  await db.execute(
    sql`ALTER TABLE credenciais_oauth_tiktok FORCE ROW LEVEL SECURITY`,
  );
});

after(async () => {
  await db.execute(sql`ALTER TABLE canais_venda NO FORCE ROW LEVEL SECURITY`);
  await db.execute(
    sql`ALTER TABLE credenciais_oauth_tiktok NO FORCE ROW LEVEL SECURITY`,
  );
  // Cleanup — cascades deletam canais_venda + credenciais
  await db.delete(conta).where(eq(conta.id, CONTA_A));
  await db.delete(conta).where(eq(conta.id, CONTA_B));
});

test("RLS: canal inserido em conta A não é visível em conta B", async () => {
  const canalAId = nanoid();
  await runAsTenant(CONTA_A, async (tx) => {
    await tx.insert(canaisVenda).values({
      id: canalAId,
      contaId: CONTA_A,
      plataforma: "tiktok_shop",
      identificadorLoja: "shop-A-001",
      nomeExibicao: "Loja A",
    });
  });

  const visiveisB = await runAsTenant(CONTA_B, (tx) =>
    tx.select().from(canaisVenda),
  );
  assert.equal(
    visiveisB.filter((c) => c.contaId === CONTA_A).length,
    0,
    "Canal de A vazou para B",
  );

  const visiveisA = await runAsTenant(CONTA_A, (tx) =>
    tx.select().from(canaisVenda),
  );
  assert.equal(
    visiveisA.filter((c) => c.id === canalAId).length,
    1,
    "Canal de A não aparece em A",
  );
});

test("Unique constraint: (cnpj_id, plataforma, identificador_loja) bloqueia duplicado", async () => {
  const cnpjFake = "cnpj-test-duplicado";

  await db.insert(canaisVenda).values({
    id: nanoid(),
    contaId: CONTA_A,
    cnpjId: cnpjFake,
    plataforma: "tiktok_shop",
    identificadorLoja: "shop-dup-001",
    nomeExibicao: "Original",
  });

  await assert.rejects(
    () =>
      db.insert(canaisVenda).values({
        id: nanoid(),
        contaId: CONTA_A,
        cnpjId: cnpjFake,
        plataforma: "tiktok_shop",
        identificadorLoja: "shop-dup-001",
        nomeExibicao: "Duplicado",
      }),
    matchDbError(/unq_canal_cnpj_loja/),
  );
});

test("Unique constraint: (conta_id, plataforma, identificador_loja) bloqueia duplicado sem cnpj", async () => {
  await db.insert(canaisVenda).values({
    id: nanoid(),
    contaId: CONTA_A,
    plataforma: "shopee",
    identificadorLoja: "shop-conta-001",
    nomeExibicao: "Primeira",
  });

  await assert.rejects(
    () =>
      db.insert(canaisVenda).values({
        id: nanoid(),
        contaId: CONTA_A,
        plataforma: "shopee",
        identificadorLoja: "shop-conta-001",
        nomeExibicao: "Duplicada",
      }),
    matchDbError(/unq_canal_conta_plataforma_loja/),
  );
});

test("ON DELETE CASCADE: deletar canal remove credenciais vinculadas", async () => {
  const canalId = nanoid();
  const credId = nanoid();

  await db.insert(canaisVenda).values({
    id: canalId,
    contaId: CONTA_B,
    plataforma: "tiktok_shop",
    identificadorLoja: "shop-cascade-001",
    nomeExibicao: "Cascade Test",
  });

  await db.insert(credenciaisOauthTiktok).values({
    id: credId,
    canalVendaId: canalId,
    contaId: CONTA_B,
    shopId: "shop-cascade-001",
    shopCipher: "cipher-fake",
    accessTokenCriptografado: "enc-access",
    accessTokenExpiraEm: new Date(Date.now() + 3600_000),
    refreshTokenCriptografado: "enc-refresh",
    refreshTokenExpiraEm: new Date(Date.now() + 86400_000),
    escoposAutorizados: ["user.info.basic"],
  });

  const before = await db
    .select()
    .from(credenciaisOauthTiktok)
    .where(eq(credenciaisOauthTiktok.id, credId));
  assert.equal(before.length, 1);

  await db.delete(canaisVenda).where(eq(canaisVenda.id, canalId));

  const after = await db
    .select()
    .from(credenciaisOauthTiktok)
    .where(eq(credenciaisOauthTiktok.id, credId));
  assert.equal(after.length, 0, "credenciais não cascadeou");
});
