// Loader do ContextoPrazo. Carrega regras de prazo + feriados do ano
// atual e seguinte, calcula hojeIso uma única vez.

import { and, between, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { canalRegraPrazo, feriado } from "@/lib/db/schema";
import { hojeIsoSP } from "./dias-uteis";
import {
  chaveRegraCanal,
  type ContextoPrazo,
  type RegraPrazoSnapshot,
} from "./types";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function carregarContextoPrazo(tx: Tx): Promise<ContextoPrazo> {
  const hojeIso = hojeIsoSP();
  const ano = Number(hojeIso.slice(0, 4));
  const inicioAno = `${ano}-01-01`;
  const fimProximoAno = `${ano + 1}-12-31`;

  const [regrasRows, feriadosRows] = await Promise.all([
    tx
      .select({
        id: canalRegraPrazo.id,
        plataforma: canalRegraPrazo.plataforma,
        canalVendaId: canalRegraPrazo.canalVendaId,
        estrategia: canalRegraPrazo.estrategia,
        diasUteis: canalRegraPrazo.diasUteis,
        campoPrazo: canalRegraPrazo.campoPrazo,
        regexPrazo: canalRegraPrazo.regexPrazo,
        fallbackHoje: canalRegraPrazo.fallbackHoje,
        ativo: canalRegraPrazo.ativo,
      })
      .from(canalRegraPrazo)
      .where(eq(canalRegraPrazo.ativo, true)),
    tx
      .select({ data: feriado.data })
      .from(feriado)
      .where(and(between(feriado.data, inicioAno, fimProximoAno))),
  ]);

  const regrasPorCanal = new Map<string, RegraPrazoSnapshot>();
  const regrasDefaultPorPlataforma = new Map<
    RegraPrazoSnapshot["plataforma"],
    RegraPrazoSnapshot
  >();
  for (const r of regrasRows) {
    const snap: RegraPrazoSnapshot = {
      id: r.id,
      plataforma: r.plataforma,
      canalVendaId: r.canalVendaId,
      estrategia: r.estrategia,
      diasUteis: r.diasUteis,
      campoPrazo: r.campoPrazo,
      regexPrazo: r.regexPrazo,
      fallbackHoje: r.fallbackHoje,
      ativo: r.ativo,
    };
    if (snap.canalVendaId) {
      regrasPorCanal.set(
        chaveRegraCanal(snap.plataforma, snap.canalVendaId),
        snap,
      );
    } else {
      regrasDefaultPorPlataforma.set(snap.plataforma, snap);
    }
  }

  const feriadosSet = new Set(feriadosRows.map((r) => r.data));

  return {
    regrasPorCanal,
    regrasDefaultPorPlataforma,
    feriadosSet,
    hojeIso,
  };
}
