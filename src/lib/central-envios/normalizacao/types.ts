// Tipos públicos do pipeline de normalização de SKU.
//
// Convenção: TUDO em UPPERCASE no contexto e no resultado. O input
// chega em qualquer caixa e é convertido pelo pré-processador.

/**
 * Categorias de SKU reconhecidas pelo parser. Detalhes em
 * `parsear-sku.ts` e nos critérios de aceitação do RITM-04.
 *
 *   AVULSO              — 1 unidade de (modelo, cor, tamanho)
 *   KIT_COR_UNICA       — N unidades da mesma (modelo, cor, tamanho)
 *   KIT_CORES_LISTADAS  — N unidades, 1 por cor listada
 *   KIT_DISTRIBUICAO    — distribuição explícita "q1 cor1 q2 cor2 ..."
 *   MIX                 — N cores do modelo (resolvido em RITM-05)
 */
export type SkuKind =
  | "AVULSO"
  | "KIT_COR_UNICA"
  | "KIT_CORES_LISTADAS"
  | "KIT_DISTRIBUICAO"
  | "MIX";

export type ParCorQtd = { cor: string; qtd: number };

export type SkuParsed = {
  kind: SkuKind;
  modeloCodigo: string;
  cores: ParCorQtd[]; // sempre não-vazio (exceto MIX, onde fica [])
  tamanho: string; // 'UNICO' para modelo.exigeTamanho=false
  qtdKit: number; // 1 para AVULSO; N para KIT/MIX
  canonical: string; // forma canônica pra lookup em sku_kit_regra
  input: string; // input cru
  preprocessado: string; // após uppercase + trim + alias global
};

export type MotivoAmbiguidade =
  | "input_vazio"
  | "modelo_desconhecido"
  | "cor_desconhecida"
  | "tamanho_desconhecido"
  | "kit_sem_n"
  | "kit_inconsistente"
  | "cor_ausente"
  | "tamanho_ausente"
  | "tokens_extras"
  | "mix_invalido";

export type TokenInterpretado = {
  token: string;
  resolvido: string | null;
  categoria:
    | "modelo"
    | "cor"
    | "tamanho"
    | "qtd"
    | "kit"
    | "mix"
    | "desconhecido";
};

export type SkuAmbiguo = {
  kind: "AMBIGUO";
  input: string;
  preprocessado: string;
  motivo: MotivoAmbiguidade;
  detalhes: string;
  tokensInterpretados: TokenInterpretado[];
};

export type ResultadoParsearSku = SkuParsed | SkuAmbiguo;

/** Snapshot por modelo, montado pelo loader. */
export type ModeloSnapshot = {
  id: string;
  codigo: string;
  corPadrao: string | null;
  exigeTamanho: boolean;
  corMixDefault: Record<string, string[]> | null;
  cores: string[]; // ordem alfabética
  tamanhos: string[]; // ordem do cadastro (ORDER BY ordem ASC)
};

/** Snapshot completo dos cadastros relevantes pra normalização. */
export type ContextoCadastro = {
  modelos: ModeloSnapshot[];
  modelosPorCodigo: Map<string, ModeloSnapshot>;
  coresGlobais: Set<string>;
  tamanhosGlobais: Set<string>;
  aliasesGlobais: {
    cor: Map<string, string>;
    tamanho: Map<string, string>;
  };
  aliasesPorModelo: Map<
    string,
    { cor: Map<string, string>; tamanho: Map<string, string> }
  >;
};
