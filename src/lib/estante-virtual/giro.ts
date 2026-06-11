// Calcula a média de peças vendidas por dia a partir das linhas do último
// import de analise_pedidos. Usado pelo card "Estoque × média de vendas" na
// página da estante pra dar uma previsibilidade de giro.
//
// "Peças" = soma de `cor.qtd × qtdProduto` por linha — mesma definição usada
// pelo `agrupar()` no módulo analise-pedidos (kits expandidos contam cada
// componente).
//
// O período é ancorado no último dia do CSV (`periodoMax`), não em "hoje" —
// senão um CSV de 3 dias atrás daria média 0 pros últimos N dias.

import type { LinhaPedido } from "@/lib/analise-pedidos/parser";

export interface PeriodoGiro {
  de: Date;
  ate: Date;
  // Dias efetivos no intervalo (sempre >= 1). Pode ser menor que o solicitado
  // se o CSV não cobre todo o lookback (ex: pediu 30d mas CSV tem só 12d).
  dias: number;
}

export interface MediaVendas {
  periodo: PeriodoGiro;
  // Soma de cor.qtd × qtdProduto das linhas que passaram o filtro.
  totalItens: number;
  // totalItens / periodo.dias.
  mediaPorDia: number;
}

export type PresetGiro = 7 | 14 | 30 | "tudo";

function toDateOnly(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function diferencaEmDias(de: Date, ate: Date): number {
  const ms = toDateOnly(ate).getTime() - toDateOnly(de).getTime();
  return Math.floor(ms / 86400000) + 1;
}

export function calcularMediaVendas(
  linhas: LinhaPedido[],
  opts: {
    periodoMin: Date;
    periodoMax: Date;
    preset: PresetGiro;
    estados: Set<string>;
  },
): MediaVendas {
  const ate = toDateOnly(opts.periodoMax);
  const minDisponivel = toDateOnly(opts.periodoMin);
  let de: Date;
  if (opts.preset === "tudo") {
    de = minDisponivel;
  } else {
    const tentativa = new Date(ate);
    tentativa.setDate(tentativa.getDate() - (opts.preset - 1));
    de = tentativa < minDisponivel ? minDisponivel : tentativa;
  }

  const dias = Math.max(1, diferencaEmDias(de, ate));
  const deTs = de.getTime();
  const ateTs = ate.getTime();

  let totalItens = 0;
  for (const linha of linhas) {
    const ts = toDateOnly(linha.dataPedido).getTime();
    if (ts < deTs || ts > ateTs) continue;
    if (opts.estados.size > 0 && !opts.estados.has(linha.estado)) continue;
    for (const cor of linha.cores) {
      const qtd = cor.qtd * linha.qtdProduto;
      if (qtd > 0) totalItens += qtd;
    }
  }

  return {
    periodo: { de, ate, dias },
    totalItens,
    mediaPorDia: totalItens / dias,
  };
}

// Quantos dias o estoque atual dura na média de vendas observada.
// Retorna Infinity quando a média é zero (sem vendas no período).
export function coberturaDias(
  estoque: number,
  mediaPorDia: number,
): number {
  if (mediaPorDia <= 0) return Infinity;
  return estoque / mediaPorDia;
}
