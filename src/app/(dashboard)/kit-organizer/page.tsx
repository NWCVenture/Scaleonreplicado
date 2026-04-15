"use client";

import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { FileText, Download, RefreshCw, Upload, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { pdfjs } from "@/lib/pdf-worker";
import { PDFDocument, StandardFonts, rgb } from "@/lib/pdf-worker";
import { PageHeader } from "@/components/layout/page-header";

type AccountType = "ML-NEW COMMAND" | "ML-NWCOMMAND" | "ML-FASTCLOTHY" | "SHP-TODAS" | "SHP-NWCOMMAND" | "FLEX";

type PageInfo = {
  index: number;
  quantity: number;
  isKit: boolean;
  pageNum: number;
  hasLua: boolean;
  hasSol: boolean;
  text: string;
};

type ProcessedData = {
  pages: PageInfo[];
  kitPages: PageInfo[];
  kitCount: number;
  totalPages: number;
  originalPages: PageInfo[];
};

export default function KitOrganizer() {
  const [file, setFile] = useState<File | null>(null);
  const [processedData, setProcessedData] = useState<ProcessedData | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState("");
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<AccountType>("ML-NEW COMMAND");
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const handleFileSelect = (selectedFile: File | null) => {
    if (selectedFile) {
      const isPDF = selectedFile.type === "application/pdf" ||
                   selectedFile.name.toLowerCase().endsWith(".pdf");

      if (isPDF) {
        setFile(selectedFile);
        setProcessedData(null);
        setProgress(0);
        toast.success("PDF selecionado!");
      } else {
        toast.error("Por favor, selecione um arquivo PDF valido.");
      }
    }
  };

  // Prevenir comportamento padrao do navegador para drag and drop
  useEffect(() => {
    const handleWindowDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      return false;
    };

    const handleWindowDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      return false;
    };

    document.addEventListener("dragover", handleWindowDragOver, true);
    document.addEventListener("drop", handleWindowDrop, true);

    return () => {
      document.removeEventListener("dragover", handleWindowDragOver, true);
      document.removeEventListener("drop", handleWindowDrop, true);
    };
  }, []);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    handleFileSelect(selectedFile || null);
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.dataTransfer.types.includes("Files")) {
      setIsDragging(true);
      e.dataTransfer.dropEffect = "copy";
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.dataTransfer.types.includes("Files")) {
      setIsDragging(true);
      e.dataTransfer.dropEffect = "copy";
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;

    if (!e.relatedTarget ||
        x < rect.left || x > rect.right ||
        y < rect.top || y > rect.bottom) {
      setIsDragging(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    setIsDragging(false);

    const files = e.dataTransfer.files;

    if (files && files.length > 0) {
      const droppedFile = files[0];

      const isPDF = droppedFile.type === "application/pdf" ||
                   droppedFile.name.toLowerCase().endsWith(".pdf");

      if (isPDF) {
        handleFileSelect(droppedFile);
      } else {
        toast.error("Por favor, solte apenas arquivos PDF.");
      }
    } else {
      toast.error("Nenhum arquivo foi solto.");
    }

    return false;
  };

  const processPDF = async () => {
    if (!file) {
      toast.error("Selecione um arquivo PDF primeiro!");
      return;
    }

    setIsProcessing(true);
    setProgress(0);
    setProgressText("Carregando bibliotecas...");

    try {
      setProgress(10);
      setProgressText("Lendo arquivo PDF...");

      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);

      if (bytes.length < 4) {
        throw new Error("Arquivo muito pequeno ou invalido.");
      }

      const pdfHeader = String.fromCharCode(...bytes.slice(0, 4));
      if (pdfHeader !== "%PDF") {
        throw new Error("Arquivo nao e um PDF valido. Verifique o arquivo e tente novamente.");
      }

      setPdfBytes(new Uint8Array(bytes));

      setProgress(20);
      setProgressText("Analisando paginas...");

      const pdf = await pdfjs.getDocument({
        data: bytes,
        verbosity: 0,
      }).promise;

      if (!pdf || pdf.numPages === 0) {
        throw new Error("PDF nao contem paginas validas.");
      }

      const pages: PageInfo[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const text = textContent.items.map((item: any) => (item as any).str).join(" ");

        let qty = 1;

        const isInDeclaracao = /DECLARA\u00c7\u00c3O\s+DE\s+CONTE\u00daDO/i.test(text);

        if (isInDeclaracao) {
          const match = text.match(/Total[:\s\t]+(\d+)/i);
          if (match) {
            const totalQty = parseInt(match[1]);
            if (totalQty > 1) {
              qty = totalQty;
            }
          } else {
            const qtdMatch = text.match(/QTD[:\s]+(\d+)/i);
            if (qtdMatch) {
              const qtdValue = parseInt(qtdMatch[1]);
              if (qtdValue > 1) {
                qty = qtdValue;
              }
            }
          }
        }

        const skuPattern = /(?:SKU|DESCRI\u00c7\u00c3O).*?((?:KIT|MIX)?\s*(?:LUA|SOL)\s+(?:AZ|BR|PT|EGG)?\s*(?:P|M|G|GG|EGG)?)/i;
        const skuMatch = text.match(skuPattern);

        const hasLua = skuMatch ? /LUA/i.test(skuMatch[1]) : false;
        const hasSolMatch = skuMatch ? /SOL/i.test(skuMatch[1]) : false;

        const isEndereco = /\b(Sol|Lua)\s+Nascente\b/i.test(text);
        const solValido = hasSolMatch && !isEndereco && (
          /\bSOL\s+(AZ|BR|PT|EGG|M|G|GG|P)\b/i.test(text) ||
          (skuMatch !== null && /\bSOL\s+(?:AZ|BR|PT|EGG)\s+(?:P|M|G|GG|EGG)\b/i.test(skuMatch[1]))
        );

        let pageText = "";
        if (hasLua && solValido) {
          pageText = "ATENCAO: MANGA LONGA E CURTA";
        } else if (hasLua) {
          pageText = "ATENCAO: MANGA LONGA";
        } else if (solValido) {
          pageText = "ATENCAO: MANGA CURTA";
        }

        const isKit = isInDeclaracao && qty > 1;

        pages.push({
          index: i - 1,
          quantity: qty,
          isKit: isKit,
          pageNum: i,
          hasLua,
          hasSol: solValido,
          text: pageText,
        });

        const progressValue = 20 + (i / pdf.numPages) * 60;
        setProgress(progressValue);
        setProgressText(`Analisando pagina ${i} de ${pdf.numPages}...`);
      }

      setProgress(85);
      setProgressText("Reorganizando paginas...");

      const kitPages = pages.filter((p) => p.isKit);
      const normalPages = pages.filter((p) => !p.isKit);
      const reorganized = [...kitPages, ...normalPages];

      const processed: ProcessedData = {
        pages: reorganized,
        kitPages: kitPages,
        kitCount: kitPages.length,
        totalPages: pages.length,
        originalPages: pages,
      };

      setProcessedData(processed);
      setProgress(100);
      setProgressText("Concluido!");

      setTimeout(() => {
        setIsProcessing(false);
        toast.success(
          `PDF analisado! ${processed.kitCount} KIT(s) encontrado(s).`
        );
      }, 500);
    } catch (error: any) {
      setIsProcessing(false);
      setProgress(0);
      const errorMessage = error.message || "Erro desconhecido ao processar PDF";
      toast.error(`Erro ao processar PDF: ${errorMessage}`);
      console.error("Erro detalhado:", error);

      if (errorMessage.includes("header") || errorMessage.includes("PDF")) {
        toast.error("Verifique se o arquivo e um PDF valido e nao esta corrompido.", {
          duration: 5000,
        });
      }
    }
  };

  const downloadModifiedPDF = async () => {
    if (!processedData) {
      toast.error("Processe o PDF primeiro!");
      return;
    }

    let bytesToUse = pdfBytes;
    if (!bytesToUse && file) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        bytesToUse = new Uint8Array(arrayBuffer);
      } catch {
        toast.error("Erro ao ler arquivo. Selecione o PDF novamente.");
        return;
      }
    }

    if (!bytesToUse || bytesToUse.length === 0) {
      toast.error("PDF nao foi carregado corretamente. Processe o PDF primeiro.");
      return;
    }

    setIsProcessing(true);
    setProgress(0);
    setProgressText("Carregando PDF...");

    try {
      if (bytesToUse.length < 4) {
        throw new Error("Arquivo PDF muito pequeno ou corrompido.");
      }

      const pdfHeader = String.fromCharCode(...bytesToUse.slice(0, 4));
      if (pdfHeader !== "%PDF") {
        throw new Error("Arquivo PDF invalido ou corrompido.");
      }

      let pdfDoc;
      try {
        pdfDoc = await PDFDocument.load(bytesToUse, {
          ignoreEncryption: true,
        });
      } catch (loadError: any) {
        console.error("Erro ao carregar PDF:", loadError);
        throw new Error(`Erro ao carregar PDF: ${loadError.message || "PDF pode estar corrompido ou protegido"}`);
      }

      setProgress(30);
      setProgressText("Criando novo PDF...");

      const newPdfDoc = await PDFDocument.create();
      setProgress(50);
      setProgressText("Reorganizando paginas...");

      const helveticaBold = await newPdfDoc.embedFont(StandardFonts.HelveticaBold);

      for (let newIdx = 0; newIdx < processedData.pages.length; newIdx++) {
        const pageInfo = processedData.pages[newIdx];
        const originalIdx = pageInfo.index;

        const [copiedPage] = await newPdfDoc.copyPages(pdfDoc, [originalIdx]);
        newPdfDoc.addPage(copiedPage);

        const pdfPages = newPdfDoc.getPages();
        const lastPage = pdfPages[pdfPages.length - 1];

        // Se e um KIT, inserir quadrado preto no canto inferior direito
        if (pageInfo.isKit) {
          try {
            const pageWidth = lastPage.getWidth();
            const squareSize = 15;
            const squareX = pageWidth - 25;
            const squareY = 15;

            lastPage.drawRectangle({
              x: squareX,
              y: squareY,
              width: squareSize,
              height: squareSize,
              color: rgb(0, 0, 0),
            });

            // Tentar carregar icone de kit
            try {
              const iconNames = ["/icon-kit.png", "/kit-icon.png", "/icon.png", "/kit.png"];
              let iconImage = null;

              for (const iconName of iconNames) {
                try {
                  const iconResponse = await fetch(iconName);
                  if (iconResponse.ok) {
                    const iconBytes = await iconResponse.arrayBuffer();
                    try {
                      iconImage = await newPdfDoc.embedPng(new Uint8Array(iconBytes));
                    } catch {
                      iconImage = await newPdfDoc.embedJpg(new Uint8Array(iconBytes));
                    }
                    break;
                  }
                } catch {
                  continue;
                }
              }

              if (iconImage) {
                lastPage.drawImage(iconImage, {
                  x: squareX - 25,
                  y: squareY - 2,
                  width: 20,
                  height: 20,
                });
              }
            } catch {
              // Se nao houver icone, continuar sem ele
            }
          } catch (e) {
            console.log("Nao foi possivel inserir quadrado/icone:", e);
          }
        }

        // Adicionar texto e imagem se houver LUA ou SOL
        if (pageInfo.text) {
          try {
            const fontSize = 8;
            const textWidth = helveticaBold.widthOfTextAtSize(pageInfo.text, fontSize);

            const textX = 10;
            const textY = 20;

            lastPage.drawText(pageInfo.text, {
              x: textX,
              y: textY,
              size: fontSize,
              color: rgb(0, 0, 0),
              font: helveticaBold,
            });

            let iconX = textX + textWidth + 5;
            const iconY = textY - 2;
            const iconSize = 27;

            // Tentar carregar imagem de manga longa se for LUA
            if (pageInfo.hasLua) {
              try {
                const imgBytes = await fetch("/manga-longa.png").then(r => r.arrayBuffer());
                const img = await newPdfDoc.embedPng(new Uint8Array(imgBytes));
                lastPage.drawImage(img, {
                  x: iconX,
                  y: iconY,
                  width: iconSize,
                  height: iconSize,
                });
                iconX += iconSize + 5;
              } catch {
                // Fallback silencioso
              }
            }

            // Tentar carregar imagem de manga curta se for SOL
            if (pageInfo.hasSol) {
              try {
                const imgBytes = await fetch("/manga-curta.png").then(r => r.arrayBuffer());
                const img = await newPdfDoc.embedPng(new Uint8Array(imgBytes));
                lastPage.drawImage(img, {
                  x: iconX,
                  y: iconY,
                  width: iconSize,
                  height: iconSize,
                });
              } catch {
                // Fallback silencioso
              }
            }
          } catch (e) {
            console.error("Nao foi possivel adicionar texto/imagem:", e);
          }
        }

        const progressValue = 50 + (newIdx / processedData.pages.length) * 40;
        setProgress(progressValue);
        setProgressText(`Processando pagina ${newIdx + 1} de ${processedData.pages.length}...`);
      }

      setProgress(95);
      setProgressText("Salvando PDF...");

      const newPdfBytes = await newPdfDoc.save();
      const blob = new Blob([newPdfBytes as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = url;
      link.style.display = "none";
      const dateStr = new Date().toISOString().split("T")[0];
      link.download = `Etiquetas_Reorganizadas_${selectedAccount}_${dateStr}.pdf`;

      document.body.appendChild(link);

      setTimeout(() => {
        link.click();
        setTimeout(() => {
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
        }, 100);
      }, 100);

      setProgress(100);
      setTimeout(() => {
        setIsProcessing(false);
        toast.success("PDF reorganizado e baixado com sucesso!");
      }, 500);
    } catch (error: any) {
      setIsProcessing(false);
      setProgress(0);
      const errorMessage = error.message || "Erro desconhecido ao reorganizar PDF";
      toast.error(`Erro: ${errorMessage}`);
      console.error("Erro detalhado ao baixar PDF:", error);

      if (errorMessage.includes("header") || errorMessage.includes("PDF")) {
        toast.error("O PDF pode estar corrompido. Tente processar novamente.", {
          duration: 5000,
        });
      }
    }
  };

  const resetAll = () => {
    setFile(null);
    setProcessedData(null);
    setPdfBytes(null);
    setProgress(0);
    setProgressText("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    toast.info("Resetado! Selecione um novo PDF para comecar.");
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="KIT Organizer"
        description="Reorganize PDFs de etiquetas - Agrupe KITs no inicio automaticamente"
      />

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Card de Upload e Processamento */}
        <Card>
          <CardHeader>
            <CardTitle>Processar PDF</CardTitle>
            <CardDescription>
              Selecione um PDF de etiquetas para reorganizar
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Selecao de Conta */}
            <div>
              <label className="block text-sm font-medium mb-2">
                Conta
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(["ML-NEW COMMAND", "ML-NWCOMMAND", "ML-FASTCLOTHY", "SHP-TODAS", "SHP-NWCOMMAND", "FLEX"] as AccountType[]).map((account) => (
                  <Button
                    key={account}
                    variant={selectedAccount === account ? "default" : "outline"}
                    onClick={() => setSelectedAccount(account)}
                    disabled={isProcessing}
                    className="text-xs"
                  >
                    {account}
                  </Button>
                ))}
              </div>
            </div>

            {/* Drag and Drop Zone */}
            <div>
              <label className="block text-sm font-medium mb-2">
                Arquivo PDF
              </label>
              <div
                ref={dropZoneRef}
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={cn(
                  "border-2 border-dashed rounded-lg p-8 text-center transition-all cursor-pointer",
                  isDragging
                    ? "border-primary bg-primary/10 scale-[1.02] shadow-lg"
                    : "border-muted-foreground/25 hover:border-primary/50",
                  isProcessing && "opacity-50 cursor-not-allowed pointer-events-none"
                )}
                style={{
                  pointerEvents: isProcessing ? "none" : "auto",
                }}
              >
                <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-sm font-medium mb-2">
                  Arraste e solte o PDF aqui
                </p>
                <p className="text-xs text-muted-foreground mb-4">
                  ou
                </p>
                <div className="flex gap-3 justify-center">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf"
                    onChange={handleFileInputChange}
                    className="hidden"
                    disabled={isProcessing}
                    id="pdf-upload"
                  />
                  <Button
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isProcessing}
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    Selecionar Arquivo
                  </Button>
                </div>
              </div>
              {file && (
                <p className="text-sm text-muted-foreground mt-2">
                  {file.name} ({(file.size / 1024).toFixed(2)} KB)
                </p>
              )}
            </div>

            {isProcessing && (
              <div className="space-y-2">
                <Progress value={progress} className="h-2" />
                <p className="text-sm text-muted-foreground text-center">
                  {progressText}
                </p>
              </div>
            )}

            {processedData && !isProcessing && (
              <Card className="bg-muted/50">
                <CardContent className="pt-6">
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium">Total de paginas:</span>
                      <span className="font-bold">{processedData.totalPages}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium">KITs encontrados:</span>
                      <span className="font-bold text-primary">
                        {processedData.kitCount}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="flex gap-3">
              <Button
                onClick={processPDF}
                disabled={!file || isProcessing}
                className="flex-1"
              >
                <FileText className="mr-2 h-4 w-4" />
                Processar PDF
              </Button>
              <Button
                onClick={resetAll}
                variant="outline"
                disabled={isProcessing}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>

            <Button
              onClick={downloadModifiedPDF}
              disabled={!processedData || isProcessing}
              className="w-full"
              variant="default"
            >
              <Download className="mr-2 h-4 w-4" />
              Baixar PDF Reorganizado
            </Button>
          </CardContent>
        </Card>

        {/* Card de Informacoes */}
        <Card>
          <CardHeader>
            <CardTitle>Como Funciona</CardTitle>
            <CardDescription>
              Entenda o processo de reorganizacao
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="text-sm font-bold text-primary">1</span>
                </div>
                <div>
                  <p className="font-medium">Selecione o PDF</p>
                  <p className="text-sm text-muted-foreground">
                    Escolha o arquivo PDF de etiquetas que deseja reorganizar
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="text-sm font-bold text-primary">2</span>
                </div>
                <div>
                  <p className="font-medium">Analise Automatica</p>
                  <p className="text-sm text-muted-foreground">
                    O sistema analisa cada pagina procurando por quantidade (QTD)
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="text-sm font-bold text-primary">3</span>
                </div>
                <div>
                  <p className="font-medium">Reorganizacao</p>
                  <p className="text-sm text-muted-foreground">
                    KITs (QTD &gt; 1) sao movidos para o inicio do PDF
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="text-sm font-bold text-primary">4</span>
                </div>
                <div>
                  <p className="font-medium">Marcacao de KITs</p>
                  <p className="text-sm text-muted-foreground">
                    Um quadrado preto e inserido no canto superior esquerdo de cada KIT
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="text-sm font-bold text-primary">5</span>
                </div>
                <div>
                  <p className="font-medium">Download</p>
                  <p className="text-sm text-muted-foreground">
                    Baixe o PDF reorganizado e pronto para impressao
                  </p>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t">
              <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg">
                <Package className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                    Dica Importante
                  </p>
                  <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                    O sistema identifica KITs procurando por &quot;Unidades&quot; ou &quot;QTD&quot; nas paginas.
                    Paginas com quantidade maior que 1 sao consideradas KITs.
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
