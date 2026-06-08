"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "@/lib/auth-client";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn, formatDate } from "@/lib/utils";
import {
  Warehouse,
  Plus,
  ChevronLeft,
  ChevronDown,
  Package,
  Trash2,
  History,
  ArrowDownCircle,
  ArrowUpCircle,
  ScanLine,
  Upload,
  ClipboardCheck,
  BarChart2,
  FileDown,
  Loader2,
  RefreshCw,
  List,
  Grid3x3,
} from "lucide-react";
import {
  isThisWeek,
  compareSKU,
  type ParsedQR,
} from "@/lib/estante-utils";
import { agregarFardos } from "@/lib/estante-virtual/agregar";
import { exportarEstanteXlsx } from "@/lib/estante-virtual/exportar-xlsx";
import { exportarUpseller } from "@/lib/estante-virtual/exportar-upseller";
import { ModalCriar } from "@/components/estante-virtual/modal-criar";
import { ModalImportar } from "@/components/estante-virtual/modal-importar";
import {
  ModalScanner,
  type PendingFardo,
  type SessionLogEntry,
} from "@/components/estante-virtual/modal-scanner";
import { FardosAgrupados } from "@/components/estante-virtual/fardos-agrupados";
import { MatrizView } from "@/components/estante-virtual/matriz-view";
import { HistoricoView } from "@/components/estante-virtual/historico-view";
import { ConsolidadoView } from "@/components/estante-virtual/consolidado-view";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type EstanteListItem = {
  id: string;
  nome: string;
  descricao: string | null;
  ultimaBipagem: string | null;
  fardoCount: number;
  totalPecas: number;
  topSkus: string[];
  createdAt: string;
};

type EstanteFardoItem = {
  id: string;
  qrCode: string;
  sku: string;
  lote: string;
  quantidade: number;
  adicionadoPor: string;
  createdAt: string;
};

export default function EstanteVirtualPage() {
  const { data: session } = useSession();

  const [view, setView] = useState<"lista" | "detalhe" | "historico">("lista");
  const [viewModoDetalhe, setViewModoDetalhe] = useState<"lista" | "matriz">(
    "lista",
  );
  const [estantes, setEstantes] = useState<EstanteListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEstante, setSelectedEstante] = useState<{
    id: string;
    nome: string;
    descricao: string | null;
    ultimaBipagem: string | null;
  } | null>(null);
  const [fardos, setFardos] = useState<EstanteFardoItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Modals
  const [showCriar, setShowCriar] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [scannerMode, setScannerMode] = useState<
    "retirar" | "adicionar" | "bipagem"
  >("adicionar");
  const [showImportar, setShowImportar] = useState(false);

  // Scanner state — pendingFardos é a fila acumulada antes do confirm.
  // sessionLog substitui o toast.warning porque o operador frequentemente
  // bipa longe da tela e perderia avisos efêmeros.
  const [pendingFardos, setPendingFardos] = useState<PendingFardo[]>([]);
  const [bipagemScanned, setBipagemScanned] = useState<string[]>([]);
  const [sessionLog, setSessionLog] = useState<SessionLogEntry[]>([]);
  const [isConfirming, setIsConfirming] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [removingId, setRemovingId] = useState<string | null>(null);

  const appendLog = useCallback(
    (tipo: SessionLogEntry["tipo"], mensagem: string) => {
      setSessionLog((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          timestamp: Date.now(),
          tipo,
          mensagem,
        },
      ]);
    },
    [],
  );

  const fardoKey = useCallback((parsed: ParsedQR, raw: string) => {
    // Chave de dedup local. UUID > codigoFardo > raw normalizado.
    if (parsed.uuid) return `uuid:${parsed.uuid}`;
    if (parsed.codigoFardo) return `cod:${parsed.codigoFardo}`;
    return `raw:${raw.trim().toUpperCase()}`;
  }, []);

  // ── Data fetching ──────────────────────────────────────────────────────────

  const fetchEstantes = useCallback(async () => {
    try {
      const res = await fetch("/api/estantes");
      if (!res.ok) throw new Error("Erro ao buscar estantes");
      const data = await res.json();
      setEstantes(data.estantes);
    } catch (error) {
      console.error("Erro ao carregar estantes:", error);
      toast.error("Erro ao carregar estantes");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchDetail = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/estantes/${id}`);
      if (!res.ok) throw new Error("Erro ao buscar estante");
      const data = await res.json();
      setSelectedEstante(data.estante);
      setFardos(data.fardos);
    } catch (error) {
      console.error("Erro ao carregar detalhe:", error);
      toast.error("Erro ao carregar detalhe da estante");
    }
  }, []);

  useEffect(() => {
    if (session) {
      fetchEstantes();
    }
  }, [session, fetchEstantes]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleCriarEstante = async (nome: string, descricao: string) => {
    const res = await fetch("/api/estantes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome, descricao: descricao || undefined }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Erro ao criar estante");
    }
    toast.success(`Estante "${nome}" criada!`);
    setShowCriar(false);
    fetchEstantes();
  };

  const handleDeleteEstante = async (id: string) => {
    if (!confirm("Excluir esta estante e todos os fardos?")) return;
    try {
      const res = await fetch(`/api/estantes/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Erro ao remover");
      toast.success("Estante excluida");
      fetchEstantes();
    } catch {
      toast.error("Erro ao remover estante");
    }
  };

  const handleScanComplete = useCallback(
    (parsed: ParsedQR, raw: string) => {
      if (!selectedId) return;

      if (scannerMode === "bipagem") {
        const key = `${parsed.sku}|${parsed.lote}`;
        if (bipagemScanned.includes(key)) {
          appendLog("warning", `Já bipado nesta sessão: ${parsed.sku} (lote ${parsed.lote})`);
          return;
        }
        setBipagemScanned((prev) => [...prev, key]);
        appendLog("success", `Bipado: ${parsed.sku} (lote ${parsed.lote})`);
        return;
      }

      // Modos adicionar e retirar: acumular em pendingFardos com dedup local.
      const key = fardoKey(parsed, raw);
      if (pendingFardos.some((p) => p.key === key)) {
        appendLog(
          "warning",
          `Já está na fila: ${parsed.sku} (lote ${parsed.lote}, qtd ${parsed.qtd})`,
        );
        return;
      }
      setPendingFardos((prev) => [...prev, { key, raw, parsed }]);
      appendLog(
        "success",
        `Adicionado à fila: ${parsed.sku} (lote ${parsed.lote}, qtd ${parsed.qtd})`,
      );
    },
    [selectedId, scannerMode, bipagemScanned, pendingFardos, appendLog, fardoKey],
  );

  const handleRemovePending = useCallback(
    (key: string) => {
      const removed = pendingFardos.find((p) => p.key === key);
      setPendingFardos((prev) => prev.filter((p) => p.key !== key));
      if (removed) {
        appendLog(
          "info",
          `Removido da fila: ${removed.parsed.sku} (lote ${removed.parsed.lote})`,
        );
      }
    },
    [pendingFardos, appendLog],
  );

  const handleConfirmInclusao = useCallback(async () => {
    if (!selectedId || pendingFardos.length === 0) return;
    setIsConfirming(true);
    try {
      const res = await fetch(`/api/estantes/${selectedId}/fardos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fardos: pendingFardos.map((p) => ({
            qrCode: p.raw.trim(),
            sku: p.parsed.sku,
            lote: p.parsed.lote,
            quantidade: p.parsed.qtd,
          })),
        }),
      });
      if (!res.ok) throw new Error("Erro ao adicionar");
      const data: {
        added: number;
        skipped: Array<{
          qrCode: string;
          sku: string;
          lote: string;
          motivo: "duplicado-mesma-estante" | "ja-existe-outra-estante";
          estanteNome?: string;
        }>;
      } = await res.json();

      if (data.added > 0) {
        appendLog("success", `${data.added} fardo(s) adicionado(s) com sucesso`);
        toast.success(`${data.added} fardo(s) adicionado(s)`);
      }
      for (const s of data.skipped ?? []) {
        const msg =
          s.motivo === "ja-existe-outra-estante"
            ? `Já existe em outra estante (${s.estanteNome ?? "—"}): ${s.sku} (lote ${s.lote})`
            : `Duplicado: ${s.sku} (lote ${s.lote})`;
        appendLog("warning", msg);
      }
      if (data.added === 0 && (data.skipped?.length ?? 0) > 0) {
        toast.warning(`Nenhum fardo adicionado — ver log da sessão`);
      }
      setPendingFardos([]);
      fetchDetail(selectedId);
      fetchEstantes();
    } catch {
      appendLog("error", "Erro ao confirmar inclusão");
      toast.error("Erro ao adicionar fardos");
    } finally {
      setIsConfirming(false);
    }
  }, [selectedId, pendingFardos, appendLog, fetchDetail, fetchEstantes]);

  const handleConfirmRetirada = useCallback(async () => {
    if (!selectedId || pendingFardos.length === 0) return;
    setIsConfirming(true);
    try {
      const res = await fetch(
        `/api/estantes/${selectedId}/fardos/bulk-delete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fardos: pendingFardos.map((p) => ({ qrCode: p.raw.trim() })),
          }),
        },
      );
      if (!res.ok) throw new Error("Erro ao retirar");
      const data: {
        removed: number;
        naoEncontrados: Array<{ qrCode?: string; fardoId?: string }>;
      } = await res.json();

      if (data.removed > 0) {
        appendLog("success", `${data.removed} fardo(s) retirado(s)`);
        toast.success(`${data.removed} fardo(s) retirado(s)`);
      }
      // Reconstrói mensagem amigável usando o pendingFardos do client (o
      // backend só devolve o raw/fardoId que falhou no match).
      for (const n of data.naoEncontrados ?? []) {
        const orig = pendingFardos.find((p) => p.raw.trim() === n.qrCode);
        const label = orig
          ? `${orig.parsed.sku} (lote ${orig.parsed.lote})`
          : (n.qrCode ?? n.fardoId ?? "—");
        appendLog("warning", `Não encontrado na estante: ${label}`);
      }
      if (data.removed === 0 && (data.naoEncontrados?.length ?? 0) > 0) {
        toast.warning("Nenhum fardo retirado — ver log da sessão");
      }
      setPendingFardos([]);
      fetchDetail(selectedId);
      fetchEstantes();
    } catch {
      appendLog("error", "Erro ao confirmar retirada");
      toast.error("Erro ao retirar fardos");
    } finally {
      setIsConfirming(false);
    }
  }, [selectedId, pendingFardos, appendLog, fetchDetail, fetchEstantes]);

  const handleConfirmBipagem = useCallback(async () => {
    if (!selectedId) return;
    setIsConfirming(true);
    try {
      const res = await fetch(`/api/estantes/${selectedId}/bipagem`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scannedCount: bipagemScanned.length }),
      });
      if (!res.ok) throw new Error("Erro ao confirmar bipagem");
      appendLog("success", `Bipagem registrada (${bipagemScanned.length} fardos)`);
      toast.success(`Bipagem registrada! ${bipagemScanned.length} fardos`);
      setBipagemScanned([]);
      setShowScanner(false);
      fetchDetail(selectedId);
      fetchEstantes();
    } catch {
      appendLog("error", "Erro ao confirmar bipagem");
      toast.error("Erro ao confirmar bipagem");
    } finally {
      setIsConfirming(false);
    }
  }, [selectedId, bipagemScanned, appendLog, fetchDetail, fetchEstantes]);

  const handleImportar = useCallback(
    async (items: Array<{ sku: string; qtd: number; lote: string }>) => {
      if (!selectedId) return;
      try {
        const res = await fetch(`/api/estantes/${selectedId}/fardos`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            origem: "importacao",
            fardos: items.map((item) => ({
              qrCode: `${item.sku}|${item.lote}|${item.qtd}`,
              sku: item.sku,
              lote: item.lote,
              quantidade: item.qtd,
            })),
          }),
        });
        if (!res.ok) throw new Error("Erro ao importar");
        const data: { added: number } = await res.json();
        toast.success(`${data.added} fardos importados!`);
        setShowImportar(false);
        fetchDetail(selectedId);
        fetchEstantes();
      } catch {
        toast.error("Erro ao importar fardos");
      }
    },
    [selectedId, fetchDetail, fetchEstantes],
  );

  const handleFinalizarBalanco = useCallback(async () => {
    if (!selectedId || !selectedEstante) return;
    if (
      !confirm(
        `Finalizar balanco de "${selectedEstante.nome}"?\nIsso registrara o estado atual no historico.`,
      )
    )
      return;
    try {
      const res = await fetch(`/api/estantes/${selectedId}/balanco`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Erro ao finalizar balanco");
      const data = await res.json();
      toast.success(
        `Balanco finalizado! ${data.totalFardos} fardos - ${data.totalPecas} pecas`,
      );
      fetchDetail(selectedId);
      fetchEstantes();
    } catch {
      toast.error("Erro ao finalizar balanco");
    }
  }, [selectedId, selectedEstante, fetchDetail, fetchEstantes]);

  const handleRemoveFardo = useCallback(
    async (fardoId: string) => {
      if (!selectedId) return;
      if (!confirm("Remover este fardo?")) return;
      setRemovingId(fardoId);
      let ok = false;
      try {
        const res = await fetch(
          `/api/estantes/${selectedId}/fardos/${fardoId}`,
          { method: "DELETE" },
        );
        ok = res.ok;
        if (!res.ok) throw new Error("Erro ao remover");
        toast.success("Fardo removido");
      } catch {
        if (!ok) toast.error("Erro ao remover fardo");
      } finally {
        setRemovingId(null);
        fetchDetail(selectedId);
        fetchEstantes();
      }
    },
    [selectedId, fetchDetail, fetchEstantes],
  );

  const toggleGroup = useCallback((sku: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(sku)) next.delete(sku);
      else next.add(sku);
      return next;
    });
  }, []);

  const downloadCSV = useCallback(() => {
    if (!selectedEstante || fardos.length === 0) return;
    const header = "SKU,Lote,Quantidade,Data";
    const rows = fardos.map(
      (f) =>
        `"${f.sku}","${f.lote}",${f.quantidade},"${formatDate(f.createdAt)}"`,
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `estante_${selectedEstante.nome}_${new Date().toLocaleDateString("pt-BR").replace(/\//g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [selectedEstante, fardos]);

  const handleExportXlsx = useCallback(async () => {
    if (!selectedEstante || fardos.length === 0) return;
    try {
      const agregado = agregarFardos(fardos);
      await exportarEstanteXlsx({
        agregado,
        fardosBrutos: fardos,
        nomeEstante: selectedEstante.nome,
      });
    } catch (error) {
      console.error("Erro ao exportar XLSX:", error);
      toast.error("Erro ao gerar XLSX");
    }
  }, [selectedEstante, fardos]);

  const handleExportUpseller = useCallback(async () => {
    if (!selectedEstante || fardos.length === 0) return;
    try {
      const r = await fetch("/api/estantes/consolidado", {
        cache: "no-store",
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const ctx = (await r.json()) as {
        modelos: Array<{ codigo: string; custoUpseller: number | null }>;
        skus: Array<{ codigo: string; pausadoUpseller: boolean }>;
      };
      const resultado = await exportarUpseller({
        fardos,
        skusCatalogo: ctx.skus.map((s) => ({
          codigo: s.codigo,
          pausado: s.pausadoUpseller,
        })),
        modelos: ctx.modelos,
        escopo: "estante",
        nomeEstante: selectedEstante.nome,
      });
      const alertSummary =
        resultado.alertas.length > 0
          ? ` · ${resultado.alertas.length} alerta(s)`
          : "";
      toast.success(
        `Update_warehouse gerado · ${resultado.linhasExportadas} SKU(s)${alertSummary}`,
      );
      if (resultado.alertas.length > 0) {
        for (const a of resultado.alertas.slice(0, 5)) {
          console.warn("[upseller alerta]", a);
        }
      }
    } catch (error) {
      console.error("upseller estante:", error);
      toast.error("Erro ao gerar XLSX da Upseller");
    }
  }, [selectedEstante, fardos]);

  const openScanner = (mode: "retirar" | "adicionar" | "bipagem") => {
    setScannerMode(mode);
    setPendingFardos([]);
    setSessionLog([]);
    if (mode === "bipagem") setBipagemScanned([]);
    setShowScanner(true);
  };

  const scannerTitle =
    scannerMode === "retirar"
      ? "Retirar Fardo"
      : scannerMode === "adicionar"
        ? "Adicionar Fardo"
        : "Bipagem Semanal";

  // ── Historico view ─────────────────────────────────────────────────────────

  if (view === "historico") {
    return (
      <div className="space-y-8">
        <HistoricoView onBack={() => setView("lista")} />
      </div>
    );
  }

  // ── Detalhe view ───────────────────────────────────────────────────────────

  if (view === "detalhe" && selectedEstante) {
    const ok =
      selectedEstante.ultimaBipagem &&
      isThisWeek(selectedEstante.ultimaBipagem);
    const totalPecas = fardos.reduce((s, f) => s + f.quantidade, 0);

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setView("lista");
              setSelectedId(null);
              setSelectedEstante(null);
            }}
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Warehouse className="h-5 w-5" />
              {selectedEstante.nome}
            </h1>
            {selectedEstante.descricao && (
              <p className="text-xs text-muted-foreground">
                {selectedEstante.descricao}
              </p>
            )}
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-4">
          <Card className="bg-slate-900 border-slate-700">
            <CardContent className="p-3 text-center">
              <p className="text-3xl font-bold">{fardos.length}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Fardos</p>
            </CardContent>
          </Card>
          <Card className="bg-slate-900 border-slate-700">
            <CardContent className="p-3 text-center">
              <p className="text-3xl font-bold">{totalPecas}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Pecas</p>
            </CardContent>
          </Card>
          <Card
            className={cn(
              ok
                ? "border-green-800 bg-green-950/30"
                : "border-yellow-800 bg-yellow-950/30",
            )}
          >
            <CardContent className="p-3 text-center">
              <p
                className={cn(
                  "text-sm font-bold",
                  ok ? "text-green-300" : "text-yellow-300",
                )}
              >
                {ok ? "OK" : "Pend."}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {selectedEstante.ultimaBipagem
                  ? formatDate(selectedEstante.ultimaBipagem)
                  : "Nunca"}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Action buttons */}
        <div className="grid grid-cols-2 gap-3">
          <Button
            className="flex-col h-14 gap-1 text-xs bg-red-600 hover:bg-red-700 text-white"
            onClick={() => openScanner("retirar")}
          >
            <ArrowUpCircle className="h-5 w-5" /> Retirar Fardo
          </Button>
          <Button
            className="flex-col h-14 gap-1 text-xs bg-green-600 hover:bg-green-700 text-white"
            onClick={() => openScanner("adicionar")}
          >
            <ArrowDownCircle className="h-5 w-5" /> Adicionar Fardo
          </Button>
          <Button
            variant="outline"
            className="flex-col h-14 gap-1 text-xs"
            onClick={() => openScanner("bipagem")}
          >
            <RefreshCw className="h-5 w-5" /> Bip. Semanal
          </Button>
          <Button
            variant="outline"
            className="flex-col h-14 gap-1 text-xs border-green-600 text-green-700 hover:bg-green-950"
            onClick={() => setShowImportar(true)}
          >
            <Upload className="h-5 w-5" /> Importar Balanco
          </Button>
          <Button
            className="col-span-2 flex-col h-14 gap-1 text-xs bg-indigo-600 hover:bg-indigo-700 text-white"
            onClick={handleFinalizarBalanco}
          >
            <ClipboardCheck className="h-5 w-5" /> Finalizar Balanco
          </Button>
        </div>

        {/* Fardos / Matriz section */}
        <div>
          <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
            <div className="flex items-center gap-3">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {viewModoDetalhe === "lista"
                  ? `Fardos por SKU (${fardos.length})`
                  : "Visualização matriz"}
              </h2>
              <div className="flex items-center border border-slate-700 rounded-md overflow-hidden">
                <button
                  type="button"
                  onClick={() => setViewModoDetalhe("lista")}
                  aria-pressed={viewModoDetalhe === "lista"}
                  className={cn(
                    "px-2.5 py-1 text-xs flex items-center gap-1 transition-colors",
                    viewModoDetalhe === "lista"
                      ? "bg-slate-700 text-foreground"
                      : "text-muted-foreground hover:bg-slate-800",
                  )}
                >
                  <List className="h-3.5 w-3.5" /> Lista
                </button>
                <button
                  type="button"
                  onClick={() => setViewModoDetalhe("matriz")}
                  aria-pressed={viewModoDetalhe === "matriz"}
                  className={cn(
                    "px-2.5 py-1 text-xs flex items-center gap-1 transition-colors border-l border-slate-700",
                    viewModoDetalhe === "matriz"
                      ? "bg-slate-700 text-foreground"
                      : "text-muted-foreground hover:bg-slate-800",
                  )}
                >
                  <Grid3x3 className="h-3.5 w-3.5" /> Matriz
                </button>
              </div>
            </div>
            {fardos.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1.5"
                  >
                    <FileDown className="h-3.5 w-3.5" /> Baixar Relatório
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={downloadCSV}>
                    CSV (cru)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleExportXlsx}>
                    XLSX (pivotado)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleExportUpseller}>
                    Upseller (.xlsx)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          {viewModoDetalhe === "lista" ? (
            <FardosAgrupados
              fardos={fardos}
              expandedGroups={expandedGroups}
              toggleGroup={toggleGroup}
              onRemove={handleRemoveFardo}
              onAddFirst={() => openScanner("adicionar")}
              removingId={removingId}
            />
          ) : (
            <MatrizView
              fardos={fardos}
              nomeEstante={selectedEstante.nome}
              ultimaBipagem={selectedEstante.ultimaBipagem}
            />
          )}
        </div>

        {/* Modals */}
        <ModalScanner
          open={showScanner}
          onOpenChange={(open) => {
            setShowScanner(open);
            if (!open) {
              setPendingFardos([]);
              setBipagemScanned([]);
              setSessionLog([]);
            }
          }}
          title={scannerTitle}
          mode={scannerMode}
          onScanComplete={handleScanComplete}
          pendingFardos={pendingFardos}
          onRemovePending={handleRemovePending}
          onConfirmInclusao={handleConfirmInclusao}
          onConfirmRetirada={handleConfirmRetirada}
          bipagemScanned={bipagemScanned}
          onConfirmBipagem={handleConfirmBipagem}
          sessionLog={sessionLog}
          onClearLog={() => setSessionLog([])}
          isConfirming={isConfirming}
        />
        <ModalImportar
          open={showImportar}
          onOpenChange={setShowImportar}
          onConfirm={handleImportar}
        />
      </div>
    );
  }

  // ── Lista view (default) ───────────────────────────────────────────────────

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <PageHeader
          title="Estante Virtual"
          description="Controle de fardos por estante"
          icon={<Warehouse className="h-8 w-8" />}
        />
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setView("historico")}
          >
            <History className="h-4 w-4 mr-2" />
            <span className="hidden sm:inline">Historico</span>
          </Button>
          <Button size="sm" onClick={() => setShowCriar(true)}>
            <Plus className="h-4 w-4 mr-2" />
            <span className="hidden sm:inline">Nova Estante</span>
          </Button>
        </div>
      </div>

      <Tabs defaultValue="por-estante" className="space-y-4">
        <TabsList>
          <TabsTrigger value="por-estante">Por Estante</TabsTrigger>
          <TabsTrigger value="consolidado">Consolidado</TabsTrigger>
        </TabsList>

        <TabsContent value="por-estante" className="space-y-4">
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : estantes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Warehouse className="h-16 w-16 text-muted-foreground/20 mb-4" />
          <p className="text-lg font-medium text-muted-foreground">
            Nenhuma estante cadastrada
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            Crie sua primeira estante para comecar.
          </p>
          <Button className="mt-5" onClick={() => setShowCriar(true)}>
            <Plus className="h-4 w-4 mr-2" /> Criar Primeira Estante
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {estantes.map((estante) => {
            const ok =
              estante.ultimaBipagem && isThisWeek(estante.ultimaBipagem);
            const sortedSkus = [...(estante.topSkus || [])]
              .sort(compareSKU)
              .filter(Boolean);
            return (
              <Card
                key={estante.id}
                className="bg-slate-900 border-slate-700 cursor-pointer hover:bg-slate-800/60 transition-colors relative group"
                onClick={() => {
                  setSelectedId(estante.id);
                  setView("detalhe");
                  fetchDetail(estante.id);
                }}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div
                        className={cn(
                          "h-2.5 w-2.5 rounded-full mt-0.5 shrink-0",
                          ok ? "bg-green-500" : "bg-yellow-500",
                        )}
                      />
                      <h3 className="font-bold">{estante.nome}</h3>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteEstante(estante.id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                  {estante.descricao && (
                    <p className="text-xs text-muted-foreground mb-2">
                      {estante.descricao}
                    </p>
                  )}
                  {sortedSkus.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-3">
                      {sortedSkus.slice(0, 6).map((sku) => (
                        <span
                          key={sku}
                          className="text-xs bg-slate-800 px-2 py-0.5 rounded font-mono"
                        >
                          {sku}
                        </span>
                      ))}
                      {sortedSkus.length > 6 && (
                        <span className="text-xs text-muted-foreground">
                          +{sortedSkus.length - 6}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="flex items-end justify-between">
                    <div className="flex items-center gap-1.5">
                      <Package className="h-4 w-4 text-muted-foreground" />
                      <span className="text-3xl font-bold leading-none">
                        {estante.fardoCount}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        fardos
                      </span>
                    </div>
                    <div className="text-right">
                      <p
                        className={cn(
                          "text-xs font-semibold",
                          ok ? "text-green-400" : "text-yellow-400",
                        )}
                      >
                        {ok ? "Bip. esta semana" : "Bipagem pendente"}
                      </p>
                      {estante.ultimaBipagem && (
                        <p className="text-xs text-muted-foreground">
                          {formatDate(estante.ultimaBipagem)}
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
        </TabsContent>

        <TabsContent value="consolidado" className="space-y-4">
          <ConsolidadoView />
        </TabsContent>
      </Tabs>

      <ModalCriar
        open={showCriar}
        onOpenChange={setShowCriar}
        onSubmit={handleCriarEstante}
      />
    </div>
  );
}
