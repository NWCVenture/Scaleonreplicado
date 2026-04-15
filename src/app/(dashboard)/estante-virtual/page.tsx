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
} from "lucide-react";
import {
  parseQRCode,
  isThisWeek,
  compareSKU,
  type ParsedQR,
} from "@/lib/estante-utils";
import { ModalCriar } from "@/components/estante-virtual/modal-criar";
import { ModalImportar } from "@/components/estante-virtual/modal-importar";
import { ModalScanner } from "@/components/estante-virtual/modal-scanner";
import { FardosAgrupados } from "@/components/estante-virtual/fardos-agrupados";
import { HistoricoView } from "@/components/estante-virtual/historico-view";

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

  // Scanner state
  const [pendingQR, setPendingQR] = useState<{
    raw: string;
    parsed: ParsedQR;
  } | null>(null);
  const [bipagemScanned, setBipagemScanned] = useState<string[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [removingId, setRemovingId] = useState<string | null>(null);

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
    async (parsed: ParsedQR, raw: string) => {
      if (!selectedId) return;

      if (scannerMode === "adicionar") {
        try {
          const res = await fetch(`/api/estantes/${selectedId}/fardos`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fardos: [
                {
                  qrCode: raw.trim(),
                  sku: parsed.sku,
                  lote: parsed.lote,
                  quantidade: parsed.qtd,
                },
              ],
            }),
          });
          if (!res.ok) throw new Error("Erro ao adicionar");
          toast.success(`Fardo adicionado: ${parsed.sku}`);
          fetchDetail(selectedId);
        } catch {
          toast.error("Erro ao adicionar fardo");
        }
      } else if (scannerMode === "retirar") {
        setPendingQR({ raw, parsed });
      } else if (scannerMode === "bipagem") {
        const key = `${parsed.sku}|${parsed.lote}`;
        if (bipagemScanned.includes(key)) {
          toast.warning("Ja bipado");
          return;
        }
        setBipagemScanned((prev) => [...prev, key]);
        toast.success(`Bipado: ${parsed.sku}`);
      }
    },
    [selectedId, scannerMode, bipagemScanned, fetchDetail],
  );

  const handleConfirmRetirada = useCallback(async () => {
    if (!pendingQR || !selectedId) return;
    const match = fardos.find(
      (f) =>
        f.sku === pendingQR.parsed.sku && f.lote === pendingQR.parsed.lote,
    );
    if (!match) {
      toast.error(`Fardo nao encontrado: ${pendingQR.parsed.sku}`);
      return;
    }
    try {
      const res = await fetch(
        `/api/estantes/${selectedId}/fardos/${match.id}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Erro ao retirar");
      toast.success(`Fardo retirado: ${pendingQR.parsed.sku}`);
      setPendingQR(null);
      setShowScanner(false);
      fetchDetail(selectedId);
      fetchEstantes();
    } catch {
      toast.error("Erro ao retirar fardo");
    }
  }, [pendingQR, selectedId, fardos, fetchDetail, fetchEstantes]);

  const handleConfirmBipagem = useCallback(async () => {
    if (!selectedId) return;
    try {
      const res = await fetch(`/api/estantes/${selectedId}/bipagem`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scannedCount: bipagemScanned.length }),
      });
      if (!res.ok) throw new Error("Erro ao confirmar bipagem");
      toast.success(`Bipagem registrada! ${bipagemScanned.length} fardos`);
      setBipagemScanned([]);
      setShowScanner(false);
      fetchDetail(selectedId);
      fetchEstantes();
    } catch {
      toast.error("Erro ao confirmar bipagem");
    }
  }, [selectedId, bipagemScanned, fetchDetail, fetchEstantes]);

  const handleImportar = useCallback(
    async (items: Array<{ sku: string; qtd: number; lote: string }>) => {
      if (!selectedId) return;
      try {
        const res = await fetch(`/api/estantes/${selectedId}/fardos`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fardos: items.map((item) => ({
              qrCode: `${item.sku}|${item.lote}|${item.qtd}`,
              sku: item.sku,
              lote: item.lote,
              quantidade: item.qtd,
            })),
          }),
        });
        if (!res.ok) throw new Error("Erro ao importar");
        toast.success(`${items.length} fardos importados!`);
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
      try {
        const res = await fetch(
          `/api/estantes/${selectedId}/fardos/${fardoId}`,
          { method: "DELETE" },
        );
        if (!res.ok) throw new Error("Erro ao remover");
        toast.success("Fardo removido");
        fetchDetail(selectedId);
        fetchEstantes();
      } catch {
        toast.error("Erro ao remover fardo");
      } finally {
        setRemovingId(null);
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

  const openScanner = (mode: "retirar" | "adicionar" | "bipagem") => {
    setScannerMode(mode);
    setPendingQR(null);
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
            className="flex-col h-14 gap-1 text-xs border-orange-400 text-orange-500 hover:bg-orange-950"
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

        {/* Fardos section */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Fardos por SKU ({fardos.length})
            </h2>
            {fardos.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={downloadCSV}
              >
                <FileDown className="h-3.5 w-3.5" /> Baixar Relatorio
              </Button>
            )}
          </div>
          <FardosAgrupados
            fardos={fardos}
            expandedGroups={expandedGroups}
            toggleGroup={toggleGroup}
            onRemove={handleRemoveFardo}
            onAddFirst={() => openScanner("adicionar")}
            removingId={removingId}
          />
        </div>

        {/* Modals */}
        <ModalScanner
          open={showScanner}
          onOpenChange={(open) => {
            setShowScanner(open);
            if (!open) {
              setPendingQR(null);
              setBipagemScanned([]);
            }
          }}
          title={scannerTitle}
          mode={scannerMode}
          onScanComplete={handleScanComplete}
          pendingQR={pendingQR}
          onConfirmRetirada={handleConfirmRetirada}
          onLerOutro={() => setPendingQR(null)}
          bipagemScanned={bipagemScanned}
          onConfirmBipagem={handleConfirmBipagem}
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

      <ModalCriar
        open={showCriar}
        onOpenChange={setShowCriar}
        onSubmit={handleCriarEstante}
      />
    </div>
  );
}
