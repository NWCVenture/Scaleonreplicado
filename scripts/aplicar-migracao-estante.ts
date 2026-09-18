// Aplica em produção a mudança de schema da catraca da Estante Virtual —
// o SQL das migrations 0037 e 0038 — sem `drizzle-kit push`.
//
// Por que não o push: `db:migrate:prod` usa `drizzle-kit push`, que remove
// objetos não declarados no schema.ts (ver AGENTS.md). Esta mudança é só
// aditiva — duas colunas e dois índices —, então aplicamos exatamente isso e
// conferimos que nada mais no banco mudou.
//
// Duas fases, porque entre elas roda o preenchimento da identidade:
//   --fase=colunas   ADD COLUMN codigo_fardo, fardo_uuid        (migration 0037)
//   --fase=indices   CREATE UNIQUE INDEX parciais por conta      (migration 0038)
//
// Idempotente: pode rodar de novo sem efeito. Seguro com a aplicação antiga no
// ar — ela não escreve nas colunas novas (ficam nulas) e os índices parciais
// ignoram nulos.
//
// Uso:
//   dotenv -e .env.local -- npx tsx scripts/aplicar-migracao-estante.ts --fase=colunas

import postgres from "postgres";

const FASE = process.argv.find((a) => a.startsWith("--fase="))?.split("=")[1];
if (FASE !== "colunas" && FASE !== "indices") {
  throw new Error("Informe --fase=colunas ou --fase=indices");
}
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não definida.");
}

const client = postgres(process.env.DATABASE_URL, {
  ssl: process.env.DATABASE_URL.includes("sslmode=require") ? "require" : false,
});

interface Retrato {
  policies: number;
  tabelas_rls: number;
  colunas_total: number;
  indices_total: number;
  colunas_novas: number;
  indices_novos: number;
}

async function retrato(): Promise<Retrato> {
  const [r] = await client<Retrato[]>`
    SELECT
      (SELECT count(*) FROM pg_policies WHERE schemaname = 'public')::int AS policies,
      (SELECT count(*) FROM pg_class
        WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace AND relrowsecurity)::int AS tabelas_rls,
      (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public')::int AS colunas_total,
      (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public')::int AS indices_total,
      (SELECT count(*) FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'estante_fardo'
          AND column_name IN ('codigo_fardo', 'fardo_uuid'))::int AS colunas_novas,
      (SELECT count(*) FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'estante_fardo'
          AND indexname IN ('uq_estante_fardo_uuid_conta', 'uq_estante_fardo_codigo_conta'))::int AS indices_novos
  `;
  return r;
}

function imprimir(rotulo: string, r: Retrato) {
  console.log(
    `${rotulo}: policies=${r.policies} tabelas_rls=${r.tabelas_rls} ` +
      `colunas_novas=${r.colunas_novas}/2 indices_novos=${r.indices_novos}/2`,
  );
}

async function main() {
  console.log(`=== Migração da Estante Virtual — fase ${FASE} ===`);
  const antes = await retrato();
  imprimir("antes ", antes);

  await client.begin(async (tx) => {
    // Não ficar preso atrás de uma transação longa da aplicação.
    await tx`SET LOCAL lock_timeout = '10s'`;
    await tx`SET LOCAL statement_timeout = '120s'`;

    if (FASE === "colunas") {
      await tx`ALTER TABLE estante_fardo ADD COLUMN IF NOT EXISTS codigo_fardo text`;
      await tx`ALTER TABLE estante_fardo ADD COLUMN IF NOT EXISTS fardo_uuid text`;
    } else {
      await tx`CREATE UNIQUE INDEX IF NOT EXISTS uq_estante_fardo_uuid_conta
               ON estante_fardo USING btree (conta_id, fardo_uuid)
               WHERE fardo_uuid IS NOT NULL`;
      await tx`CREATE UNIQUE INDEX IF NOT EXISTS uq_estante_fardo_codigo_conta
               ON estante_fardo USING btree (conta_id, codigo_fardo)
               WHERE codigo_fardo IS NOT NULL`;
    }
  });

  const depois = await retrato();
  imprimir("depois", depois);

  // Nada além do pretendido pode ter mudado. RLS e policies intocados; o total
  // de colunas/índices só pode crescer exatamente pelo que esta fase criou.
  const erros: string[] = [];
  if (depois.policies !== antes.policies) erros.push("policies mudaram");
  if (depois.tabelas_rls !== antes.tabelas_rls) erros.push("RLS mudou");
  if (depois.colunas_total - antes.colunas_total !== depois.colunas_novas - antes.colunas_novas) {
    erros.push("colunas inesperadas mudaram");
  }
  if (depois.indices_total - antes.indices_total !== depois.indices_novos - antes.indices_novos) {
    erros.push("índices inesperados mudaram");
  }
  if (FASE === "colunas" && depois.colunas_novas !== 2) erros.push("colunas não criadas");
  if (FASE === "indices" && depois.indices_novos !== 2) erros.push("índices não criados");

  if (erros.length > 0) {
    console.error(`FALHA na conferência: ${erros.join(", ")}`);
    await client.end();
    process.exit(1);
  }
  console.log("Conferência OK: só o pretendido mudou; RLS e policies intactos.");
  await client.end();
}

main().catch(async (err) => {
  console.error("Falhou:", err instanceof Error ? err.message : err);
  await client.end();
  process.exit(1);
});
