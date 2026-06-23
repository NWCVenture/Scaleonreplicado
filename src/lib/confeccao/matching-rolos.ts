// Matching fornecedor↔cortador por (cor, oficina) — RITM-34.
//
// Rolos não têm identidade física (sem etiqueta única). Pra reconciliar
// "rolo X pesado pelo fornecedor = rolo Y pesado pelo cortador?", a
// planilha original (OP TEMPLATE.xlsm seção 3) usa ranking por peso
// dentro de (cor, oficina): ordena ambas as listas e casa por posição.
// É a melhor aproximação dado que a única assinatura comum é o peso.
//
// **Como distribuir pesos do fornecedor por oficina**: a Compra tem
// `pesosRolos` por cor (cross-fornecedor, agregado) e separadamente
// `distribuicaoOficinas[].rolosPorCor[cor]` em contagens. Não há
// vínculo explícito "esse peso vai pra essa oficina". A heurística é
// ordenar `pesosRolos` da cor em ordem ascendente e distribuir os
// primeiros n_A pesos pra oficina A, próximos n_B pra oficina B, etc.,
// na ordem em que oficinas aparecem em `distribuicaoOficinas`.
// (Mesma heurística usada na planilha original.)
//
// View read-only — sem persistência. Recalcular sempre.

import type {
  SubtaskCompraPayload,
  DistribuicaoOficina,
} from "./schemas/payloads/compra";
import type { SubtaskCortePayload } from "./schemas/payloads/corte";

/** Default usado quando a Compra não definiu `toleranciaMatchingPct`. */
export const TOLERANCIA_MATCHING_PADRAO = 5;

export interface PareamentoRolo {
  /** 1-indexed dentro do par (cor, oficina). */
  rank: number;
  /** Peso do fornecedor (null se cortador devolveu rolo a mais). */
  pesoFornecedor: number | null;
  /** Peso do cortador (null se cortador faltou informar). */
  pesoCortador: number | null;
  /** cortador − fornecedor (null se algum é null). */
  diffKg: number | null;
  /** % em relação ao peso fornecedor (null se algum é null). */
  diffPct: number | null;
  /** Fornecedor enviou esse rolo mas cortador não informou peso. */
  forneOrfao: boolean;
  /** Cortador devolveu rolo extra inesperado (fornecedor sem par). */
  cortOrfao: boolean;
  /** |diffPct| > tolerância. */
  alerta: boolean;
}

export interface MatchingCorOficina {
  oficinaId: string;
  corId: string;
  pares: PareamentoRolo[];
  /** Soma dos pesos do fornecedor (essa cor, essa oficina). */
  totalForne: number;
  /** Soma dos pesos do cortador. */
  totalCort: number;
  /** cortador − fornecedor. */
  diffTotalKg: number;
  /** % em relação ao total fornecedor. */
  diffTotalPct: number | null;
}

/**
 * Agrega pesos do fornecedor por cor (cross-fornecedor) e ordena ASC.
 * É o ponto de partida pra distribuição entre oficinas — primeiras
 * oficinas pegam os pesos menores.
 */
function pesosFornecedorPorCorAsc(
  compra: SubtaskCompraPayload | null | undefined,
): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const f of compra?.fornecedores ?? []) {
    for (const c of f.cores) {
      const arr = out.get(c.corId) ?? [];
      for (const p of c.pesosRolos) {
        if (Number.isFinite(p) && p > 0) arr.push(p);
      }
      out.set(c.corId, arr);
    }
  }
  for (const arr of out.values()) arr.sort((a, b) => a - b);
  return out;
}

/**
 * Calcula o matching pra todas as combinações (oficina, cor) que têm
 * pelo menos 1 rolo enviado ou informado pelo cortador.
 *
 * Não persiste — caller é UI.
 */
export function calcularMatchingRolos(
  compra: SubtaskCompraPayload | null | undefined,
  corte: SubtaskCortePayload | null | undefined,
): MatchingCorOficina[] {
  const tolerancia =
    compra?.toleranciaMatchingPct ?? TOLERANCIA_MATCHING_PADRAO;

  const pesosPorCorAsc = pesosFornecedorPorCorAsc(compra);
  const distribuicao: DistribuicaoOficina[] = compra?.distribuicaoOficinas ?? [];

  // Offset por cor: à medida que iteramos oficinas na ordem de
  // distribuicaoOficinas, consumimos os primeiros n_oficina pesos.
  const offsetPorCor = new Map<string, number>();

  const resultado: MatchingCorOficina[] = [];

  for (const oficina of distribuicao) {
    // Corte pode ter `oficinas` undefined (subtask em rascunho)
    const oficinaCorte = corte?.oficinas?.find(
      (o) => o.oficinaId === oficina.oficinaId,
    );

    for (const [corId, qtdRolos] of Object.entries(oficina.rolosPorCor)) {
      if (qtdRolos <= 0) continue;

      // (1) Slice de pesos do fornecedor pra esta (oficina, cor)
      const todosPesos = pesosPorCorAsc.get(corId) ?? [];
      const inicio = offsetPorCor.get(corId) ?? 0;
      const fim = inicio + qtdRolos;
      const pesosForne = todosPesos.slice(inicio, fim);
      offsetPorCor.set(corId, fim);

      // (2) Pesos do cortador pra esta (oficina, cor), ordenados ASC
      const pesosCort = (oficinaCorte?.rolosRecebidos ?? [])
        .filter((r) => r.corId === corId)
        .map((r) => r.pesoCortador)
        .sort((a, b) => a - b);

      // (3) Zip por rank até o maior dos dois
      const n = Math.max(pesosForne.length, pesosCort.length);
      const pares: PareamentoRolo[] = [];
      for (let i = 0; i < n; i++) {
        const forne = i < pesosForne.length ? pesosForne[i] : null;
        const cort = i < pesosCort.length ? pesosCort[i] : null;
        const diffKg =
          forne !== null && cort !== null ? cort - forne : null;
        const diffPct =
          forne !== null && cort !== null && forne > 0
            ? (cort / forne - 1) * 100
            : null;
        const alerta = diffPct !== null && Math.abs(diffPct) > tolerancia;
        pares.push({
          rank: i + 1,
          pesoFornecedor: forne,
          pesoCortador: cort,
          diffKg,
          diffPct,
          forneOrfao: cort === null && forne !== null,
          cortOrfao: forne === null && cort !== null,
          alerta,
        });
      }

      const totalForne = pesosForne.reduce((s, p) => s + p, 0);
      const totalCort = pesosCort.reduce((s, p) => s + p, 0);
      const diffTotalKg = totalCort - totalForne;
      const diffTotalPct =
        totalForne > 0 ? (totalCort / totalForne - 1) * 100 : null;

      resultado.push({
        oficinaId: oficina.oficinaId,
        corId,
        pares,
        totalForne,
        totalCort,
        diffTotalKg,
        diffTotalPct,
      });
    }
  }

  return resultado;
}

/**
 * Conta total de rolos informados pelo cortador no payload — útil pra
 * decidir se mostra o link "Matching de Rolos" na tela da OP.
 */
export function totalRolosRecebidos(
  corte: SubtaskCortePayload | null | undefined,
): number {
  let total = 0;
  for (const o of corte?.oficinas ?? []) {
    total += o.rolosRecebidos?.length ?? 0;
  }
  return total;
}
