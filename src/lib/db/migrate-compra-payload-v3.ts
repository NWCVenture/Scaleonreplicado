// Migração de payload da subtask OPBUY: v2 → v3 (RITM-32).
//
// v2:
//   { fornecedores: [...],
//     destinatarioCorteId: "...",   ← single oficina
//     tipoTecidoId, gramaturaGM2, larguraRoloCm, observacoes }
//
// v3:
//   { fornecedores: [...],
//     distribuicaoOficinas: [        ← novo: plano multi-oficina
//       { oficinaId, rolosPorCor: { corId → qtdRolos } }
//     ],
//     destinatarioCorteId,           ← legacy mantido pra leitura no ciclo
//     tipoTecidoId, gramaturaGM2, larguraRoloCm, observacoes }
//
// Política de migração: 1 oficina (a antiga destinatarioCorteId) recebe
// TODOS os rolos contratados — split entre múltiplas oficinas é decisão
// do operador via UI nova (modal de planejamento de distribuição).
//
// Idempotente: detecta payload já no formato v3 (tem .distribuicaoOficinas)
// e pula. Use:
//   npx dotenv -e .env.local -- npx tsx src/lib/db/migrate-compra-payload-v3.ts
//   npx dotenv -e .env.prod  -- npx tsx src/lib/db/migrate-compra-payload-v3.ts

import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { confeccaoSubtask } from "./schema";
import {
  agruparRolosContratadosPorCor,
  type SubtaskCompraPayload,
} from "@/lib/confeccao/schemas/payloads/compra";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL não definida. Use dotenv-cli com .env.local ou .env.prod.",
  );
}

const client = postgres(process.env.DATABASE_URL);
const db = drizzle(client);

function ehFormatoV3(payload: unknown): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "distribuicaoOficinas" in payload
  );
}

function ehFormatoV2(payload: unknown): payload is SubtaskCompraPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "fornecedores" in payload
  );
}

function migrarPayload(
  payload: SubtaskCompraPayload,
): { novoPayload: Record<string, unknown> } | { skip: string } {
  const destinatario = payload.destinatarioCorteId;
  if (!destinatario) {
    return {
      skip:
        "sem destinatarioCorteId — operador define a distribuição na UI nova",
    };
  }

  const rolosMap = agruparRolosContratadosPorCor(payload);
  const rolosPorCor: Record<string, number> = {};
  let total = 0;
  for (const [corId, qtd] of rolosMap) {
    if (qtd > 0) {
      rolosPorCor[corId] = qtd;
      total += qtd;
    }
  }
  if (total === 0) {
    return {
      skip:
        "nenhuma cor tem qtdRolosContratados > 0 — operador preenche depois",
    };
  }

  // Preserva todo o payload existente e injeta distribuicaoOficinas.
  const novoPayload: Record<string, unknown> = {
    ...(payload as Record<string, unknown>),
    distribuicaoOficinas: [
      {
        oficinaId: destinatario,
        rolosPorCor,
      },
    ],
  };
  return { novoPayload };
}

async function main() {
  console.log(
    "=== Migração payload OPBUY: destinatarioCorteId → distribuicaoOficinas (v3) ===\n",
  );

  const subtasks = await db
    .select()
    .from(confeccaoSubtask)
    .where(eq(confeccaoSubtask.prefixo, "OPBUY"));

  console.log(`Encontradas ${subtasks.length} subtask(s) OPBUY.\n`);

  let migradas = 0;
  let puladasV3 = 0;
  let puladasVazias = 0;
  let puladasIncompletas = 0;
  const detalhesIncompletas: Array<{ numero: string; motivo: string }> = [];

  for (const st of subtasks) {
    const payload = st.payload;

    if (ehFormatoV3(payload)) {
      console.log(`  ⏭  ${st.numero}: já está no formato v3`);
      puladasV3++;
      continue;
    }

    if (!ehFormatoV2(payload)) {
      console.log(
        `  ◯  ${st.numero}: payload vazio ou não-v2 — nada a migrar`,
      );
      puladasVazias++;
      continue;
    }

    const r = migrarPayload(payload);
    if ("skip" in r) {
      console.log(`  ⚠  ${st.numero}: ${r.skip}`);
      puladasIncompletas++;
      detalhesIncompletas.push({ numero: st.numero, motivo: r.skip });
      continue;
    }

    await db
      .update(confeccaoSubtask)
      .set({ payload: r.novoPayload as never })
      .where(eq(confeccaoSubtask.id, st.id));
    const dist = r.novoPayload.distribuicaoOficinas as Array<{
      rolosPorCor: Record<string, number>;
    }>;
    const total = Object.values(dist[0].rolosPorCor).reduce(
      (s, n) => s + n,
      0,
    );
    console.log(
      `  ✓  ${st.numero}: migrada (1 oficina, ${total} rolo(s) atribuído(s))`,
    );
    migradas++;
  }

  console.log(
    `\n=== Resumo: ${migradas} migrada(s), ${puladasV3} já-v3, ${puladasVazias} vazia(s), ${puladasIncompletas} incompleta(s) ===`,
  );

  if (detalhesIncompletas.length > 0) {
    console.log("\nIncompletas (revisar manualmente):");
    for (const d of detalhesIncompletas) {
      console.log(`  - ${d.numero}: ${d.motivo}`);
    }
  }

  await client.end();
}

main().catch(async (err) => {
  console.error("ERRO:", err);
  await client.end();
  process.exit(1);
});
