// Re-exporta types do backend pra UI usar sem importar de @/lib/db.
//
// Mantém o boundary entre lib (backend-only) e UI clara: páginas e
// componentes importam só de @/types/central-envios.

export type {
  ArquivoIngerido,
  EstatisticasSessao,
  LinhaExplodidaSerializada,
  ParsedAmbiguo,
  ParsedOk,
  PedidoEnriquecido,
  PrazoStatus,
  ResultadoComposer,
  SkuKindEnriquecido,
} from "@/lib/central-envios/sessao/types";

export type SessaoCentralEnviosResumo = {
  id: string;
  status: "ativa" | "encerrada";
  tipoVisualizacao: string;
  filtrosExtrator: Record<string, unknown>;
  iniciouEm: string;
  ultimaAtividadeEm: string;
  dadosBlobUrl: string | null;
};

export type UploadEstado =
  | { status: "enviando"; progresso?: number }
  | {
      status: "processando";
      runId: string;
      progresso?: number;
    }
  | {
      status: "concluido";
      runId: string;
      totalLinhas: number;
      linhasValidas: number;
      linhasDescartadas: number;
    }
  | { status: "erro"; runId?: string; erro: string };

export type UploadEmAndamento = {
  id: string;
  arquivoNome: string;
  tipoIngestao: "tiktok_csv" | "ml_xlsx";
  estado: UploadEstado;
};
