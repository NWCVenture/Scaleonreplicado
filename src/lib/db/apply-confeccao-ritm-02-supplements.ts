// Aplica os objetos do Módulo Confecção (RITM-02) que NÃO são gerenciados
// pelo Drizzle schema.ts:
//   - Sequence `confeccao_op_sequencial` (CYCLE 0-9999)
//   - CHECK constraints em confeccao_anexo e confeccao_nota
//
// Por que existe: `db:migrate:prod` no projeto usa `drizzle-kit push`, que
// sincroniza o banco com schema.ts mas não suporta sequences nativas nem
// CHECK constraints declarados fora do schema. Em dev, a migration SQL
// (0024_sad_nekra.sql) já cria tudo via `db:migrate:dev` (que usa migrate
// versionado, não push). Em prod, precisamos rodar este script após o push.
//
// Idempotente: usa IF NOT EXISTS / DO blocks com checagem em
// pg_constraint. Pode rodar várias vezes sem efeito colateral.
//
// Uso:
//   dotenv -e .env.prod -- npx tsx src/lib/db/apply-confeccao-ritm-02-supplements.ts
//   dotenv -e .env.local -- npx tsx src/lib/db/apply-confeccao-ritm-02-supplements.ts  (sanity check)

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
  console.log("=== Aplicando supplements do Módulo Confecção (RITM-02) ===");
  console.log(
    `Target: ${process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "?"}`,
  );
  console.log("");

  await client.begin(async (tx) => {
    // 1. Sequence pro número da OP. CREATE SEQUENCE IF NOT EXISTS é
    // suportado a partir do Postgres 9.5+ (todos os ambientes do projeto
    // são bem mais novos).
    await tx.unsafe(
      `CREATE SEQUENCE IF NOT EXISTS "confeccao_op_sequencial" START 1 MINVALUE 0 MAXVALUE 9999 CYCLE`,
    );
    console.log("  ✓ sequence confeccao_op_sequencial");

    // 2. CHECK constraints idempotentes (DROP IF EXISTS antes de ADD).
    const checks: Array<{
      tabela: string;
      nome: string;
      expr: string;
    }> = [
      {
        tabela: "confeccao_anexo",
        nome: "confeccao_anexo_tem_pai",
        expr: `"subtask_id" IS NOT NULL OR "ordem_producao_id" IS NOT NULL OR "lalamove_id" IS NOT NULL`,
      },
      {
        tabela: "confeccao_anexo",
        nome: "confeccao_anexo_tamanho_max_50mb",
        expr: `"tamanho_bytes" <= 52428800`,
      },
      {
        tabela: "confeccao_nota",
        nome: "confeccao_nota_tem_pai",
        expr: `"ordem_producao_id" IS NOT NULL OR "subtask_id" IS NOT NULL`,
      },
    ];

    for (const c of checks) {
      await tx.unsafe(
        `ALTER TABLE "${c.tabela}" DROP CONSTRAINT IF EXISTS "${c.nome}"`,
      );
      await tx.unsafe(
        `ALTER TABLE "${c.tabela}" ADD CONSTRAINT "${c.nome}" CHECK (${c.expr})`,
      );
      console.log(`  ✓ ${c.tabela}.${c.nome}`);
    }
  });

  console.log("");
  console.log("=== Verificação ===");

  const seqs = await client<{ sequence_name: string }[]>`
    SELECT sequence_name FROM information_schema.sequences
    WHERE sequence_name = 'confeccao_op_sequencial'
  `;
  console.log(`Sequence: ${seqs.length === 1 ? "OK" : "AUSENTE"}`);

  const checks = await client<{ conname: string }[]>`
    SELECT conname FROM pg_constraint
    WHERE conname IN (
      'confeccao_anexo_tem_pai',
      'confeccao_anexo_tamanho_max_50mb',
      'confeccao_nota_tem_pai'
    )
    ORDER BY conname
  `;
  console.log(`CHECK constraints: ${checks.length}/3`);
  for (const c of checks) console.log(`  - ${c.conname}`);

  await client.end();
}

main().catch(async (err) => {
  console.error("Falhou:", err);
  await client.end();
  process.exit(1);
});
