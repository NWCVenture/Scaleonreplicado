// Composer da sessão Central de Envios.
//
// Recebe runIds de ingestao_run.status='concluido', os 3 contextos
// (cadastro, explosão, prazo) e o estado atual da sessão. Aplica
// parser → explosão → cálculo de prazo a cada pedido bruto, faz merge
// com dados existentes (dedup por (canal, orderId), primeira ocorrência)
// e re-deriva estatísticas.
//
// Persistência (UPDATE da sessao_central_envios) fica no caller —
// o composer não toca no banco além de SELECT em ingestao_run.

import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { ingestaoRun } from "@/lib/db/schema";
import {
  parsearSku,
} from "../normalizacao/parsear-sku";
import type { ContextoCadastro } from "../normalizacao/types";
import { explodirSku } from "../explosao/explodir-sku";
import type { ContextoExplosao } from "../explosao/types";
import { calcularPrazo } from "../prazo/calcular-prazo";
import { dataCivilSP } from "../prazo/dias-uteis";
import type { ContextoPrazo, EntradaCalculoPrazo } from "../prazo/types";
import type {
  ArquivoIngerido,
  EstatisticasSessao,
  PedidoEnriquecido,
  ResultadoComposer,
} from "./types";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Shape dos pedidos brutos saídos dos parsers RITM-02/03. Não importa
// os tipos exatos — usamos um discriminador `canal` e campos
// opcionais.
type PedidoBrutoTikTok = {
  canal: "tiktok_shop";
  orderId: string;
  trackingId: string | null;
  sellerSku: string;
  quantidade: number;
  buyerUsername: string | null;
  criadoEm: string;
  orderStatus: string;
  orderSubstatus: string | null;
};

type PedidoBrutoMl = {
  canal: "mercado_livre";
  numeroVenda: string;
  numeroEnvio: string | null;
  sku: string;
  variacao: string | null;
  estado: string | null;
  unidades: number;
  comprador: string | null;
  dataVendaIso: string | null;
  dataVendaRaw: string;
};

type PedidoBruto = PedidoBrutoTikTok | PedidoBrutoMl;

export type FetchFn = typeof fetch;

export type ProcessarSessaoArgs = {
  tx: Tx;
  runIds: string[];
  sessaoAtual: {
    arquivosIngeridos: ArquivoIngerido[];
    dados: PedidoEnriquecido[];
  };
  ctxCadastro: ContextoCadastro;
  ctxExplosao: ContextoExplosao;
  ctxPrazo: ContextoPrazo;
  // Injetável pra testes (resultado offload bate em Blob via fetch).
  fetchFn?: FetchFn;
};

export async function processarSessao(
  args: ProcessarSessaoArgs,
): Promise<ResultadoComposer> {
  const fetchFn = args.fetchFn ?? fetch;
  const arquivosExistentes = new Map(
    args.sessaoAtual.arquivosIngeridos.map((a) => [a.runId, a] as const),
  );

  // Filtra runIds novos (idempotência: já processado é pulado).
  const runIdsNovos = args.runIds.filter((id) => !arquivosExistentes.has(id));
  let runsRows: Array<typeof ingestaoRun.$inferSelect> = [];
  if (runIdsNovos.length > 0) {
    runsRows = await args.tx
      .select()
      .from(ingestaoRun)
      .where(inArray(ingestaoRun.id, runIdsNovos));
  }

  const pedidosNovos: PedidoEnriquecido[] = [];
  const arquivosIngeridos: ArquivoIngerido[] = [...args.sessaoAtual.arquivosIngeridos];

  for (const run of runsRows) {
    if (run.status !== "concluido") {
      // Skip silencioso — frontend deveria ter filtrado.
      continue;
    }

    // Carrega `resultado` inline ou via blob.
    const pedidosBrutos = await carregarResultadoRun(run, fetchFn);

    let ambiguos = 0;
    let comExplosaoErro = 0;
    let comPrazoSemData = 0;

    for (const bruto of pedidosBrutos) {
      const enr = enriquecerPedido(
        bruto,
        run.id,
        args.ctxCadastro,
        args.ctxExplosao,
        args.ctxPrazo,
      );
      pedidosNovos.push(enr);
      if (enr.parsed.kind === "AMBIGUO") ambiguos++;
      if (enr.explosaoErro) comExplosaoErro++;
      if (enr.prazo.status === "SEM_DATA") comPrazoSemData++;
    }

    arquivosIngeridos.push({
      runId: run.id,
      tipo: run.tipo,
      arquivoNome: run.arquivoNome,
      totalLinhas: run.totalLinhas ?? pedidosBrutos.length,
      linhasValidas: run.linhasValidas ?? pedidosBrutos.length,
      linhasDescartadas: run.linhasDescartadas ?? 0,
      ingeridoEm: run.createdAt.toISOString(),
      processadoEm: new Date().toISOString(),
      ambiguos,
      comExplosaoErro,
      comPrazoSemData,
    });
  }

  // Dedup por (canal, orderId) — primeira ocorrência ganha.
  const dadosMerged = mergeComDedup(args.sessaoAtual.dados, pedidosNovos);

  const estatisticas = derivarEstatisticas(dadosMerged, args.ctxPrazo.hojeIso);

  return {
    arquivosIngeridos,
    dados: dadosMerged,
    estatisticas,
  };
}

async function carregarResultadoRun(
  run: typeof ingestaoRun.$inferSelect,
  fetchFn: FetchFn,
): Promise<PedidoBruto[]> {
  if (run.resultado != null) {
    return run.resultado as PedidoBruto[];
  }
  if (run.resultadoBlobUrl) {
    const resp = await fetchFn(run.resultadoBlobUrl, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) {
      throw new Error(
        `composer: falha ao baixar resultado do run ${run.id} (HTTP ${resp.status})`,
      );
    }
    return (await resp.json()) as PedidoBruto[];
  }
  return [];
}

function enriquecerPedido(
  bruto: PedidoBruto,
  origemRunId: string,
  ctxCadastro: ContextoCadastro,
  ctxExplosao: ContextoExplosao,
  ctxPrazo: ContextoPrazo,
): PedidoEnriquecido {
  // Normaliza identidade + campos comuns
  let comum: {
    canal: "tiktok_shop" | "mercado_livre";
    orderId: string;
    trackingId: string | null;
    skuRaw: string;
    quantidadeRaw: number;
    criadoEmIso: string | null;
    comprador: string | null;
    camposExtras: Record<string, string | null>;
  };
  if (bruto.canal === "tiktok_shop") {
    comum = {
      canal: "tiktok_shop",
      orderId: bruto.orderId,
      trackingId: bruto.trackingId,
      skuRaw: bruto.sellerSku,
      quantidadeRaw: bruto.quantidade,
      criadoEmIso: bruto.criadoEm,
      comprador: bruto.buyerUsername,
      camposExtras: {
        orderStatus: bruto.orderStatus,
        orderSubstatus: bruto.orderSubstatus,
      },
    };
  } else {
    comum = {
      canal: "mercado_livre",
      orderId: bruto.numeroVenda,
      trackingId: bruto.numeroEnvio,
      skuRaw: bruto.sku,
      quantidadeRaw: bruto.unidades,
      criadoEmIso: bruto.dataVendaIso,
      comprador: bruto.comprador,
      camposExtras: {
        Estado: bruto.estado,
        Variação: bruto.variacao,
        dataVendaRaw: bruto.dataVendaRaw,
      },
    };
  }

  // Parser
  const parsedRaw = parsearSku(comum.skuRaw, ctxCadastro);
  let parsed: PedidoEnriquecido["parsed"];
  let linhasExplodidas: PedidoEnriquecido["linhasExplodidas"] = [];
  let explosaoErro: PedidoEnriquecido["explosaoErro"] = null;

  if (parsedRaw.kind === "AMBIGUO") {
    parsed = {
      kind: "AMBIGUO",
      motivo: parsedRaw.motivo,
      detalhes: parsedRaw.detalhes,
    };
  } else {
    parsed = {
      kind: "OK",
      modeloCodigo: parsedRaw.modeloCodigo,
      tamanho: parsedRaw.tamanho,
      qtdKit: parsedRaw.qtdKit,
      canonical: parsedRaw.canonical,
      cores: parsedRaw.cores.map((c) => ({ cor: c.cor, qtd: c.qtd })),
      skuKind: parsedRaw.kind,
    };
    const expl = explodirSku(parsedRaw, ctxExplosao);
    if (expl.kind === "LINHAS") {
      linhasExplodidas = expl.linhas.map((l) => ({
        modeloCodigo: l.modeloCodigo,
        cor: l.cor,
        tamanho: l.tamanho,
        qtd: l.qtd * comum.quantidadeRaw,
      }));
    } else {
      explosaoErro = { motivo: expl.motivo, detalhes: expl.detalhes };
    }
  }

  // Prazo
  const entradaPrazo: EntradaCalculoPrazo = {
    plataforma: comum.canal,
    canalVendaId: null,
    criadoEmIso: comum.criadoEmIso,
    camposExtras: comum.camposExtras,
  };
  const prazoRes = calcularPrazo(entradaPrazo, ctxPrazo);

  return {
    origemRunId,
    canal: comum.canal,
    orderId: comum.orderId,
    trackingId: comum.trackingId,
    skuRaw: comum.skuRaw,
    quantidadeRaw: comum.quantidadeRaw,
    criadoEmIso: comum.criadoEmIso,
    comprador: comum.comprador,
    camposExtras: comum.camposExtras,
    parsed,
    linhasExplodidas,
    explosaoErro,
    prazo: {
      status: prazoRes.status,
      prazoIso: prazoRes.prazoIso,
      origem: prazoRes.origem,
      detalhes: prazoRes.detalhes,
    },
  };
}

function mergeComDedup(
  existentes: PedidoEnriquecido[],
  novos: PedidoEnriquecido[],
): PedidoEnriquecido[] {
  const vistos = new Set<string>();
  const out: PedidoEnriquecido[] = [];
  for (const p of [...existentes, ...novos]) {
    const k = `${p.canal}::${p.orderId}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push(p);
  }
  return out;
}

function derivarEstatisticas(
  dados: PedidoEnriquecido[],
  hojeIso: string,
): EstatisticasSessao {
  const porCanal: Record<string, number> = {};
  const porModelo: Record<string, number> = {};
  let totalAmbiguos = 0;
  let totalAtrasados = 0;
  let totalHoje = 0;
  let totalNoPrazo = 0;
  let totalSemData = 0;

  for (const p of dados) {
    porCanal[p.canal] = (porCanal[p.canal] ?? 0) + 1;
    if (p.parsed.kind === "OK") {
      porModelo[p.parsed.modeloCodigo] =
        (porModelo[p.parsed.modeloCodigo] ?? 0) + 1;
    } else {
      totalAmbiguos++;
    }

    if (p.prazo.status === "SEM_DATA") totalSemData++;
    else if (p.prazo.prazoIso === hojeIso) totalHoje++;
    else if (p.prazo.prazoIso != null && p.prazo.prazoIso < hojeIso)
      totalAtrasados++;
    else totalNoPrazo++;
  }

  return {
    totalPedidos: dados.length,
    totalAmbiguos,
    totalAtrasados,
    totalHoje,
    totalNoPrazo,
    totalSemData,
    porCanal,
    porModelo,
    hojeIso,
  };
}

// Re-export pra ergonomia
export { dataCivilSP };
