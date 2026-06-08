import * as XLSX from "xlsx";
import type { Resultado } from "./parser";

export interface ContextoExportacao {
  de: Date;
  ate: Date;
  estados: string[];
  totalLinhasOriginal: number;
}

function fmtData(d: Date): string {
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  return `${dia}/${mes}/${d.getFullYear()}`;
}

function fmtDataHora(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${fmtData(d)} ${hh}:${mm}`;
}

export function gerarXlsxExportacao(
  resultado: Resultado,
  contexto: ContextoExportacao
): ArrayBuffer {
  const wb = XLSX.utils.book_new();

  const resumoLinhas: (string | number)[][] = [
    ["Análise de Pedidos"],
    [],
    ["Período analisado", `${fmtData(contexto.de)} a ${fmtData(contexto.ate)}`],
    ["Estados considerados", contexto.estados.join(", ") || "(todos)"],
    ["Total de pedidos no período", resultado.totalPedidos],
    ["Total de itens (kits expandidos)", resultado.totalItens],
    ["SKUs distintos", resultado.totalSkus],
    ["Linhas originais na planilha", contexto.totalLinhasOriginal],
  ];
  const wsResumo = XLSX.utils.aoa_to_sheet(resumoLinhas);
  wsResumo["!cols"] = [{ wch: 32 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, wsResumo, "Resumo");

  const tamanhos = resultado.matriz.tamanhos;
  const matrizHeader = ["Cor", ...tamanhos, "Total"];
  const matrizBody = resultado.matriz.linhas.map((l) => [
    l.cor,
    ...tamanhos.map((t) => l.porTamanho[t] ?? 0),
    l.total,
  ]);
  const totalRow = [
    "Total",
    ...tamanhos.map((t) => resultado.matriz.totalPorTamanho[t] ?? 0),
    resultado.matriz.totalGeral,
  ];
  const wsMatriz = XLSX.utils.aoa_to_sheet([
    matrizHeader,
    ...matrizBody,
    totalRow,
  ]);
  wsMatriz["!cols"] = [
    { wch: 22 },
    ...tamanhos.map(() => ({ wch: 8 })),
    { wch: 10 },
  ];
  XLSX.utils.book_append_sheet(wb, wsMatriz, "Matriz Cor x Tamanho");

  const wsTopCores = XLSX.utils.aoa_to_sheet([
    ["Cor", "Quantidade", "% do total"],
    ...resultado.topCores.map((r) => [r.nome, r.qtd, Number(r.pct.toFixed(2))]),
  ]);
  wsTopCores["!cols"] = [{ wch: 22 }, { wch: 14 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, wsTopCores, "Top Cores");

  const wsTopTam = XLSX.utils.aoa_to_sheet([
    ["Tamanho", "Quantidade", "% do total"],
    ...resultado.topTamanhos.map((r) => [
      r.nome,
      r.qtd,
      Number(r.pct.toFixed(2)),
    ]),
  ]);
  wsTopTam["!cols"] = [{ wch: 14 }, { wch: 14 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, wsTopTam, "Top Tamanhos");

  const wsSku = XLSX.utils.aoa_to_sheet([
    ["SKU", "Anúncio", "Pedidos", "Itens"],
    ...resultado.porSku.map((r) => [
      r.sku,
      r.nomeAnuncio,
      r.qtdPedidos,
      r.qtdItens,
    ]),
  ]);
  wsSku["!cols"] = [{ wch: 30 }, { wch: 60 }, { wch: 10 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, wsSku, "Por SKU");

  const wsLinhas = XLSX.utils.aoa_to_sheet([
    [
      "Nº Pedido",
      "Data",
      "Estado",
      "SKU",
      "Anúncio",
      "Variação",
      "Cor",
      "Tamanho",
      "Qtd",
    ],
    ...resultado.linhasFiltradas.map((r) => [
      r.numeroPedido,
      fmtDataHora(r.dataPedido),
      r.estado,
      r.sku,
      r.nomeAnuncio,
      r.variacao,
      r.cor,
      r.tamanho,
      r.qtd,
    ]),
  ]);
  wsLinhas["!cols"] = [
    { wch: 18 },
    { wch: 16 },
    { wch: 14 },
    { wch: 28 },
    { wch: 50 },
    { wch: 30 },
    { wch: 16 },
    { wch: 8 },
    { wch: 6 },
  ];
  XLSX.utils.book_append_sheet(wb, wsLinhas, "Linhas Filtradas");

  const buffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return buffer as ArrayBuffer;
}
