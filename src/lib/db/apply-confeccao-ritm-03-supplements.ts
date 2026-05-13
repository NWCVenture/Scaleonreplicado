// Aplica objetos da RITM-03 (Lalamove + retiradas + subconferências) que
// não são gerenciados pelo Drizzle schema.ts:
//   - CHECK constraints em confeccao_lalamove
//   - Índices parciais (WHERE) em confeccao_lalamove e webhook/cotacao
//
// Drizzle push em prod cria índices completos e não suporta CHECK. Este
// script é idempotente — pode rodar várias vezes sem efeito colateral.
//
// Uso:
//   dotenv -e .env.prod -- npx tsx src/lib/db/apply-confeccao-ritm-03-supplements.ts
//   dotenv -e .env.local -- npx tsx src/lib/db/apply-confeccao-ritm-03-supplements.ts  (sanity check)

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
  console.log("=== Aplicando supplements da RITM-03 (Lalamove) ===");
  console.log(
    `Target: ${process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "?"}`,
  );
  console.log("");

  await client.begin(async (tx) => {
    // ----------------------------------------------------------------
    // 1. CHECK constraints em confeccao_lalamove
    // ----------------------------------------------------------------
    const checks: Array<{ tabela: string; nome: string; expr: string }> = [
      {
        tabela: "confeccao_lalamove",
        nome: "confeccao_lalamove_tem_pai",
        expr: `"subtask_id" IS NOT NULL OR "retirada_id" IS NOT NULL`,
      },
      {
        tabela: "confeccao_lalamove",
        nome: "confeccao_lalamove_api_completo",
        expr: `origem_solicitacao = 'manual' OR status IN ('rascunho', 'cotado') OR (order_id_api IS NOT NULL AND service_type IS NOT NULL)`,
      },
    ];

    for (const c of checks) {
      await tx.unsafe(
        `ALTER TABLE "${c.tabela}" DROP CONSTRAINT IF EXISTS "${c.nome}"`,
      );
      await tx.unsafe(
        `ALTER TABLE "${c.tabela}" ADD CONSTRAINT "${c.nome}" CHECK (${c.expr})`,
      );
      console.log(`  ✓ CHECK ${c.tabela}.${c.nome}`);
    }

    // ----------------------------------------------------------------
    // 2. Índices parciais — drop full, create partial
    // ----------------------------------------------------------------
    const indices: Array<{
      tabela: string;
      nome: string;
      colunas: string;
      where: string;
    }> = [
      {
        tabela: "confeccao_lalamove",
        nome: "idx_confeccao_lalamove_order_id_api",
        colunas: `"order_id_api"`,
        where: `"order_id_api" IS NOT NULL`,
      },
      {
        tabela: "confeccao_lalamove",
        nome: "idx_confeccao_lalamove_procura_alta",
        colunas: `"status","data_solicitacao"`,
        where: `"status" = 'procurando_motorista'`,
      },
      {
        tabela: "confeccao_lalamove_cotacao",
        nome: "idx_confeccao_lalamove_cotacao_validas",
        colunas: `"lalamove_id","expira_em"`,
        where: `"status" = 'valida'`,
      },
      {
        tabela: "confeccao_lalamove_webhook_event",
        nome: "idx_confeccao_lalamove_webhook_nao_processados",
        colunas: `"recebido_em"`,
        where: `"processado" = false`,
      },
    ];

    for (const i of indices) {
      await tx.unsafe(`DROP INDEX IF EXISTS "${i.nome}"`);
      await tx.unsafe(
        `CREATE INDEX "${i.nome}" ON "${i.tabela}" USING btree (${i.colunas}) WHERE ${i.where}`,
      );
      console.log(`  ✓ INDEX parcial ${i.nome}`);
    }
  });

  console.log("");
  console.log("=== Verificação ===");

  const checks = await client<{ conname: string }[]>`
    SELECT conname FROM pg_constraint
    WHERE conname IN (
      'confeccao_lalamove_tem_pai',
      'confeccao_lalamove_api_completo'
    )
    ORDER BY conname
  `;
  console.log(`CHECK constraints: ${checks.length}/2`);
  for (const c of checks) console.log(`  - ${c.conname}`);

  const partials = await client<{ indexname: string; indexdef: string }[]>`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE indexname IN (
      'idx_confeccao_lalamove_order_id_api',
      'idx_confeccao_lalamove_procura_alta',
      'idx_confeccao_lalamove_cotacao_validas',
      'idx_confeccao_lalamove_webhook_nao_processados'
    )
    AND indexdef LIKE '%WHERE%'
    ORDER BY indexname
  `;
  console.log(`Índices parciais (com WHERE): ${partials.length}/4`);
  for (const p of partials) console.log(`  - ${p.indexname}`);

  await client.end();
}

main().catch(async (err) => {
  console.error("Falhou:", err);
  await client.end();
  process.exit(1);
});
