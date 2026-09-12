// Auditoria (e limpeza opcional) de fardos duplicados na Estante Virtual.
//
// Contexto: a proteção anti-duplicata da Estante Virtual vive só em código —
// um SELECT seguido de INSERT, em READ COMMITTED. Duas bipagens simultâneas
// passam ambas pela verificação e ambas gravam. Não há UNIQUE em
// `estante_fardo` que impeça.
//
// A correção é criar índices únicos parciais sobre a identidade do fardo
// (campos 4 e 7 do QR). Mas o Postgres se recusa a criar um índice único que
// os dados já violam — então este script vem antes: mede o passivo e, quando
// autorizado, remove as sobras mantendo a linha mais antiga de cada grupo.
//
// Uso:
//   # só relata, não altera nada (padrão)
//   dotenv -e .env.local -- npx tsx scripts/auditar-duplicatas-estante.ts
//
//   # remove as sobras e grava relatório JSON
//   dotenv -e .env.local -- npx tsx scripts/auditar-duplicatas-estante.ts --apply
//
// Em produção, trocar para `.env.prod`. SEMPRE rodar sem --apply primeiro.

import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { parseQRCode } from "../src/lib/estante-utils";
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
  estante_id: string;
  estante_nome: string;
  qr_code: string;
  sku: string;
  lote: string;
  quantidade: number;
  created_at: Date;
}

interface Remocao {
  id: string;
  conta_id: string;
  estante_nome: string;
  sku: string;
  lote: string;
  quantidade: number;
  qr_code: string;
  created_at: string;
  /** Qual chave colidiu e com qual linha — o "por quê" da remoção. */
  colidiu_em: "uuid" | "codigo_fardo";
  chave: string;
  mantido_id: string;
  mantido_created_at: string;
}

function alvo(): string {
  return process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "?";
}

async function main() {
  console.log("=== Auditoria de duplicatas — Estante Virtual ===");
  console.log(`Target: ${alvo()}`);
  console.log(`Modo:   ${APLICAR ? "APLICAR (vai remover)" : "somente leitura"}\n`);

  const linhas = await client<Linha[]>`
    SELECT f.id, f.conta_id, f.estante_id, e.nome AS estante_nome,
           f.qr_code, f.sku, f.lote, f.quantidade, f.created_at
    FROM estante_fardo f
    JOIN estante e ON e.id = f.estante_id
    ORDER BY f.created_at ASC, f.id ASC
  `;
  console.log(`Fardos analisados: ${linhas.length}\n`);

  // Espelha exatamente o que os índices únicos parciais vão impor:
  // unicidade de (conta_id, uuid) e (conta_id, codigo_fardo), ignorando nulos.
  // Varre em ordem cronológica e mantém sempre o primeiro de cada grupo.
  const vistoUuid = new Map<string, Linha>();
  const vistoCodigo = new Map<string, Linha>();
  const remover: Remocao[] = [];
  const naoParseaveis: Linha[] = [];
  const semIdentidade: Linha[] = [];

  for (const l of linhas) {
    // parseQRCode normaliza os três separadores (`}`, `{`, `|`) — por isso
    // não dá pra usar split_part do Postgres, que só conhece um.
    const p = parseQRCode(l.qr_code);
    if (!p) {
      naoParseaveis.push(l);
      continue;
    }

    const uuid = p.uuid?.trim() || null;
    const codigo = p.codigoFardo?.trim() || null;

    if (!uuid && !codigo) {
      semIdentidade.push(l);
      continue;
    }

    const kUuid = uuid ? `${l.conta_id}|${uuid}` : null;
    const kCodigo = codigo ? `${l.conta_id}|${codigo}` : null;

    const colisaoUuid = kUuid ? vistoUuid.get(kUuid) : undefined;
    const colisaoCodigo = kCodigo ? vistoCodigo.get(kCodigo) : undefined;
    const mantido = colisaoUuid ?? colisaoCodigo;

    if (mantido) {
      remover.push({
        id: l.id,
        conta_id: l.conta_id,
        estante_nome: l.estante_nome,
        sku: l.sku,
        lote: l.lote,
        quantidade: l.quantidade,
        qr_code: l.qr_code,
        created_at: l.created_at.toISOString(),
        colidiu_em: colisaoUuid ? "uuid" : "codigo_fardo",
        chave: (colisaoUuid ? uuid : codigo)!,
        mantido_id: mantido.id,
        mantido_created_at: mantido.created_at.toISOString(),
      });
      continue;
    }

    if (kUuid) vistoUuid.set(kUuid, l);
    if (kCodigo) vistoCodigo.set(kCodigo, l);
  }

  // ── Relatório ────────────────────────────────────────────────────
  const pecas = remover.reduce((s, r) => s + r.quantidade, 0);

  console.log("── Resumo ──────────────────────────────────────────");
  console.log(`  deduplicáveis (têm identidade): ${linhas.length - naoParseaveis.length - semIdentidade.length}`);
  console.log(`  sem identidade (v1)           : ${semIdentidade.length}`);
  console.log(`  não parseáveis                : ${naoParseaveis.length}`);
  console.log(`  DUPLICATAS a remover          : ${remover.length}`);
  console.log(`  peças contadas a mais         : ${pecas}\n`);

  if (remover.length > 0) {
    console.log("── Duplicatas ──────────────────────────────────────");
    const porChave = new Map<string, Remocao[]>();
    for (const r of remover) {
      const k = `${r.colidiu_em}=${r.chave}`;
      porChave.set(k, [...(porChave.get(k) ?? []), r]);
    }
    for (const [chave, grupo] of porChave) {
      const g = grupo[0];
      console.log(`  ${chave}`);
      console.log(`     estante: ${g.estante_nome} · ${g.sku} (${g.lote}) · ${g.quantidade} peças`);
      console.log(`     mantém : ${g.mantido_id}  (${g.mantido_created_at})`);
      console.log(`     remove : ${grupo.length} linha(s)`);
    }
    console.log("");
  }

  if (semIdentidade.length > 0) {
    console.log("── Sem identidade (v1) — NÃO são tocadas ───────────");
    console.log("  Etiqueta `SKU}LOTE}QTD` não carrega identificador. Dois fardos");
    console.log("  físicos distintos do mesmo produto/lote/quantidade produzem");
    console.log("  strings idênticas: é impossível distinguir duplicata de estoque");
    console.log("  legítimo. O índice único parcial também vai ignorá-las.");
    for (const l of semIdentidade) {
      console.log(`     ${l.estante_nome} · ${l.sku} (${l.lote}) · ${l.quantidade} peças · ${l.id}`);
    }
    console.log("");
  }

  if (naoParseaveis.length > 0) {
    console.log("── Não parseáveis — NÃO são tocadas ────────────────");
    for (const l of naoParseaveis) {
      console.log(`     ${l.estante_nome} · ${l.id} · ${l.qr_code.length} caracteres`);
    }
    console.log("");
  }

  // Passivo histórico: linhas gravadas antes do RITM-05a, que a validação de
  // hoje recusaria. Não são duplicatas e este script não as toca — mas quem
  // for corrigir SKU/lote precisa saber que existem.
  const foraDoContrato = linhas.filter((l) => !validarQR(l.qr_code).ok);
  if (foraDoContrato.length > 0) {
    console.log("── Fora do contrato atual — NÃO são tocadas ────────");
    console.log("  Gravadas antes da validação entrar em vigor. Informativo.");
    for (const l of foraDoContrato) {
      const r = validarQR(l.qr_code);
      const motivo = r.ok ? "?" : `${r.motivo}: ${r.detalhe}`;
      console.log(`     ${l.estante_nome} · ${l.sku} · ${l.id}`);
      console.log(`        ${motivo}`);
    }
    console.log("");
  }

  // ── Aplicação ────────────────────────────────────────────────────
  if (!APLICAR) {
    console.log(remover.length > 0
      ? "Nada foi alterado. Rode com --apply para remover as duplicatas."
      : "Nada a fazer — sem duplicatas.");
    await client.end();
    return;
  }

  if (remover.length === 0) {
    console.log("Nada a remover.");
    await client.end();
    return;
  }

  // Relatório em disco ANTES de apagar: uma vez removidas, as linhas não
  // podem ser reconstruídas a partir do banco.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const arquivo = path.resolve(process.cwd(), `estante-duplicatas-${stamp}.json`);
  fs.writeFileSync(
    arquivo,
    JSON.stringify({ gerado_em: new Date().toISOString(), alvo: alvo(), removidas: remover }, null, 2),
  );
  console.log(`Relatório gravado: ${arquivo}`);

  const ids = remover.map((r) => r.id);
  const res = await client.begin(async (tx) => {
    const del = await tx`DELETE FROM estante_fardo WHERE id = ANY(${ids})`;
    return del.count;
  });
  console.log(`Removidas: ${res} linha(s)`);

  const [{ n }] = await client<{ n: string }[]>`
    SELECT COUNT(*)::text AS n FROM estante_fardo
  `;
  console.log(`Fardos restantes: ${n}`);

  await client.end();
}

main().catch(async (err) => {
  console.error("Falhou:", err);
  await client.end();
  process.exit(1);
});
