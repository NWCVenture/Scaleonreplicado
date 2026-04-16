"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSession } from "@/lib/auth-client";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Tag } from "lucide-react";
import { UploadPlanilha } from "@/components/associar-etiquetas/upload-planilha";
import { UploadZpl } from "@/components/associar-etiquetas/upload-zpl";
import { ScannerInput } from "@/components/associar-etiquetas/scanner-input";
import { ListaAssociacoes } from "@/components/associar-etiquetas/lista-associacoes";
import {
  detectAndParseSpreadsheet,
  processarBipagem,
  exportarCSV,
  copiarAssociacoes,
  convertZplToImage,
  parseZplManual,
  type PlanilhaItem,
  type FormatoPlanilha,
  type EtiquetaAssociadaLocal,
} from "@/lib/etiquetas-utils";

interface AssociacaoRecord {
  id: string;
  etiqueta: string;
  sku: string;
  quantidade: number;
  createdAt: string;
}

export default function AssociarEtiquetasPage() {
  const { data: session, isPending } = useSession();

  // File state
  const [planilhaFile, setPlanilhaFile] = useState<File | null>(null);
  const [zplFile, setZplFile] = useState<File | null>(null);
  const [zplContent, setZplContent] = useState("");

  // Spreadsheet maps
  const [mapaPorId, setMapaPorId] = useState<Map<string, PlanilhaItem>>(
    new Map(),
  );
  const [mapaPorSku, setMapaPorSku] = useState<
    Map<string, PlanilhaItem[]>
  >(new Map());
  const [mapaPorTracking, setMapaPorTracking] = useState<
    Map<string, PlanilhaItem>
  >(new Map());
  const [formato, setFormato] = useState<FormatoPlanilha>("auto");

  // Associations from DB
  const [etiquetasAssociadas, setEtiquetasAssociadas] = useState<
    AssociacaoRecord[]
  >([]);

  // UI state
  const [inputValue, setInputValue] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isGerandoPdf, setIsGerandoPdf] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Refs
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ── Fetch existing associations on mount ──────────────────────────────────
  useEffect(() => {
    if (!session) return;

    const fetchAssociations = async () => {
      setIsLoading(true);
      try {
        const res = await fetch("/api/etiquetas");
        if (res.ok) {
          const { etiquetas } = await res.json();
          setEtiquetasAssociadas(etiquetas);
        }
      } catch {
        toast.error("Erro ao carregar associacoes");
      } finally {
        setIsLoading(false);
      }
    };

    fetchAssociations();
  }, [session]);

  // ── Auto-focus textarea when planilha is loaded ───────────────────────────
  useEffect(() => {
    if (mapaPorId.size === 0) return;
    const interval = setInterval(() => {
      if (document.activeElement !== inputRef.current) {
        inputRef.current?.focus();
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [mapaPorId.size]);

  // ── Handle planilha file upload ───────────────────────────────────────────
  const handlePlanilhaSelected = useCallback((file: File) => {
    setIsProcessing(true);
    setPlanilhaFile(file);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(firstSheet, {
          header: 1,
          defval: "",
        }) as any[][];

        const result = detectAndParseSpreadsheet(jsonData);
        setFormato(result.formato);
        setMapaPorId(result.mapaPorId);
        setMapaPorSku(result.mapaPorSku);
        setMapaPorTracking(result.mapaPorTracking);

        toast.success(
          `Planilha carregada! ${result.totalItens} itens (${result.formato === "lista_empacotamento" ? "Lista Empacotamento" : "Export Order"})`,
        );
      } catch {
        toast.error("Erro ao processar planilha");
      } finally {
        setIsProcessing(false);
      }
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const handleRemovePlanilha = useCallback(() => {
    setPlanilhaFile(null);
    setMapaPorId(new Map());
    setMapaPorSku(new Map());
    setMapaPorTracking(new Map());
    setFormato("auto");
  }, []);

  // ── Handle ZPL file upload ────────────────────────────────────────────────
  const handleZplSelected = useCallback((file: File) => {
    setZplFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      setZplContent(e.target?.result as string);
    };
    reader.readAsText(file);
  }, []);

  const handleRemoveZpl = useCallback(() => {
    setZplFile(null);
    setZplContent("");
  }, []);

  // ── Process scanned input ─────────────────────────────────────────────────
  const handleProcess = useCallback(async () => {
    if (!inputValue.trim()) return;

    const existingLocal: EtiquetaAssociadaLocal[] = etiquetasAssociadas.map(
      (a) => ({
        id: a.id,
        etiqueta: a.etiqueta,
        sku: a.sku,
        quantidade: a.quantidade,
      }),
    );

    const { novas, naoEncontradas } = processarBipagem(
      inputValue,
      formato,
      mapaPorId,
      mapaPorSku,
      mapaPorTracking,
      existingLocal,
    );

    if (naoEncontradas.length > 0) {
      toast.warning(
        `${naoEncontradas.length} etiqueta(s) nao encontrada(s): ${naoEncontradas.slice(0, 3).join(", ")}${naoEncontradas.length > 3 ? "..." : ""}`,
      );
    }

    if (novas.length > 0) {
      // Save to API
      try {
        const res = await fetch("/api/etiquetas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            etiquetas: novas.map((n) => ({
              etiqueta: n.etiqueta,
              sku: n.sku,
              quantidade: n.quantidade,
            })),
          }),
        });

        if (res.ok) {
          const created: AssociacaoRecord[] = await res.json();
          setEtiquetasAssociadas((prev) => [...created, ...prev]);
          toast.success(`${novas.length} associacao(oes) criada(s)!`);
        } else {
          throw new Error();
        }
      } catch {
        toast.error("Erro ao salvar associacoes");
      }
    }

    setInputValue("");
  }, [
    inputValue,
    formato,
    mapaPorId,
    mapaPorSku,
    mapaPorTracking,
    etiquetasAssociadas,
  ]);

  // ── Remove association ────────────────────────────────────────────────────
  const handleRemover = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/etiquetas/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setEtiquetasAssociadas((prev) => prev.filter((a) => a.id !== id));
      toast.success("Associacao removida");
    } catch {
      toast.error("Erro ao remover associacao");
    }
  }, []);

  // ── Clear all associations ────────────────────────────────────────────────
  const handleLimparTudo = useCallback(async () => {
    try {
      const res = await fetch("/api/etiquetas/bulk-delete", {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      setEtiquetasAssociadas([]);
      toast.success("Todas as associacoes removidas");
    } catch {
      toast.error("Erro ao limpar associacoes");
    }
  }, []);

  // ── Export CSV ────────────────────────────────────────────────────────────
  const handleExportar = useCallback(() => {
    if (!etiquetasAssociadas.length) {
      toast.warning("Nenhuma associacao para exportar");
      return;
    }
    exportarCSV(etiquetasAssociadas);
    toast.success("CSV exportado!");
  }, [etiquetasAssociadas]);

  // ── Copy associations ─────────────────────────────────────────────────────
  const handleCopiar = useCallback(async () => {
    if (!etiquetasAssociadas.length) return;
    await copiarAssociacoes(etiquetasAssociadas);
    toast.success("Copiado para a area de transferencia!");
  }, [etiquetasAssociadas]);

  // ── Generate example PDF ──────────────────────────────────────────────────
  const handleGerarPdfExemplo = useCallback(async () => {
    if (mapaPorId.size === 0) {
      toast.error("Carregue uma planilha primeiro!");
      return;
    }
    if (!zplContent) {
      toast.error("Carregue um arquivo ZPL primeiro!");
      return;
    }

    setIsGerandoPdf(true);
    try {
      const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");

      const primeiroItem = Array.from(mapaPorId.values())[0];
      if (!primeiroItem) {
        toast.error("Nenhum dado na planilha!");
        return;
      }

      toast.info("Convertendo ZPL para imagem...");

      const imagemZpl = await convertZplToImage(zplContent);

      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage([283.46, 425.2]); // 10cm x 15cm

      const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const helveticaBold = await pdfDoc.embedFont(
        StandardFonts.HelveticaBold,
      );

      const pageWidth = page.getWidth();
      const pageHeight = page.getHeight();

      let imagemInserida = false;

      if (imagemZpl && imagemZpl.length > 0) {
        try {
          const imagemPng = await pdfDoc.embedPng(imagemZpl);
          const escala = Math.min(
            (pageWidth - 20) / imagemPng.width,
            (pageHeight - 60) / imagemPng.height,
          );
          const imgWidth = imagemPng.width * escala;
          const imgHeight = imagemPng.height * escala;
          const imgX = (pageWidth - imgWidth) / 2;
          const imgY = pageHeight - imgHeight - 10;

          page.drawImage(imagemPng, {
            x: imgX,
            y: imgY,
            width: imgWidth,
            height: imgHeight,
          });
          imagemInserida = true;
        } catch {
          toast.warning(
            "Erro ao renderizar ZPL como imagem. Usando parsing manual...",
          );
        }
      }

      if (!imagemInserida) {
        const textos = parseZplManual(zplContent, pageHeight);
        for (const texto of textos) {
          try {
            page.drawText(texto.text, {
              x: texto.x,
              y: texto.y,
              size: texto.size,
              font: texto.bold ? helveticaBold : helvetica,
              color: rgb(0, 0, 0),
            });
          } catch {
            // skip invalid text
          }
        }
      }

      // Add SKU/Qty/ID text overlay
      const skuText = `SKU: ${primeiroItem.sku}`;
      const qtdText = `Qtd: ${primeiroItem.quantidade}`;
      const idText = `ID: ${primeiroItem.idPedido}`;

      const skuWidth = helveticaBold.widthOfTextAtSize(skuText, 12);
      const qtdWidth = helveticaBold.widthOfTextAtSize(qtdText, 12);
      const idWidth = helvetica.widthOfTextAtSize(idText, 10);

      const margin = 10;
      let textY = margin + 30;

      page.drawText(skuText, {
        x: pageWidth - skuWidth - margin,
        y: textY,
        size: 12,
        font: helveticaBold,
        color: rgb(0, 0, 0),
      });

      textY -= 15;

      page.drawText(qtdText, {
        x: pageWidth - qtdWidth - margin,
        y: textY,
        size: 12,
        font: helveticaBold,
        color: rgb(0, 0, 0),
      });

      textY -= 12;

      page.drawText(idText, {
        x: pageWidth - idWidth - margin,
        y: textY,
        size: 10,
        font: helvetica,
        color: rgb(0.5, 0.5, 0.5),
      });

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([new Uint8Array(pdfBytes)], {
        type: "application/pdf",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Etiqueta_Exemplo_${primeiroItem.sku.replace(/\s+/g, "_")}.pdf`;
      a.click();
      URL.revokeObjectURL(url);

      toast.success("PDF de exemplo gerado e baixado!");
    } catch (error: any) {
      toast.error(
        `Erro ao gerar PDF: ${error?.message || "Erro desconhecido"}`,
      );
    } finally {
      setIsGerandoPdf(false);
    }
  }, [mapaPorId, zplContent]);

  // ── Generate PDFs for all associations ────────────────────────────────────
  const handleGerarPdfs = useCallback(async () => {
    if (!etiquetasAssociadas.length) {
      toast.error("Nenhuma associacao para gerar PDFs!");
      return;
    }
    if (!zplContent) {
      toast.error("Carregue um arquivo ZPL primeiro!");
      return;
    }

    setIsGerandoPdf(true);
    try {
      const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");

      const pdfs: { id: string; bytes: Uint8Array; nome: string }[] = [];

      for (const associacao of etiquetasAssociadas) {
        const pdfDoc = await PDFDocument.create();
        const page = pdfDoc.addPage([283.46, 425.2]);

        const item = mapaPorId.get(associacao.etiqueta);
        const sku = item?.sku || associacao.sku;
        const quantidade = item?.quantidade || associacao.quantidade;

        const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const helveticaBold = await pdfDoc.embedFont(
          StandardFonts.HelveticaBold,
        );

        const pageWidth = page.getWidth();
        const pageHeight = page.getHeight();

        const imagemZpl = await convertZplToImage(zplContent);

        let imagemInserida = false;
        if (imagemZpl && imagemZpl.length > 0) {
          try {
            const imagemPng = await pdfDoc.embedPng(imagemZpl);
            const escala = Math.min(
              (pageWidth - 20) / imagemPng.width,
              (pageHeight - 60) / imagemPng.height,
            );
            const imgWidth = imagemPng.width * escala;
            const imgHeight = imagemPng.height * escala;
            const imgX = (pageWidth - imgWidth) / 2;
            const imgY = pageHeight - imgHeight - 10;

            page.drawImage(imagemPng, {
              x: imgX,
              y: imgY,
              width: imgWidth,
              height: imgHeight,
            });
            imagemInserida = true;
          } catch {
            // fallback to manual parsing
          }
        }

        if (!imagemInserida) {
          const textos = parseZplManual(zplContent, pageHeight);
          for (const texto of textos) {
            try {
              page.drawText(texto.text, {
                x: texto.x,
                y: texto.y,
                size: texto.size,
                font: texto.bold ? helveticaBold : helvetica,
                color: rgb(0, 0, 0),
              });
            } catch {
              // skip invalid text
            }
          }
        }

        const skuText = `SKU: ${sku}`;
        const qtdText = `Qtd: ${quantidade}`;
        const idText = `ID: ${associacao.etiqueta}`;

        const skuWidth = helveticaBold.widthOfTextAtSize(skuText, 12);
        const qtdWidth = helveticaBold.widthOfTextAtSize(qtdText, 12);
        const idWidth = helvetica.widthOfTextAtSize(idText, 10);

        const margin = 10;
        let textY = margin + 30;

        page.drawText(skuText, {
          x: pageWidth - skuWidth - margin,
          y: textY,
          size: 12,
          font: helveticaBold,
          color: rgb(0, 0, 0),
        });

        textY -= 15;

        page.drawText(qtdText, {
          x: pageWidth - qtdWidth - margin,
          y: textY,
          size: 12,
          font: helveticaBold,
          color: rgb(0, 0, 0),
        });

        textY -= 12;

        page.drawText(idText, {
          x: pageWidth - idWidth - margin,
          y: textY,
          size: 10,
          font: helvetica,
          color: rgb(0.5, 0.5, 0.5),
        });

        const pdfBytes = await pdfDoc.save();
        pdfs.push({
          id: associacao.id,
          bytes: new Uint8Array(pdfBytes),
          nome: `Etiqueta_${associacao.etiqueta}_${sku.replace(/\s+/g, "_")}.pdf`,
        });
      }

      // Download all PDFs with 200ms delay between each
      for (const pdf of pdfs) {
        const blob = new Blob([pdf.bytes.buffer as ArrayBuffer], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = pdf.nome;
        a.click();
        URL.revokeObjectURL(url);

        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      toast.success(
        `${pdfs.length} PDF(s) gerado(s) e baixado(s) com sucesso!`,
      );
    } catch (error: any) {
      toast.error(
        `Erro ao gerar PDFs: ${error?.message || "Erro desconhecido"}`,
      );
    } finally {
      setIsGerandoPdf(false);
    }
  }, [etiquetasAssociadas, zplContent, mapaPorId]);

  // ── Render ────────────────────────────────────────────────────────────────
  if (isPending || isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
      </div>
    );
  }

  if (!session) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Associar Etiquetas"
        description="Vincule SKUs a etiquetas de pedidos"
        icon={<Tag className="h-6 w-6" />}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <UploadPlanilha
          isProcessing={isProcessing}
          fileName={planilhaFile?.name || null}
          planilhaSize={mapaPorId.size}
          onFileSelected={handlePlanilhaSelected}
          onRemove={handleRemovePlanilha}
        />
        <UploadZpl
          zplFileName={zplFile?.name || null}
          hasZpl={!!zplContent}
          hasPlanilha={mapaPorId.size > 0}
          isGerandoPdf={isGerandoPdf}
          onFileSelected={handleZplSelected}
          onRemove={handleRemoveZpl}
          onGerarPdfExemplo={handleGerarPdfExemplo}
        />
      </div>

      {mapaPorId.size > 0 && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Scanner</CardTitle>
            </CardHeader>
            <CardContent>
              <ScannerInput
                ref={inputRef}
                value={inputValue}
                onChange={setInputValue}
                onProcess={handleProcess}
              />
            </CardContent>
          </Card>

          <ListaAssociacoes
            associacoes={etiquetasAssociadas}
            formato={formato}
            hasZpl={!!zplContent}
            isGerandoPdf={isGerandoPdf}
            onRemover={handleRemover}
            onLimparTudo={handleLimparTudo}
            onExportar={handleExportar}
            onCopiar={handleCopiar}
            onGerarPdfs={handleGerarPdfs}
          />
        </>
      )}
    </div>
  );
}
