// Parser TikTok Shop CSV — função pura, sem efeitos colaterais.
//
// Entrada: Buffer (UTF-8 com ou sem BOM) ou string contendo o CSV de
// "Para_enviar_pedido-*.csv" exportado pelo painel do TikTok Seller.
//
// Saída: ResultadoParser com pedidos normalizados (campos do CSV mapeados
// pra schema interno) + estatísticas + breakdown de descartes.
//
// Importante:
//   - NENHUMA normalização de SKU/cor/tamanho acontece aqui. Isso vai
//     pra RITM-04. `sellerSku` vem literal do CSV.
//   - `criadoEm` é convertido pra ISO UTC assumindo timezone America/Sao_Paulo
//     (UTC-3 fixo, sem horário de verão — BR não tem mais desde 2019). Se
//     for descoberto que o TikTok exporta outro timezone, ajustar aqui e
//     revalidar fixtures de timezone.
//   - O filtro de Order Status default é "A ser enviado" — recorte da
//     ferramenta original. Customizável via `opts.filtrarOrderStatus`.

import { parse } from "csv-parse/sync";

// Limite de 50MB no input (vide spec). CSV típico do TikTok BR fica < 1MB.
export const MAX_INPUT_BYTES = 50 * 1024 * 1024;

// Filtro default — recorte "vou despachar hoje" no painel do TikTok.
export const DEFAULT_FILTRO_ORDER_STATUS = "A ser enviado";

// Colunas obrigatórias no header. `Order Substatus` é opcional.
const COLUNAS_OBRIGATORIAS = [
  "Order ID",
  "Tracking ID",
  "Seller SKU",
  "Quantity",
  "Buyer Username",
  "Created Time",
  "Order Status",
] as const;

const COLUNA_OPCIONAL = "Order Substatus" as const;

export type PedidoNormalizadoBruto = {
  canal: "tiktok_shop";
  orderId: string;
  trackingId: string | null;
  sellerSku: string;
  quantidade: number;
  buyerUsername: string | null;
  // ISO 8601 UTC, derivado de "MM/DD/YYYY HH:MM:SS AM/PM" assumindo UTC-3.
  criadoEm: string;
  orderStatus: string;
  orderSubstatus: string | null;
};

export type DescarteMotivo =
  | "status_diferente_filtro"
  | "linha_vazia"
  | "data_invalida"
  | "quantidade_invalida";

export type ResultadoParser = {
  pedidos: PedidoNormalizadoBruto[];
  totalLinhas: number;
  linhasValidas: number;
  linhasDescartadas: number;
  descartesResumo: Record<DescarteMotivo, number>;
};

// Erro humano-legível com `codigo` machine-readable (vai pra
// ingestao_run.erro_codigo). Não usamos `Error` puro porque a Inngest
// function precisa decidir retry vs final fail baseado no código.
export class ParserError extends Error {
  readonly codigo: string;
  constructor(codigo: string, mensagem: string) {
    super(mensagem);
    this.name = "ParserError";
    this.codigo = codigo;
  }
}

function tamanhoBytes(input: Buffer | string): number {
  return typeof input === "string" ? Buffer.byteLength(input, "utf8") : input.length;
}

// Limpa `\t` no fim de cada campo (TikTok adiciona em alguns) + trim de
// espaços. Não toca em \t no meio (raro, mas se acontecer não é nossa
// briga).
function limparCampo(valor: string | undefined): string {
  if (valor == null) return "";
  return valor.replace(/\t+$/, "").trim();
}

function camposVazios(linha: string[]): boolean {
  return linha.every((c) => limparCampo(c) === "");
}

// Converte "MM/DD/YYYY HH:MM:SS AM/PM" (timezone America/Sao_Paulo,
// UTC-3) em ISO 8601 UTC. Retorna null se o formato não bater.
//
// Por que parse manual em vez de `new Date(str)`: o ECMAScript spec
// permite browsers/runtimes interpretarem datas locale-dependent. Node
// e Chrome divergem aqui. Manual é determinístico.
function parseCreatedTimeToISO(valor: string): string | null {
  const match = valor.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s+(AM|PM)$/i,
  );
  if (!match) return null;

  const [, mmStr, ddStr, yyyyStr, hhStr, MMStr, ssStr, period] = match;
  const mm = Number(mmStr);
  const dd = Number(ddStr);
  const yyyy = Number(yyyyStr);
  let hh = Number(hhStr);
  const minutes = Number(MMStr);
  const seconds = Number(ssStr);

  // Validação básica (não pega 31 de fev, mas o Date.UTC mais abaixo
  // pega — meses inválidos viram NaN).
  if (mm < 1 || mm > 12) return null;
  if (dd < 1 || dd > 31) return null;
  if (hh < 1 || hh > 12) return null;
  if (minutes < 0 || minutes > 59) return null;
  if (seconds < 0 || seconds > 59) return null;

  // 12-hour → 24-hour
  if (period.toUpperCase() === "AM") {
    if (hh === 12) hh = 0; // 12 AM = 00h
  } else {
    if (hh !== 12) hh += 12; // 12 PM continua 12h; demais somam 12
  }

  // Local BR UTC-3 → UTC: somar 3h.
  const utcMs = Date.UTC(yyyy, mm - 1, dd, hh + 3, minutes, seconds);
  if (Number.isNaN(utcMs)) return null;

  // Sanity: Date.UTC rolls overflow (mm=2,dd=31 vira março). Detecta:
  const back = new Date(utcMs);
  if (back.getUTCDate() !== dd && back.getUTCDate() !== dd - 30) {
    // dd-30 cobre 31 → 1 do mês seguinte, que é o overflow esperado.
    // Aqui detectamos overflow real de dia inválido tipo 32.
    if (
      back.getUTCMonth() !== mm - 1 &&
      back.getUTCMonth() !== mm % 12 // mês seguinte por overflow leve
    ) {
      return null;
    }
  }

  return back.toISOString();
}

function decodeToString(input: Buffer | string): string {
  if (typeof input === "string") return input;
  // UTF-8 é o esperado. BOM é tratado pelo csv-parse via bom:true.
  return input.toString("utf8");
}

/**
 * Parseia um CSV exportado pelo painel do TikTok Shop. Função pura.
 *
 * @param input Buffer (UTF-8) ou string do CSV.
 * @param opts.filtrarOrderStatus Status que define "incluir no resultado".
 *        Default: "A ser enviado". Outros valores descartam a linha com
 *        motivo `status_diferente_filtro`.
 * @returns ResultadoParser com pedidos + estatísticas.
 * @throws ParserError quando o input é inválido (size, header).
 */
export function parsearTikTokCsv(
  input: Buffer | string,
  opts: { filtrarOrderStatus?: string } = {},
): ResultadoParser {
  if (tamanhoBytes(input) > MAX_INPUT_BYTES) {
    throw new ParserError(
      "arquivo_muito_grande",
      `Arquivo excede ${MAX_INPUT_BYTES} bytes (${MAX_INPUT_BYTES / (1024 * 1024)}MB)`,
    );
  }

  const filtroStatus = opts.filtrarOrderStatus ?? DEFAULT_FILTRO_ORDER_STATUS;
  const texto = decodeToString(input);

  // columns: false → linhas vêm como string[]. Isso nos deixa
  // controlar mapeamento de coluna manualmente — se o TikTok renomear
  // "Order ID" pra "OrderID", queremos falhar explícito em vez de
  // silenciosamente pegar a coluna errada.
  let linhas: string[][];
  try {
    linhas = parse(texto, {
      columns: false,
      skip_empty_lines: false,
      relax_column_count: true,
      bom: true,
      trim: false, // limparCampo lida com isso por coluna
    }) as string[][];
  } catch (err) {
    throw new ParserError(
      "csv_invalido",
      `Falha ao parsear CSV: ${(err as Error).message}`,
    );
  }

  if (linhas.length === 0) {
    throw new ParserError("csv_vazio", "CSV sem linhas (nem header)");
  }

  // Header é a primeira linha não-vazia.
  const headerLinha = linhas[0].map(limparCampo);
  const indexPorColuna = new Map<string, number>();
  headerLinha.forEach((nome, idx) => indexPorColuna.set(nome, idx));

  const ausentes = COLUNAS_OBRIGATORIAS.filter(
    (col) => !indexPorColuna.has(col),
  );
  if (ausentes.length > 0) {
    throw new ParserError(
      "colunas_ausentes",
      `Colunas obrigatórias ausentes: ${ausentes.join(", ")}`,
    );
  }

  const idxOrderId = indexPorColuna.get("Order ID")!;
  const idxTrackingId = indexPorColuna.get("Tracking ID")!;
  const idxSellerSku = indexPorColuna.get("Seller SKU")!;
  const idxQuantity = indexPorColuna.get("Quantity")!;
  const idxBuyerUsername = indexPorColuna.get("Buyer Username")!;
  const idxCreatedTime = indexPorColuna.get("Created Time")!;
  const idxOrderStatus = indexPorColuna.get("Order Status")!;
  const idxOrderSubstatus = indexPorColuna.get(COLUNA_OPCIONAL); // pode ser undefined

  const pedidos: PedidoNormalizadoBruto[] = [];
  const descartesResumo: Record<DescarteMotivo, number> = {
    status_diferente_filtro: 0,
    linha_vazia: 0,
    data_invalida: 0,
    quantidade_invalida: 0,
  };

  let totalLinhasDados = 0;

  for (let i = 1; i < linhas.length; i++) {
    const linha = linhas[i];
    if (camposVazios(linha)) {
      // Linha completamente em branco — counta como descarte se houver
      // algo na linha (ex.: vírgulas só), pula silenciosamente se for
      // EOL puro.
      if (linha.length > 0 && linha.some((c) => c !== "")) {
        totalLinhasDados++;
        descartesResumo.linha_vazia++;
      }
      continue;
    }

    totalLinhasDados++;

    const orderStatus = limparCampo(linha[idxOrderStatus]);
    if (orderStatus !== filtroStatus) {
      descartesResumo.status_diferente_filtro++;
      continue;
    }

    const createdRaw = limparCampo(linha[idxCreatedTime]);
    const criadoEm = parseCreatedTimeToISO(createdRaw);
    if (!criadoEm) {
      descartesResumo.data_invalida++;
      continue;
    }

    const qtyRaw = limparCampo(linha[idxQuantity]);
    const qty = Number.parseInt(qtyRaw, 10);
    if (!Number.isFinite(qty) || qty <= 0) {
      descartesResumo.quantidade_invalida++;
      continue;
    }

    const trackingId = limparCampo(linha[idxTrackingId]) || null;
    const buyerUsername = limparCampo(linha[idxBuyerUsername]) || null;
    const orderSubstatus =
      idxOrderSubstatus != null
        ? limparCampo(linha[idxOrderSubstatus]) || null
        : null;

    pedidos.push({
      canal: "tiktok_shop",
      orderId: limparCampo(linha[idxOrderId]),
      trackingId,
      sellerSku: limparCampo(linha[idxSellerSku]),
      quantidade: qty,
      buyerUsername,
      criadoEm,
      orderStatus,
      orderSubstatus,
    });
  }

  return {
    pedidos,
    totalLinhas: totalLinhasDados,
    linhasValidas: pedidos.length,
    linhasDescartadas: totalLinhasDados - pedidos.length,
    descartesResumo,
  };
}
