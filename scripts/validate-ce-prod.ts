// Validação one-shot do estado do RITM-01 em prod.
// Confere: tabelas, RLS, policies, índices parciais, colunas em
// modelo_principal e linhas do seed.

import postgres from "postgres";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não definida.");
}

const client = postgres(process.env.DATABASE_URL, {
  ssl: process.env.DATABASE_URL.includes("sslmode=require") ? "require" : false,
});

const CE_TABELAS = [
  "tamanho_alias",
  "cor_alias",
  "feriado",
  "canal_regra_prazo",
  "categoria_sku",
];

async function main() {
  console.log("=== Validação RITM-01 Central de Envios — PROD ===");
  console.log(
    `Target: ${process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "?"}\n`,
  );

  // 1. Tabelas existem
  const tabelas = await client<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_name = ANY(${CE_TABELAS as unknown as string[]})
    ORDER BY table_name
  `;
  console.log(`[1] Tabelas (${tabelas.length}/5):`);
  for (const t of tabelas) console.log(`  ✓ ${t.table_name}`);
  if (tabelas.length !== 5) {
    console.error("  ✗ FALTAM TABELAS");
    process.exit(1);
  }

  // 2. RLS habilitado
  const rls = await client<{ relname: string; relrowsecurity: boolean }[]>`
    SELECT relname, relrowsecurity FROM pg_class
    WHERE relname = ANY(${CE_TABELAS as unknown as string[]})
    ORDER BY relname
  `;
  console.log(`\n[2] RLS habilitado:`);
  for (const r of rls) {
    const ok = r.relrowsecurity ? "✓" : "✗";
    console.log(`  ${ok} ${r.relname} → relrowsecurity=${r.relrowsecurity}`);
  }
  if (rls.some((r) => !r.relrowsecurity)) {
    console.error("  ✗ ALGUMA TABELA SEM RLS");
    process.exit(1);
  }

  // 3. Policies tenant_isolation
  const pols = await client<{ tablename: string; polname: string }[]>`
    SELECT c.relname AS tablename, p.polname
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    WHERE c.relname = ANY(${CE_TABELAS as unknown as string[]})
    ORDER BY c.relname
  `;
  console.log(`\n[3] Policies (${pols.length}/5):`);
  for (const p of pols) console.log(`  ✓ ${p.tablename} → ${p.polname}`);

  // 4. Índices parciais
  const idx = await client<{ indexname: string; indexdef: string }[]>`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE schemaname='public' AND tablename='canal_regra_prazo'
    ORDER BY indexname
  `;
  console.log(`\n[4] Índices em canal_regra_prazo:`);
  for (const i of idx) {
    const partial = i.indexdef.includes("WHERE") ? " (parcial)" : "";
    const nulls = i.indexdef.includes("NULLS NOT DISTINCT") ? " [NND]" : "";
    console.log(`  - ${i.indexname}${partial}${nulls}`);
  }

  // 5. NULLS NOT DISTINCT nos aliases
  const aliases = await client<{ indexname: string; indexdef: string }[]>`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE schemaname='public' AND tablename IN ('tamanho_alias','cor_alias')
    ORDER BY indexname
  `;
  console.log(`\n[5] Índices em aliases:`);
  for (const i of aliases) {
    const nnd = i.indexdef.includes("NULLS NOT DISTINCT") ? " [NND]" : "";
    console.log(`  - ${i.indexname}${nnd}`);
  }

  // 6. Colunas novas em modelo_principal
  const cols = await client<{
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
  }[]>`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name='modelo_principal'
      AND column_name IN ('cor_padrao','exige_tamanho','cor_mix_default')
    ORDER BY column_name
  `;
  console.log(`\n[6] Colunas novas em modelo_principal:`);
  for (const c of cols)
    console.log(
      `  ✓ ${c.column_name} ${c.data_type} (nullable=${c.is_nullable}, default=${c.column_default ?? "—"})`,
    );

  // 7. Seed: 3 defaults
  const seed = await client<{
    plataforma: string;
    estrategia: string;
    dias_uteis: number | null;
    campo_prazo: string | null;
    fallback_hoje: boolean;
  }[]>`
    SELECT plataforma, estrategia, dias_uteis, campo_prazo, fallback_hoje
    FROM canal_regra_prazo
    WHERE conta_id='nwc-root' AND canal_venda_id IS NULL
    ORDER BY plataforma
  `;
  console.log(`\n[7] Seed defaults (${seed.length}/3):`);
  for (const s of seed) {
    const desc =
      s.estrategia === "DIAS_UTEIS_POS_VENDA"
        ? `${s.dias_uteis}d`
        : `${s.estrategia} (campo=${s.campo_prazo}, fallbackHoje=${s.fallback_hoje})`;
    console.log(`  ✓ ${s.plataforma.padEnd(15)} → ${desc}`);
  }

  console.log("\n✅ Tudo OK.");
  await client.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("❌ Falha:", err);
  await client.end();
  process.exit(1);
});
