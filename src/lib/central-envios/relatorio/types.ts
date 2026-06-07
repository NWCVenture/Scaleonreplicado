// Tipos compartilhados do histórico/arquivamento (RITM-11).

import type {
  ArquivoIngerido,
  EstatisticasSessao,
  PedidoEnriquecido,
} from "@/lib/central-envios/sessao/types";

export type PlanejamentoListItem = {
  id: string;
  geradoEm: string;
  dataReferencia: string;
  usuarioId: string;
  usuarioNome: string | null;
  totalPedidos: number;
  totalAtrasados: number;
  totalHoje: number;
  totalAmbiguos: number;
  totalArquivos: number;
  emailEnviadoPara: string[] | null;
  emailEnviadoEm: string | null;
};

export type PlanejamentoSnapshotCliente = {
  id: string;
  geradoEm: string;
  dataReferencia: string;
  usuarioId: string;
  usuarioNome: string | null;
  arquivosIngeridos: ArquivoIngerido[];
  estatisticas: EstatisticasSessao;
  totalPedidos: number;
  totalAtrasados: number;
  totalHoje: number;
  totalAmbiguos: number;
  totalArquivos: number;
  dados: PedidoEnriquecido[] | null;
  dadosBlobUrl: string | null;
  emailEnviadoPara: string[] | null;
  emailEnviadoEm: string | null;
};
