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
  ScanLine,
  ArrowUpCircle,
  CheckCircle,
  X,
  AlertTriangle,
  AlertCircle,
  Info,
  Trash2,
} from "lucide-react";
import { CameraScanner } from "@/components/shared/camera-scanner";
import { parseQRCode, type ParsedQR } from "@/lib/estante-utils";
import { cn } from "@/lib/utils";

export type PendingFardo = {
  key: string;
  raw: string;
  parsed: ParsedQR;
};

export type SessionLogEntry = {
  id: string;
  timestamp: number;
  tipo: "success" | "warning" | "error" | "info";
  mensagem: string;
};

interface ModalScannerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  mode: "retirar" | "adicionar" | "bipagem";
  onScanComplete: (parsed: ParsedQR, raw: string) => void;
  pendingFardos?: PendingFardo[];
  onRemovePending?: (key: string) => void;
  onConfirmInclusao?: () => void;
  onConfirmRetirada?: () => void;
  bipagemScanned?: string[];
  onConfirmBipagem?: () => void;
  sessionLog?: SessionLogEntry[];
  onClearLog?: () => void;
  isConfirming?: boolean;
}

const logIcons = {
  success: CheckCircle,
  warning: AlertTriangle,
  error: AlertCircle,
  info: Info,
};

const logStyles = {
  success: "text-green-400",
  warning: "text-yellow-400",
  error: "text-red-400",
  info: "text-blue-400",
};

export function ModalScanner({
  open,
  onOpenChange,
  title,
  mode,
  onScanComplete,
  pendingFardos = [],
  onRemovePending,
  onConfirmInclusao,
  onConfirmRetirada,
  bipagemScanned = [],
  onConfirmBipagem,
  sessionLog = [],
  onClearLog,
  isConfirming = false,
}: ModalScannerProps) {
  const [scanInput, setScanInput] = useState("");
  const [lastScanned, setLastScanned] = useState<ParsedQR | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const logScrollRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const playBeep = (type: "success" | "error" = "success") => {
    const audio = new Audio(
      type === "success" ? "/sounds/bipado.mp3" : "/sounds/erro.mp3",
    );
    audio.play().catch(() => {});
  };

  useEffect(() => {
    if (open) {
      setTimeout(() => scanRef.current?.focus(), 200);
    }
  }, [open]);

  // Mantém o log da sessão sempre rolado pro último evento.
  useEffect(() => {
    if (logScrollRef.current) {
      logScrollRef.current.scrollTop = logScrollRef.current.scrollHeight;
    }
  }, [sessionLog.length]);

  const handleCameraScan = (raw: string) => {
    const parsed = parseQRCode(raw);
    if (!parsed) {
      playBeep("error");
      return;
    }
    playBeep("success");
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
          playBeep("success");
          setLastScanned(parsed);
          onScanComplete(parsed, value);
        } else {
          playBeep("error");
        }
        setScanInput("");
      }
    }, 30);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && scanInput.trim().length > 3) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const parsed = parseQRCode(scanInput);
      if (parsed) {
        playBeep("success");
        setLastScanned(parsed);
        onScanComplete(parsed, scanInput);
      } else {
        playBeep("error");
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

  const totalPecasPendentes = pendingFardos.reduce(
    (sum, p) => sum + p.parsed.qtd,
    0,
  );

  const confirmButtonClass =
    mode === "retirar"
      ? "bg-red-600 hover:bg-red-700"
      : mode === "adicionar"
        ? "bg-green-600 hover:bg-green-700"
        : "";

  const confirmIcon =
    mode === "retirar" ? (
      <ArrowUpCircle className="h-5 w-5 mr-2" />
    ) : (
      <CheckCircle className="h-5 w-5 mr-2" />
    );

  const handleConfirm = () => {
    if (mode === "adicionar") onConfirmInclusao?.();
    else if (mode === "retirar") onConfirmRetirada?.();
    else if (mode === "bipagem") onConfirmBipagem?.();
  };

  const podeConfirmar =
    mode === "bipagem"
      ? bipagemScanned.length > 0
      : pendingFardos.length > 0;

  const labelConfirmar =
    mode === "retirar"
      ? `Confirmar Retirada (${pendingFardos.length})`
      : mode === "adicionar"
        ? `Confirmar Inclusão (${pendingFardos.length})`
        : `Confirmar Bipagem (${bipagemScanned.length})`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className={accentColor}>{title}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* ── Coluna esquerda: scanner + revisão ───────────────── */}
          <div className="space-y-3">
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

                  {lastScanned && (
                    <div className="p-3 bg-slate-800 border border-slate-700 rounded-lg">
                      <div className="flex items-center gap-2 mb-1">
                        <CheckCircle className="h-4 w-4 text-green-500" />
                        <span className="text-sm font-semibold text-green-200">
                          Último lido
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

            {/* Lista de fardos pendentes (revisão antes de confirmar) */}
            {mode !== "bipagem" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">
                    Fardos na fila: {pendingFardos.length}
                    {pendingFardos.length > 0 && (
                      <span className="text-muted-foreground font-normal ml-2">
                        ({totalPecasPendentes} peças)
                      </span>
                    )}
                  </p>
                </div>
                <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                  {pendingFardos.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-3 text-center bg-slate-900 rounded border border-dashed border-slate-700">
                      Bipe os fardos para revisar antes de confirmar
                    </p>
                  ) : (
                    pendingFardos.map((p) => (
                      <div
                        key={p.key}
                        className="flex items-center gap-2 text-xs bg-slate-800 rounded px-2 py-1.5 border border-slate-700"
                      >
                        <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />
                        <div className="grid grid-cols-3 gap-2 flex-1 min-w-0">
                          <span
                            className="font-mono font-bold truncate"
                            title={p.parsed.sku}
                          >
                            {p.parsed.sku}
                          </span>
                          <span
                            className="font-mono truncate text-muted-foreground"
                            title={p.parsed.lote}
                          >
                            {p.parsed.lote}
                          </span>
                          <span className="font-mono font-bold text-right">
                            {p.parsed.qtd}
                          </span>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 shrink-0 hover:bg-red-900/50"
                          onClick={() => onRemovePending?.(p.key)}
                        >
                          <X className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Bipagem semanal: lista simplificada (apenas SKU|LOTE) */}
            {mode === "bipagem" && bipagemScanned.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  Validados: {bipagemScanned.length}
                </p>
                <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
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
              </div>
            )}
          </div>

          {/* ── Coluna direita: log da sessão ─────────────────────── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">
                Log da sessão
                {sessionLog.length > 0 && (
                  <span className="text-muted-foreground font-normal ml-2">
                    ({sessionLog.length})
                  </span>
                )}
              </p>
              {sessionLog.length > 0 && onClearLog && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={onClearLog}
                >
                  <Trash2 className="h-3 w-3 mr-1" /> Limpar
                </Button>
              )}
            </div>
            <div
              ref={logScrollRef}
              className="h-72 overflow-y-auto space-y-1 pr-1 bg-slate-900 rounded border border-slate-700 p-2"
            >
              {sessionLog.length === 0 ? (
                <p className="text-xs text-muted-foreground py-3 text-center">
                  Nenhum evento registrado ainda
                </p>
              ) : (
                sessionLog.map((entry) => {
                  const Icon = logIcons[entry.tipo];
                  const time = new Date(entry.timestamp).toLocaleTimeString(
                    "pt-BR",
                    { hour: "2-digit", minute: "2-digit", second: "2-digit" },
                  );
                  return (
                    <div
                      key={entry.id}
                      className="flex items-start gap-2 text-xs px-2 py-1.5 bg-slate-800/50 rounded"
                    >
                      <Icon
                        className={cn(
                          "h-3.5 w-3.5 shrink-0 mt-0.5",
                          logStyles[entry.tipo],
                        )}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-muted-foreground text-[10px] font-mono">
                          {time}
                        </p>
                        <p className="break-words">{entry.mensagem}</p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Botão de confirmar ocupa a largura toda */}
        <Button
          className={cn("w-full h-12 mt-2 text-white", confirmButtonClass)}
          disabled={!podeConfirmar || isConfirming}
          onClick={handleConfirm}
        >
          {confirmIcon}
          {isConfirming ? "Processando..." : labelConfirmar}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
