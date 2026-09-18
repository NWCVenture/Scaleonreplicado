// Contrato da etiqueta de fardo da Estante Virtual.
//
// Este módulo é a fonte única da verdade sobre "o que é uma etiqueta válida":
// tamanho, quantidade de campos, e onde mora a identidade do fardo.
//
// Constrói em cima de `parseQRCode` (src/lib/estante-utils.ts) sem alterá-lo —
// aquele parser também serve o fluxo de Importar Balanço, que é mais tolerante
// por natureza. Aqui a régua é estrita: é a fronteira de escrita no banco.

import { parseQRCode } from "@/lib/estante-utils";

// ============================================================
// Contrato
// ============================================================

// Versões emitidas pelo cadastro. O número é a contagem de campos:
//   v1: SKU}LOTE}QTD                                   — sem identidade
//   v2: SKU}LOTE}QTD}CODIGO_FARDO                      — só codigoFardo
//   v3: SKU}LOTE}QTD}CODIGO_FARDO}ISO}USUARIO}UUID     — codigoFardo + uuid
export const CAMPOS_POR_VERSAO = { 3: 1, 4: 2, 7: 3 } as const;

export type VersaoQR = (typeof CAMPOS_POR_VERSAO)[keyof typeof CAMPOS_POR_VERSAO];

// Teto de caracteres. Derivado do maior payload legítimo (v3):
//   sku 64 + lote 64 + qtd 6 + codigoFardo 16 + ISO 28 + usuario 64 + uuid 36
//   + 6 separadores ≈ 284. Arredondado para 512 (~1,8x de folga).
// Existe para barrar entrada malformada — o caso real observado em produção
// foi um bloco de 24 linhas colado de uma vez, com 2.660 caracteres, do qual
// o sistema gravou só a primeira linha e descartou as outras 23 em silêncio.
export const MAX_QR_LEN = 512;

// Mesmos separadores que `parseQRCode` aceita. `{` aparece quando o scanner
// HID emite em layout US e o Windows traduz pra ABNT2 (`}`/`{` trocados).
const SEPARADORES = /[}{|]/;

export type MotivoRecusa =
  | "vazio"
  | "tamanho-excedido"
  | "campos-invalidos"
  | "nao-parseavel";

export interface FardoValidado {
  /** Payload original, apenas com bordas aparadas. É o que vai pro banco. */
  qrCode: string;
  /** Derivado do QR e normalizado — nunca vem do cliente. */
  sku: string;
  lote: string;
  quantidade: number;
  /** Campo 4. `null` em v1. */
  codigoFardo: string | null;
  /** Campo 7. `null` em v1 e v2. */
  fardoUuid: string | null;
  versao: VersaoQR;
}

export type ResultadoValidacao =
  | { ok: true; fardo: FardoValidado }
  | { ok: false; motivo: MotivoRecusa; detalhe: string };

// ============================================================
// Normalização
// ============================================================

/**
 * Canonicaliza o SKU: maiúsculas e espaços internos colapsados.
 *
 * Sem isso, "LUA CZ M", "LUA  CZ  M" e "lua cz m" viram três produtos
 * distintos na matriz — o mesmo empilhamento físico contado em triplicado.
 * Espelha `normalizeSku` da tela de cadastro, que já fazia isso na emissão;
 * a ingestão da estante é que nunca aplicou.
 */
export function normalizarSku(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, " ");
}

// ============================================================
// Validação
// ============================================================

/** Conta campos usando a mesma regra de `parseQRCode` (aparar + separadores). */
export function contarCampos(raw: string): number {
  const limpo = raw.trim().replace(/^[|{}]+/, "").trim();
  if (!limpo) return 0;
  return limpo.split(SEPARADORES).length;
}

function versaoPorCampos(n: number): VersaoQR | null {
  return (CAMPOS_POR_VERSAO as Record<number, VersaoQR>)[n] ?? null;
}

/**
 * Régua estrita para escrita no banco.
 *
 * Difere de `parseQRCode` em dois pontos deliberados:
 *  - exige contagem de campos exata (3, 4 ou 7). O parser aceita `>= 3` e
 *    ignora o excedente, que é como o payload de 2.660 caracteres passou.
 *  - impõe teto de tamanho.
 */
export function validarQR(raw: string): ResultadoValidacao {
  const bruto = (raw ?? "").trim();

  if (!bruto) {
    return { ok: false, motivo: "vazio", detalhe: "QR vazio" };
  }

  if (bruto.length > MAX_QR_LEN) {
    return {
      ok: false,
      motivo: "tamanho-excedido",
      detalhe: `${bruto.length} caracteres (máximo ${MAX_QR_LEN})`,
    };
  }

  const campos = contarCampos(bruto);
  const versao = versaoPorCampos(campos);
  if (versao === null) {
    return {
      ok: false,
      motivo: "campos-invalidos",
      detalhe: `${campos} campo(s); esperado 3, 4 ou 7`,
    };
  }

  const parsed = parseQRCode(bruto);
  if (!parsed) {
    return {
      ok: false,
      motivo: "nao-parseavel",
      detalhe: "SKU, lote ou quantidade ausentes/inválidos",
    };
  }

  return {
    ok: true,
    fardo: {
      qrCode: bruto,
      sku: normalizarSku(parsed.sku),
      lote: parsed.lote.trim(),
      quantidade: parsed.qtd,
      codigoFardo: parsed.codigoFardo ?? null,
      fardoUuid: parsed.uuid ?? null,
      versao,
    },
  };
}

// ============================================================
// Identidade
// ============================================================

/**
 * Um fardo só é deduplicável se a etiqueta carrega identificador.
 *
 * Em v1 (`SKU}LOTE}QTD`) isso é impossível por natureza: dois fardos físicos
 * distintos do mesmo produto, lote e quantidade produzem strings idênticas.
 * Não dá pra distinguir duplicata de estoque legítimo — a informação não
 * existe na etiqueta. Esses casos entram sinalizados, não em silêncio.
 */
export function temIdentidade(fardo: FardoValidado): boolean {
  return fardo.codigoFardo !== null || fardo.fardoUuid !== null;
}
