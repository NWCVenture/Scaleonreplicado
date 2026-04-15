"use client";

import { useState, useRef, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Camera,
  Keyboard,
  Loader2,
  ScanLine,
  ArrowUpCircle,
  CheckCircle,
} from "lucide-react";
import { CameraScanner } from "@/components/shared/camera-scanner";
import { parseQRCode, type ParsedQR } from "@/lib/estante-utils";
import { cn } from "@/lib/utils";

interface ModalScannerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  mode: "retirar" | "adicionar" | "bipagem";
  onScanComplete: (parsed: ParsedQR, raw: string) => void;
  pendingQR?: { raw: string; parsed: ParsedQR } | null;
  onConfirmRetirada?: () => void;
  onLerOutro?: () => void;
  bipagemScanned?: string[];
  onConfirmBipagem?: () => void;
}

export function ModalScanner({
  open,
  onOpenChange,
  title,
  mode,
  onScanComplete,
  pendingQR,
  onConfirmRetirada,
  onLerOutro,
  bipagemScanned = [],
  onConfirmBipagem,
}: ModalScannerProps) {
  const [scanInput, setScanInput] = useState("");
  const [lastScanned, setLastScanned] = useState<ParsedQR | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => scanRef.current?.focus(), 200);
    }
  }, [open]);

  const handleCameraScan = (raw: string) => {
    const parsed = parseQRCode(raw);
    if (!parsed) return;
    setLastScanned(parsed);
    onScanComplete(parsed, raw);
  };

  const handleTextChange = (value: string) => {
    setScanInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (value.trim().length > 3) {
        const parsed = parseQRCode(value);
        if (parsed) {
          setLastScanned(parsed);
          onScanComplete(parsed, value);
        }
        setScanInput("");
      }
    }, 100);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && scanInput.trim().length > 3) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const parsed = parseQRCode(scanInput);
      if (parsed) {
        setLastScanned(parsed);
        onScanComplete(parsed, scanInput);
      }
      setScanInput("");
    }
  };

  const accentColor =
    mode === "retirar"
      ? "text-red-400"
      : mode === "adicionar"
        ? "text-green-400"
        : "text-blue-400";

  const accentBg =
    mode === "retirar"
      ? "bg-red-950 border-red-800"
      : mode === "adicionar"
        ? "bg-green-950 border-green-800"
        : "bg-blue-950 border-blue-800";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className={accentColor}>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {pendingQR && mode === "retirar" ? (
            <div className="space-y-4">
              <div className={cn("p-4 rounded-xl border", accentBg)}>
                <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">
                  QR lido
                </p>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div>
                    <p className="text-xs text-muted-foreground">SKU</p>
                    <p className="font-bold font-mono text-sm">
                      {pendingQR.parsed.sku}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Lote</p>
                    <p className="font-bold font-mono text-sm">
                      {pendingQR.parsed.lote}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Qtd</p>
                    <p className="font-bold font-mono text-sm">
                      {pendingQR.parsed.qtd}
                    </p>
                  </div>
                </div>
              </div>
              <Button
                className="w-full h-14 text-base bg-red-600 hover:bg-red-700 text-white"
                onClick={onConfirmRetirada}
              >
                <ArrowUpCircle className="h-5 w-5 mr-2" /> Confirmar Retirada
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={onLerOutro}
              >
                Ler outro QR
              </Button>
            </div>
          ) : (
            <>
              <Tabs defaultValue="teclado">
                <TabsList className="w-full">
                  <TabsTrigger value="camera" className="flex-1">
                    <Camera className="h-4 w-4 mr-1" /> Camera
                  </TabsTrigger>
                  <TabsTrigger value="teclado" className="flex-1">
                    <Keyboard className="h-4 w-4 mr-1" /> Leitor/Teclado
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="camera">
                  <CameraScanner onScan={handleCameraScan} />
                </TabsContent>

                <TabsContent value="teclado">
                  <div className="space-y-3">
                    <div className="relative">
                      <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                      <Input
                        ref={scanRef}
                        className="pl-10 text-base h-12 font-mono bg-slate-800 border-slate-600"
                        placeholder="Aponte o leitor QR aqui..."
                        value={scanInput}
                        onChange={(e) => handleTextChange(e.target.value)}
                        onKeyDown={handleKeyDown}
                        autoComplete="off"
                      />
                    </div>

                    {lastScanned && mode !== "retirar" && (
                      <div className="p-3 bg-green-950 border border-green-800 rounded-lg">
                        <div className="flex items-center gap-2 mb-1">
                          <CheckCircle className="h-4 w-4 text-green-500" />
                          <span className="text-sm font-semibold text-green-200">
                            Ultimo lido
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          <div>
                            <p className="text-muted-foreground">SKU</p>
                            <p className="font-bold font-mono">
                              {lastScanned.sku}
                            </p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Lote</p>
                            <p className="font-bold font-mono">
                              {lastScanned.lote}
                            </p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Qtd</p>
                            <p className="font-bold font-mono">
                              {lastScanned.qtd}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </TabsContent>
              </Tabs>

              {mode === "bipagem" && bipagemScanned.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    Validados: {bipagemScanned.length}
                  </p>
                  <div className="max-h-28 overflow-y-auto space-y-1 pr-1">
                    {bipagemScanned.map((key, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 text-xs bg-slate-800 rounded px-2 py-1"
                      >
                        <CheckCircle className="h-3 w-3 text-green-500 shrink-0" />
                        <span className="font-mono truncate">{key}</span>
                      </div>
                    ))}
                  </div>
                  <Button className="w-full" onClick={onConfirmBipagem}>
                    <CheckCircle className="h-4 w-4 mr-2" /> Confirmar Bipagem (
                    {bipagemScanned.length})
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
