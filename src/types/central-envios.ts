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

export type CategoriaRegra =
  | { tipo: "regex"; pattern: string; flags?: string }
  | {
      tipo: "composicao";
      modeloCodigo: string;
      qtdMin?: number;
      qtdMax?: number;
    }
  | { tipo: "tag"; tags: string[] };

export type CategoriaSkuClient = {
  id: string;
  nome: string;
  ordem: number;
  ativo: boolean;
  regras: CategoriaRegra[];
};

export type StatusPrazoUi = "ATRASADO" | "HOJE" | "NO_PRAZO" | "SEM_DATA";

export type FiltrosExtrator = {
  plataformas?: string[];
  statusPrazo?: StatusPrazoUi[];
  categoriaIds?: string[];
  modelos?: string[];
  cores?: string[];
  tamanhos?: string[];
  busca?: string;
  soAmbiguos?: boolean;
};

// ------------------------------------------------------------------
// Tipos da UI de Configurações (RITM-10)
// ------------------------------------------------------------------

export type PapelClient =
  | "owner"
  | "admin"
  | "gerente"
  | "operador"
  | "costureiro"
  | "financeiro"
  | "fiscal"
  | "supervisor"
  | "funcionario"
  | "expedicao";

export type PlataformaCanalClient = "tiktok_shop" | "shopee" | "mercado_livre";

export type CanalEstrategiaPrazoClient =
  | "DIAS_UTEIS_POS_VENDA"
  | "CAMPO_EXPLICITO"
  | "HIBRIDO";

export type CanalVendaResumo = {
  id: string;
  nomeExibicao: string;
  plataforma: PlataformaCanalClient;
};

export type RegraPrazoClient = {
  id: string;
  canalVendaId: string | null;
  canalNomeExibicao: string | null;
  plataforma: PlataformaCanalClient;
  estrategia: CanalEstrategiaPrazoClient;
  diasUteis: number | null;
  campoPrazo: string | null;
  regexPrazo: string | null;
  fallbackHoje: boolean;
  ativo: boolean;
};

export type ModeloResumo = {
  id: string;
  codigo: string;
};

export type AliasClient = {
  id: string;
  modeloId: string | null;
  modeloCodigo: string | null;
  codigoAlias: string;
  codigoReal: string;
};

export type FeriadoClient = {
  id: string;
  data: string;
  descricao: string;
  fonte: string;
};

// ------------------------------------------------------------------
// Histórico/arquivamento (RITM-11)
// ------------------------------------------------------------------

export type {
  PlanejamentoListItem,
  PlanejamentoSnapshotCliente,
} from "@/lib/central-envios/relatorio/types";
