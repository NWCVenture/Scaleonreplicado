// Aplica as 2 colunas do export Upseller direto via ALTER TABLE IF NOT EXISTS.
//
// Por que existe: `drizzle-kit push` em prod tem o risco documentado em
// AGENTS.md de dropar RLS/policies/sequences que vivem fora do schema.ts.
// Esse script é cirúrgico — só adiciona o que precisamos e nada mais.
//
// Colunas:
//   - modelo_principal.custo_upseller : real, NULL = sem custo cadastrado.
//   - sku_catalogo.pausado_upseller   : bool, default false, NOT NULL.
//
// Idempotente — pode rodar várias vezes.
//
// Uso:
//   dotenv -e .env.prod -- npx tsx src/lib/db/apply-upseller-cols.ts

import postgres from "postgres";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL não definida. Use dotenv -e .env.prod ou .env.local.",
  );
}

const client = postgres(process.env.DATABASE_URL, {
  ssl: process.env.DATABASE_URL.includes("sslmode=require") ? "require" : false,
});

async function main() {
  console.log("=== Aplicando colunas Upseller ===");
  console.log(
    `Target: ${process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "?"}`,
  );
  console.log("");

  await client.begin(async (tx) => {
    await tx`
      ALTER TABLE "modelo_principal"
        ADD COLUMN IF NOT EXISTS "custo_upseller" real
    `;
    console.log("✓ modelo_principal.custo_upseller (real, nullable)");

    await tx`
      ALTER TABLE "sku_catalogo"
        ADD COLUMN IF NOT EXISTS "pausado_upseller" boolean
          DEFAULT false NOT NULL
    `;
    console.log("✓ sku_catalogo.pausado_upseller (bool, default false)");
  });

  console.log("");
  console.log("Concluído.");
  await client.end();
}

main().catch((err) => {
  console.error("Erro:", err);
  process.exit(1);
});
