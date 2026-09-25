// Diagnóstico somente leitura de estabilidade do banco, para investigar
// relatos de "não consigo entrar, agora consegui".
//
// Responde a três perguntas:
//   1. O compute do Postgres reiniciou/foi suspenso? (pg_postmaster_start_time)
//   2. Houve erro/conflito/deadlock acumulado? (pg_stat_database)
//   3. Quando cada pessoa entrou de fato, e alguma senha foi trocada?
//      (session / account) — sem escrever e-mail nenhum no log.
//
// Pessoas aparecem só pelos 8 primeiros caracteres do SHA-256 do e-mail.
// Endereços de IP saem com o último octeto mascarado.
//
// Uso:
//   dotenv -e .env.local -- npx tsx scripts/diagnostico-estabilidade.ts

import postgres from "postgres";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não definida.");
}

const client = postgres(process.env.DATABASE_URL, {
  ssl: process.env.DATABASE_URL.includes("sslmode=require") ? "require" : false,
});

// 8 primeiros caracteres do SHA-256 do e-mail em minúsculas.
const APELIDO = `left(encode(sha256(convert_to(lower(u.email), 'UTF8')), 'hex'), 8)`;
// 189.12.34.56 -> 189.12.34.x  (mantém a rede, esconde a máquina)
const IP_MASCARADO = `regexp_replace(s.ip_address, '\.[0-9]+$', '.x')`;

async function main() {
  console.log("=== Estabilidade do banco (somente leitura) ===\n");

  const [up] = await client<Record<string, string>[]>`
    SELECT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')                        AS agora_utc,
           to_char(pg_postmaster_start_time(), 'YYYY-MM-DD HH24:MI:SS')   AS compute_subiu_utc,
           date_trunc('second', now() - pg_postmaster_start_time())::text AS tempo_de_pe
  `;
  console.log("── O compute reiniciou? ────────────────────────────");
  for (const [k, v] of Object.entries(up)) console.log(`  ${k.padEnd(20)} ${v}`);
  console.log("  (tempo de pé curto = compute foi suspenso e religou = cold start)");

  const [db] = await client<Record<string, string | null>[]>`
    SELECT numbackends::text                                              AS conexoes_agora,
           to_char(stats_reset, 'YYYY-MM-DD HH24:MI:SS')                  AS estatisticas_zeradas_em,
           xact_commit::text                                              AS transacoes_ok,
           xact_rollback::text                                            AS transacoes_desfeitas,
           deadlocks::text                                                AS deadlocks,
           conflicts::text                                                AS conflitos,
           blks_read::text                                                AS leituras_em_disco,
           blks_hit::text                                                 AS leituras_em_cache
    FROM pg_stat_database WHERE datname = current_database()
  `;
  console.log("\n── Saúde acumulada do banco ────────────────────────");
  for (const [k, v] of Object.entries(db)) console.log(`  ${k.padEnd(24)} ${v ?? "—"}`);

  const atividade = await client<{ state: string | null; qtd: number }[]>`
    SELECT state, count(*)::int AS qtd FROM pg_stat_activity
    WHERE datname = current_database() GROUP BY state ORDER BY qtd DESC
  `;
  console.log("\n── Conexões agora ──────────────────────────────────");
  for (const a of atividade) console.log(`  ${(a.state ?? "(sem estado)").padEnd(24)} ${a.qtd}`);

  const sessoes = await client<Record<string, string | null>[]>`
    SELECT ${client.unsafe(APELIDO)}                                        AS pessoa,
           to_char(s.created_at, 'DD/MM HH24:MI')                           AS entrou_em_utc,
           to_char(s.updated_at, 'DD/MM HH24:MI')                           AS ultimo_uso_utc,
           to_char(s.expires_at, 'DD/MM HH24:MI')                           AS expira_em_utc,
           (s.expires_at > now())::text                                     AS ativa,
           coalesce(${client.unsafe(IP_MASCARADO)}, '—')                    AS ip,
           left(coalesce(s.user_agent, '—'), 28)                            AS dispositivo
    FROM session s JOIN "user" u ON u.id = s.user_id
    WHERE s.created_at > now() - interval '7 days'
    ORDER BY s.created_at DESC
    LIMIT 40
  `;
  console.log("\n── Entradas dos últimos 7 dias ─────────────────────");
  if (sessoes.length === 0) {
    console.log("  (nenhuma sessão criada nos últimos 7 dias)");
  } else {
    console.log("  pessoa    entrou       último uso   expira       ativa  ip");
    for (const s of sessoes) {
      console.log(
        `  ${s.pessoa}  ${s.entrou_em_utc}  ${s.ultimo_uso_utc}  ${s.expira_em_utc}  ` +
          `${(s.ativa === "true" ? "sim" : "não").padEnd(5)}  ${s.ip}`,
      );
    }
  }

  const senhas = await client<Record<string, string | null>[]>`
    SELECT ${client.unsafe(APELIDO)}                          AS pessoa,
           to_char(a.created_at, 'DD/MM/YYYY HH24:MI')         AS credencial_criada,
           to_char(a.updated_at, 'DD/MM/YYYY HH24:MI')         AS credencial_alterada,
           (a.updated_at > a.created_at + interval '1 minute')::text AS senha_ja_trocada
    FROM account a JOIN "user" u ON u.id = a.user_id
    WHERE a.provider_id = 'credential'
    ORDER BY a.updated_at DESC
    LIMIT 8
  `;
  console.log("\n── Senhas alteradas mais recentemente ──────────────");
  for (const s of senhas) {
    console.log(
      `  ${s.pessoa}  criada ${s.credencial_criada}  alterada ${s.credencial_alterada}  ` +
        `trocou=${s.senha_ja_trocada === "true" ? "sim" : "não"}`,
    );
  }

  await client.end();
}

main().catch(async (err) => {
  const e = err as { message?: string; code?: string };
  console.error(`Falhou: ${e?.code ?? ""} ${e?.message ?? "erro"}`);
  await client.end();
  process.exit(1);
});
