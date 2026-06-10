import * as XLSX from "xlsx";

export interface CorQtd {
  nome: string;
  qtd: number;
}

export interface VariacaoParseada {
  tamanho: string | null;
  cores: CorQtd[];
}

export interface LinhaPedido {
  numeroPedido: string;
  plataforma: string | null;
  loja: string | null;
  estado: string;
  dataPedido: Date;
  sku: string;
  nomeAnuncio: string;
  variacaoOriginal: string;
  tamanho: string | null;
  cores: CorQtd[];
  qtdProduto: number;
  precoProduto: number | null;
}

export interface PeriodoDisponivel {
  min: Date;
  max: Date;
}

export interface ParseResult {
  linhas: LinhaPedido[];
  periodoDisponivel: PeriodoDisponivel | null;
  estadosDistintos: string[];
  avisos: string[];
}

export interface FiltroAgrupamento {
  de: Date;
  ate: Date;
  estados: Set<string>;
}

export interface CelulaMatriz {
  cor: string;
  porTamanho: Record<string, number>;
  total: number;
}

export interface ResultadoMatriz {
  tamanhos: string[];
  linhas: CelulaMatriz[];
  totalPorTamanho: Record<string, number>;
  totalGeral: number;
}

export interface RankingItem {
  nome: string;
  qtd: number;
  pct: number;
}

export interface ResumoSku {
  sku: string;
  nomeAnuncio: string;
  qtdPedidos: number;
  qtdItens: number;
}

export interface LinhaFiltrada {
  numeroPedido: string;
  dataPedido: Date;
  estado: string;
  sku: string;
  nomeAnuncio: string;
  variacao: string;
  cor: string;
  tamanho: string;
  qtd: number;
}

export interface PedidosPorDiaSemana {
  // 0 = Domingo, 6 = Sábado (alinhado com Date.getDay()).
  diaSemana: number;
  // Pedidos únicos (por numeroPedido) que caem nesse dia da semana no período.
  total: number;
  // Quantos dias do calendário daquele dia da semana caem no período filtrado.
  // Usado pra calcular média e expor no tooltip.
  ocorrencias: number;
  // total / ocorrencias (0 quando não há ocorrências no período).
  media: number;
}

export interface Resultado {
  matriz: ResultadoMatriz;
  topCores: RankingItem[];
  topTamanhos: RankingItem[];
  porSku: ResumoSku[];
  linhasFiltradas: LinhaFiltrada[];
  totalPedidos: number;
  totalItens: number;
  totalSkus: number;
  // Sempre 7 entradas, na ordem 0..6 (Dom..Sáb).
  pedidosPorDiaSemana: PedidosPorDiaSemana[];
}

const TAMANHOS_CANONICOS = ["P", "M", "G", "GG", "EGG", "XGG"] as const;
const TAMANHO_ALIASES: Record<string, string> = {
  PP: "PP",
  P: "P",
  M: "M",
  G: "G",
  GG: "GG",
  EGG: "EGG",
  XGG: "XGG",
  XG: "GG",
};

export function normalizeTamanho(raw: string): string | null {
  const s = raw.trim().toUpperCase();
  if (!s) return null;
  return TAMANHO_ALIASES[s] ?? s;
}

const COR_ALIASES: Record<string, string> = {
  PT: "Preto",
  PRETO: "Preto",
  AZ: "Azul",
  AZUL: "Azul",
  BR: "Branco",
  BRANCO: "Branco",
  CZ: "Cinza",
  CINZA: "Cinza",
  VM: "Vermelho",
  VERMELHO: "Vermelho",
  VD: "Verde",
  VERDE: "Verde",
};

export function normalizeCor(raw: string): string {
  const s = raw.trim();
  if (!s) return s;
  const upper = s.toUpperCase();
  if (COR_ALIASES[upper]) return COR_ALIASES[upper];
  return s
    .split(/\s+/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(" ");
}

export function parseVariacao(variacao: string | null | undefined): VariacaoParseada {
  if (!variacao || typeof variacao !== "string") {
    return { tamanho: null, cores: [] };
  }
  const trimmed = variacao.trim();
  if (!trimmed) return { tamanho: null, cores: [] };

  const lastComma = trimmed.lastIndexOf(",");
  let tamanho: string | null = null;
  let coresStr = trimmed;
  if (lastComma !== -1) {
    tamanho = normalizeTamanho(trimmed.slice(lastComma + 1));
    coresStr = trimmed.slice(0, lastComma);
  }

  // Formato unitário denormalizado tipo "Azul,Lisa" (sem barra, com vírgula extra):
  // a Upseller exporta produtos unitários como Cor,Tipo,Tamanho. Já consumimos o
  // tamanho acima; descartamos o tipo (Lisa, Premium, etc.) e ficamos só com a cor.
  if (!coresStr.includes("/") && coresStr.includes(",")) {
    coresStr = coresStr.split(",")[0];
  }

  const cores: CorQtd[] = [];
  for (const parte of coresStr.split("/")) {
    const limpo = parte.trim();
    if (!limpo) continue;
    const match = limpo.match(/^(.+?)\s*\((\d+)\)\s*$/);
    if (match) {
      const nome = normalizeCor(match[1]);
      const qtd = parseInt(match[2], 10);
      if (nome && qtd > 0) cores.push({ nome, qtd });
    } else {
      const nome = normalizeCor(limpo);
      if (nome) cores.push({ nome, qtd: 1 });
    }
  }

  return { tamanho, cores };
}

const COLUNAS = {
  numeroPedido: ["Nº de Pedido", "N° de Pedido", "Numero de Pedido"],
  plataforma: ["Plataformas", "Plataforma"],
  loja: ["Nome da Loja no UpSeller", "Loja"],
  estado: ["Estado do Pedido", "Status do Pedido"],
  dataPedido: ["Hora do Pedido", "Data do Pedido"],
  nomeAnuncio: ["Nome do Anúncio", "Nome do Anuncio"],
  sku: ["SKU"],
  variacao: ["Variação", "Variacao"],
  qtdProduto: ["Qtd. do Produto", "Quantidade do Produto", "Qtd"],
  precoProduto: ["Preço de Produto", "Preco de Produto"],
} as const;

function findColumn(headers: string[], candidates: readonly string[]): string | null {
  for (const cand of candidates) {
    const hit = headers.find((h) => h.trim().toLowerCase() === cand.trim().toLowerCase());
    if (hit) return hit;
  }
  return null;
}

function parseData(valor: unknown): Date | null {
  if (!valor) return null;
  if (valor instanceof Date) {
    return isNaN(valor.getTime()) ? null : valor;
  }
  if (typeof valor === "number") {
    const ms = (valor - 25569) * 86400 * 1000;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof valor === "string") {
    const s = valor.trim();
    if (!s) return null;
    const match = s.match(
      /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?/
    );
    if (match) {
      const [, y, mo, d, h = "0", mi = "0", se = "0"] = match;
      const date = new Date(
        Number(y),
        Number(mo) - 1,
        Number(d),
        Number(h),
        Number(mi),
        Number(se)
      );
      return isNaN(date.getTime()) ? null : date;
    }
    const fallback = new Date(s);
    return isNaN(fallback.getTime()) ? null : fallback;
  }
  return null;
}

function parseNumero(valor: unknown): number {
  if (valor == null) return 0;
  if (typeof valor === "number") return valor;
  if (typeof valor === "string") {
    const n = parseFloat(valor.replace(",", "."));
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

export function parseUpsellerWorkbook(buffer: ArrayBuffer): ParseResult {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return {
      linhas: [],
      periodoDisponivel: null,
      estadosDistintos: [],
      avisos: ["Nenhuma aba encontrada na planilha"],
    };
  }
  const worksheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: null,
    raw: false,
  });
  if (rows.length === 0) {
    return {
      linhas: [],
      periodoDisponivel: null,
      estadosDistintos: [],
      avisos: ["Planilha vazia"],
    };
  }

  const headers = Object.keys(rows[0]);
  const colNumero = findColumn(headers, COLUNAS.numeroPedido);
  const colData = findColumn(headers, COLUNAS.dataPedido);
  const colEstado = findColumn(headers, COLUNAS.estado);
  const colSku = findColumn(headers, COLUNAS.sku);
  const colVariacao = findColumn(headers, COLUNAS.variacao);
  const colQtd = findColumn(headers, COLUNAS.qtdProduto);
  const colNome = findColumn(headers, COLUNAS.nomeAnuncio);
  const colPlataforma = findColumn(headers, COLUNAS.plataforma);
  const colLoja = findColumn(headers, COLUNAS.loja);
  const colPreco = findColumn(headers, COLUNAS.precoProduto);

  const avisos: string[] = [];
  if (!colData) avisos.push("Coluna 'Hora do Pedido' não encontrada");
  if (!colVariacao) avisos.push("Coluna 'Variação' não encontrada");
  if (!colSku) avisos.push("Coluna 'SKU' não encontrada");
  if (!colEstado) avisos.push("Coluna 'Estado do Pedido' não encontrada");
  if (!colData || !colVariacao || !colSku || !colEstado) {
    return { linhas: [], periodoDisponivel: null, estadosDistintos: [], avisos };
  }

  const linhas: LinhaPedido[] = [];
  const estadosSet = new Set<string>();
  let minDate: Date | null = null;
  let maxDate: Date | null = null;
  let semData = 0;
  let semVariacao = 0;

  for (const row of rows) {
    const data = parseData(row[colData]);
    if (!data) {
      semData++;
      continue;
    }
    const variacaoStr = (row[colVariacao] as string | null) ?? "";
    const variacao = parseVariacao(variacaoStr);
    if (variacao.cores.length === 0) {
      semVariacao++;
      continue;
    }
    const estado = String(row[colEstado] ?? "").trim() || "Desconhecido";
    estadosSet.add(estado);

    const qtdProduto = Math.max(
      1,
      Math.round(colQtd ? parseNumero(row[colQtd]) : 1)
    );
    const linha: LinhaPedido = {
      numeroPedido: colNumero ? String(row[colNumero] ?? "").trim() : "",
      plataforma: colPlataforma ? String(row[colPlataforma] ?? "").trim() || null : null,
      loja: colLoja ? String(row[colLoja] ?? "").trim() || null : null,
      estado,
      dataPedido: data,
      sku: String(row[colSku] ?? "").trim(),
      nomeAnuncio: colNome ? String(row[colNome] ?? "").trim() : "",
      variacaoOriginal: String(variacaoStr).trim(),
      tamanho: variacao.tamanho,
      cores: variacao.cores,
      qtdProduto,
      precoProduto: colPreco ? parseNumero(row[colPreco]) || null : null,
    };
    linhas.push(linha);
    if (!minDate || data < minDate) minDate = data;
    if (!maxDate || data > maxDate) maxDate = data;
  }

  if (semData > 0) avisos.push(`${semData} linha(s) ignorada(s) por data inválida`);
  if (semVariacao > 0) avisos.push(`${semVariacao} linha(s) ignorada(s) por variação inválida`);

  return {
    linhas,
    periodoDisponivel: minDate && maxDate ? { min: minDate, max: maxDate } : null,
    estadosDistintos: [...estadosSet].sort(),
    avisos,
  };
}

function toDateOnly(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function ordenarTamanhos(tamanhos: string[]): string[] {
  const ordemCanonica: Record<string, number> = {};
  TAMANHOS_CANONICOS.forEach((t, i) => (ordemCanonica[t] = i));
  return [...tamanhos].sort((a, b) => {
    const oa = ordemCanonica[a] ?? 100;
    const ob = ordemCanonica[b] ?? 100;
    if (oa !== ob) return oa - ob;
    return a.localeCompare(b);
  });
}

export function agrupar(linhas: LinhaPedido[], filtro: FiltroAgrupamento): Resultado {
  const deTs = toDateOnly(filtro.de);
  const ateTs = toDateOnly(filtro.ate);

  const matriz = new Map<string, Map<string, number>>();
  const totaisCor = new Map<string, number>();
  const totaisTamanho = new Map<string, number>();
  const porSkuMap = new Map<
    string,
    { sku: string; nomeAnuncio: string; pedidos: Set<string>; itens: number }
  >();
  const linhasFiltradas: LinhaFiltrada[] = [];
  const pedidosUnicos = new Set<string>();
  // Pedidos únicos por dia da semana (0=Dom..6=Sáb). Dedup por número de
  // pedido — uma venda com várias linhas conta uma única vez no seu dow.
  const pedidosPorDow: Array<Set<string>> = Array.from({ length: 7 }, () => new Set());
  let totalItens = 0;

  for (const linha of linhas) {
    const ts = toDateOnly(linha.dataPedido);
    if (ts < deTs || ts > ateTs) continue;
    if (filtro.estados.size > 0 && !filtro.estados.has(linha.estado)) continue;

    const tamanho = linha.tamanho ?? "—";
    pedidosUnicos.add(linha.numeroPedido);
    if (linha.numeroPedido) {
      pedidosPorDow[linha.dataPedido.getDay()].add(linha.numeroPedido);
    }

    const skuKey = linha.sku || "(sem SKU)";
    let skuEntry = porSkuMap.get(skuKey);
    if (!skuEntry) {
      skuEntry = {
        sku: skuKey,
        nomeAnuncio: linha.nomeAnuncio,
        pedidos: new Set<string>(),
        itens: 0,
      };
      porSkuMap.set(skuKey, skuEntry);
    }
    if (linha.numeroPedido) skuEntry.pedidos.add(linha.numeroPedido);

    for (const cor of linha.cores) {
      const qtd = cor.qtd * linha.qtdProduto;
      if (qtd <= 0) continue;

      let porTamanho = matriz.get(cor.nome);
      if (!porTamanho) {
        porTamanho = new Map();
        matriz.set(cor.nome, porTamanho);
      }
      porTamanho.set(tamanho, (porTamanho.get(tamanho) ?? 0) + qtd);
      totaisCor.set(cor.nome, (totaisCor.get(cor.nome) ?? 0) + qtd);
      totaisTamanho.set(tamanho, (totaisTamanho.get(tamanho) ?? 0) + qtd);
      totalItens += qtd;
      skuEntry.itens += qtd;

      linhasFiltradas.push({
        numeroPedido: linha.numeroPedido,
        dataPedido: linha.dataPedido,
        estado: linha.estado,
        sku: linha.sku,
        nomeAnuncio: linha.nomeAnuncio,
        variacao: linha.variacaoOriginal,
        cor: cor.nome,
        tamanho,
        qtd,
      });
    }
  }

  const tamanhos = ordenarTamanhos([...totaisTamanho.keys()]);
  const linhasMatriz: CelulaMatriz[] = [...matriz.entries()]
    .map(([cor, porTamanho]) => {
      const porTamanhoObj: Record<string, number> = {};
      let total = 0;
      for (const t of tamanhos) {
        const v = porTamanho.get(t) ?? 0;
        porTamanhoObj[t] = v;
        total += v;
      }
      return { cor, porTamanho: porTamanhoObj, total };
    })
    .sort((a, b) => b.total - a.total);

  const totalPorTamanho: Record<string, number> = {};
  let totalGeral = 0;
  for (const t of tamanhos) {
    const v = totaisTamanho.get(t) ?? 0;
    totalPorTamanho[t] = v;
    totalGeral += v;
  }

  const topCores: RankingItem[] = [...totaisCor.entries()]
    .map(([nome, qtd]) => ({
      nome,
      qtd,
      pct: totalGeral > 0 ? (qtd / totalGeral) * 100 : 0,
    }))
    .sort((a, b) => b.qtd - a.qtd);

  const topTamanhos: RankingItem[] = tamanhos
    .map((nome) => ({
      nome,
      qtd: totalPorTamanho[nome],
      pct: totalGeral > 0 ? (totalPorTamanho[nome] / totalGeral) * 100 : 0,
    }))
    .sort((a, b) => b.qtd - a.qtd);

  const porSku: ResumoSku[] = [...porSkuMap.values()]
    .map((e) => ({
      sku: e.sku,
      nomeAnuncio: e.nomeAnuncio,
      qtdPedidos: e.pedidos.size,
      qtdItens: e.itens,
    }))
    .sort((a, b) => b.qtdItens - a.qtdItens);

  // Ocorrências de cada dia da semana no intervalo filtrado. O loop usa
  // setDate(+1) — atravessa horário de verão sem desalinhar porque a
  // comparação é só por data civil (toDateOnly).
  const ocorrenciasDow = [0, 0, 0, 0, 0, 0, 0];
  if (deTs <= ateTs) {
    const cursor = new Date(filtro.de.getFullYear(), filtro.de.getMonth(), filtro.de.getDate());
    while (toDateOnly(cursor) <= ateTs) {
      ocorrenciasDow[cursor.getDay()]++;
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  const pedidosPorDiaSemana: PedidosPorDiaSemana[] = ocorrenciasDow.map(
    (ocorrencias, dow) => {
      const total = pedidosPorDow[dow].size;
      return {
        diaSemana: dow,
        total,
        ocorrencias,
        media: ocorrencias > 0 ? total / ocorrencias : 0,
      };
    },
  );

  return {
    matriz: {
      tamanhos,
      linhas: linhasMatriz,
      totalPorTamanho,
      totalGeral,
    },
    topCores,
    topTamanhos,
    porSku,
    linhasFiltradas: linhasFiltradas.sort(
      (a, b) => a.dataPedido.getTime() - b.dataPedido.getTime()
    ),
    totalPedidos: pedidosUnicos.size,
    totalItens,
    totalSkus: porSkuMap.size,
    pedidosPorDiaSemana,
  };
}
