import type {
  TipoColeta,
  ContaOperacao,
  TransportadoraLabel,
} from "@/lib/db/schema";

// Re-export for convenience
export type { TipoColeta, ContaOperacao, TransportadoraLabel };

// SKU line used in devolucao forms and kit rules
export interface SkuLine {
  sku: string;
  qtd: number;
}

// Devolucao form data (sent in finalize POST)
export interface DevolucaoFormData {
  skuLines: SkuLine[];
  operacao: ContaOperacao;
  avaria: boolean;
  obs: string;
  tipo: TipoColeta;
  fotoPacoteBase64?: string;
  fotoAvariaBase64?: string;
}

// Map of packageCode → devolucao data
export type DevolucoesMap = Record<string, DevolucaoFormData>;

// Carrier pattern for prefix detection
export interface CarrierPattern {
  id: string;
  transportadora: string;
  prefixos: string[];
}

// Kit rule with components
export interface SkuKitRule {
  id: string;
  kitSku: string;
  components: SkuLine[];
}

// API response types
export interface BipagemRecord {
  id: string;
  tipo: TipoColeta;
  conta: ContaOperacao;
  total: number;
  revisado: boolean;
  revisadoPor: string | null;
  revisadoPorNome: string | null;
  revisadoEm: string | null;
  usuarioId: string;
  usuarioNome: string;
  createdAt: string;
}

export interface BipagemPacoteRecord {
  id: string;
  codigo: string;
  transportadora: TransportadoraLabel | null;
}

export interface BipagemDevolucaoRecord {
  id: string;
  operacao: ContaOperacao;
  avaria: boolean;
  observacao: string | null;
  tipo: TipoColeta;
  fotoPacoteUrl: string | null;
  fotoAvariaUrl: string | null;
  skuLines: { sku: string; quantidade: number }[];
}

export interface BipagemDetail extends BipagemRecord {
  pacotes: (BipagemPacoteRecord & { devolucao?: BipagemDevolucaoRecord })[];
}

export interface BipagemTemporariaRecord {
  id: string;
  tipo: TipoColeta;
  conta: ContaOperacao;
  total: number;
  dados: {
    pacotes: Array<{ codigo: string; transportadora?: string }>;
    devolucoes: Record<
      string,
      {
        skuLines: Array<{ sku: string; qtd: number }>;
        operacao: string;
        avaria: string;
        obs: string;
        tipo: string;
      }
    >;
  };
  usuarioId: string;
  createdAt: string;
}

// Constants
export const FUNCTION_TYPES: TipoColeta[] = [
  "FLEX",
  "COLETA",
  "DEVOLUCAO",
  "CANCELADO",
];
export const OPERATIONS: ContaOperacao[] = [
  "TIKTOK_SHOP",
  "MERCADO_LIVRE",
  "SHOPEE",
];

export const FUNCTION_DISPLAY: Record<TipoColeta, string> = {
  FLEX: "FLEX",
  COLETA: "COLETA",
  DEVOLUCAO: "DEVOLUÇÃO",
  CANCELADO: "CANCELADO",
};

export const OPERATION_DISPLAY: Record<ContaOperacao, string> = {
  TIKTOK_SHOP: "TIKTOK SHOP",
  MERCADO_LIVRE: "MERCADO LIVRE",
  SHOPEE: "SHOPEE",
};

export const CARRIER_DISPLAY: Record<TransportadoraLabel, string> = {
  TTK_JDLOG: "TTK-JDLOG",
  TTK_IMILE: "TTK-IMILE",
  ML: "ML",
  SHP: "SHP",
  DESCONHECIDA: "?",
};

export const CARRIER_COLORS: Record<TransportadoraLabel, string> = {
  TTK_JDLOG: "bg-green-700/20 text-green-500 border-green-700/30",
  TTK_IMILE: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  ML: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  SHP: "bg-red-500/20 text-red-400 border-red-500/30",
  DESCONHECIDA: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
};

export const EMPTY_SKU_LINE: SkuLine = { sku: "", qtd: 1 };
