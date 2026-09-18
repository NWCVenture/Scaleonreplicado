// Diagnóstico somente leitura do banco, antes de qualquer mudança da Estante
// Virtual. Imprime só contagens e datas — seguro para log público.
//
// Serve para: (1) confirmar que a conexão é o banco certo, comparando os
// números com o que a aplicação mostra; (2) registrar o estado de RLS e
// policies antes da mudança; (3) ver se a mudança já foi aplicada; (4) ver se
// o prefixo iMile está cadastrado na Coletas.
//
// Uso:
//   dotenv -e .env.local -- npx tsx scripts/diagnostico-producao.ts

import postgres from "postgres";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não definida.");
}

const client = postgres(process.env.DATABASE_URL, {
  ssl: process.env.DATABASE_URL.includes("sslmode=require") ? "require" : false,
});

async function main() {
  const [v] = await client<{ versao: string }[]>`SELECT current_setting('server_version') AS versao`;
  console.log(`=== Diagnóstico do banco (somente leitura) ===`);
  console.log(`Postgres ${v.versao}\n`);

  const [c] = await client<Record<string, string | null>[]>`
    SELECT
      (SELECT count(*) FROM conta)::text                                   AS contas,
      (SELECT count(*) FROM "user")::text                                  AS usuarios,
      (SELECT count(*) FROM estante)::text                                 AS estantes,
      (SELECT count(*) FROM estante_fardo)::text                           AS fardos_na_estante,
      (SELECT coalesce(sum(quantidade), 0) FROM estante_fardo)::text       AS pecas_na_estante,
      (SELECT to_char(max(created_at), 'YYYY-MM-DD') FROM estante_fardo)   AS ultimo_fardo_incluido,
      (SELECT count(*) FROM coleta_bipagem)::text                          AS coletas_finalizadas,
      (SELECT to_char(max(created_at), 'YYYY-MM-DD') FROM coleta_bipagem)  AS ultima_coleta
  `;
  console.log("── Conferência de que é o banco certo ──────────────");
  for (const [k, val] of Object.entries(c)) console.log(`  ${k.padEnd(24)} ${val ?? "—"}`);

  const [s] = await client<Record<string, number>[]>`
    SELECT
      (SELECT count(*) FROM pg_policies WHERE schemaname = 'public')::int AS policies,
      (SELECT count(*) FROM pg_class
        WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace AND relrowsecurity)::int AS tabelas_com_rls,
      (SELECT count(*) FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'estante_fardo'
          AND column_name IN ('codigo_fardo', 'fardo_uuid'))::int AS colunas_novas,
      (SELECT count(*) FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'estante_fardo'
          AND indexname IN ('uq_estante_fardo_uuid_conta', 'uq_estante_fardo_codigo_conta'))::int AS indices_novos
  `;
  console.log("\n── Estado do schema ────────────────────────────────");
  console.log(`  policies                 ${s.policies}`);
  console.log(`  tabelas com RLS          ${s.tabelas_com_rls}`);
  console.log(`  colunas novas (0037)     ${s.colunas_novas}/2`);
  console.log(`  índices novos (0038)     ${s.indices_novos}/2`);

  const prefixos = await client<{ transportadora: string; contas: number; com_3320: number }[]>`
    SELECT transportadora,
           count(*)::int AS contas,
           count(*) FILTER (WHERE prefixos::jsonb ? '3320')::int AS com_3320
    FROM transportadora_padrao
    GROUP BY transportadora
    ORDER BY transportadora
  `;
  console.log("\n── Coletas: prefixos de transportadora ─────────────");
  if (prefixos.length === 0) console.log("  (nenhum cadastrado)");
  for (const p of prefixos) {
    console.log(`  ${p.transportadora.padEnd(12)} contas=${p.contas}  com prefixo 3320=${p.com_3320}`);
  }

  await client.end();
}

main().catch(async (err) => {
  const e = err as { message?: string; code?: string };
  console.error(`Falhou: ${e?.code ?? ""} ${e?.message ?? "erro"}`);
  await client.end();
  process.exit(1);
});
