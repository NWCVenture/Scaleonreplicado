// Migração de payload da subtask OPBUY: pré/pós → multi-fornecedor (RITM-29).
//
// v1 (antigo):
//   { pre: { fornecedorId, tipoTecidoId, destinatarioCorteId,
//            cores: [{ corId, kgsSolicitados }], observacoesPedido? },
//     pos: { rolosRecebidos: [{ corId, pesos: [] }], precoKgEfetivo,
//            gramaturaGM2, larguraRoloCm, observacoesPos? } }
//
// v2 (novo):
//   { fornecedores: [{
//       fornecedorId, observacoes?,
//       cores: [{ corId, kgsContratados, qtdRolosContratados, precoPorKg, pesosRolos: [] }]
//     }],
//     destinatarioCorteId, tipoTecidoId, gramaturaGM2, larguraRoloCm, observacoes }
//
// Idempotente: detecta payload no formato novo (tem .fornecedores) e pula.
// Use:
//   npx dotenv -e .env.local -- npx tsx src/lib/db/migrate-compra-payload-v2.ts
//   npx dotenv -e .env.prod  -- npx tsx src/lib/db/migrate-compra-payload-v2.ts

import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { confeccaoSubtask } from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL não definida. Use dotenv-cli com .env.local ou .env.prod.",
  );
}

const client = postgres(process.env.DATABASE_URL);
const db = drizzle(client);

interface PayloadV1Pre {
  fornecedorId?: string;
  tipoTecidoId?: string;
  destinatarioCorteId?: string;
  cores?: Array<{ corId: string; kgsSolicitados: number }>;
  observacoesPedido?: string;
}

interface PayloadV1Pos {
  rolosRecebidos?: Array<{ corId: string; pesos: number[] }>;
  precoKgEfetivo?: number;
  gramaturaGM2?: number;
  larguraRoloCm?: number;
  observacoesPos?: string;
}

interface PayloadV1 {
  pre?: PayloadV1Pre;
  pos?: PayloadV1Pos;
}

function ehFormatoNovo(payload: unknown): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "fornecedores" in payload
  );
}

function ehFormatoAntigo(payload: unknown): payload is PayloadV1 {
  return (
    typeof payload === "object" &&
    payload !== null &&
    ("pre" in payload || "pos" in payload)
  );
}

function converter(antigo: PayloadV1): Record<string, unknown> {
  const pre = antigo.pre ?? {};
  const pos = antigo.pos ?? {};
  const coresAntigas = pre.cores ?? [];
  const rolosPorCor = new Map<string, number[]>();
  for (const r of pos.rolosRecebidos ?? []) {
    rolosPorCor.set(r.corId, r.pesos ?? []);
  }
  const precoKg = pos.precoKgEfetivo ?? 0;

  // Constrói 1 fornecedor (o do pre) com todas as cores.
  const fornecedores: Array<Record<string, unknown>> = [];
  if (pre.fornecedorId && coresAntigas.length > 0) {
    fornecedores.push({
      fornecedorId: pre.fornecedorId,
      observacoes: pre.observacoesPedido,
      cores: coresAntigas.map((c) => {
        const pesos = rolosPorCor.get(c.corId) ?? [];
        return {
          corId: c.corId,
          kgsContratados: c.kgsSolicitados,
          // No v1, a qtd de rolos era implícita pelo length dos pesos.
          // Se ainda não havia pos, assumimos 0 — operador define depois.
          qtdRolosContratados: pesos.length,
          precoPorKg: precoKg,
          pesosRolos: pesos,
        };
      }),
    });
  }

  const novo: Record<string, unknown> = { fornecedores };
  if (pre.destinatarioCorteId) novo.destinatarioCorteId = pre.destinatarioCorteId;
  if (pre.tipoTecidoId) novo.tipoTecidoId = pre.tipoTecidoId;
  if (pos.gramaturaGM2 !== undefined) novo.gramaturaGM2 = pos.gramaturaGM2;
  if (pos.larguraRoloCm !== undefined) novo.larguraRoloCm = pos.larguraRoloCm;
  // Combina observações pré + pós em "observacoes" único
  const obsCombinada = [pre.observacoesPedido, pos.observacoesPos]
    .filter((x): x is string => typeof x === "string" && x.trim() !== "")
    .join("\n\n");
  if (obsCombinada) novo.observacoes = obsCombinada;
  return novo;
}

async function main() {
  console.log("=== Migração payload OPBUY: pré/pós → multi-fornecedor (v2) ===\n");

  const subtasks = await db
    .select()
    .from(confeccaoSubtask)
    .where(eq(confeccaoSubtask.prefixo, "OPBUY"));

  console.log(`Encontradas ${subtasks.length} subtask(s) OPBUY.\n`);

  let migradas = 0;
  let puladas = 0;
  let semConteudo = 0;

  for (const st of subtasks) {
    const payload = st.payload;
    if (ehFormatoNovo(payload)) {
      console.log(`  ⏭  ${st.numero}: já está no formato novo`);
      puladas++;
      continue;
    }
    if (!ehFormatoAntigo(payload)) {
      if (payload === null || (typeof payload === "object" && Object.keys(payload).length === 0)) {
        console.log(`  ◯  ${st.numero}: payload vazio — nada a migrar`);
        semConteudo++;
        continue;
      }
      console.log(
        `  ⚠  ${st.numero}: payload não reconhecido (nem antigo nem novo)`,
      );
      puladas++;
      continue;
    }

    const novo = converter(payload);
    await db
      .update(confeccaoSubtask)
      .set({ payload: novo as never })
      .where(eq(confeccaoSubtask.id, st.id));
    console.log(
      `  ✓  ${st.numero}: migrada (${(novo.fornecedores as unknown[]).length} fornecedor(es))`,
    );
    migradas++;
  }

  console.log(
    `\n=== Resumo: ${migradas} migrada(s), ${puladas} pulada(s), ${semConteudo} sem conteúdo ===`,
  );

  await client.end();
}

main().catch(async (err) => {
  console.error("ERRO:", err);
  await client.end();
  process.exit(1);
});
