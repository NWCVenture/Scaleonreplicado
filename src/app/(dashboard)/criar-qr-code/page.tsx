"use client";

import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import { Input, Label } from "@/components/ui/form-elements";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { QRCodeSVG } from "qrcode.react";
import { Printer, Download, QrCode, RefreshCw, Package, Plus, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/page-header";

export default function CriarQRCode() {
  // Tab
  const [activeTab, setActiveTab] = useState<'fardos' | 'embalados'>('fardos');

  // Fardos (existente)
  const [titulo, setTitulo] = useState("");
  const [link, setLink] = useState("");
  const [qrValue, setQrValue] = useState("");
  const printRef = useRef<HTMLDivElement>(null);

  // Embalados
  const [emSkuInput, setEmSkuInput] = useState("");
  const [emQtd, setEmQtd] = useState(1);
  const [emQrValue, setEmQrValue] = useState("");
  const [emSuggestions, setEmSuggestions] = useState<string[]>([]);
  const [showEmSuggestions, setShowEmSuggestions] = useState(false);

  // Fetch SKU suggestions from API (both Embalados and Kits use the same catalog)
  useEffect(() => {
    if (emSkuInput.length < 1) { setEmSuggestions([]); setShowEmSuggestions(false); return; }
    const controller = new AbortController();
    fetch(`/api/sku-catalogo?search=${encodeURIComponent(emSkuInput)}`, { signal: controller.signal })
      .then(r => r.ok ? r.json() : { skus: [] })
      .then(data => {
        const list = (data.skus as { codigo: string }[]).map(s => s.codigo).slice(0, 10);
        setEmSuggestions(list);
        setShowEmSuggestions(list.length > 0);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [emSkuInput]);

  // --- Shared handlers ---
  const handlePrint = (svgId: string, printTitulo: string, printLink: string) => {
    const svgElement = document.querySelector(`#${svgId}`) as SVGSVGElement;
    if (!svgElement) {
      toast.error("Erro ao gerar PDF. Tente novamente.");
      return;
    }
    const svgData = new XMLSerializer().serializeToString(svgElement);
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @page { size: 10cm 15cm; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 10cm; height: 15cm; margin: 0; padding: 20px;
      background: white; display: flex; flex-direction: column;
      align-items: center; justify-content: center; font-family: Arial, sans-serif;
    }
    .qr-container { margin-bottom: 20px; display: flex; align-items: center; justify-content: center; }
    .qr-container svg { max-width: 100%; height: auto; }
    .title { font-size: 18px; font-weight: bold; text-align: center; margin-bottom: 10px; word-break: break-word; }
    .link { font-size: 10px; text-align: center; color: #666; word-break: break-all; max-width: 100%; }
  </style>
</head>
<body>
  <div class="qr-container">${svgData}</div>
  <div class="title">${printTitulo || 'QR Code'}</div>
  <div class="link">${printLink || ''}</div>
  <script>window.onload = function() { setTimeout(function() { window.print(); }, 250); };</script>
</body>
</html>`;
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
    } else {
      toast.error("Popup bloqueado. Permita popups para imprimir.");
    }
  };

  const handleDownloadPNG = async (svgId: string, downloadTitulo: string) => {
    try {
      const svgElement = document.querySelector(`#${svgId}`) as SVGSVGElement;
      if (!svgElement) {
        toast.error("Erro ao gerar PNG. Tente novamente.");
        return;
      }
      const svgData = new XMLSerializer().serializeToString(svgElement);
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      const img = new Image();
      const size = 2000;
      canvas.width = size;
      canvas.height = size;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => {
          if (ctx) {
            ctx.fillStyle = "#FFFFFF";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            const padding = 50;
            const qrSize = size - (padding * 2);
            ctx.drawImage(img, padding, padding, qrSize, qrSize);
            canvas.toBlob((blob) => {
              if (blob) {
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = downloadTitulo
                  ? `${downloadTitulo.replace(/[^a-z0-9]/gi, '_')}.png`
                  : "qr-code.png";
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                toast.success("PNG baixado com sucesso!");
                resolve();
              } else {
                reject(new Error("Erro ao criar blob"));
              }
            }, "image/png");
          } else {
            reject(new Error("Contexto do canvas não disponível"));
          }
        };
        img.onerror = () => reject(new Error("Erro ao carregar imagem SVG"));
        const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
        img.src = URL.createObjectURL(svgBlob);
      });
    } catch (error) {
      console.error("Erro ao baixar PNG:", error);
      toast.error("Erro ao converter para PNG. Tente novamente.");
    }
  };

  const handleGenerateFardo = () => {
    if (!titulo.trim()) {
      toast.error("Preencha o título do QR Code!");
      return;
    }
    if (!link.trim()) {
      toast.error("Preencha o link/informação do QR Code!");
      return;
    }
    setQrValue(link.trim());
    toast.success("QR Code gerado com sucesso!");
  };

  // --- Embalados handlers ---
  const handleGenerateEmbalado = () => {
    if (!emSkuInput.trim()) {
      toast.error("Selecione um SKU!");
      return;
    }
    if (emQtd < 1) {
      toast.error("Quantidade deve ser pelo menos 1!");
      return;
    }
    const sku = emSkuInput.trim().toUpperCase();
    const value = `${sku}|EMBALADO|${emQtd}`;
    setEmQrValue(value);
    toast.success("QR Code do embalado gerado!");
  };

  const emQrTitle = emSkuInput ? `${emSkuInput.toUpperCase()} x${emQtd}` : "";


  return (
    <div className="space-y-6">
      <PageHeader
        title="Criar QR Code"
        description="Gere QR Codes para fardos ou embalados."
        icon={<QrCode className="h-8 w-8" />}
      />

      {/* Tab Navigation */}
      <div className="flex gap-1 border-b border-slate-700">
        {[
          { id: 'fardos' as const, label: 'Fardos / Geral', icon: QrCode },
          { id: 'embalados' as const, label: 'Embalados', icon: Package },
        ].map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors",
                activeTab === tab.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* TAB 1: Fardos / Geral */}
      {activeTab === 'fardos' && (
        <div className="grid gap-8 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Informações do QR Code</CardTitle>
              <CardDescription>
                Preencha os campos abaixo para gerar seu QR Code
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <Label htmlFor="titulo">Título do QR Code</Label>
                <Input
                  id="titulo"
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  placeholder="Ex: Link do Produto, Informação, etc."
                  className="mt-2"
                />
              </div>

              <div>
                <Label htmlFor="link">Link / Informação</Label>
                <Input
                  id="link"
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  placeholder="Ex: https://exemplo.com ou qualquer texto"
                  className="mt-2"
                />
                <p className="text-xs text-muted-foreground mt-2">
                  Pode ser um link (URL), texto ou qualquer informação que deseja codificar no QR Code.
                </p>
              </div>

              <Button
                onClick={handleGenerateFardo}
                className="w-full h-12 text-lg"
                disabled={!titulo.trim() || !link.trim()}
              >
                <QrCode className="mr-2 h-5 w-5" />
                Gerar QR Code
              </Button>

              {qrValue && (
                <div className="pt-4 border-t border-slate-700 space-y-4">
                  <div className="flex gap-3">
                    <Button
                      onClick={() => handlePrint("qr-code-svg-fardo", titulo, link)}
                      className="flex-1 h-12"
                      variant="default"
                    >
                      <Printer className="mr-2 h-5 w-5" />
                      Imprimir
                    </Button>
                    <Button
                      onClick={() => handleDownloadPNG("qr-code-svg-fardo", titulo)}
                      className="flex-1 h-12"
                      variant="outline"
                    >
                      <Download className="mr-2 h-5 w-5" />
                      Baixar PNG
                    </Button>
                  </div>
                  <Button
                    onClick={() => {
                      setTitulo("");
                      setLink("");
                      setQrValue("");
                      toast.info("Formulário limpo");
                    }}
                    variant="ghost"
                    className="w-full"
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Limpar e Criar Novo
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Visualização</CardTitle>
              <CardDescription>Visualize o QR Code gerado</CardDescription>
            </CardHeader>
            <CardContent>
              {qrValue ? (
                <div className="flex flex-col items-center justify-center space-y-4 p-8 bg-muted/30 rounded-lg min-h-[400px]">
                  <div className="bg-white p-6 rounded-lg shadow-lg">
                    <QRCodeSVG
                      id="qr-code-svg-fardo"
                      value={qrValue}
                      size={300}
                      level="H"
                      imageSettings={{
                        src: "/logo.svg",
                        x: undefined,
                        y: undefined,
                        height: 60,
                        width: 60,
                        excavate: true,
                      }}
                    />
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold">{titulo}</p>
                    <p className="text-sm text-muted-foreground mt-1 break-all max-w-md">{link}</p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center space-y-4 p-8 bg-muted/30 rounded-lg min-h-[400px]">
                  <QrCode className="h-24 w-24 text-muted-foreground opacity-50" />
                  <p className="text-muted-foreground text-center">
                    Preencha os campos e clique em &quot;Gerar QR Code&quot; para visualizar
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* TAB 2: Embalados */}
      {activeTab === 'embalados' && (
        <div className="grid gap-8 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>QR Code de Embalado</CardTitle>
              <CardDescription>
                Selecione um SKU e informe a quantidade para gerar o QR Code do embalado
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label>SKU do Embalado</Label>
                <div className="relative">
                  <Input
                    placeholder="Buscar ou digitar SKU..."
                    value={emSkuInput}
                    onChange={(e) => setEmSkuInput(e.target.value)}
                    onFocus={() => emSkuInput.length > 0 && setShowEmSuggestions(true)}
                  />
                  {showEmSuggestions && emSuggestions.length > 0 && (
                    <div className="absolute z-50 w-full mt-1 bg-slate-800 border border-slate-700 rounded-md shadow-lg max-h-48 overflow-auto">
                      {emSuggestions.map(sku => (
                        <button
                          key={sku}
                          type="button"
                          className="w-full text-left px-4 py-2 hover:bg-slate-700 text-sm text-white"
                          onClick={() => {
                            setEmSkuInput(sku);
                            setShowEmSuggestions(false);
                          }}
                        >
                          {sku}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Quantidade</Label>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    onClick={() => setEmQtd(q => Math.max(1, q - 1))}
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                  <Input
                    type="number"
                    value={emQtd}
                    onChange={(e) => setEmQtd(Math.max(1, parseInt(e.target.value) || 1))}
                    className="text-center text-xl font-bold"
                    min="1"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    onClick={() => setEmQtd(q => q + 1)}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <Button
                onClick={handleGenerateEmbalado}
                className="w-full h-12 text-lg"
                disabled={!emSkuInput.trim()}
              >
                <Package className="mr-2 h-5 w-5" />
                Gerar QR Code do Embalado
              </Button>

              {emQrValue && (
                <div className="pt-4 border-t border-slate-700 space-y-4">
                  <div className="flex gap-3">
                    <Button
                      onClick={() => handlePrint("qr-code-svg-embalado", emQrTitle, emQrValue)}
                      className="flex-1 h-12"
                      variant="default"
                    >
                      <Printer className="mr-2 h-5 w-5" />
                      Imprimir
                    </Button>
                    <Button
                      onClick={() => handleDownloadPNG("qr-code-svg-embalado", emQrTitle)}
                      className="flex-1 h-12"
                      variant="outline"
                    >
                      <Download className="mr-2 h-5 w-5" />
                      Baixar PNG
                    </Button>
                  </div>
                  <Button
                    onClick={() => {
                      setEmSkuInput("");
                      setEmQtd(1);
                      setEmQrValue("");
                      toast.info("Formulário limpo");
                    }}
                    variant="ghost"
                    className="w-full"
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Limpar e Criar Novo
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Visualização</CardTitle>
              <CardDescription>QR Code do embalado gerado</CardDescription>
            </CardHeader>
            <CardContent>
              {emQrValue ? (
                <div className="flex flex-col items-center justify-center space-y-4 p-8 bg-muted/30 rounded-lg min-h-[400px]">
                  <div className="bg-white p-6 rounded-lg shadow-lg">
                    <QRCodeSVG
                      id="qr-code-svg-embalado"
                      value={emQrValue}
                      size={300}
                      level="H"
                      imageSettings={{
                        src: "/logo.svg",
                        x: undefined,
                        y: undefined,
                        height: 60,
                        width: 60,
                        excavate: true,
                      }}
                    />
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold font-mono">{emSkuInput.toUpperCase()}</p>
                    <p className="text-2xl font-bold text-primary mt-1">&times; {emQtd} peças</p>
                    <p className="text-xs text-muted-foreground mt-2 font-mono">{emQrValue}</p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center space-y-4 p-8 bg-muted/30 rounded-lg min-h-[400px]">
                  <Package className="h-24 w-24 text-muted-foreground opacity-50" />
                  <p className="text-muted-foreground text-center">
                    Selecione um SKU e informe a quantidade para gerar o QR Code do embalado
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}


      {/* Área de Impressão (Oculta visualmente) */}
      <div className="hidden">
        <div ref={printRef}>
          <div
            className="print-page bg-white text-black w-[10cm] h-[15cm] flex flex-col items-center justify-center p-4 mx-auto"
            style={{ pageBreakAfter: 'always' }}
          >
            <div className="relative flex-shrink-0 mb-4">
              <QRCodeSVG
                value={qrValue || " "}
                size={200}
                level="H"
                imageSettings={{
                  src: "/logo.svg",
                  x: undefined,
                  y: undefined,
                  height: 40,
                  width: 40,
                  excavate: true,
                }}
              />
            </div>
            <div className="text-center flex-1 flex flex-col justify-center w-full px-2">
              <h3 className="text-2xl font-bold mb-2 break-words leading-tight">{titulo}</h3>
              <p className="text-xs text-gray-600 break-all max-w-full mt-2 font-mono">{link}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
