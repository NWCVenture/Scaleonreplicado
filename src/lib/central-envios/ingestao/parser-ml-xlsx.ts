// Parser Mercado Livre XLSX — função pura, sem efeitos colaterais.
//
// Entrada: Buffer do export "Vendas BR — Mercado Libre y Mercado Shops"
// gerado pelo painel do Mercado Livre. Nome típico:
// AAAAMMDD_Vendas_BR_Mercado_Libre_y_Mercado_Shops_*_<CONTA>.xlsx
//
// Estrutura do XLSX:
//   - linhas 1-5 (índices 0-4): metadata (título, período, conta)
//   - linha 6 (índice 5):       header das colunas
//   - linhas 7+ (índices 6+):   dados
//
// Importante:
//   - NENHUMA normalização de SKU/cor/tamanho. RITM-04 normaliza.
//   - NÃO extrai prazo de "Estado" — RITM-06 faz isso. Aqui só preserva.
//   - Dedup intra-arquivo por N.º de venda (mantém primeiro). Cross-file
//     dedup é responsabilidade do merge de sessão (RITM-07).

import * as XLSX from "xlsx";
import { ParserError, MAX_INPUT_BYTES } from "./parser-tiktok-csv";

// Re-exporta o limite — fonte única.
export { MAX_INPUT_BYTES, ParserError };

// Colunas obrigatórias do header ML. Atenção ao `º` (ordinal masculino,
// U+00BA, NÃO degree sign U+00B0).
const COLUNAS_OBRIGATORIAS = [
  "N.º de venda",
  "Data da venda",
  "SKU",
  "Unidades",
] as const;

// Colunas opcionais — incluídas no resultado quando presentes.
const COL_VARIACAO = "Variação" as const;
const COL_ESTADO = "Estado" as const;
const COL_COMPRADOR = "Comprador" as const;
const COL_NUMERO_ENVIO = "N.º de envio" as const;

// Linhas de SKU que representam o "agregador" da venda — devem ser
// ignoradas porque os produtos vêm linha-a-linha em seguida.
const REGEX_PACOTE_DIVERSOS = /^Pacote de \d+ produtos?$/i;

export type PedidoMlBruto = {
  canal: "mercado_livre";
  numeroVenda: string;
  numeroEnvio: string | null;
  sku: string;
  variacao: string | null;
  estado: string | null;
  unidades: number;
  comprador: string | null;
  // ISO 8601 UTC quando conseguiu parsear; null caso contrário.
  dataVendaIso: string | null;
  // Como veio no XLSX (string ou Date.toString()). Útil pra debug e
  // pra RITM-06 caso precise re-parsear.
  dataVendaRaw: string;
};

export type DescarteMotivoMl =
  | "pacote_diversos"
  | "linha_vazia"
  | "dedup_intra_arquivo"
  | "quantidade_invalida"
  | "numero_venda_vazio";

export type ResultadoMlParser = {
  pedidos: PedidoMlBruto[];
  totalLinhas: number;
  linhasValidas: number;
  linhasDescartadas: number;
  descartesResumo: Record<DescarteMotivoMl, number>;
};

function tamanhoBytes(input: Buffer | string): number {
  return typeof input === "string"
    ? Buffer.byteLength(input, "utf8")
    : input.length;
}

function trimSe(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

// Converte qualquer cell value pra um número inteiro positivo, ou null
// se inválido. Aceita: número JS, string "5", string "5,0", "5.0".
function parseUnidades(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) {
    return Math.trunc(v);
  }
  if (typeof v === "string") {
    const limpa = v.trim().replace(",", ".");
    const n = Number(limpa);
    if (Number.isFinite(n) && n > 0) return Math.trunc(n);
  }
  return null;
}

// Tenta converter a cell de "Data da venda" em ISO UTC. Aceita Date
// (quando xlsx tá com cellDates:true) ou string em formato pt-BR
// DD/MM/YYYY HH:MM[:SS] (com ou sem segundos). TZ assumida:
// America/Sao_Paulo UTC-3 fixo (mesma premissa do TikTok parser).
//
// Retorna { iso, raw }:
//   - raw: representação textual do valor original
//   - iso: ISO UTC quando conseguiu; null senão.
function parseDataVenda(v: unknown): { iso: string | null; raw: string } {
  if (v instanceof Date) {
    return { iso: v.toISOString(), raw: v.toISOString() };
  }
  if (typeof v === "number") {
    // XLSX serial date (dias desde 1899-12-30). Convertemos via
    // utilitário do próprio xlsx pra Date.
    const d = XLSX.SSF?.parse_date_code?.(v);
    if (d && Number.isFinite(d.y)) {
      // Tratamos como local SP UTC-3.
      const utcMs = Date.UTC(d.y, d.m - 1, d.d, d.H + 3, d.M, d.S);
      if (Number.isFinite(utcMs)) {
        return { iso: new Date(utcMs).toISOString(), raw: String(v) };
      }
    }
    return { iso: null, raw: String(v) };
  }
  if (typeof v === "string") {
    const raw = v.trim();
    // DD/MM/YYYY[ HH:MM[:SS]] — com ou sem hora.
    const m = raw.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
    );
    if (m) {
      const [, dd, mm, yyyy, hh = "0", mi = "0", ss = "0"] = m;
      const d = Number(dd);
      const M = Number(mm);
      const y = Number(yyyy);
      const H = Number(hh);
      const Mi = Number(mi);
      const S = Number(ss);
      if (
        M >= 1 &&
        M <= 12 &&
        d >= 1 &&
        d <= 31 &&
        H >= 0 &&
        H <= 23 &&
        Mi >= 0 &&
        Mi <= 59 &&
        S >= 0 &&
        S <= 59
      ) {
        const utcMs = Date.UTC(y, M - 1, d, H + 3, Mi, S);
        const back = new Date(utcMs);
        // sanity: month sem overflow
        if (back.getUTCMonth() === M - 1 || back.getUTCMonth() === M % 12) {
          return { iso: back.toISOString(), raw };
        }
      }
    }
    return { iso: null, raw };
  }
  return { iso: null, raw: "" };
}

/**
 * Parseia um XLSX exportado pelo painel do Mercado Livre. Função pura.
 *
 * @param input Buffer (XLSX binário) ou string (raro; não usar em prod).
 * @returns ResultadoMlParser com pedidos + estatísticas.
 * @throws ParserError quando o input é inválido (size, header, sheet
 *         ausente).
 */
export function parsearMlXlsx(input: Buffer | string): ResultadoMlParser {
  if (tamanhoBytes(input) > MAX_INPUT_BYTES) {
    throw new ParserError(
      "arquivo_muito_grande",
      `Arquivo excede ${MAX_INPUT_BYTES} bytes (${MAX_INPUT_BYTES / (1024 * 1024)}MB)`,
    );
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(input, {
      type: typeof input === "string" ? "string" : "buffer",
      cellDates: true,
    });
  } catch (err) {
    throw new ParserError(
      "xlsx_invalido",
      `Falha ao ler XLSX: ${(err as Error).message}`,
    );
  }

  const primeiroSheetNome = workbook.SheetNames[0];
  if (!primeiroSheetNome) {
    throw new ParserError("xlsx_sem_sheets", "Workbook sem sheets");
  }
  const sheet = workbook.Sheets[primeiroSheetNome];
  if (!sheet) {
    throw new ParserError(
      "xlsx_sheet_vazio",
      `Sheet '${primeiroSheetNome}' vazio`,
    );
  }

  // Header em linha 6 (índice 5), dados a partir do índice 6.
  // Com `range: 5`, sheet_to_json retorna [header, ...dados].
  const linhas = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    range: 5,
    defval: null,
    raw: true,
    blankrows: false,
  });

  if (linhas.length === 0) {
    throw new ParserError(
      "xlsx_sem_dados",
      "XLSX sem dados após o header (linhas 7+)",
    );
  }

  const header = (linhas[0] ?? []).map(trimSe);
  const indexPorColuna = new Map<string, number>();
  header.forEach((nome, idx) => {
    if (nome !== "") indexPorColuna.set(nome, idx);
  });

  const ausentes = COLUNAS_OBRIGATORIAS.filter(
    (col) => !indexPorColuna.has(col),
  );
  if (ausentes.length > 0) {
    throw new ParserError(
      "colunas_ausentes",
      `Colunas obrigatórias ausentes: ${ausentes.join(", ")}`,
    );
  }

  const idxNumeroVenda = indexPorColuna.get("N.º de venda")!;
  const idxDataVenda = indexPorColuna.get("Data da venda")!;
  const idxSku = indexPorColuna.get("SKU")!;
  const idxUnidades = indexPorColuna.get("Unidades")!;
  const idxVariacao = indexPorColuna.get(COL_VARIACAO);
  const idxEstado = indexPorColuna.get(COL_ESTADO);
  const idxComprador = indexPorColuna.get(COL_COMPRADOR);
  const idxNumeroEnvio = indexPorColuna.get(COL_NUMERO_ENVIO);

  const pedidos: PedidoMlBruto[] = [];
  const numerosVistos = new Set<string>();
  const descartesResumo: Record<DescarteMotivoMl, number> = {
    pacote_diversos: 0,
    linha_vazia: 0,
    dedup_intra_arquivo: 0,
    quantidade_invalida: 0,
    numero_venda_vazio: 0,
  };

  let totalLinhas = 0;

  for (let i = 1; i < linhas.length; i++) {
    const linha = linhas[i];
    if (!linha) continue;

    const sku = trimSe(linha[idxSku]);
    const numeroVenda = trimSe(linha[idxNumeroVenda]);
    const unidadesRaw = linha[idxUnidades];

    // Linha completamente vazia — não conta como linha de dados.
    if (sku === "" && numeroVenda === "" && unidadesRaw == null) {
      continue;
    }

    totalLinhas++;

    // "Pacote de N produtos" — agregador; o detalhe vem em linhas
    // separadas. Ignorar.
    if (REGEX_PACOTE_DIVERSOS.test(sku)) {
      descartesResumo.pacote_diversos++;
      continue;
    }

    if (numeroVenda === "") {
      descartesResumo.numero_venda_vazio++;
      continue;
    }

    if (numerosVistos.has(numeroVenda)) {
      descartesResumo.dedup_intra_arquivo++;
      continue;
    }

    const unidades = parseUnidades(unidadesRaw);
    if (unidades == null) {
      descartesResumo.quantidade_invalida++;
      continue;
    }

    const { iso: dataVendaIso, raw: dataVendaRaw } = parseDataVenda(
      linha[idxDataVenda],
    );

    const variacao =
      idxVariacao != null ? trimSe(linha[idxVariacao]) || null : null;
    const estado = idxEstado != null ? trimSe(linha[idxEstado]) || null : null;
    const comprador =
      idxComprador != null ? trimSe(linha[idxComprador]) || null : null;
    const numeroEnvio =
      idxNumeroEnvio != null ? trimSe(linha[idxNumeroEnvio]) || null : null;

    numerosVistos.add(numeroVenda);
    pedidos.push({
      canal: "mercado_livre",
      numeroVenda,
      numeroEnvio,
      sku,
      variacao,
      estado,
      unidades,
      comprador,
      dataVendaIso,
      dataVendaRaw,
    });
  }

  return {
    pedidos,
    totalLinhas,
    linhasValidas: pedidos.length,
    linhasDescartadas: totalLinhas - pedidos.length,
    descartesResumo,
  };
}
