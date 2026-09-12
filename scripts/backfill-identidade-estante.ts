// Backfill de `codigo_fardo` e `fardo_uuid` em `estante_fardo`.
//
// As colunas nascem nulas (migration 0037). Este script as preenche a partir
// do `qr_code` já gravado, para que os índices únicos parciais possam ser
// criados em seguida e passem a valer também para o acervo existente.
//
// Ordem obrigatória:
//   1. migration das colunas   (0037)
//   2. auditar-duplicatas-estante.ts --apply   ← remove colisões
//   3. ESTE script
//   4. migration dos índices únicos
//
// Inverter 2 e 3 não quebra nada, mas inverter 3 e 4 sim: o índice único
// recusa nascer sobre dados que já o violam.
//
// Uso:
//   # só relata (padrão)
//   dotenv -e .env.local -- npx tsx scripts/backfill-identidade-estante.ts
//
//   # grava
//   dotenv -e .env.local -- npx tsx scripts/backfill-identidade-estante.ts --apply

import postgres from "postgres";
import { validarQR } from "../src/lib/estante-virtual/fardo-qr";

const APLICAR = process.argv.includes("--apply");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não definida. Use dotenv -e .env.local.");
}

const client = postgres(process.env.DATABASE_URL, {
  ssl: process.env.DATABASE_URL.includes("sslmode=require") ? "require" : false,
});

interface Linha {
  id: string;
  conta_id: string;
  qr_code: string;
  sku: string;
  codigo_fardo: string | null;
  fardo_uuid: string | null;
}

async function main() {
  console.log("=== Backfill de identidade — estante_fardo ===");
  console.log(`Target: ${process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "?"}`);
  console.log(`Modo:   ${APLICAR ? "APLICAR" : "somente leitura"}\n`);

  const linhas = await client<Linha[]>`
    SELECT id, conta_id, qr_code, sku, codigo_fardo, fardo_uuid
    FROM estante_fardo
    ORDER BY created_at ASC
  `;

  const atualizar: Array<{ id: string; codigo: string | null; uuid: string | null }> = [];
  let semIdentidade = 0;
  let foraDoContrato = 0;
  let jaPreenchidos = 0;

  for (const l of linhas) {
    if (l.codigo_fardo !== null || l.fardo_uuid !== null) {
      jaPreenchidos++;
      continue;
    }

    // Régua estrita de propósito: uma etiqueta que a aplicação recusaria hoje
    // não ganha identidade no acervo. Ela nunca poderá ser re-bipada mesmo
    // (a validação barra na entrada), então indexá-la não protegeria nada —
    // e gravaria lixo numa coluna que o índice único vai usar.
    const r = validarQR(l.qr_code);
    if (!r.ok) {
      foraDoContrato++;
      console.log(`  fora do contrato: ${l.id} · ${l.sku} · ${r.motivo}`);
      continue;
    }

    if (r.fardo.codigoFardo === null && r.fardo.fardoUuid === null) {
      semIdentidade++;
      continue;
    }

    atualizar.push({
      id: l.id,
      codigo: r.fardo.codigoFardo,
      uuid: r.fardo.fardoUuid,
    });
  }

  console.log("\n── Resumo ──────────────────────────────────────────");
  console.log(`  total de fardos       : ${linhas.length}`);
  console.log(`  já preenchidos        : ${jaPreenchidos}`);
  console.log(`  a preencher           : ${atualizar.length}`);
  console.log(`  sem identidade (v1)   : ${semIdentidade}  (ficam nulos — correto)`);
  console.log(`  fora do contrato      : ${foraDoContrato}  (ficam nulos — legado)\n`);

  // Conferência prévia: o índice único vai exigir (conta_id, chave) distinto.
  // Melhor descobrir colisão aqui do que na criação do índice.
  const porChave = new Map<string, string[]>();
  for (const a of atualizar) {
    const l = linhas.find((x) => x.id === a.id)!;
    for (const [tipo, val] of [["uuid", a.uuid], ["codigo", a.codigo]] as const) {
      if (!val) continue;
      const k = `${tipo}|${l.conta_id}|${val}`;
      porChave.set(k, [...(porChave.get(k) ?? []), a.id]);
    }
  }
  const colisoes = [...porChave.entries()].filter(([, ids]) => ids.length > 1);
  if (colisoes.length > 0) {
    console.log("── COLISÕES — o índice único vai falhar ────────────");
    for (const [k, ids] of colisoes) console.log(`  ${k} → ${ids.length} linhas`);
    console.log("\n  Rode antes: scripts/auditar-duplicatas-estante.ts --apply");
    await client.end();
    process.exit(1);
  }
  console.log("Sem colisões — seguro criar os índices únicos depois.\n");

  if (!APLICAR) {
    console.log("Nada foi alterado. Rode com --apply para gravar.");
    await client.end();
    return;
  }

  if (atualizar.length === 0) {
    console.log("Nada a preencher.");
    await client.end();
    return;
  }

  const n = await client.begin(async (tx) => {
    let c = 0;
    for (const a of atualizar) {
      const r = await tx`
        UPDATE estante_fardo
        SET codigo_fardo = ${a.codigo}, fardo_uuid = ${a.uuid}
        WHERE id = ${a.id}
      `;
      c += r.count;
    }
    return c;
  });
  console.log(`Atualizadas: ${n} linha(s)`);

  const [stats] = await client<{ com_codigo: string; com_uuid: string; nulos: string }[]>`
    SELECT
      COUNT(*) FILTER (WHERE codigo_fardo IS NOT NULL)::text AS com_codigo,
      COUNT(*) FILTER (WHERE fardo_uuid   IS NOT NULL)::text AS com_uuid,
      COUNT(*) FILTER (WHERE codigo_fardo IS NULL
                         AND fardo_uuid   IS NULL)::text     AS nulos
    FROM estante_fardo
  `;
  console.log(`Com codigo_fardo: ${stats.com_codigo} · com fardo_uuid: ${stats.com_uuid} · sem identidade: ${stats.nulos}`);

  await client.end();
}

main().catch(async (err) => {
  console.error("Falhou:", err);
  await client.end();
  process.exit(1);
});
