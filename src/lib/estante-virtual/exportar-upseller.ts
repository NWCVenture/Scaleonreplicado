// Gera o XLSX "Update_warehouse_CONSOLIDADO_DDMMYYYY.xlsx" pra importar na
// Upseller. Implementa as regras de docs/auxiliares/PROCESSO_Update_Warehouse.md:
//
//   - Offset +1000 em todos os estoques (Upseller usa 1000 = 0 peças reais).
//   - SKUs com pausadoUpseller=true são ignorados (e geram alerta informativo).
//   - Modelos sem custoUpseller exportam com Custo Médio vazio + alerta.
//   - Prefixo de SKU não cadastrado em modelo_principal → alerta.
//   - Modo consolidado: inclui todos os SKUs ativos+não-pausados do
//     sku_catalogo, mesmo com zero estoque (sai com 1000), gerando alerta
//     "sku_ausente" pra cada um.
//   - Modo estante: exporta só os SKUs presentes nos fardos passados.
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
  | "sku_ausente"
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

  // SKUs esperados (ativos não pausados). No catálogo o "ativo" foi filtrado
  // upstream (route só retorna ativos), então aqui basta excluir pausados.
  const skusEsperados = input.skusCatalogo
    .filter((s) => !s.pausado)
    .map((s) => s.codigo);
  const skusEsperadosSet = new Set(skusEsperados);

  // Conjunto final de SKUs que vão no XLSX.
  // Modo módulo: inclui todos os esperados (mesmo com 0 estoque).
  // Modo estante: só os SKUs presentes nos fardos da estante.
  const skusParaExportar = new Set<string>();
  if (input.escopo === "modulo") {
    for (const s of skusEsperados) skusParaExportar.add(s);
  }
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
    if (pecas === 0 && input.escopo === "modulo") {
      alertas.push({
        tipo: "sku_ausente",
        mensagem: `SKU "${sku}" esperado mas sem peças em nenhuma estante — exportado como 0.`,
        sku,
      });
    }

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
