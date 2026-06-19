// Agrega pedidos da sessão de central-envios pela semana corrente (Seg→Dom),
// usando como referência a data de entrega (`prazo.prazoIso`) — não a data
// de criação. O prazoIso já contempla a regra do canal (ex: +2 dias úteis
// no TikTok), então essa é a "verdade" da operação.
//
// Saída pronta pra alimentar 2 gráficos no DashboardTab:
//  - Total de peças por dia da semana (1 série).
//  - Top N SKUs por dia da semana (N séries + bucket "Outros").
//
// Convenções:
//  - Trabalhamos com YYYY-MM-DD (data civil SP) o tempo todo. Date.UTC pra
//    derivar o DOW evita drift de timezone do runtime.
//  - DOW: 0=Dom..6=Sáb. Pra visualização em "Seg→Dom" o caller reordena.

import type { PedidoEnriquecido } from "@/lib/central-envios/sessao/types";

export const DOW_NOMES_CURTOS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
// Ordem visual padrão BR (semana de calendário começa na seg).
export const DOW_VISUAL_SEG_DOM = [1, 2, 3, 4, 5, 6, 0] as const;

export function dowFromYmd(ymd: string): number {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return -1;
  const [, y, mo, d] = m;
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d))).getUTCDay();
}

function quebrarYmd(ymd: string): { y: number; m: number; d: number } {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`YMD inválido: '${ymd}'`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function formatarYmd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function somarDias(ymd: string, dias: number): string {
  const { y, m, d } = quebrarYmd(ymd);
  const t = Date.UTC(y, m - 1, d) + dias * 86400000;
  const dt = new Date(t);
  return formatarYmd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

// Segunda-feira da semana corrente onde `hojeIso` cai.
// DOW 1=seg → mantém; DOW 0=dom → volta 6 dias; demais → volta (DOW-1) dias.
export function inicioDaSemanaIso(hojeIso: string): string {
  const dow = dowFromYmd(hojeIso);
  if (dow === -1) throw new Error(`hojeIso inválido: '${hojeIso}'`);
  const delta = dow === 0 ? -6 : -(dow - 1);
  return somarDias(hojeIso, delta);
}

// Domingo da semana corrente (inicio + 6 dias).
export function fimDaSemanaIso(hojeIso: string): string {
  return somarDias(inicioDaSemanaIso(hojeIso), 6);
}

export interface PorSkuPorDow {
  sku: string;
  porDow: number[]; // 7 entradas, indexadas pelo DOW (0=Dom..6=Sáb).
  total: number;
}

export interface AgregacaoSemanal {
  // Janela usada (inclusive).
  inicioIso: string;
  fimIso: string;
  // Indexado por DOW (0..6).
  totalPorDow: number[];
  // Top N SKUs por total na semana.
  topSkus: PorSkuPorDow[];
  // Bucket dos SKUs que não entraram no top N.
  outrosPorDow: number[];
  outrosCount: number;
  // Quantos pedidos OK foram considerados (caíram na janela e tinham prazo).
  pedidosConsiderados: number;
}

// Próximos 7 dias começando em `hojeIso` (inclusive). Diferente da semana
// corrente (Seg→Dom) — usado quando o consumidor quer alinhar a projeção
// com "hoje" (ex: projeção de estoque na estante virtual).
export function montarAgregacaoProximos7Dias(
  dados: PedidoEnriquecido[],
  hojeIso: string,
  opts: { maxSkus: number } = { maxSkus: 8 },
): AgregacaoSemanal {
  return agregarEntre(dados, hojeIso, somarDias(hojeIso, 6), opts);
}

export function montarAgregacaoSemanal(
  dados: PedidoEnriquecido[],
  hojeIso: string,
  opts: { maxSkus: number } = { maxSkus: 8 },
): AgregacaoSemanal {
  return agregarEntre(
    dados,
    inicioDaSemanaIso(hojeIso),
    fimDaSemanaIso(hojeIso),
    opts,
  );
}

function agregarEntre(
  dados: PedidoEnriquecido[],
  inicioIso: string,
  fimIso: string,
  opts: { maxSkus: number },
): AgregacaoSemanal {
  const totalPorDow = [0, 0, 0, 0, 0, 0, 0];
  const porSku = new Map<string, PorSkuPorDow>();
  let pedidosConsiderados = 0;

  for (const p of dados) {
    if (p.parsed.kind !== "OK") continue;
    const prazo = p.prazo.prazoIso;
    if (!prazo) continue;
    if (prazo < inicioIso || prazo > fimIso) continue;
    const dow = dowFromYmd(prazo);
    if (dow < 0) continue;
    pedidosConsiderados++;
    for (const l of p.linhasExplodidas) {
      if (!l.qtd || l.qtd <= 0) continue;
      const sku = `${l.modeloCodigo} ${l.cor} ${l.tamanho}`;
      totalPorDow[dow] += l.qtd;
      let agg = porSku.get(sku);
      if (!agg) {
        agg = { sku, porDow: [0, 0, 0, 0, 0, 0, 0], total: 0 };
        porSku.set(sku, agg);
      }
      agg.porDow[dow] += l.qtd;
      agg.total += l.qtd;
    }
  }

  const skusOrdenados = [...porSku.values()].sort((a, b) => b.total - a.total);
  const topSkus = skusOrdenados.slice(0, opts.maxSkus);
  const restantes = skusOrdenados.slice(opts.maxSkus);
  const outrosPorDow = [0, 0, 0, 0, 0, 0, 0];
  for (const r of restantes) {
    for (let i = 0; i < 7; i++) outrosPorDow[i] += r.porDow[i];
  }

  return {
    inicioIso,
    fimIso,
    totalPorDow,
    topSkus,
    outrosPorDow,
    outrosCount: restantes.length,
    pedidosConsiderados,
  };
}
