"use client";

import { useState, useRef } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Upload,
  FileSpreadsheet,
  Download,
  RefreshCw,
  AlertCircle,
  FileText,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/page-header";

interface ProcessingFilters {
  skus: string[];
  colors: string[];
  kitTypes: string[];
  manufacturingTime?: number;
  stockToAdd?: number;
  zeroStock: boolean;
}

interface Change {
  sku: string;
  codigoAnuncio: string;
  estoqueAnterior: number;
  estoqueNovo: number;
  manufacturingTime: string;
  tipo: string;
  linhaExcel: number;
}

export default function ProcessadorAnuncios() {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedData, setProcessedData] = useState<{
    buffer: ArrayBuffer;
    report: string;
  } | null>(null);

  // Filtros
  const [skusInput, setSkusInput] = useState("");
  const [colorsInput, setColorsInput] = useState("");
  const [kitTypesInput, setKitTypesInput] = useState("");
  const [manufacturingTime, setManufacturingTime] = useState<string>("");
  const [stockToAdd, setStockToAdd] = useState<string>("");
  const [zeroStock, setZeroStock] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setProcessedData(null);
    }
  };

  const checkCriteria = (
    sku: string,
    filters: ProcessingFilters
  ): boolean => {
    const skuUpper = sku.toUpperCase();

    const hasSku =
      filters.skus.length === 0 ||
      filters.skus.some((s) => skuUpper.includes(s.toUpperCase()));
    if (!hasSku) return false;

    const hasColor =
      filters.colors.length === 0 ||
      filters.colors.some((c) => skuUpper.includes(c.toUpperCase())) ||
      skuUpper.includes("MIX");
    if (!hasColor) return false;

    const hasKitType =
      filters.kitTypes.length === 0 ||
      filters.kitTypes.some((kt) => skuUpper.startsWith(kt.toUpperCase())) ||
      (hasSku && hasColor);
    if (!hasKitType) return false;

    const hasSize =
      [" P", " M", " G", " GG"].some((size) => sku.endsWith(size)) ||
      ["P ", "M ", "G ", "GG "].some((size) => sku.includes(size)) ||
      /[^A-Z](P|M|G|GG)$/.test(sku);
    if (!hasSize) return false;

    return true;
  };

  const generateReport = (
    changes: Change[],
    filters: ProcessingFilters
  ): string => {
    const lines: string[] = [];
    lines.push("=".repeat(100));
    lines.push("RELATORIO DE ALTERACOES - PROCESSADOR DE ANUNCIOS");
    lines.push("=".repeat(100));
    lines.push(`Data: ${new Date().toLocaleString("pt-BR")}`);
    lines.push(`Total de alteracoes: ${changes.length}`);
    lines.push("");
    lines.push("Filtros aplicados:");
    lines.push(
      `  SKUs: ${filters.skus.length > 0 ? filters.skus.join(", ") : "Todos"}`
    );
    lines.push(
      `  Cores: ${filters.colors.length > 0 ? filters.colors.join(", ") : "Todas"}`
    );
    lines.push(
      `  Tipos de Kit: ${filters.kitTypes.length > 0 ? filters.kitTypes.join(", ") : "Todos"}`
    );
    lines.push("");

    // Resumo por tipo
    const byType: Record<string, number> = {};
    changes.forEach((c) => (byType[c.tipo] = (byType[c.tipo] || 0) + 1));

    lines.push("RESUMO POR TIPO:");
    Object.entries(byType).forEach(([tipo, count]) => {
      lines.push(`  ${tipo}: ${count}`);
    });
    lines.push("");
    lines.push("DETALHES:");
    lines.push(
      "SKU".padEnd(30) +
        "Estoque Ant.".padEnd(15) +
        "Estoque Novo".padEnd(15) +
        "Tipo"
    );
    lines.push("-".repeat(100));

    changes.forEach((c) => {
      lines.push(
        c.sku.padEnd(30) +
          String(c.estoqueAnterior).padEnd(15) +
          String(c.estoqueNovo).padEnd(15) +
          c.tipo
      );
    });

    return lines.join("\n");
  };

  const downloadFile = (
    content: ArrayBuffer | string,
    fileName: string,
    type: string
  ) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const processSpreadsheet = async () => {
    if (!file) {
      toast.error("Selecione um arquivo Excel primeiro.");
      return;
    }

    setIsProcessing(true);

    try {
      const filters: ProcessingFilters = {
        skus: skusInput
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        colors: colorsInput
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        kitTypes: kitTypesInput
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        manufacturingTime: manufacturingTime
          ? parseInt(manufacturingTime)
          : undefined,
        stockToAdd: stockToAdd ? parseInt(stockToAdd) : undefined,
        zeroStock,
      };

      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });

      const sheetName =
        workbook.SheetNames.find((name) => name === "Anuncios") ||
        workbook.SheetNames[0];
      if (!sheetName) throw new Error("Nenhuma aba encontrada na planilha");

      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        defval: null,
      }) as any[][];

      // Encontrar indices das colunas
      let headerRowIndex = -1;
      let skuColIndex = -1;
      let quantityColIndex = -1;
      let manufacturingTimeColIndex = -1;
      let codigoAnuncioColIndex = -1;

      // Procurar linha de cabecalho
      for (let i = 0; i < Math.min(10, data.length); i++) {
        const row = data[i];
        if (row) {
          const skuIdx = row.findIndex(
            (cell: any) =>
              cell && typeof cell === "string" && cell.toUpperCase() === "SKU"
          );
          if (skuIdx !== -1) {
            headerRowIndex = i;
            skuColIndex = skuIdx;
            quantityColIndex = row.findIndex(
              (cell: any) =>
                cell &&
                typeof cell === "string" &&
                (cell.includes("Estoque") || cell.toUpperCase() === "QUANTITY")
            );
            manufacturingTimeColIndex = row.findIndex(
              (cell: any) =>
                cell &&
                typeof cell === "string" &&
                (cell.includes("Prazo") ||
                  cell.toUpperCase() === "MANUFACTURING_TIME")
            );
            codigoAnuncioColIndex = row.findIndex(
              (cell: any) =>
                cell &&
                typeof cell === "string" &&
                (cell.includes("Codigo do anuncio") ||
                  cell.toUpperCase() === "ITEM_ID")
            );
            break;
          }
        }
      }

      if (headerRowIndex === -1 || skuColIndex === -1) {
        throw new Error(
          'Estrutura da planilha nao reconhecida. Certifique-se de que existe uma coluna "SKU".'
        );
      }

      const changes: Change[] = [];

      // Processar linhas
      for (let i = headerRowIndex + 1; i < data.length; i++) {
        const row = data[i];
        if (!row || !row[skuColIndex]) continue;

        const sku = String(row[skuColIndex]).trim();
        if (!sku) continue;

        const matchesCriteria = checkCriteria(sku, filters);

        if (filters.zeroStock && matchesCriteria && quantityColIndex !== -1) {
          const estoqueAnterior = Number(row[quantityColIndex]) || 0;
          row[quantityColIndex] = 0;

          changes.push({
            sku,
            codigoAnuncio:
              codigoAnuncioColIndex !== -1
                ? String(row[codigoAnuncioColIndex] || "")
                : "",
            estoqueAnterior,
            estoqueNovo: 0,
            manufacturingTime: "-",
            tipo: "Estoque Zerado",
            linhaExcel: i + 1,
          });
          continue;
        }

        if (matchesCriteria) {
          let tipo = "";
          const estoqueAnterior =
            quantityColIndex !== -1
              ? Number(row[quantityColIndex]) || 0
              : 0;
          let estoqueNovo = estoqueAnterior;

          if (
            filters.manufacturingTime !== undefined &&
            manufacturingTimeColIndex !== -1
          ) {
            row[manufacturingTimeColIndex] = filters.manufacturingTime;
          }

          if (
            estoqueAnterior === 0 &&
            filters.stockToAdd &&
            quantityColIndex !== -1
          ) {
            row[quantityColIndex] = filters.stockToAdd;
            estoqueNovo = filters.stockToAdd;
            tipo = "Estoque + Prazo";
          } else {
            tipo = "Apenas Prazo";
          }

          changes.push({
            sku,
            codigoAnuncio:
              codigoAnuncioColIndex !== -1
                ? String(row[codigoAnuncioColIndex] || "")
                : "",
            estoqueAnterior,
            estoqueNovo,
            manufacturingTime:
              filters.manufacturingTime !== undefined
                ? String(filters.manufacturingTime)
                : "-",
            tipo,
            linhaExcel: i + 1,
          });
        }
      }

      // Gerar nova planilha
      const newWorksheet = XLSX.utils.aoa_to_sheet(data);
      workbook.Sheets[sheetName] = newWorksheet;
      const modifiedBuffer = XLSX.write(workbook, {
        type: "array",
        bookType: "xlsx",
      });
      const report = generateReport(changes, filters);

      setProcessedData({
        buffer: modifiedBuffer,
        report,
      });

      toast.success(
        `Processamento concluido! ${changes.length} alteracoes realizadas.`
      );
    } catch (error: any) {
      console.error(error);
      toast.error(`Erro ao processar: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Editar Estoque no ML"
        description="Processe planilhas de anuncios do Mercado Livre para atualizar estoque e prazos em massa."
        icon={<FileSpreadsheet className="h-8 w-8 text-primary" />}
      />

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Coluna de Configuracao */}
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>1. Upload da Planilha</CardTitle>
              <CardDescription>
                Selecione o arquivo .xlsx exportado do ML
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div
                className={cn(
                  "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
                  file
                    ? "border-primary bg-primary/5"
                    : "border-muted-foreground/25 hover:border-primary/50"
                )}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept=".xlsx"
                  onChange={handleFileChange}
                />
                {file ? (
                  <div className="flex flex-col items-center gap-2">
                    <FileSpreadsheet className="h-10 w-10 text-primary" />
                    <span className="font-medium text-sm truncate max-w-full">
                      {file.name}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-2 h-8"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFile(null);
                        setProcessedData(null);
                      }}
                    >
                      Trocar arquivo
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Upload className="h-10 w-10" />
                    <span className="text-sm">Clique para selecionar</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>2. Filtros de Selecao</CardTitle>
              <CardDescription>
                Defina quais anuncios serao alterados
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>SKUs (separados por virgula)</Label>
                <Input
                  placeholder="Ex: LUA, SOL"
                  value={skusInput}
                  onChange={(e) => setSkusInput(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Cores (separados por virgula)</Label>
                <Input
                  placeholder="Ex: AZ, BR, PT"
                  value={colorsInput}
                  onChange={(e) => setColorsInput(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Tipos de Kit</Label>
                <Input
                  placeholder="Ex: KIT, MIX"
                  value={kitTypesInput}
                  onChange={(e) => setKitTypesInput(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Coluna de Acoes */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>3. Regras de Atualizacao</CardTitle>
              <CardDescription>
                O que deve ser feito nos anuncios selecionados?
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label>Novo Prazo de Fabricacao (dias)</Label>
                  <Input
                    type="number"
                    placeholder="Nao alterar"
                    value={manufacturingTime}
                    onChange={(e) => setManufacturingTime(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Adicionar Estoque (se zerado)</Label>
                  <Input
                    type="number"
                    placeholder="Nao alterar"
                    value={stockToAdd}
                    onChange={(e) => setStockToAdd(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex items-center space-x-2 p-4 border rounded-md bg-destructive/5 border-destructive/20">
                <Checkbox
                  id="zeroStock"
                  checked={zeroStock}
                  onCheckedChange={(checked) => setZeroStock(checked as boolean)}
                />
                <div className="grid gap-1.5 leading-none">
                  <Label
                    htmlFor="zeroStock"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-destructive"
                  >
                    Zerar Estoque dos Selecionados
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Se marcado, o estoque sera definido como 0 para todos os
                    itens que corresponderem aos filtros.
                  </p>
                </div>
              </div>

              <Button
                className="w-full h-12 text-lg font-bold"
                onClick={processSpreadsheet}
                disabled={!file || isProcessing}
              >
                {isProcessing ? (
                  <>
                    <RefreshCw className="mr-2 h-5 w-5 animate-spin" />{" "}
                    Processando...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-5 w-5" /> Processar Planilha
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {processedData && (
            <Card className="border-green-500/50 bg-green-50/10">
              <CardHeader>
                <CardTitle className="text-green-600 dark:text-green-400 flex items-center gap-2">
                  <CheckCircle2 className="h-6 w-6" /> Processamento Concluido
                </CardTitle>
                <CardDescription>
                  Faca o download dos arquivos gerados abaixo.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col sm:flex-row gap-4">
                <Button
                  className="flex-1 h-12 bg-green-600 hover:bg-green-700 text-white"
                  onClick={() =>
                    downloadFile(
                      processedData.buffer,
                      `planilha_atualizada_${new Date().getTime()}.xlsx`,
                      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    )
                  }
                >
                  <FileSpreadsheet className="mr-2 h-5 w-5" /> Baixar Planilha
                  Atualizada
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 h-12"
                  onClick={() =>
                    downloadFile(
                      processedData.report,
                      `relatorio_alteracoes_${new Date().getTime()}.txt`,
                      "text/plain"
                    )
                  }
                >
                  <FileText className="mr-2 h-5 w-5" /> Baixar Relatorio de
                  Alteracoes
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
