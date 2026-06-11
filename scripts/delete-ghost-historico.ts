// One-shot: deleta o registro fantasma `a53d4dc3-...` do historico de
// expedição diária. tracking_id_impresso tem ON DELETE CASCADE — vai junto.
//
// Uso:
//   dotenv -e .env.prod -- npx tsx scripts/delete-ghost-historico.ts

import postgres from "postgres";

const GHOST_ID = "a53d4dc3-4629-4331-83d0-f1bf14bc4735";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não definida. Use dotenv -e .env.prod.");
}

const client = postgres(process.env.DATABASE_URL, {
  ssl: process.env.DATABASE_URL.includes("sslmode=require") ? "require" : false,
});

async function main() {
  console.log(`Target: ${process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "?"}`);

  const beforeTracking = await client<{ n: string }[]>`
    SELECT COUNT(*)::text AS n FROM tracking_id_impresso WHERE historico_id = ${GHOST_ID}
  `;
  const beforeHistorico = await client<{ n: string }[]>`
    SELECT COUNT(*)::text AS n FROM historico_impressao_etiquetas WHERE id = ${GHOST_ID}
  `;
  console.log(`Antes: ${beforeHistorico[0].n} historico, ${beforeTracking[0].n} trackings`);

  await client.begin(async (tx) => {
    // CASCADE deveria limpar tracking_id_impresso, mas faço explícito pra log.
    const delTracking = await tx`
      DELETE FROM tracking_id_impresso WHERE historico_id = ${GHOST_ID}
    `;
    console.log(`  ✓ DELETE tracking_id_impresso: ${delTracking.count} row(s)`);

    const delHistorico = await tx`
      DELETE FROM historico_impressao_etiquetas WHERE id = ${GHOST_ID}
    `;
    console.log(`  ✓ DELETE historico_impressao_etiquetas: ${delHistorico.count} row(s)`);
  });

  const afterTracking = await client<{ n: string }[]>`
    SELECT COUNT(*)::text AS n FROM tracking_id_impresso WHERE historico_id = ${GHOST_ID}
  `;
  const afterHistorico = await client<{ n: string }[]>`
    SELECT COUNT(*)::text AS n FROM historico_impressao_etiquetas WHERE id = ${GHOST_ID}
  `;
  console.log(`Depois: ${afterHistorico[0].n} historico, ${afterTracking[0].n} trackings`);

  await client.end();
}

main().catch(async (err) => {
  console.error("Falhou:", err);
  await client.end();
  process.exit(1);
});
