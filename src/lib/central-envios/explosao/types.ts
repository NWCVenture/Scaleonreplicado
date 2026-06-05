// Tipos públicos do pipeline de explosão de SKU.
//
// Convenção: opera sobre SkuParsed (saída do RITM-04). Tudo já em
// UPPERCASE — não fazemos normalização aqui.

import type { ContextoCadastro, SkuParsed } from "../normalizacao/types";

export type LinhaExplodida = {
  modeloCodigo: string;
  cor: string;
  tamanho: string;
  qtd: number;
};

export type MotivoExplosaoErro =
  | "componente_ambiguo"
  | "componente_nao_avulso"
  | "mix_cores_insuficientes"
  | "mix_modelo_sem_cores"
  | "sku_kind_nao_suportado";

export type ExplosaoErro = {
  kind: "EXPLOSAO_ERRO";
  motivo: MotivoExplosaoErro;
  detalhes: string;
  parsed: SkuParsed;
};

export type LinhasExplodidas = {
  kind: "LINHAS";
  linhas: LinhaExplodida[];
  origem: "nominal" | "parametrico";
  canonical: string;
};

export type ResultadoExplosao = LinhasExplodidas | ExplosaoErro;

export type KitRegraComponenteResolvido = {
  componenteSku: string;
  componenteCanonical: string;
  quantidade: number;
  modeloCodigo: string;
  cor: string;
  tamanho: string;
};

export type KitRegraSnapshot = {
  id: string;
  kitSku: string;
  canonical: string;
  componentes: KitRegraComponenteResolvido[];
};

export type ProblemaKitRegra = {
  kitRegraId: string;
  kitSku: string;
  motivo: "kit_sku_ambiguo" | "componente_ambiguo" | "componente_nao_avulso";
  detalhes: string;
};

export type ContextoExplosao = {
  cadastro: ContextoCadastro;
  kitRegrasPorCanonical: Map<string, KitRegraSnapshot>;
  kitRegrasComProblema: ProblemaKitRegra[];
};
