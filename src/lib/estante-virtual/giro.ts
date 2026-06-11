// Cálculos de giro de estoque a partir das linhas do último import de
// analise_pedidos. Usado pelo card "Estoque × média de vendas" na página da
// estante.
//
// "Peças" = soma de `cor.qtd × qtdProduto` por linha — mesma definição usada
// pelo `agrupar()` no módulo analise-pedidos (kits expandidos contam cada
// componente).
//
// Convenções:
//  - O período da janela histórica é ancorado em `periodoMax` do CSV (não em
//    "hoje"), pra CSVs subidos com defasagem ainda produzirem média correta.
//  - "+2 dias úteis" pra projetar data de entrega ignora feriados — é
//    aproximação consciente, já que estamos calculando média estatística.
//    Alinha com a regra de prazo da central de envios em dias úteis.
//  - DOW: 0=Dom..6=Sáb (alinhado com Date.getDay()).

import type { LinhaPedido } from "@/lib/analise-pedidos/parser";

export const PLATAFORMA_TIKTOK = "TikTok Shop";
// Ordem visual padrão BR: Seg→Dom. O backend mantém 0=Dom..6=Sáb.
export const DOW_VISUAL_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
export const DOW_VISUAL_LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

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

// Adiciona N dias úteis a uma data (pula sáb/dom). Não considera feriados.
// Usado pra estimar a data de "saída efetiva" do estoque (= data do pedido
// + 2 dias úteis de preparo, igual à regra do central de envios).
export function adicionarDiasUteis(d: Date, n: number): Date {
  const result = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  let adicionados = 0;
  while (adicionados < n) {
    result.setDate(result.getDate() + 1);
    const dow = result.getDay();
    if (dow !== 0 && dow !== 6) adicionados++;
  }
  return result;
}

export interface MediaPorDiaSemana {
  // 0=Dom..6=Sáb. Sempre 7 entradas, indexadas pela própria DOW.
  diaSemana: number;
  // Peças cuja data de entrega caiu nesse DOW (cor.qtd × qtdProduto somados).
  totalItens: number;
  // Quantos dias daquele DOW caem no intervalo do CSV (no domínio do pedido).
  ocorrencias: number;
  // totalItens / ocorrencias; 0 quando ocorrencias = 0.
  media: number;
}

// Calcula a média de peças entregues por DOW. A "data de entrega" é estimada
// como data_pedido + 2 dias úteis. Filtra por plataforma (default TikTok
// Shop) e estados (default usa o que estiver presente entre Enviado/Retirada).
export function calcularMediaPorDiaSemana(
  linhas: LinhaPedido[],
  opts: {
    periodoMin: Date;
    periodoMax: Date;
    preset: PresetGiro;
    estados: Set<string>;
    plataforma: string;
  },
): MediaPorDiaSemana[] {
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
  const deTs = de.getTime();
  const ateTs = ate.getTime();

  const totalPorDow = [0, 0, 0, 0, 0, 0, 0];
  const ocorrenciasPorDow = [0, 0, 0, 0, 0, 0, 0];

  // Ocorrências de cada DOW no domínio do PEDIDO. Não shiftamos pelo +2 úteis
  // porque o nº de cada DOW num intervalo de N dias é praticamente o mesmo
  // antes ou depois do shift — e queremos média estatística simples.
  const cursor = new Date(de);
  while (cursor.getTime() <= ateTs) {
    ocorrenciasPorDow[cursor.getDay()]++;
    cursor.setDate(cursor.getDate() + 1);
  }

  for (const linha of linhas) {
    const ts = toDateOnly(linha.dataPedido).getTime();
    if (ts < deTs || ts > ateTs) continue;
    if (opts.estados.size > 0 && !opts.estados.has(linha.estado)) continue;
    if (opts.plataforma && linha.plataforma !== opts.plataforma) continue;
    const entrega = adicionarDiasUteis(linha.dataPedido, 2);
    const dowEntrega = entrega.getDay();
    let pecas = 0;
    for (const cor of linha.cores) {
      const q = cor.qtd * linha.qtdProduto;
      if (q > 0) pecas += q;
    }
    totalPorDow[dowEntrega] += pecas;
  }

  return ocorrenciasPorDow.map((ocorrencias, dow) => ({
    diaSemana: dow,
    totalItens: totalPorDow[dow],
    ocorrencias,
    media: ocorrencias > 0 ? totalPorDow[dow] / ocorrencias : 0,
  }));
}

export interface DiaSimulado {
  diaSemana: number;
  // Estoque no INÍCIO do dia (antes de processar as entregas previstas).
  estoqueInicial: number;
  // Média histórica de peças a entregar nesse DOW.
  mediaEntregar: number;
}

// Projeta o consumo do estoque ao longo da semana Seg→Dom. O estoque inicial
// da segunda = estoque atual; pra cada dia seguinte subtrai a média do dia
// anterior. Permite ver visualmente a "queda" do estoque ao longo da semana.
export function simularEstoqueSemanal(
  estoqueAtual: number,
  medias: MediaPorDiaSemana[],
): DiaSimulado[] {
  const mediasPorDow = new Map(medias.map((m) => [m.diaSemana, m.media]));
  let saldo = estoqueAtual;
  const resultado: DiaSimulado[] = [];
  for (const dow of DOW_VISUAL_ORDER) {
    const mediaEntregar = mediasPorDow.get(dow) ?? 0;
    resultado.push({
      diaSemana: dow,
      estoqueInicial: Math.max(0, saldo),
      mediaEntregar,
    });
    saldo -= mediaEntregar;
  }
  return resultado;
}
