// Tipos da sessão Central de Envios.
//
// PedidoEnriquecido é o "achatamento" do output dos 3 pipelines
// (RITM-04/05/06) numa estrutura única que o frontend consome sem
// precisar re-parsear nada.

import type { PlataformaCanal } from "@/lib/db/schema";

export type ArquivoIngerido = {
  runId: string;
  tipo: "tiktok_csv" | "ml_xlsx";
  arquivoNome: string;
  totalLinhas: number;
  linhasValidas: number;
  linhasDescartadas: number;
  ingeridoEm: string; // ISO UTC
  processadoEm: string | null;
  ambiguos: number;
  comExplosaoErro: number;
  comPrazoSemData: number;
};

export type PrazoStatus = "CALCULADO" | "HOJE" | "SEM_DATA";

export type SkuKindEnriquecido =
  | "AVULSO"
  | "KIT_COR_UNICA"
  | "KIT_CORES_LISTADAS"
  | "KIT_DISTRIBUICAO"
  | "MIX";

export type ParsedOk = {
  kind: "OK";
  modeloCodigo: string;
  tamanho: string;
  qtdKit: number;
  canonical: string;
  cores: Array<{ cor: string; qtd: number }>;
  skuKind: SkuKindEnriquecido;
};

export type ParsedAmbiguo = {
  kind: "AMBIGUO";
  motivo: string;
  detalhes: string;
};

export type LinhaExplodidaSerializada = {
  modeloCodigo: string;
  cor: string;
  tamanho: string;
  qtd: number;
};

export type PedidoEnriquecido = {
  // Identidade
  origemRunId: string;
  canal: PlataformaCanal;
  orderId: string;
  trackingId: string | null;
  // Raw (mantido pra UI mostrar e pra extrator)
  skuRaw: string;
  quantidadeRaw: number;
  criadoEmIso: string | null;
  comprador: string | null;
  camposExtras: Record<string, string | null>;
  // Normalização
  parsed: ParsedOk | ParsedAmbiguo;
  // Explosão
  linhasExplodidas: LinhaExplodidaSerializada[];
  explosaoErro: { motivo: string; detalhes: string } | null;
  // Prazo
  prazo: {
    status: PrazoStatus;
    prazoIso: string | null;
    origem: string | null;
    detalhes: string;
  };
};

export type EstatisticasSessao = {
  totalPedidos: number;
  totalAmbiguos: number;
  totalAtrasados: number;
  totalHoje: number;
  totalNoPrazo: number;
  totalSemData: number;
  porCanal: Record<string, number>;
  porModelo: Record<string, number>;
  hojeIso: string;
};

export type ResultadoComposer = {
  arquivosIngeridos: ArquivoIngerido[];
  dados: PedidoEnriquecido[];
  estatisticas: EstatisticasSessao;
};
