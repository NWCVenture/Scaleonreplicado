// Sistema de saldos centralizado (RITM-14).
//
// Saldos rastreados pela OP:
//  - Compra: rolos comprados por cor, KGs comprados por cor
//  - Corte: rolos enviados (todas oficinas), rolos descartados,
//    peças cortadas por (tamanho×cor)
//  - Costura: peças enviadas por (oficina, tamanho×cor), peças
//    retiradas (todas retiradas não canceladas)
//
// Saldos derivam dos payloads das subtasks — não há cache; cada query
// recalcula. Para grande volume, pode virar materialized view; para
// MVP, recálculo on-demand é suficiente.

import type { SubtaskCompraPayload } from "./schemas/payloads/compra";
import type { SubtaskCortePayload } from "./schemas/payloads/corte";
import type { SubtaskCosturaPayload } from "./schemas/payloads/costura";

export interface SaldosCompra {
  rolosPorCor: Record<string, number>;
  kgsPorCor: Record<string, number>;
}

export interface SaldosCorte {
  rolosEnviadosPorCor: Record<string, number>;
  rolosDescartadosPorCor: Record<string, number>;
  pecasCortadas: Record<string, Record<string, number>>; // [tamanho][cor]
  saldoRolosPorCor: Record<string, number>; // rolos não-enviados (comprados − enviados − descartados)
}

export interface SaldosCostura {
  pecasEnviadasPorOficina: Record<string, Record<string, Record<string, number>>>; // [oficina][tam][cor]
  pecasEnviadasTotais: Record<string, Record<string, number>>; // [tam][cor]
  saldoPecasParaCostura: Record<string, Record<string, number>>; // [tam][cor] = cortadas − enviadas
  pecasRetiradasPorOficina: Record<string, Record<string, Record<string, number>>>;
  pecasRetiradasTotais: Record<string, Record<string, number>>;
  saldoPecasPorOficina: Record<string, Record<string, Record<string, number>>>; // [oficina][tam][cor] = enviadas − retiradas
}

export interface SaldosOP {
  compra: SaldosCompra;
  corte: SaldosCorte;
  costura: SaldosCostura;
}

export interface RetiradaParaSaldo {
  oficinaId: string;
  pecasPorTamanhoCor: Record<string, Record<string, number>>;
  canceladaEm: Date | null;
}

/**
 * Calcula saldos da subtask Compra a partir do payload (v2: multi-fornecedor).
 *
 * `rolosPorCor` usa a quantidade de pesos efetivamente informados (não a
 * qtd contratada), porque o que está disponível pra enviar ao corte é o
 * que já chegou e foi pesado. Cross-fornecedor agregado por cor.
 */
export function calcularSaldosCompra(
  compraPayload: SubtaskCompraPayload | null | undefined,
): SaldosCompra {
  const rolosPorCor: Record<string, number> = {};
  const kgsPorCor: Record<string, number> = {};
  for (const f of compraPayload?.fornecedores ?? []) {
    for (const c of f.cores) {
      rolosPorCor[c.corId] = (rolosPorCor[c.corId] ?? 0) + c.pesosRolos.length;
      kgsPorCor[c.corId] =
        (kgsPorCor[c.corId] ?? 0) + c.pesosRolos.reduce((s, p) => s + p, 0);
    }
  }
  return { rolosPorCor, kgsPorCor };
}

/**
 * Calcula saldos da subtask Corte: agrega todas as oficinas do payload.
 */
export function calcularSaldosCorte(
  cortePayload: SubtaskCortePayload | null | undefined,
  compraSaldos: SaldosCompra,
): SaldosCorte {
  const rolosEnviadosPorCor: Record<string, number> = {};
  const rolosDescartadosPorCor: Record<string, number> = {};
  const pecasCortadas: Record<string, Record<string, number>> = {};

  for (const o of cortePayload?.oficinas ?? []) {
    for (const [corId, qtd] of Object.entries(o.rolosEnviadosPorCor ?? {})) {
      rolosEnviadosPorCor[corId] = (rolosEnviadosPorCor[corId] ?? 0) + qtd;
    }
    for (const d of o.rolosDescartados ?? []) {
      rolosDescartadosPorCor[d.corId] =
        (rolosDescartadosPorCor[d.corId] ?? 0) + d.qtdRolos;
    }
    for (const r of o.rendimentoPorTamanhoCor ?? []) {
      pecasCortadas[r.tamanho] = pecasCortadas[r.tamanho] ?? {};
      pecasCortadas[r.tamanho][r.corId] =
        (pecasCortadas[r.tamanho][r.corId] ?? 0) + r.quantidade;
    }
  }

  const saldoRolosPorCor: Record<string, number> = {};
  for (const cor of Object.keys(compraSaldos.rolosPorCor)) {
    saldoRolosPorCor[cor] = Math.max(
      0,
      (compraSaldos.rolosPorCor[cor] ?? 0) -
        (rolosEnviadosPorCor[cor] ?? 0) -
        (rolosDescartadosPorCor[cor] ?? 0),
    );
  }

  return {
    rolosEnviadosPorCor,
    rolosDescartadosPorCor,
    pecasCortadas,
    saldoRolosPorCor,
  };
}

/**
 * Calcula saldos da subtask Costura: peças enviadas por oficina,
 * retiradas (não canceladas) e saldos resultantes.
 */
export function calcularSaldosCostura(
  costuraPayload: SubtaskCosturaPayload | null | undefined,
  retiradas: RetiradaParaSaldo[],
  corteSaldos: SaldosCorte,
): SaldosCostura {
  const pecasEnviadasPorOficina: Record<
    string,
    Record<string, Record<string, number>>
  > = {};
  const pecasEnviadasTotais: Record<string, Record<string, number>> = {};

  for (const o of costuraPayload?.oficinas ?? []) {
    pecasEnviadasPorOficina[o.oficinaId] =
      pecasEnviadasPorOficina[o.oficinaId] ?? {};
    for (const p of o.pecasEnviadasPorTamanhoCor ?? []) {
      pecasEnviadasPorOficina[o.oficinaId][p.tamanho] =
        pecasEnviadasPorOficina[o.oficinaId][p.tamanho] ?? {};
      pecasEnviadasPorOficina[o.oficinaId][p.tamanho][p.corId] =
        (pecasEnviadasPorOficina[o.oficinaId][p.tamanho][p.corId] ?? 0) +
        p.quantidade;
      pecasEnviadasTotais[p.tamanho] = pecasEnviadasTotais[p.tamanho] ?? {};
      pecasEnviadasTotais[p.tamanho][p.corId] =
        (pecasEnviadasTotais[p.tamanho][p.corId] ?? 0) + p.quantidade;
    }
  }

  const saldoPecasParaCostura: Record<string, Record<string, number>> = {};
  for (const [tam, mapaCor] of Object.entries(corteSaldos.pecasCortadas)) {
    for (const [cor, cortadas] of Object.entries(mapaCor)) {
      const enviadas = pecasEnviadasTotais[tam]?.[cor] ?? 0;
      saldoPecasParaCostura[tam] = saldoPecasParaCostura[tam] ?? {};
      saldoPecasParaCostura[tam][cor] = Math.max(0, cortadas - enviadas);
    }
  }

  // Retiradas não canceladas
  const pecasRetiradasPorOficina: Record<
    string,
    Record<string, Record<string, number>>
  > = {};
  const pecasRetiradasTotais: Record<string, Record<string, number>> = {};
  for (const r of retiradas) {
    if (r.canceladaEm !== null) continue;
    pecasRetiradasPorOficina[r.oficinaId] =
      pecasRetiradasPorOficina[r.oficinaId] ?? {};
    for (const [tam, mapaCor] of Object.entries(r.pecasPorTamanhoCor ?? {})) {
      for (const [cor, qtd] of Object.entries(mapaCor)) {
        pecasRetiradasPorOficina[r.oficinaId][tam] =
          pecasRetiradasPorOficina[r.oficinaId][tam] ?? {};
        pecasRetiradasPorOficina[r.oficinaId][tam][cor] =
          (pecasRetiradasPorOficina[r.oficinaId][tam][cor] ?? 0) + qtd;
        pecasRetiradasTotais[tam] = pecasRetiradasTotais[tam] ?? {};
        pecasRetiradasTotais[tam][cor] =
          (pecasRetiradasTotais[tam][cor] ?? 0) + qtd;
      }
    }
  }

  // Saldo por oficina (enviadas − retiradas)
  const saldoPecasPorOficina: Record<
    string,
    Record<string, Record<string, number>>
  > = {};
  for (const [oficinaId, mapaTam] of Object.entries(pecasEnviadasPorOficina)) {
    saldoPecasPorOficina[oficinaId] = {};
    for (const [tam, mapaCor] of Object.entries(mapaTam)) {
      for (const [cor, enviadas] of Object.entries(mapaCor)) {
        const retiradas =
          pecasRetiradasPorOficina[oficinaId]?.[tam]?.[cor] ?? 0;
        saldoPecasPorOficina[oficinaId][tam] =
          saldoPecasPorOficina[oficinaId][tam] ?? {};
        saldoPecasPorOficina[oficinaId][tam][cor] = Math.max(
          0,
          enviadas - retiradas,
        );
      }
    }
  }

  return {
    pecasEnviadasPorOficina,
    pecasEnviadasTotais,
    saldoPecasParaCostura,
    pecasRetiradasPorOficina,
    pecasRetiradasTotais,
    saldoPecasPorOficina,
  };
}

/**
 * Calcula saldos completos da OP.
 */
export function calcularSaldosOP(input: {
  compra: SubtaskCompraPayload | null | undefined;
  corte: SubtaskCortePayload | null | undefined;
  costura: SubtaskCosturaPayload | null | undefined;
  retiradas: RetiradaParaSaldo[];
}): SaldosOP {
  const compra = calcularSaldosCompra(input.compra);
  const corte = calcularSaldosCorte(input.corte, compra);
  const costura = calcularSaldosCostura(input.costura, input.retiradas, corte);
  return { compra, corte, costura };
}

/**
 * Valida que uma NOVA retirada não excede o saldo disponível na oficina.
 *
 * Saldo disponível = peças enviadas pra oficina − peças já retiradas
 * (em retiradas não canceladas).
 */
export function validarSaldoRetirada(input: {
  oficinaId: string;
  pecasNovaRetirada: Record<string, Record<string, number>>;
  saldoCostura: SaldosCostura;
}): { ok: true } | { ok: false; mensagem: string } {
  const saldoOficina = input.saldoCostura.saldoPecasPorOficina[input.oficinaId];
  if (!saldoOficina) {
    return {
      ok: false,
      mensagem: `Oficina ${input.oficinaId} não consta no payload da Costura — defina peças enviadas antes de criar retirada`,
    };
  }
  for (const [tam, mapaCor] of Object.entries(input.pecasNovaRetirada)) {
    for (const [cor, qtd] of Object.entries(mapaCor)) {
      const disponivel = saldoOficina[tam]?.[cor] ?? 0;
      if (qtd > disponivel) {
        return {
          ok: false,
          mensagem: `Retirada (${tam}, ${cor}): ${qtd} peças, mas só ${disponivel} disponíveis na oficina (já considerando retiradas anteriores)`,
        };
      }
    }
  }
  return { ok: true };
}

