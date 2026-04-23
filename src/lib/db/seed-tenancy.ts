import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { conta } from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL não definida. Use dotenv-cli com .env.local ou .env.prod.",
  );
}

const client = postgres(process.env.DATABASE_URL);
const db = drizzle(client);

const CONTA_NWC_ID = "nwc-root";

const TABELAS_OPERACIONAIS = [
  "sku_catalogo",
  "sku_kit_regra",
  "sku_kit_componente",
  "lote_cadastrado",
  "transportadora_padrao",
  "stock_item",
  "contagem_bipagem",
  "contagem_manuseavel",
  "contagem_embalado",
  "coleta_bipagem",
  "coleta_bipagem_pacote",
  "coleta_devolucao",
  "coleta_devolucao_sku",
  "coleta_bipagem_temporaria",
  "alteracao_estoque",
  "produto_avariado",
  "estante",
  "estante_fardo",
  "estante_movimentacao",
  "etiqueta_associacao",
  "textil_lote",
] as const;

async function seedContaNwc() {
  console.log(`\n[1/3] Garantindo conta '${CONTA_NWC_ID}'...`);
  await db
    .insert(conta)
    .values({
      id: CONTA_NWC_ID,
      nome: "NWC",
      emailPrincipal: "admin@nwc.com",
      plano: "enterprise",
      status: "ativa",
    })
    .onConflictDoNothing();
  console.log(`  ✓ Conta '${CONTA_NWC_ID}' pronta.`);
}

async function backfillContaId() {
  console.log(`\n[2/3] Backfill de conta_id em ${TABELAS_OPERACIONAIS.length} tabelas...`);
  let totalAtualizadas = 0;
  for (const tabela of TABELAS_OPERACIONAIS) {
    const result = await db.execute(
      sql.raw(
        `UPDATE "${tabela}" SET conta_id = '${CONTA_NWC_ID}' WHERE conta_id IS NULL`,
      ),
    );
    const count = (result as unknown as { count: number }).count ?? 0;
    totalAtualizadas += count;
    console.log(`  ✓ ${tabela}: ${count} linha(s) atualizada(s)`);
  }
  console.log(`  Total: ${totalAtualizadas} linha(s) backfilled.`);
}

async function verificarNulls() {
  console.log(`\n[3/3] Verificação: conta_id IS NULL em qualquer tabela?`);
  let temNull = false;
  for (const tabela of TABELAS_OPERACIONAIS) {
    const result = await db.execute(
      sql.raw(`SELECT COUNT(*)::int AS n FROM "${tabela}" WHERE conta_id IS NULL`),
    );
    const rows = result as unknown as Array<{ n: number }>;
    const n = rows[0]?.n ?? 0;
    if (n > 0) {
      console.log(`  ✗ ${tabela}: ${n} linha(s) ainda com NULL`);
      temNull = true;
    }
  }
  if (!temNull) {
    console.log(`  ✓ Nenhuma linha com conta_id NULL. Pronto para NOT NULL.`);
  } else {
    throw new Error("Há linhas com conta_id NULL — abortando.");
  }
}

async function main() {
  console.log("=== Seed de tenancy + backfill NWC ===");
  await seedContaNwc();
  await backfillContaId();
  await verificarNulls();
  console.log("\n✅ Concluído.");
  await client.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("❌ Falha:", err);
  await client.end();
  process.exit(1);
});
