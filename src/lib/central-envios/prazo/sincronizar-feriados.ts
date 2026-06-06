// Sincroniza feriados nacionais via BrasilAPI.
//
// Idempotente:
//   - Linha com fonte='manual' nunca é tocada.
//   - Linha com fonte='nacional_api' e mesmo (contaId, data): atualiza
//     só descricao se mudou.
//   - Não existe: INSERT novo.
//
// Não deleta feriados que sumiram da BrasilAPI — operador pode ter
// cadastrado eventos próprios (manuais ou via sync de anos anteriores).
//
// O endpoint público da BrasilAPI não exige autenticação. Timeout
// hard de 15s. Erro de rede ou status != 2xx → throw com mensagem
// canônica `sync_falhou:...`.

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { feriado } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const TIMEOUT_MS = 15_000;

const BrasilApiFeriadoSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  name: z.string().min(1),
  type: z.string().optional(),
});

const BrasilApiRespostaSchema = z.array(BrasilApiFeriadoSchema);

export type ResultadoSyncFeriados = {
  ano: number;
  inseridos: number;
  atualizados: number;
  pulados: number;
  detalhes: string;
};

export type FetchFn = typeof fetch;

/**
 * Slug determinístico — usado em `referencia_externa` pra correlacionar
 * o registro local com o feriado da BrasilAPI mesmo se o `name` mudar.
 */
function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function buscarFeriadosNacionais(
  ano: number,
  fetchFn: FetchFn,
): Promise<z.infer<typeof BrasilApiRespostaSchema>> {
  const url = `https://brasilapi.com.br/api/feriados/v1/${ano}`;
  let response: Response;
  try {
    response = await fetchFn(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(`sync_falhou: rede/timeout (${(err as Error).message})`);
  }
  if (!response.ok) {
    throw new Error(`sync_falhou: HTTP ${response.status}`);
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch (err) {
    throw new Error(
      `sync_falhou: payload não-JSON (${(err as Error).message})`,
    );
  }
  const parsed = BrasilApiRespostaSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `sync_falhou: payload inválido (${parsed.error.issues[0]?.message})`,
    );
  }
  return parsed.data;
}

/**
 * Sincroniza feriados nacionais do ano `ano` na conta `contaId`.
 *
 * @param tx Transação dentro de withConta.
 * @param contaId Conta-alvo (usado no INSERT; RLS já isola).
 * @param ano Ano em formato yyyy.
 * @param fetchFn Injetável pra testes (default: fetch global).
 */
export async function sincronizarFeriadosNacionais(
  tx: Tx,
  contaId: string,
  ano: number,
  fetchFn: FetchFn = fetch,
): Promise<ResultadoSyncFeriados> {
  const lista = await buscarFeriadosNacionais(ano, fetchFn);

  let inseridos = 0;
  let atualizados = 0;
  let pulados = 0;

  for (const f of lista) {
    const slug = slugify(f.name);
    const existente = await tx
      .select({
        id: feriado.id,
        fonte: feriado.fonte,
        descricao: feriado.descricao,
      })
      .from(feriado)
      .where(and(eq(feriado.contaId, contaId), eq(feriado.data, f.date)))
      .limit(1);

    if (existente.length === 0) {
      await tx.insert(feriado).values({
        id: generateId(),
        contaId,
        data: f.date,
        descricao: f.name,
        fonte: "nacional_api",
        referenciaExterna: slug,
      });
      inseridos++;
      continue;
    }

    const row = existente[0];
    if (row.fonte === "manual") {
      pulados++;
      continue;
    }
    // fonte = nacional_api — atualiza descricao se mudou.
    if (row.descricao !== f.name) {
      await tx
        .update(feriado)
        .set({ descricao: f.name, referenciaExterna: slug })
        .where(eq(feriado.id, row.id));
      atualizados++;
    } else {
      pulados++;
    }
  }

  return {
    ano,
    inseridos,
    atualizados,
    pulados,
    detalhes: `ano=${ano}: ${inseridos} novo(s), ${atualizados} atualizado(s), ${pulados} sem mudança`,
  };
}
