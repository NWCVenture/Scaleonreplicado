// Geração client-side do XLSX pivotado de uma estante. 5 abas:
// Resumo · Matriz · Por SKU · Caixas parciais · Bruto.
//
// exceljs é carregado via dynamic import — evita ~800kB no bundle inicial.

import type { EstanteAgregada, EstanteFardoItem } from "./agregar";
import { CAIXA_PADRAO } from "./agregar";

interface ExportContext {
  agregado: EstanteAgregada;
  fardosBrutos: EstanteFardoItem[];
  nomeEstante: string;
}

function nomeArquivo(nome: string): string {
  // Espelha o padrão do downloadCSV existente: dd-MM-yyyy local
  const data = new Date()
    .toLocaleDateString("pt-BR")
    .replace(/\//g, "-");
  return `estante_${nome}_${data}.xlsx`;
}

function fmtDataBR(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("pt-BR");
  } catch {
    return iso;
  }
}

export async function exportarEstanteXlsx(ctx: ExportContext): Promise<void> {
  const { agregado, fardosBrutos, nomeEstante } = ctx;
  const ExcelJS = (await import("exceljs")).default;

  const wb = new ExcelJS.Workbook();
  wb.creator = "NWC ERP";
  wb.created = new Date();

  // ── Aba 1: Resumo ────────────────────────────────────────────────────────
  const resumo = wb.addWorksheet("Resumo");
  resumo.columns = [
    { header: "", key: "k", width: 28 },
    { header: "", key: "v", width: 40 },
  ];
  const dataGeracao = new Date().toLocaleString("pt-BR");
  const linhasResumo: Array<[string, string | number]> = [
    ["Estante", nomeEstante],
    ["Gerado em", dataGeracao],
    ["Lotes", agregado.lotes.join(", ") || "—"],
    ["Total de peças", agregado.totalPecas],
    ["Total de fardos", agregado.totalFardos],
    ["Fardos cheios", agregado.fardosCheios],
    ["Fardos parciais", agregado.fardosParciais],
    ["Ocupação (%)", agregado.ocupacaoPct],
    ["Caixa padrão (peças)", CAIXA_PADRAO],
  ];
  for (const [k, v] of linhasResumo) {
    const row = resumo.addRow({ k, v });
    row.getCell("k").font = { bold: true };
  }
  if (agregado.avisos.length > 0) {
    resumo.addRow({});
    const header = resumo.addRow({ k: "Avisos", v: `${agregado.avisos.length} item(ns)` });
    header.font = { bold: true };
    for (const av of agregado.avisos) {
      resumo.addRow({ k: av.tipo, v: av.mensagem });
    }
  }

  // ── Aba 2: Matriz cor × tamanho ──────────────────────────────────────────
  const matriz = wb.addWorksheet("Matriz");
  const headerMatriz = ["", ...agregado.tamanhosOrdenados, "Total"];
  matriz.addRow(headerMatriz).font = { bold: true };
  for (const cor of agregado.coresOrdenadas) {
    const linha: Array<string | number> = [cor];
    for (const tam of agregado.tamanhosOrdenados) {
      linha.push(agregado.matriz[cor]?.[tam] ?? 0);
    }
    linha.push(agregado.totaisPorCor[cor] ?? 0);
    const row = matriz.addRow(linha);
    row.getCell(1).font = { bold: true };
    row.getCell(headerMatriz.length).font = { bold: true };
  }
  const linhaTotal: Array<string | number> = ["Total"];
  for (const tam of agregado.tamanhosOrdenados) {
    linhaTotal.push(agregado.totaisPorTamanho[tam] ?? 0);
  }
  linhaTotal.push(agregado.totalPecas);
  const totalRow = matriz.addRow(linhaTotal);
  totalRow.font = { bold: true };
  matriz.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
  matriz.getColumn(1).width = 10;
  for (let i = 2; i <= headerMatriz.length; i++) {
    matriz.getColumn(i).width = 10;
  }

  // ── Aba 3: Por SKU ───────────────────────────────────────────────────────
  const porSku = wb.addWorksheet("Por SKU");
  porSku.columns = [
    { header: "SKU", key: "sku", width: 22 },
    { header: "Produto", key: "produto", width: 10 },
    { header: "Cor", key: "cor", width: 8 },
    { header: "Tamanho", key: "tamanho", width: 10 },
    { header: "Peças", key: "pecas", width: 10 },
    { header: "Fardos", key: "numFardos", width: 10 },
    { header: "Cheios", key: "fardosCheios", width: 10 },
    { header: "Parciais", key: "fardosParciais", width: 10 },
  ];
  porSku.getRow(1).font = { bold: true };
  porSku.views = [{ state: "frozen", ySplit: 1 }];
  for (const linha of agregado.porSku) {
    porSku.addRow(linha);
  }

  // ── Aba 4: Caixas parciais ───────────────────────────────────────────────
  const parciais = wb.addWorksheet("Caixas parciais");
  parciais.columns = [
    { header: "SKU", key: "sku", width: 22 },
    { header: "Cor", key: "cor", width: 8 },
    { header: "Tamanho", key: "tamanho", width: 10 },
    { header: "Lote", key: "lote", width: 14 },
    { header: "Quantidade", key: "quantidade", width: 12 },
    { header: "Falta p/ cheia", key: "faltaParaCheia", width: 14 },
  ];
  parciais.getRow(1).font = { bold: true };
  parciais.views = [{ state: "frozen", ySplit: 1 }];
  for (const linha of agregado.caixasParciais) {
    parciais.addRow(linha);
  }

  // ── Aba 5: Bruto (auditoria) ─────────────────────────────────────────────
  const bruto = wb.addWorksheet("Bruto");
  bruto.columns = [
    { header: "SKU", key: "sku", width: 22 },
    { header: "Lote", key: "lote", width: 14 },
    { header: "Quantidade", key: "quantidade", width: 12 },
    { header: "Adicionado por", key: "adicionadoPor", width: 22 },
    { header: "Data", key: "data", width: 14 },
  ];
  bruto.getRow(1).font = { bold: true };
  bruto.views = [{ state: "frozen", ySplit: 1 }];
  for (const f of fardosBrutos) {
    bruto.addRow({
      sku: f.sku,
      lote: f.lote,
      quantidade: f.quantidade,
      adicionadoPor: f.adicionadoPor,
      data: fmtDataBR(f.createdAt),
    });
  }

  // ── Download ─────────────────────────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo(nomeEstante);
  a.click();
  URL.revokeObjectURL(url);
}
