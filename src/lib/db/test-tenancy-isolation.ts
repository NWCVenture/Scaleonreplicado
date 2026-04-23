import { eq, and, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./index";
import {
  conta,
  usuarioConta,
  user,
  skuCatalogo,
  stockItem,
} from "./schema";

const CONTA_NWC = "nwc-root";
const CONTA_AVZ = "avz-root";
const TEST_ROLE = "tenant_test";

/**
 * Versão do withConta que adicionalmente faz SET LOCAL ROLE para um role
 * NÃO-superuser. No Docker local conectamos como `postgres` (superuser), que
 * bypassa RLS por design — em prod o app usa um role dedicado sem BYPASSRLS.
 * Este wrapper simula esse cenário.
 */
async function withContaAsTenantRole<T>(
  contaId: string,
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL ROLE ${TEST_ROLE}`));
    await tx.execute(sql`SELECT set_config('app.conta_atual', ${contaId}, true)`);
    const out = await fn(tx);
    await tx.execute(sql`RESET ROLE`);
    return out;
  });
}

async function ensureTestRole() {
  console.log(`\n=== SETUP: garantindo role ${TEST_ROLE} (não-superuser) ===`);
  const exists = await db.execute(
    sql`SELECT 1 FROM pg_roles WHERE rolname = ${TEST_ROLE}`,
  );
  if (exists.length === 0) {
    await db.execute(sql.raw(`CREATE ROLE ${TEST_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS`));
    console.log(`  ★ role ${TEST_ROLE} criado.`);
  } else {
    console.log(`  = role ${TEST_ROLE} já existe.`);
  }
  // Garantir grants nas tabelas operacionais usadas no teste
  await db.execute(
    sql.raw(`GRANT SELECT, INSERT, UPDATE, DELETE ON sku_catalogo, stock_item TO ${TEST_ROLE}`),
  );
  await db.execute(
    sql.raw(`GRANT USAGE ON SCHEMA public TO ${TEST_ROLE}`),
  );
}

type TestResult = { name: string; passed: boolean; detail: string };
const results: TestResult[] = [];

function assert(name: string, cond: boolean, detail: string) {
  results.push({ name, passed: cond, detail });
  console.log(`${cond ? "✓" : "✗"} ${name} — ${detail}`);
}

async function setupAvz() {
  console.log("\n=== SETUP: criando conta AVZ (vazia) ===");

  await db
    .insert(conta)
    .values({
      id: CONTA_AVZ,
      nome: "AVZ",
      emailPrincipal: "admin@avz.com",
      plano: "enterprise",
      status: "ativa",
    })
    .onConflictDoNothing();

  const skuAvz = await db
    .select()
    .from(skuCatalogo)
    .where(
      and(eq(skuCatalogo.contaId, CONTA_AVZ), eq(skuCatalogo.codigo, "AVZ-TESTE-001")),
    )
    .limit(1);

  if (skuAvz.length === 0) {
    await db.insert(skuCatalogo).values({
      id: nanoid(),
      codigo: "AVZ-TESTE-001",
      contaId: CONTA_AVZ,
    });
  }

  const stockAvz = await db
    .select()
    .from(stockItem)
    .where(
      and(eq(stockItem.contaId, CONTA_AVZ), eq(stockItem.sku, "AVZ-TESTE-001")),
    )
    .limit(1);

  if (stockAvz.length === 0) {
    await db.insert(stockItem).values({
      id: nanoid(),
      sku: "AVZ-TESTE-001",
      lote: "AVZ-LOTE-1",
      quantidade: 42,
      codigoFardo: "AVZ-FARDO-TEST-001",
      contaId: CONTA_AVZ,
    });
  }

  console.log("  Conta AVZ pronta com 1 SKU + 1 stockItem de teste.");
}

async function diagRlsState(label: string) {
  const rows = await db.execute(sql`
    SELECT relname, relrowsecurity, relforcerowsecurity
    FROM pg_class
    WHERE relname IN ('sku_catalogo', 'stock_item')
    ORDER BY relname
  `);
  console.log(`  [diag ${label}] pg_class:`, JSON.stringify(rows));

  const role = await db.execute(sql`SELECT current_user, session_user`);
  console.log(`  [diag ${label}] role:`, JSON.stringify(role));
}

async function testIsolation() {
  console.log("\n=== TESTES DE ISOLAMENTO (withConta) ===");

  const allSkus = await db.select().from(skuCatalogo);
  const skusNwc = allSkus.filter((s) => s.contaId === CONTA_NWC);
  const skusAvz = allSkus.filter((s) => s.contaId === CONTA_AVZ);
  assert(
    "Sem withConta, owner vê tudo (bypass RLS)",
    skusNwc.length > 0 && skusAvz.length > 0,
    `NWC=${skusNwc.length} SKUs, AVZ=${skusAvz.length} SKUs`,
  );

  await diagRlsState("antes do FORCE");

  console.log("  (Ligando FORCE temporariamente em sku_catalogo + stock_item…)");
  await db.execute(sql`ALTER TABLE sku_catalogo FORCE ROW LEVEL SECURITY`);
  await db.execute(sql`ALTER TABLE stock_item FORCE ROW LEVEL SECURITY`);

  await diagRlsState("depois do FORCE");

  // Diagnóstico: dentro de withContaAsTenantRole(NWC), checa GUC + role + count
  const diagInside = await withContaAsTenantRole(CONTA_NWC, async (tx) => {
    const guc = await tx.execute(
      sql`SELECT current_setting('app.conta_atual', true) AS guc, current_user AS who`,
    );
    const rows = await tx.select().from(skuCatalogo);
    return { guc, rows };
  });
  console.log("  [diag dentro de withContaAsTenantRole(NWC)]");
  console.log("    GUC:", JSON.stringify(diagInside.guc));
  console.log(`    rows retornadas: ${diagInside.rows.length}`);

  const nwcSkus = diagInside.rows;
  const vazamento = nwcSkus.filter((s) => s.contaId !== CONTA_NWC);
  assert(
    "withConta(NWC) + role tenant filtra para NWC",
    vazamento.length === 0 && nwcSkus.length > 0,
    `${nwcSkus.length} SKUs, ${vazamento.length} vazamentos`,
  );

  const avzSkus = await withContaAsTenantRole(CONTA_AVZ, async (tx) => {
    return tx.select().from(skuCatalogo);
  });
  const avzVaz = avzSkus.filter((s) => s.contaId !== CONTA_AVZ);
  assert(
    "withConta(AVZ) + role tenant filtra para AVZ",
    avzVaz.length === 0 && avzSkus.length > 0,
    `${avzSkus.length} SKUs, ${avzVaz.length} vazamentos`,
  );

  const nwcStock = await withContaAsTenantRole(CONTA_NWC, async (tx) =>
    tx.select().from(stockItem),
  );
  const avzStock = await withContaAsTenantRole(CONTA_AVZ, async (tx) =>
    tx.select().from(stockItem),
  );
  const nwcStockVaz = nwcStock.filter((s) => s.contaId !== CONTA_NWC);
  const avzStockVaz = avzStock.filter((s) => s.contaId !== CONTA_AVZ);
  assert(
    "stock_item isolado por conta",
    nwcStockVaz.length === 0 && avzStockVaz.length === 0,
    `NWC=${nwcStock.length} (${nwcStockVaz.length} vaz), AVZ=${avzStock.length} (${avzStockVaz.length} vaz)`,
  );

  const insertResult = await withContaAsTenantRole(CONTA_AVZ, async (tx) => {
    const id = nanoid();
    await tx.execute(
      sql`INSERT INTO sku_catalogo (id, codigo, conta_id) VALUES (${id}, ${"AVZ-INSERT-" + Date.now()}, ${CONTA_AVZ})`,
    );
    return id;
  });

  await db.execute(sql`ALTER TABLE sku_catalogo NO FORCE ROW LEVEL SECURITY`);
  await db.execute(sql`ALTER TABLE stock_item NO FORCE ROW LEVEL SECURITY`);

  const inserted = await db
    .select()
    .from(skuCatalogo)
    .where(eq(skuCatalogo.id, insertResult))
    .limit(1);
  assert(
    "INSERT com conta_id AVZ cria linha correta",
    inserted.length === 1 && inserted[0].contaId === CONTA_AVZ,
    `id=${insertResult.slice(0, 8)}..., conta_id=${inserted[0]?.contaId}`,
  );

  await db.delete(skuCatalogo).where(eq(skuCatalogo.id, insertResult));
  console.log("  (FORCE desligado novamente — estado pré-teste restaurado.)");
}

async function testContaIsolamentoUsuarios() {
  console.log("\n=== TESTE DE VÍNCULO DE USUÁRIOS ===");

  const vinculosNwc = await db
    .select()
    .from(usuarioConta)
    .where(eq(usuarioConta.contaId, CONTA_NWC));

  const vinculosAvz = await db
    .select()
    .from(usuarioConta)
    .where(eq(usuarioConta.contaId, CONTA_AVZ));

  assert(
    "Vínculos usuario_conta — NWC com usuários, AVZ pode ou não ter",
    vinculosNwc.length > 0,
    `NWC=${vinculosNwc.length} vínculos, AVZ=${vinculosAvz.length} vínculos`,
  );

  const firstUser = await db.select().from(user).limit(1);
  if (firstUser.length > 0) {
    const jaVinculado = await db
      .select()
      .from(usuarioConta)
      .where(
        and(
          eq(usuarioConta.usuarioId, firstUser[0].id),
          eq(usuarioConta.contaId, CONTA_AVZ),
        ),
      )
      .limit(1);

    if (jaVinculado.length === 0) {
      await db.insert(usuarioConta).values({
        id: nanoid(),
        usuarioId: firstUser[0].id,
        contaId: CONTA_AVZ,
        papel: "admin",
        aceitoEm: new Date(),
        ativo: true,
      });
      console.log(
        `  ★ ${firstUser[0].email} agora tem acesso a ambas NWC + AVZ (para testar o seletor UI).`,
      );
    } else {
      console.log(`  = ${firstUser[0].email} já tem acesso a ambas contas.`);
    }
  }
}

async function main() {
  console.log("=== TESTE DE ACEITE — MULTI-TENANCY ONDA 1 ===");
  await ensureTestRole();
  await setupAvz();
  await testIsolation();
  await testContaIsolamentoUsuarios();

  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  console.log(`\n=== RESUMO: ${passed}/${total} testes passaram ===`);

  if (passed !== total) {
    console.log("\nFalhas:");
    results
      .filter((r) => !r.passed)
      .forEach((r) => console.log(`  ✗ ${r.name}: ${r.detail}`));
    process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Erro fatal:", err);
  process.exit(1);
});
