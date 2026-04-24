"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSession } from "@/lib/auth-client";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Barcode,
  Plus,
  Minus,
  Trash2,
  Download,
  Mail,
  RotateCcw,
  Loader2,
  X,
  Play,
  ScanLine,
  Settings,
  Package,
  PackageCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { generateId } from "@/lib/utils";

// ============================================================
// Types
// ============================================================

type ScannedItem = {
  id: string;
  sku: string;
  lote: string;
  quantidade: number;
  raw: string;
  createdAt: string;
};

type ManuseavelItem = {
  id: string;
  sku: string;
  quantidade: number;
  updatedAt: string;
};

type EmbaladoItem = {
  id: string;
  sku: string;
  quantidade: number;
  createdAt: string;
};

// ============================================================
// Constants
// ============================================================

const COLOR_MAP: Record<string, { bg: string; text: string; label: string }> = {
  PT: { bg: "bg-black", text: "text-white", label: "PRETO" },
  AZ: { bg: "bg-blue-600", text: "text-white", label: "AZUL" },
  BR: {
    bg: "bg-white border-2 border-gray-200",
    text: "text-black",
    label: "BRANCO",
  },
  VM: { bg: "bg-red-600", text: "text-white", label: "VERMELHO" },
  VD: { bg: "bg-green-600", text: "text-white", label: "VERDE" },
  AM: { bg: "bg-yellow-400", text: "text-black", label: "AMARELO" },
  RS: { bg: "bg-pink-500", text: "text-white", label: "ROSA" },
};

// ============================================================
// Helpers
// ============================================================

// Aceita todos os formatos de QR emitidos pelo módulo de cadastro:
//   v1 (antigo):  SKU}LOTE}QTD                                   — 3 campos
//   v2 (antigo+): SKU}LOTE}QTD}CODIGO_FARDO                      — 4 campos
//   v3 (atual):   SKU}LOTE}QTD}CODIGO_FARDO}ISO}USUARIO}UUID     — 7 campos
//
// Normaliza separadores antes do split: `}`, `{` e `|` são tratados como
// equivalentes. `{` aparece quando o scanner HID emite em layout US mas o
// Windows traduz pra ABNT2 (teclas de `}`/`{` ficam trocadas). SKU, LOTE e
// QTD ocupam sempre as 3 primeiras posições — campos extras são ignorados.
function parseScannedData(
  raw: string
): { sku: string; lote: string; qtd: number } | null {
  if (!raw) return null;
  const clean = raw.trim().replace(/^[|{}]+/, "").trim();
  if (!clean) return null;

  const parts = clean.split(/[}{|]/);
  if (parts.length < 3) {
    console.warn("[contagem] QR nao reconhecido (menos de 3 campos):", raw);
    return null;
  }

  // Remove prefixo numerico herdado do formato mais antigo
  // (ex: "1LUA AZ GG" -> "LUA AZ GG")
  const sku = parts[0].trim().replace(/^\d+\s*/, "").trim();
  const lote = parts[1].trim();
  const qtd = parseInt(parts[2].trim(), 10);

  if (!sku || !lote || isNaN(qtd) || qtd <= 0) {
    console.warn("[contagem] QR invalido apos parse:", { raw, sku, lote, qtd });
    return null;
  }
  return { sku, lote, qtd };
}

function playBeep(type: "success" | "error") {
  try {
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    if (type === "success") {
      oscillator.frequency.value = 800;
      gain.gain.value = 0.3;
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.15);
    } else {
      oscillator.frequency.value = 300;
      gain.gain.value = 0.3;
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.3);
    }
  } catch {
    // Audio not available
  }
}

// ============================================================
// Component
// ============================================================

export default function ContagemPage() {
  const { data: session } = useSession();

  // Tab state
  const [activeTab, setActiveTab] = useState<
    "bipagem" | "manuseavel" | "embalada"
  >("bipagem");

  // Loading states
  const [isLoadingBipagem, setIsLoadingBipagem] = useState(true);
  const [isLoadingManuseavel, setIsLoadingManuseavel] = useState(true);
  const [isLoadingEmbalados, setIsLoadingEmbalados] = useState(true);

  // ── Tab 1: Bipagem ──
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isScanningMode, setIsScanningMode] = useState(false);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const modalInputRef = useRef<HTMLInputElement>(null);
  const scanTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastProcessedValue = useRef<string>("");

  // ── Tab 2: Manuseavel ──
  const [manuseavelItems, setManuseavelItems] = useState<ManuseavelItem[]>([]);
  const [showConfig, setShowConfig] = useState(false);
  const [novoSku, setNovoSku] = useState("");

  // ── Tab 3: Embalada ──
  const [embaladosList, setEmbaladosList] = useState<EmbaladoItem[]>([]);
  const [embaladoSkuInput, setEmbaladoSkuInput] = useState("");
  const [embaladoQtd, setEmbaladoQtd] = useState(1);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [embaladoScanInput, setEmbaladoScanInput] = useState("");
  const embaladoScanTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastEmbaladoProcessed = useRef<string>("");

  // ============================================================
  // Data fetching
  // ============================================================

  const fetchBipagem = useCallback(async () => {
    try {
      const res = await fetch("/api/contagem/bipagem");
      if (!res.ok) throw new Error("Erro ao buscar bipagens");
      const data = await res.json();
      setScannedItems(data.items);
    } catch (error) {
      console.error("Erro ao carregar bipagens:", error);
      toast.error("Erro ao carregar bipagens");
    } finally {
      setIsLoadingBipagem(false);
    }
  }, []);

  const fetchManuseavel = useCallback(async () => {
    try {
      const res = await fetch("/api/contagem/manuseavel");
      if (!res.ok) throw new Error("Erro ao buscar manuseavel");
      const data = await res.json();
      setManuseavelItems(data.items);
    } catch (error) {
      console.error("Erro ao carregar manuseavel:", error);
      toast.error("Erro ao carregar manuseavel");
    } finally {
      setIsLoadingManuseavel(false);
    }
  }, []);

  const fetchEmbalados = useCallback(async () => {
    try {
      const res = await fetch("/api/contagem/embalados");
      if (!res.ok) throw new Error("Erro ao buscar embalados");
      const data = await res.json();
      setEmbaladosList(data.items);
    } catch (error) {
      console.error("Erro ao carregar embalados:", error);
      toast.error("Erro ao carregar embalados");
    } finally {
      setIsLoadingEmbalados(false);
    }
  }, []);

  useEffect(() => {
    fetchBipagem();
    fetchManuseavel();
    fetchEmbalados();
  }, [fetchBipagem, fetchManuseavel, fetchEmbalados]);

  // Focus modal input when scanning mode activates
  useEffect(() => {
    if (isScanningMode && modalInputRef.current) {
      modalInputRef.current.focus();
    }
  }, [isScanningMode]);

  // Autocomplete for embalados SKU
  useEffect(() => {
    if (embaladoSkuInput.length === 0) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    const controller = new AbortController();
    const fetchSuggestions = async () => {
      try {
        const res = await fetch(
          `/api/sku-catalogo?search=${encodeURIComponent(embaladoSkuInput)}`,
          { signal: controller.signal }
        );
        if (!res.ok) return;
        const data = await res.json();
        const skuList = (data.skus as { codigo: string }[]).map(
          (s) => s.codigo
        );
        setSuggestions(skuList.slice(0, 10));
        setShowSuggestions(skuList.length > 0);
      } catch {
        // Aborted or error
      }
    };
    fetchSuggestions();
    return () => controller.abort();
  }, [embaladoSkuInput]);

  // ============================================================
  // Tab 1: Bipagem handlers
  // ============================================================

  const processScan = useCallback(
    async (value: string) => {
      if (!value.trim()) return;
      if (lastProcessedValue.current === value.trim()) return;
      const data = parseScannedData(value);
      if (data && !isNaN(data.qtd)) {
        lastProcessedValue.current = value.trim();
        const tempId = generateId();
        const optimisticItem: ScannedItem = {
          id: tempId,
          sku: data.sku,
          lote: data.lote,
          quantidade: data.qtd,
          raw: value,
          createdAt: new Date().toISOString(),
        };
        setScannedItems((prev) => [optimisticItem, ...prev]);
        playBeep("success");
        toast.success(`Bipado: ${data.sku}`, {
          description: `+${data.qtd} unidades`,
          duration: 1000,
          position: isScanningMode ? "top-center" : "bottom-right",
        });
        setInputValue("");
        setTimeout(() => {
          lastProcessedValue.current = "";
        }, 1000);

        try {
          const res = await fetch("/api/contagem/bipagem", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sku: data.sku,
              lote: data.lote,
              quantidade: data.qtd,
              raw: value,
            }),
          });
          if (!res.ok) throw new Error();
          const saved = await res.json();
          setScannedItems((prev) =>
            prev.map((i) => (i.id === tempId ? saved : i))
          );
        } catch {
          toast.error("Erro ao salvar bipagem no servidor");
        }
      } else {
        if (value.length > 10) {
          console.warn("Formato nao reconhecido:", value);
          playBeep("error");
        }
      }
    },
    [isScanningMode]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setInputValue(val);
      if (scanTimeoutRef.current) {
        clearTimeout(scanTimeoutRef.current);
        scanTimeoutRef.current = null;
      }
      scanTimeoutRef.current = setTimeout(() => {
        if (val.length > 5 && val.trim() !== lastProcessedValue.current) {
          processScan(val);
        }
        scanTimeoutRef.current = null;
      }, 100);
    },
    [processScan]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Tab") e.preventDefault();
      if (e.key === "Enter") {
        e.preventDefault();
        if (scanTimeoutRef.current) {
          clearTimeout(scanTimeoutRef.current);
          scanTimeoutRef.current = null;
        }
        if (inputValue.trim() !== lastProcessedValue.current) {
          processScan(inputValue);
        }
      }
      if (e.key === "Escape" && isScanningMode) {
        setIsScanningMode(false);
      }
    },
    [inputValue, processScan, isScanningMode]
  );

  const handleRemoveBipagem = useCallback(
    async (id: string) => {
      setScannedItems((prev) => prev.filter((i) => i.id !== id));
      try {
        await fetch("/api/contagem/bipagem", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: [id] }),
        });
      } catch {
        toast.error("Erro ao deletar bipagem");
        fetchBipagem();
      }
    },
    [fetchBipagem]
  );

  const handleReset = useCallback(async () => {
    if (!confirm("Tem certeza que deseja limpar toda a contagem atual?"))
      return;
    const ids = scannedItems.map((i) => i.id);
    if (ids.length === 0) return;
    setScannedItems([]);
    try {
      await fetch("/api/contagem/bipagem", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      toast.info("Contagem reiniciada.");
    } catch {
      toast.error("Erro ao limpar bipagens");
      fetchBipagem();
    }
  }, [scannedItems, fetchBipagem]);

  const generateReport = useCallback(() => {
    if (scannedItems.length === 0) {
      toast.error("Nada para exportar!");
      return;
    }
    let report = "";
    const date = new Date().toLocaleString("pt-BR");
    report += "RELATORIO DE BALANCO DE ESTOQUE\n";
    report += `Gerado em: ${date}\n`;
    report += "----------------------------------------\n\n";
    report += "RESUMO POR COR/PRODUTO\n";
    report += "----------------------------------------\n";
    const byColor: Record<string, number> = {};
    scannedItems.forEach((item) => {
      const parts = item.sku.split(" ");
      if (parts.length >= 2) {
        const key = `${parts[0]} - ${parts[1]}`;
        byColor[key] = (byColor[key] || 0) + item.quantidade;
      } else {
        byColor["OUTROS"] = (byColor["OUTROS"] || 0) + item.quantidade;
      }
    });
    Object.entries(byColor)
      .sort()
      .forEach(([key, total]) => {
        report += `${key.padEnd(20)}: ${total} pecas\n`;
      });
    report += "\n";
    report += "SOMA DOS ESTOQUES POR SKU\n";
    report += "----------------------------------------\n";
    const bySku: Record<string, number> = {};
    scannedItems.forEach((item) => {
      bySku[item.sku] = (bySku[item.sku] || 0) + item.quantidade;
    });
    Object.entries(bySku)
      .sort()
      .forEach(([sku, total]) => {
        report += `${sku.padEnd(20)} = ${total}\n`;
      });
    report += "\n";
    report += "RELATORIO DE BIPAGEM (DETALHADO)\n";
    report += "----------------------------------------\n";
    report += "HORA      | SKU                  | QTD | LOTE\n";
    [...scannedItems]
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      )
      .forEach((item) => {
        const time = new Date(item.createdAt).toLocaleTimeString("pt-BR");
        report += `${time}  | ${item.sku.padEnd(20)} | ${String(item.quantidade).padEnd(3)} | ${item.lote}\n`;
      });
    const blob = new Blob([report], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `balanco_estoque_${new Date().toISOString().split("T")[0]}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("Relatorio baixado com sucesso!");
  }, [scannedItems]);

  const handleEnviarEmail = useCallback(async () => {
    if (scannedItems.length === 0) {
      toast.error("Nada para enviar!");
      return;
    }
    setIsSendingEmail(true);
    try {
      const res = await fetch("/api/contagem/enviar-email", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? "Erro ao enviar");
      }
      const destinos = Array.isArray(data.destinatarios)
        ? data.destinatarios.length
        : data.sent ?? 0;
      toast.success("Balanço enviado por email!", {
        description: `${data.sent ?? destinos} destinatário(s)${data.failed ? ` · ${data.failed} falha(s)` : ""}`,
      });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao enviar email",
      );
    } finally {
      setIsSendingEmail(false);
    }
  }, [scannedItems]);

  // ============================================================
  // Tab 2: Manuseavel handlers
  // ============================================================

  const handleManuseavelCount = useCallback(
    async (sku: string, val: number) => {
      const newVal = Math.max(0, val);
      setManuseavelItems((prev) =>
        prev.map((i) => (i.sku === sku ? { ...i, quantidade: newVal } : i))
      );
      try {
        await fetch("/api/contagem/manuseavel", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sku, quantidade: newVal }),
        });
      } catch {
        toast.error("Erro ao atualizar quantidade");
        fetchManuseavel();
      }
    },
    [fetchManuseavel]
  );

  const handleAddManuseavelSku = useCallback(async () => {
    const skuVal = novoSku.trim().toUpperCase();
    if (!skuVal) return;
    if (manuseavelItems.some((i) => i.sku === skuVal)) {
      toast.error("SKU ja existe na lista!");
      return;
    }
    const tempItem: ManuseavelItem = {
      id: generateId(),
      sku: skuVal,
      quantidade: 0,
      updatedAt: new Date().toISOString(),
    };
    setManuseavelItems((prev) => [...prev, tempItem]);
    setNovoSku("");
    toast.success("SKU adicionado!");
    try {
      await fetch("/api/contagem/manuseavel", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku: skuVal, quantidade: 0 }),
      });
    } catch {
      toast.error("Erro ao adicionar SKU");
      fetchManuseavel();
    }
  }, [novoSku, manuseavelItems, fetchManuseavel]);

  const handleResetManuseavel = useCallback(async () => {
    if (!confirm("Limpar todas as contagens manuseaveis?")) return;
    const updates = manuseavelItems.map((item) =>
      fetch("/api/contagem/manuseavel", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku: item.sku, quantidade: 0 }),
      })
    );
    setManuseavelItems((prev) =>
      prev.map((i) => ({ ...i, quantidade: 0 }))
    );
    try {
      await Promise.all(updates);
      toast.info("Contagens reiniciadas.");
    } catch {
      toast.error("Erro ao reiniciar contagens");
      fetchManuseavel();
    }
  }, [manuseavelItems, fetchManuseavel]);

  // ============================================================
  // Tab 3: Embalada handlers
  // ============================================================

  const handleAddEmbalado = useCallback(async () => {
    if (!embaladoSkuInput.trim()) {
      toast.error("Informe o SKU!");
      return;
    }
    const skuVal = embaladoSkuInput.trim().toUpperCase();
    const tempId = generateId();
    const optimisticItem: EmbaladoItem = {
      id: tempId,
      sku: skuVal,
      quantidade: embaladoQtd,
      createdAt: new Date().toISOString(),
    };
    setEmbaladosList((prev) => [...prev, optimisticItem]);
    setEmbaladoSkuInput("");
    setEmbaladoQtd(1);
    setShowSuggestions(false);
    toast.success(`Embalado adicionado: ${skuVal}`);
    try {
      const res = await fetch("/api/contagem/embalados", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku: skuVal, quantidade: embaladoQtd }),
      });
      if (!res.ok) throw new Error();
      const saved = await res.json();
      setEmbaladosList((prev) =>
        prev.map((i) => (i.id === tempId ? saved : i))
      );
    } catch {
      toast.error("Erro ao salvar embalado");
    }
  }, [embaladoSkuInput, embaladoQtd]);

  const handleRemoveEmbalado = useCallback(
    async (id: string) => {
      setEmbaladosList((prev) => prev.filter((i) => i.id !== id));
      try {
        await fetch("/api/contagem/embalados", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: [id] }),
        });
      } catch {
        toast.error("Erro ao deletar embalado");
        fetchEmbalados();
      }
    },
    [fetchEmbalados]
  );

  const handleEmbaladoScanChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setEmbaladoScanInput(val);
      if (embaladoScanTimeoutRef.current) {
        clearTimeout(embaladoScanTimeoutRef.current);
      }
      embaladoScanTimeoutRef.current = setTimeout(async () => {
        if (
          val.length > 5 &&
          val.trim() !== lastEmbaladoProcessed.current
        ) {
          const data = parseScannedData(val);
          if (data && !isNaN(data.qtd)) {
            lastEmbaladoProcessed.current = val.trim();
            const tempId = generateId();
            const newItem: EmbaladoItem = {
              id: tempId,
              sku: data.sku,
              quantidade: data.qtd,
              createdAt: new Date().toISOString(),
            };
            setEmbaladosList((prev) => [...prev, newItem]);
            playBeep("success");
            toast.success(`Embalado: ${data.sku} (+${data.qtd})`);
            setEmbaladoScanInput("");
            setTimeout(() => {
              lastEmbaladoProcessed.current = "";
            }, 1000);

            try {
              const res = await fetch("/api/contagem/embalados", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  sku: data.sku,
                  quantidade: data.qtd,
                }),
              });
              if (!res.ok) throw new Error();
              const saved = await res.json();
              setEmbaladosList((prev) =>
                prev.map((i) => (i.id === tempId ? saved : i))
              );
            } catch {
              toast.error("Erro ao salvar embalado");
            }
          } else if (val.length > 10) {
            playBeep("error");
          }
        }
      }, 100);
    },
    []
  );

  const handleResetEmbalados = useCallback(async () => {
    if (!confirm("Limpar todos os embalados?")) return;
    const ids = embaladosList.map((i) => i.id);
    if (ids.length === 0) return;
    setEmbaladosList([]);
    try {
      await fetch("/api/contagem/embalados", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      toast.info("Embalados reiniciados.");
    } catch {
      toast.error("Erro ao limpar embalados");
      fetchEmbalados();
    }
  }, [embaladosList, fetchEmbalados]);

  // ============================================================
  // Computed values
  // ============================================================

  const totalPecas = scannedItems.reduce((acc, i) => acc + i.quantidade, 0);
  const totalFardos = scannedItems.length;
  const totalManuseavel = manuseavelItems.reduce(
    (a, i) => a + i.quantidade,
    0
  );
  const totalEmbalados = embaladosList.reduce((a, i) => a + i.quantidade, 0);

  const groupedSku = scannedItems.reduce(
    (acc, item) => {
      acc[item.sku] = (acc[item.sku] || 0) + item.quantidade;
      return acc;
    },
    {} as Record<string, number>
  );

  const getLastItemColor = () => {
    if (scannedItems.length === 0) return null;
    const lastSku = scannedItems[0].sku;
    const parts = lastSku.split(" ");
    for (const part of parts) {
      if (COLOR_MAP[part]) return COLOR_MAP[part];
    }
    return null;
  };

  const lastColor = getLastItemColor();

  // ============================================================
  // Render
  // ============================================================

  if (!session) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contagem de Estoque"
        description="Gerencie seu balanco de estoque de forma rapida e eficiente."
        icon={<Barcode className="h-8 w-8 text-primary" />}
      />

      {/* Tab Navigation */}
      <div className="flex gap-1 border-b">
        {(
          [
            {
              id: "bipagem" as const,
              label: "Bipagem",
              icon: ScanLine,
              badge: totalFardos > 0 ? totalPecas : null,
            },
            {
              id: "manuseavel" as const,
              label: "Estante Manuseavel",
              icon: Package,
              badge: totalManuseavel > 0 ? totalManuseavel : null,
            },
            {
              id: "embalada" as const,
              label: "Estante Embalada",
              icon: PackageCheck,
              badge: totalEmbalados > 0 ? totalEmbalados : null,
            },
          ] as const
        ).map((tab) => {
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
              {tab.badge !== null && (
                <span className="bg-primary text-primary-foreground text-xs px-1.5 py-0.5 rounded-full font-bold">
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* TAB 1: Bipagem & Contagem */}
      {activeTab === "bipagem" && (
        <div className="space-y-6">
          {isLoadingBipagem ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="flex gap-3 justify-end">
                <Button
                  variant="outline"
                  onClick={handleReset}
                  className="h-10"
                >
                  <RotateCcw className="mr-2 h-4 w-4" /> Reiniciar
                </Button>
                <Button
                  variant="outline"
                  onClick={handleEnviarEmail}
                  disabled={isSendingEmail || scannedItems.length === 0}
                  className="h-10"
                >
                  {isSendingEmail ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Mail className="mr-2 h-4 w-4" />
                  )}
                  Enviar por Email
                </Button>
                <Button
                  onClick={generateReport}
                  className="h-10 font-bold bg-primary hover:bg-primary/90"
                >
                  <Download className="mr-2 h-4 w-4" /> Baixar Relatorio
                </Button>
              </div>

              <Card className="border-2 border-primary/20 shadow-lg bg-primary/5">
                <CardContent className="p-8 flex flex-col items-center justify-center text-center space-y-4">
                  <div className="bg-background p-4 rounded-full shadow-sm">
                    <ScanLine className="h-12 w-12 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold mb-2">
                      Modo de Contagem Focada
                    </h3>
                    <p className="text-muted-foreground max-w-md mx-auto mb-6">
                      Ative este modo para travar o cursor no campo de leitura e
                      bipar continuamente sem interrupcoes.
                    </p>
                    <Button
                      size="lg"
                      className="h-16 px-12 text-xl font-bold shadow-xl hover:scale-105 transition-transform"
                      onClick={() => setIsScanningMode(true)}
                    >
                      <Play className="mr-3 h-6 w-6 fill-current" /> COMECAR
                      CONTAGEM
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Fullscreen scanning mode overlay */}
              {isScanningMode && (
                <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col items-center justify-center p-4 animate-in fade-in duration-200">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-4 right-4 h-12 w-12 rounded-full hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setIsScanningMode(false)}
                  >
                    <X className="h-8 w-8" />
                  </Button>
                  <div className="w-full max-w-3xl space-y-8 text-center">
                    <div className="space-y-2">
                      <h2 className="text-4xl font-bold tracking-tight text-primary">
                        MODO DE CONTAGEM ATIVO
                      </h2>
                      <p className="text-xl text-muted-foreground">
                        Pressione{" "}
                        <kbd className="px-2 py-1 bg-muted rounded border">
                          ESC
                        </kbd>{" "}
                        para sair
                      </p>
                    </div>
                    <div className="relative flex items-center justify-center gap-4">
                      <div className="relative flex-1">
                        <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full opacity-50 animate-pulse" />
                        <Input
                          ref={modalInputRef}
                          value={inputValue}
                          onChange={handleInputChange}
                          onKeyDown={handleKeyDown}
                          placeholder="BIPE AQUI..."
                          className="relative h-32 text-center text-5xl font-mono font-bold border-4 border-primary shadow-2xl focus-visible:ring-4 focus-visible:ring-primary/50 rounded-xl bg-background"
                          autoComplete="off"
                          autoFocus
                        />
                      </div>
                      {lastColor && (
                        <div
                          className={cn(
                            "h-32 w-32 rounded-xl shadow-2xl flex items-center justify-center border-4 border-white/20 animate-in zoom-in duration-300",
                            lastColor.bg
                          )}
                        >
                          <span
                            className={cn(
                              "font-bold text-xl",
                              lastColor.text
                            )}
                          >
                            {lastColor.label}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-8 mt-12">
                      <div className="bg-card p-6 rounded-xl border shadow-sm">
                        <p className="text-sm text-muted-foreground uppercase font-bold tracking-wider">
                          Total de Pecas
                        </p>
                        <p className="text-6xl font-bold text-primary mt-2">
                          {totalPecas}
                        </p>
                      </div>
                      <div className="bg-card p-6 rounded-xl border shadow-sm">
                        <p className="text-sm text-muted-foreground uppercase font-bold tracking-wider">
                          Fardos Lidos
                        </p>
                        <p className="text-6xl font-bold mt-2">
                          {totalFardos}
                        </p>
                      </div>
                    </div>
                    {scannedItems.length > 0 && (
                      <div className="bg-green-500/10 border border-green-500/20 p-4 rounded-lg animate-in slide-in-from-bottom-4">
                        <p className="text-green-600 dark:text-green-400 font-medium mb-1">
                          Ultimo registro:
                        </p>
                        <p className="text-2xl font-bold">
                          {scannedItems[0].sku}{" "}
                          <span className="opacity-50 mx-2">|</span> +
                          {scannedItems[0].quantidade}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="grid gap-8 lg:grid-cols-2">
                <Card className="h-[500px] flex flex-col">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex justify-between items-center">
                      Historico de Bipagem
                      <span className="text-sm font-normal bg-secondary px-2 py-1 rounded-md">
                        {totalFardos} fardos lidos
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex-1 overflow-auto">
                    {scannedItems.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-50">
                        <Barcode className="h-16 w-16 mb-4" />
                        <p className="text-lg">Nenhum item bipado ainda.</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {scannedItems.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center justify-between p-3 bg-secondary/20 rounded-md border border-border/50"
                          >
                            <div>
                              <p className="font-bold font-mono text-lg">
                                {item.sku}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {new Date(item.createdAt).toLocaleTimeString()}{" "}
                                &bull; {item.lote}
                              </p>
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="text-xl font-bold text-primary">
                                +{item.quantidade}
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                onClick={() => handleRemoveBipagem(item.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="h-[500px] flex flex-col">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex justify-between items-center">
                      Resumo do Balanco
                      <span className="text-sm font-bold text-primary bg-primary/10 px-3 py-1 rounded-md">
                        Total: {totalPecas} pecas
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex-1 overflow-auto p-0">
                    <Table>
                      <TableHeader className="sticky top-0 bg-background z-10">
                        <TableRow>
                          <TableHead>SKU</TableHead>
                          <TableHead className="text-right">
                            Total Pecas
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {Object.keys(groupedSku).length === 0 ? (
                          <TableRow>
                            <TableCell
                              colSpan={2}
                              className="h-32 text-center text-muted-foreground"
                            >
                              Aguardando dados...
                            </TableCell>
                          </TableRow>
                        ) : (
                          Object.entries(groupedSku)
                            .sort((a, b) => b[1] - a[1])
                            .map(([sku, qtd]) => (
                              <TableRow key={sku}>
                                <TableCell className="font-mono font-medium">
                                  {sku}
                                </TableCell>
                                <TableCell className="text-right font-bold text-lg">
                                  {qtd}
                                </TableCell>
                              </TableRow>
                            ))
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB 2: Estante Manuseavel */}
      {activeTab === "manuseavel" && (
        <div className="space-y-6">
          {isLoadingManuseavel ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-xl font-bold">Estante Manuseavel</h3>
                  <p className="text-sm text-muted-foreground">
                    Contagem manual por SKU unico. Total:{" "}
                    <strong>{totalManuseavel} pecas</strong>
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setShowConfig(!showConfig)}
                  >
                    <Settings className="mr-2 h-4 w-4" />
                    {showConfig ? "Fechar Config" : "Configurar SKUs"}
                  </Button>
                  {manuseavelItems.length > 0 && (
                    <Button variant="outline" onClick={handleResetManuseavel}>
                      <RotateCcw className="mr-2 h-4 w-4" />
                      Zerar Contagens
                    </Button>
                  )}
                </div>
              </div>

              {showConfig && (
                <Card className="bg-muted/30">
                  <CardHeader>
                    <CardTitle className="text-base">
                      Adicionar SKU a Estante
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Ex: LUA AZ G"
                        value={novoSku}
                        onChange={(e) =>
                          setNovoSku(e.target.value.toUpperCase())
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleAddManuseavelSku();
                        }}
                      />
                      <Button onClick={handleAddManuseavelSku}>
                        <Plus className="mr-2 h-4 w-4" /> Adicionar
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      {manuseavelItems.length} SKU(s) configurado(s)
                    </p>
                  </CardContent>
                </Card>
              )}

              {manuseavelItems.length === 0 ? (
                <Card>
                  <CardContent className="py-16 flex flex-col items-center text-muted-foreground">
                    <Package className="h-16 w-16 mb-4 opacity-30" />
                    <p className="font-medium">Nenhum SKU configurado.</p>
                    <p className="text-sm mt-1">
                      Use &quot;Configurar SKUs&quot; para adicionar itens a
                      estante.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {manuseavelItems.map((item) => (
                      <Card key={item.id}>
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between mb-3">
                            <p className="font-mono font-bold text-sm">
                              {item.sku}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-9 w-9 shrink-0"
                              onClick={() =>
                                handleManuseavelCount(
                                  item.sku,
                                  item.quantidade - 1
                                )
                              }
                            >
                              <Minus className="h-4 w-4" />
                            </Button>
                            <Input
                              type="number"
                              value={item.quantidade}
                              onChange={(e) =>
                                handleManuseavelCount(
                                  item.sku,
                                  parseInt(e.target.value) || 0
                                )
                              }
                              className="text-center text-xl font-bold h-9"
                              min="0"
                            />
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-9 w-9 shrink-0"
                              onClick={() =>
                                handleManuseavelCount(
                                  item.sku,
                                  item.quantidade + 1
                                )
                              }
                            >
                              <Plus className="h-4 w-4" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  <Card className="bg-primary/5 border-primary/20">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex justify-between">
                        Resumo Manuseavel
                        <span className="text-primary font-bold">
                          {totalManuseavel} pecas
                        </span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>SKU</TableHead>
                            <TableHead className="text-right">
                              Quantidade
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {manuseavelItems
                            .filter((i) => i.quantidade > 0)
                            .sort((a, b) => b.quantidade - a.quantidade)
                            .map((item) => (
                              <TableRow key={item.id}>
                                <TableCell className="font-mono">
                                  {item.sku}
                                </TableCell>
                                <TableCell className="text-right font-bold">
                                  {item.quantidade}
                                </TableCell>
                              </TableRow>
                            ))}
                          {manuseavelItems.filter((i) => i.quantidade > 0)
                            .length === 0 && (
                            <TableRow>
                              <TableCell
                                colSpan={2}
                                className="text-center text-muted-foreground py-4"
                              >
                                Nenhuma quantidade preenchida ainda.
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* TAB 3: Estante Embalada */}
      {activeTab === "embalada" && (
        <div className="space-y-6">
          {isLoadingEmbalados ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-xl font-bold">Estante Embalada</h3>
                  <p className="text-sm text-muted-foreground">
                    Selecione ou bipe QR Code de embalados. Total:{" "}
                    <strong>{totalEmbalados} pecas</strong>
                  </p>
                </div>
                {embaladosList.length > 0 && (
                  <Button variant="outline" onClick={handleResetEmbalados}>
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Limpar Lista
                  </Button>
                )}
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                {/* Adicionar por selecao manual */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">
                      Selecionar SKU Embalado
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="relative">
                      <Input
                        placeholder="Buscar SKU embalado..."
                        value={embaladoSkuInput}
                        onChange={(e) => setEmbaladoSkuInput(e.target.value)}
                        onFocus={() =>
                          embaladoSkuInput.length > 0 &&
                          setShowSuggestions(true)
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleAddEmbalado();
                        }}
                      />
                      {showSuggestions && suggestions.length > 0 && (
                        <div className="absolute z-50 w-full mt-1 bg-background border rounded-md shadow-lg max-h-48 overflow-auto">
                          {suggestions.map((sku) => (
                            <button
                              key={sku}
                              type="button"
                              className="w-full text-left px-4 py-2 hover:bg-muted text-sm"
                              onClick={() => {
                                setEmbaladoSkuInput(sku);
                                setShowSuggestions(false);
                              }}
                            >
                              {sku}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="icon"
                        className="shrink-0"
                        onClick={() =>
                          setEmbaladoQtd((q) => Math.max(1, q - 1))
                        }
                      >
                        <Minus className="h-4 w-4" />
                      </Button>
                      <Input
                        type="number"
                        value={embaladoQtd}
                        onChange={(e) =>
                          setEmbaladoQtd(
                            Math.max(1, parseInt(e.target.value) || 1)
                          )
                        }
                        className="text-center font-bold"
                        min="1"
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        className="shrink-0"
                        onClick={() => setEmbaladoQtd((q) => q + 1)}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                    <Button
                      onClick={handleAddEmbalado}
                      className="w-full"
                      disabled={!embaladoSkuInput.trim()}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Adicionar Embalado
                    </Button>
                  </CardContent>
                </Card>

                {/* Bipe QR Code */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">
                      Bipe QR Code do Embalado
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Input
                      placeholder="Bipe o QR Code aqui..."
                      value={embaladoScanInput}
                      onChange={handleEmbaladoScanChange}
                      className="h-16 text-xl font-mono text-center border-2 border-dashed"
                      autoComplete="off"
                    />
                    <p className="text-xs text-muted-foreground text-center">
                      Formato esperado:{" "}
                      <code className="bg-muted px-1 rounded">
                        SKU|LOTE|QTD
                      </code>
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Lista de embalados */}
              <Card className="h-[400px] flex flex-col">
                <CardHeader className="pb-2">
                  <CardTitle className="flex justify-between items-center">
                    Embalados Contados
                    <span className="text-sm font-bold text-primary bg-primary/10 px-3 py-1 rounded-md">
                      {embaladosList.length} item(ns) &bull; {totalEmbalados}{" "}
                      pecas
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex-1 overflow-auto p-0">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background z-10">
                      <TableRow>
                        <TableHead>SKU</TableHead>
                        <TableHead className="text-right">Qtd</TableHead>
                        <TableHead className="w-12"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {embaladosList.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={3}
                            className="h-32 text-center text-muted-foreground"
                          >
                            <PackageCheck className="h-10 w-10 mx-auto mb-2 opacity-30" />
                            Nenhum embalado adicionado.
                          </TableCell>
                        </TableRow>
                      ) : (
                        embaladosList.map((item) => (
                          <TableRow key={item.id}>
                            <TableCell className="font-mono font-medium">
                              {item.sku}
                            </TableCell>
                            <TableCell className="text-right font-bold">
                              {item.quantidade}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 hover:text-destructive"
                                onClick={() => handleRemoveEmbalado(item.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}
    </div>
  );
}
