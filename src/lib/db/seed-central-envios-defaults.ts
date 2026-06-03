// Seed mínimo da Central de Envios — RITM-01.
//
// Popula APENAS as 3 regras de prazo default por plataforma
// (canal_venda_id = NULL). Não toca em modelo, cor, tamanho, alias,
// categoria ou feriado — esses são cadastros do tenant, não do código.
//
// As 3 regras representam fatos públicos das plataformas:
//   - TikTok Shop: 2 dias úteis após a venda
//   - Shopee:      1 dia útil após a venda
//   - Mercado Livre: data explícita no campo "Estado" do export XLSX
//
// Mesmo assim, o operador pode editar tudo via UI de configurações
// (RITM-10). Por isso o seed é IDEMPOTENTE e NÃO sobrescreve config
// manual: se a linha já existe (qualquer config), pula. Roda 2× sem
// efeito colateral.
//
// Conta-alvo: via env SEED_CONTA_ID (default 'nwc-root').
//
// Uso:
//   dotenv -e .env.local -- npx tsx src/lib/db/seed-central-envios-defaults.ts
//   dotenv -e .env.prod  -- npx tsx src/lib/db/seed-central-envios-defaults.ts
//   SEED_CONTA_ID=outra-conta dotenv -e .env.local -- npx tsx ...

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { and, eq, isNull } from "drizzle-orm";
import postgres from "postgres";
import { canalRegraPrazo } from "./schema";
import { generateId } from "../utils";

// Aceita tanto `db` global quanto uma transação `tx` — ambos têm a mesma
// shape de query. Drizzle não exporta um tipo "executor" comum, então
// usamos PostgresJsDatabase<any> pra aceitar qualquer schema (o `db`
// real do projeto está tipado com `schema`, e `tx` dentro de
// db.transaction tem o mesmo shape).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Executor = PostgresJsDatabase<any>;

type RegraDefault = {
  plataforma: "tiktok_shop" | "shopee" | "mercado_livre";
  estrategia: "DIAS_UTEIS_POS_VENDA" | "CAMPO_EXPLICITO" | "HIBRIDO";
  diasUteis: number | null;
  campoPrazo: string | null;
  regexPrazo: string | null;
  fallbackHoje: boolean;
};

// As 3 regras representam fatos públicos das plataformas:
//   - TikTok Shop: 2 dias úteis após a venda
//   - Shopee:      1 dia útil após a venda
//   - Mercado Livre: data explícita no campo "Estado" do export XLSX
export const REGRAS_PRAZO_DEFAULT: RegraDefault[] = [
  {
    plataforma: "tiktok_shop",
    estrategia: "DIAS_UTEIS_POS_VENDA",
    diasUteis: 2,
    campoPrazo: null,
    regexPrazo: null,
    fallbackHoje: false,
  },
  {
    plataforma: "shopee",
    estrategia: "DIAS_UTEIS_POS_VENDA",
    diasUteis: 1,
    campoPrazo: null,
    regexPrazo: null,
    fallbackHoje: false,
  },
  {
    plataforma: "mercado_livre",
    estrategia: "CAMPO_EXPLICITO",
    diasUteis: null,
    campoPrazo: "Estado",
    regexPrazo: "coleta do dia (\\d+) de (\\w+)",
    fallbackHoje: true,
  },
];

export type SeedResultado = { inseridos: number; pulados: number };

/**
 * Aplica os defaults de prazo por plataforma na conta indicada.
 * Idempotente: se a default da plataforma (canal_venda_id IS NULL) já
 * existe, NÃO toca — config manual do operador não é sobrescrita.
 *
 * Exportada pra ser usada no seed e nos testes (sem precisar abrir
 * conexão separada).
 */
export async function aplicarRegrasPrazoDefault(
  executor: Executor,
  contaId: string,
  opts: { log?: boolean } = {},
): Promise<SeedResultado> {
  const log = opts.log ?? false;
  let inseridos = 0;
  let pulados = 0;

  for (const regra of REGRAS_PRAZO_DEFAULT) {
    const existente = await executor
      .select({ id: canalRegraPrazo.id })
      .from(canalRegraPrazo)
      .where(
        and(
          eq(canalRegraPrazo.contaId, contaId),
          eq(canalRegraPrazo.plataforma, regra.plataforma),
          isNull(canalRegraPrazo.canalVendaId),
        ),
      )
      .limit(1);

    if (existente.length > 0) {
      if (log) console.log(`  - ${regra.plataforma.padEnd(15)} já existe — pulado`);
      pulados++;
      continue;
    }

    await executor.insert(canalRegraPrazo).values({
      id: generateId(),
      contaId,
      canalVendaId: null,
      plataforma: regra.plataforma,
      estrategia: regra.estrategia,
      diasUteis: regra.diasUteis,
      campoPrazo: regra.campoPrazo,
      regexPrazo: regra.regexPrazo,
      fallbackHoje: regra.fallbackHoje,
      ativo: true,
    });

    if (log) {
      const desc =
        regra.estrategia === "DIAS_UTEIS_POS_VENDA"
          ? `${regra.diasUteis} dia(s) útil(eis)`
          : `${regra.estrategia} (campo='${regra.campoPrazo}')`;
      console.log(`  ✓ ${regra.plataforma.padEnd(15)} inserido — ${desc}`);
    }
    inseridos++;
  }

  return { inseridos, pulados };
}

// Entry point CLI — só roda se executado direto (`tsx ...seed-central-envios-defaults.ts`),
// não quando importado por testes.
async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL não definida. Use dotenv -e .env.local ou .env.prod.",
    );
  }

  const CONTA_ID = process.env.SEED_CONTA_ID ?? "nwc-root";
  const client = postgres(process.env.DATABASE_URL, {
    ssl: process.env.DATABASE_URL.includes("sslmode=require")
      ? "require"
      : false,
  });
  const db = drizzle(client);

  console.log("=== Seed Central de Envios — defaults por plataforma ===");
  console.log(
    `Target: ${process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "?"}`,
  );
  console.log(`\n[Central de Envios] Seed de defaults de prazo`);
  console.log(`  Conta-alvo: ${CONTA_ID}\n`);

  const { inseridos, pulados } = await aplicarRegrasPrazoDefault(
    db,
    CONTA_ID,
    { log: true },
  );

  console.log(`\n  Inseridos: ${inseridos} · Pulados: ${pulados}`);
  console.log("\n✅ Concluído.");
  await client.end();
  process.exit(0);
}

// Detecta execução direta via tsx CLI. Quando importado por testes, isso
// avalia false e o main() não roda.
if (process.argv[1]?.endsWith("seed-central-envios-defaults.ts")) {
  main().catch(async (err) => {
    console.error("❌ Falha:", err);
    process.exit(1);
  });
}
