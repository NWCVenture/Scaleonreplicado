// Gera o XLSX "Update_warehouse_CONSOLIDADO_DDMMYYYY.xlsx" pra importar na
// Upseller. Implementa as regras de docs/auxiliares/PROCESSO_Update_Warehouse.md:
//
//   - Offset +1000 em todos os estoques (Upseller usa 1000 = 0 peças reais).
//   - SKUs com pausadoUpseller=true são ignorados (e geram alerta informativo).
//   - Modelos sem custoUpseller exportam com Custo Médio vazio + alerta.
//   - Prefixo de SKU não cadastrado em modelo_principal → alerta.
//   - Ambos os modos exportam apenas SKUs com pelo menos uma peça nos fardos
//     passados. SKUs do catálogo sem estoque são omitidos (não vão como 1000).
//     O modo modulo agrega todas as estantes; o modo estante recorta numa só.
//
// exceljs via dynamic import — fica fora do bundle inicial.

import type { EstanteFardoItem } from "./agregar";

export interface SkuCatalogoUpseller {
  codigo: string;
  pausado: boolean;
}

export interface ModeloUpseller {
  codigo: string;
  custoUpseller: number | null;
}

export type AlertaTipoUpseller =
  | "sem_custo"
  | "prefixo_desconhecido"
  | "pausado_ignorado"
  | "fora_do_catalogo";

export interface AlertaUpseller {
  tipo: AlertaTipoUpseller;
  mensagem: string;
  sku?: string;
  modelo?: string;
}

export interface ExportarUpsellerInput {
  fardos: EstanteFardoItem[];
  skusCatalogo: SkuCatalogoUpseller[];
  modelos: ModeloUpseller[];
  escopo: "modulo" | "estante";
  nomeEstante?: string;
  offset?: number;
}

export interface ResultadoUpseller {
  linhasExportadas: number;
  alertas: AlertaUpseller[];
  nomeArquivo: string;
}

const OFFSET_PADRAO = 1000;

function nomeArquivoConsolidado(): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = now.getFullYear();
  return `Update_warehouse_CONSOLIDADO_${dd}${mm}${yyyy}.xlsx`;
}

function nomeArquivoEstante(nomeEstante: string): string {
  const data = new Date().toLocaleDateString("pt-BR").replace(/\//g, "-");
  return `Update_warehouse_${nomeEstante}_${data}.xlsx`;
}

export async function exportarUpseller(
  input: ExportarUpsellerInput,
): Promise<ResultadoUpseller> {
  const offset = input.offset ?? OFFSET_PADRAO;
  const alertas: AlertaUpseller[] = [];

  // Total de peças por SKU (consolidando todos os fardos passados).
  const totalPorSku = new Map<string, number>();
  for (const f of input.fardos) {
    totalPorSku.set(f.sku, (totalPorSku.get(f.sku) ?? 0) + f.quantidade);
  }

  // Custo por modelo (codigo → custo).
  const custoPorModelo = new Map<string, number | null>();
  for (const m of input.modelos) {
    custoPorModelo.set(m.codigo, m.custoUpseller);
  }

  // SKUs pausados (set p/ lookup O(1)).
  const pausados = new Set<string>(
    input.skusCatalogo.filter((s) => s.pausado).map((s) => s.codigo),
  );

  // SKUs do catálogo ativos e não pausados (route só retorna ativos upstream).
  const skusEsperadosSet = new Set(
    input.skusCatalogo.filter((s) => !s.pausado).map((s) => s.codigo),
  );

  // Conjunto final de SKUs que vão no XLSX: SKUs com pelo menos uma peça nos
  // fardos passados E presentes no catálogo (ativos + não pausados). SKUs do
  // catálogo sem estoque são omitidos. SKUs nos fardos fora do catálogo ou
  // pausados geram alerta e ficam de fora.
  const skusParaExportar = new Set<string>();
  for (const sku of totalPorSku.keys()) {
    if (skusEsperadosSet.has(sku)) {
      skusParaExportar.add(sku);
    } else if (pausados.has(sku)) {
      alertas.push({
        tipo: "pausado_ignorado",
        mensagem: `SKU pausado "${sku}" ignorado (${totalPorSku.get(sku)} peças no estoque).`,
        sku,
      });
    } else {
      alertas.push({
        tipo: "fora_do_catalogo",
        mensagem: `SKU "${sku}" tem fardos mas não está no sku_catalogo — não exportado.`,
        sku,
      });
    }
  }

  // Construir linhas + emitir alertas.
  type Linha = { sku: string; estoque: number; custo: number | null };
  const linhas: Linha[] = [];
  const modelosSemCustoAvisados = new Set<string>();
  const prefixosDesconhecidosAvisados = new Set<string>();

  for (const sku of skusParaExportar) {
    const modeloCodigo = sku.split(" ")[0] ?? "";
    const custoEntry = custoPorModelo.get(modeloCodigo);
    let custo: number | null = null;

    if (custoEntry === undefined) {
      if (!prefixosDesconhecidosAvisados.has(modeloCodigo)) {
        alertas.push({
          tipo: "prefixo_desconhecido",
          mensagem: `Prefixo "${modeloCodigo}" não cadastrado em modelo_principal — SKUs com esse prefixo não terão custo.`,
          modelo: modeloCodigo,
        });
        prefixosDesconhecidosAvisados.add(modeloCodigo);
      }
    } else if (custoEntry == null) {
      if (!modelosSemCustoAvisados.has(modeloCodigo)) {
        alertas.push({
          tipo: "sem_custo",
          mensagem: `Modelo "${modeloCodigo}" sem custo cadastrado — Custo Médio ficará vazio.`,
          modelo: modeloCodigo,
        });
        modelosSemCustoAvisados.add(modeloCodigo);
      }
    } else {
      custo = custoEntry;
    }

    const pecas = totalPorSku.get(sku) ?? 0;
    linhas.push({ sku, estoque: pecas + offset, custo });
  }

  linhas.sort((a, b) => a.sku.localeCompare(b.sku, "en"));

  // Gerar o XLSX.
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "SCALEON ERP";
  wb.created = new Date();
  const sheet = wb.addWorksheet("Sheet1");

  sheet.addRow([
    "SKU*",
    "Estoque Baixo\n(Não será atualizado se não for preenchido)",
    "Qtd. Total Atualizado\n(Não será atualizado se não for preenchido)",
    "Custo Médio Atualizado\n(Não será atualizado se não for preenchido)",
  ]);
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { wrapText: true, vertical: "top" };

  for (const linha of linhas) {
    sheet.addRow([linha.sku, null, linha.estoque, linha.custo]);
  }

  sheet.columns = [
    { width: 16 },
    { width: 22 },
    { width: 22 },
    { width: 24 },
  ];

  const nomeArquivo =
    input.escopo === "modulo"
      ? nomeArquivoConsolidado()
      : nomeArquivoEstante(input.nomeEstante ?? "estante");

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo;
  a.click();
  URL.revokeObjectURL(url);

  return {
    linhasExportadas: linhas.length,
    alertas,
    nomeArquivo,
  };
}
