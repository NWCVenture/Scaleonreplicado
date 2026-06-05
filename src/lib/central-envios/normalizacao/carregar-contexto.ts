// Carrega o snapshot dos cadastros relevantes pra normalização.
//
// Roda dentro de uma transação `withConta` (RLS já isolando por
// conta_id). Faz ~7 queries em paralelo e monta o `ContextoCadastro`
// com tudo em UPPERCASE — assumindo que o parser também trabalha em
// UPPERCASE.
//
// Sem cache cross-request neste RITM (vide spec); chama uma vez por
// upload.

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  modeloPrincipal,
  modeloCor,
  modeloTamanho,
  corCatalogo,
  tamanhoCatalogo,
  corAlias,
  tamanhoAlias,
} from "@/lib/db/schema";
import type { ContextoCadastro, ModeloSnapshot } from "./types";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Carrega snapshot dos cadastros do tenant (conta ativa via RLS).
 *
 * @param tx Transação iniciada por `withConta`/`withContaAtiva`.
 * @returns ContextoCadastro consumível por `parsearSku`.
 */
export async function carregarContextoCadastro(
  tx: Tx,
): Promise<ContextoCadastro> {
  const [
    modelosRows,
    coresRows,
    tamanhosRows,
    coresGlobaisRows,
    tamanhosGlobaisRows,
    aliasesCorRows,
    aliasesTamanhoRows,
  ] = await Promise.all([
    tx
      .select({
        id: modeloPrincipal.id,
        codigo: modeloPrincipal.codigo,
        corPadrao: modeloPrincipal.corPadrao,
        exigeTamanho: modeloPrincipal.exigeTamanho,
        corMixDefault: modeloPrincipal.corMixDefault,
      })
      .from(modeloPrincipal)
      .where(eq(modeloPrincipal.ativo, true)),
    tx
      .select({
        modeloId: modeloCor.modeloId,
        codigo: modeloCor.codigo,
      })
      .from(modeloCor)
      .where(eq(modeloCor.ativo, true)),
    tx
      .select({
        modeloId: modeloTamanho.modeloId,
        codigo: modeloTamanho.codigo,
        ordem: modeloTamanho.ordem,
      })
      .from(modeloTamanho)
      .where(eq(modeloTamanho.ativo, true)),
    tx
      .select({ codigo: corCatalogo.codigo })
      .from(corCatalogo)
      .where(eq(corCatalogo.ativo, true)),
    tx
      .select({ codigo: tamanhoCatalogo.codigo })
      .from(tamanhoCatalogo)
      .where(eq(tamanhoCatalogo.ativo, true)),
    tx
      .select({
        modeloId: corAlias.modeloId,
        codigoAlias: corAlias.codigoAlias,
        codigoReal: corAlias.codigoReal,
      })
      .from(corAlias),
    tx
      .select({
        modeloId: tamanhoAlias.modeloId,
        codigoAlias: tamanhoAlias.codigoAlias,
        codigoReal: tamanhoAlias.codigoReal,
      })
      .from(tamanhoAlias),
  ]);

  // Agrupa cores por modelo (com sort alfabético).
  const coresPorModelo = new Map<string, string[]>();
  for (const { modeloId, codigo } of coresRows) {
    const lista = coresPorModelo.get(modeloId) ?? [];
    lista.push(codigo.toUpperCase());
    coresPorModelo.set(modeloId, lista);
  }
  for (const lista of coresPorModelo.values()) {
    lista.sort();
  }

  // Agrupa tamanhos por modelo, na ordem do cadastro (já vem de ORDER BY,
  // mas Postgres pode reordenar — re-sort por ordem se quiser
  // determinismo extra; aqui mantemos a ordem do cursor).
  const tamanhosPorModelo = new Map<
    string,
    Array<{ codigo: string; ordem: number }>
  >();
  for (const { modeloId, codigo, ordem } of tamanhosRows) {
    const lista = tamanhosPorModelo.get(modeloId) ?? [];
    lista.push({ codigo: codigo.toUpperCase(), ordem });
    tamanhosPorModelo.set(modeloId, lista);
  }
  for (const lista of tamanhosPorModelo.values()) {
    lista.sort((a, b) => a.ordem - b.ordem);
  }

  // Monta snapshots de modelos.
  const modelos: ModeloSnapshot[] = modelosRows.map((row) => ({
    id: row.id,
    codigo: row.codigo.toUpperCase(),
    corPadrao: row.corPadrao ? row.corPadrao.toUpperCase() : null,
    exigeTamanho: row.exigeTamanho,
    corMixDefault: row.corMixDefault
      ? Object.fromEntries(
          Object.entries(row.corMixDefault).map(([k, v]) => [
            k,
            v.map((c) => c.toUpperCase()),
          ]),
        )
      : null,
    cores: coresPorModelo.get(row.id) ?? [],
    tamanhos: (tamanhosPorModelo.get(row.id) ?? []).map((t) => t.codigo),
  }));

  const modelosPorCodigo = new Map<string, ModeloSnapshot>();
  for (const m of modelos) {
    modelosPorCodigo.set(m.codigo, m);
  }

  // Conjuntos globais (uppercase).
  const coresGlobais = new Set(
    coresGlobaisRows.map((r) => r.codigo.toUpperCase()),
  );
  const tamanhosGlobais = new Set(
    tamanhosGlobaisRows.map((r) => r.codigo.toUpperCase()),
  );

  // Aliases: separa globais (modeloId IS NULL) vs por-modelo.
  const aliasGlobalCor = new Map<string, string>();
  const aliasGlobalTam = new Map<string, string>();
  const aliasesPorModelo = new Map<
    string,
    { cor: Map<string, string>; tamanho: Map<string, string> }
  >();

  function getEntrada(modeloId: string) {
    let e = aliasesPorModelo.get(modeloId);
    if (!e) {
      e = { cor: new Map(), tamanho: new Map() };
      aliasesPorModelo.set(modeloId, e);
    }
    return e;
  }

  for (const r of aliasesCorRows) {
    const k = r.codigoAlias.toUpperCase();
    const v = r.codigoReal.toUpperCase();
    if (r.modeloId == null) aliasGlobalCor.set(k, v);
    else getEntrada(r.modeloId).cor.set(k, v);
  }
  for (const r of aliasesTamanhoRows) {
    const k = r.codigoAlias.toUpperCase();
    const v = r.codigoReal.toUpperCase();
    if (r.modeloId == null) aliasGlobalTam.set(k, v);
    else getEntrada(r.modeloId).tamanho.set(k, v);
  }

  return {
    modelos,
    modelosPorCodigo,
    coresGlobais,
    tamanhosGlobais,
    aliasesGlobais: { cor: aliasGlobalCor, tamanho: aliasGlobalTam },
    aliasesPorModelo,
  };
}
