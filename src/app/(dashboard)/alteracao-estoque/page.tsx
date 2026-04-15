"use client";

import { useState, useEffect } from "react";
import { useSession } from "@/lib/auth-client";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn, formatDate } from "@/lib/utils";
import {
  Loader2,
  ArrowLeftRight,
  History,
  CheckCircle2,
  Square,
  CheckSquare,
  Download,
  Trash2,
  ArrowRight,
  Plus,
  Minus,
  Tag,
  Filter,
  Calendar,
} from "lucide-react";
import {
  type Size,
  SIZES,
  extractSize,
  replaceSize,
  type AlteracaoEstoqueRecord,
  formatItens,
  gerarRelatorioGeral,
  gerarRelatorioResumido,
  gerarRelatorioSaidas,
  gerarRelatorioEntradas,
  downloadTxt,
} from "@/lib/stock-transfer-utils";

export default function AlteracaoEstoquePage() {
  const { data: session } = useSession();

  // Core data
  const [historico, setHistorico] = useState<AlteracaoEstoqueRecord[]>([]);
  const [totalRegistros, setTotalRegistros] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  // UI toggles
  const [showHistorico, setShowHistorico] = useState(false);
  const [mostrarPopupUpseller, setMostrarPopupUpseller] = useState(false);

  // Filters
  const [filtroDataInicio, setFiltroDataInicio] = useState("");
  const [filtroDataFim, setFiltroDataFim] = useState("");
  const [filtroRevisado, setFiltroRevisado] = useState<
    "todos" | "revisados" | "pendentes"
  >("todos");
  const [offset, setOffset] = useState(0);

  // Multi-select for batch review
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());

  // Quick Edit Popup
  const [showAlteracaoPopup, setShowAlteracaoPopup] = useState(false);
  const [popupSaidaSku, setPopupSaidaSku] = useState("");
  const [popupQtd, setPopupQtd] = useState(1);
  const [popupNovoTamanho, setPopupNovoTamanho] = useState<Size | null>(null);
  const [popupEtiqueta, setPopupEtiqueta] = useState("");

  // SKU autocomplete
  const [saidaInput, setSaidaInput] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Submit state
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchHistorico = async (newOffset?: number) => {
    try {
      const currentOffset = newOffset ?? offset;
      const params = new URLSearchParams();
      params.set("limit", "50");
      params.set("offset", String(currentOffset));
      if (filtroDataInicio) params.set("dataInicio", filtroDataInicio);
      if (filtroDataFim) params.set("dataFim", filtroDataFim);
      if (filtroRevisado !== "todos") params.set("revisado", filtroRevisado);

      const res = await fetch(`/api/alteracoes-estoque?${params.toString()}`);
      if (!res.ok) throw new Error("Erro ao buscar historico");
      const data = await res.json();

      if (currentOffset > 0) {
        setHistorico((prev) => [...prev, ...data.registros]);
      } else {
        setHistorico(data.registros);
      }
      setTotalRegistros(data.total);
    } catch (error) {
      console.error("Erro ao carregar historico:", error);
      toast.error("Erro ao carregar historico");
    } finally {
      setIsLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    if (session) {
      fetchHistorico();
    }
  }, [session]);

  // Filter change
  useEffect(() => {
    setOffset(0);
    fetchHistorico(0);
  }, [filtroDataInicio, filtroDataFim, filtroRevisado]);

  // SKU autocomplete
  useEffect(() => {
    if (saidaInput.length < 1) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/sku-catalogo?search=${encodeURIComponent(saidaInput)}`
        );
        if (!res.ok) return;
        const data = await res.json();
        const codigos = data.skus.map((s: { codigo: string }) => s.codigo);
        setSuggestions(codigos.slice(0, 10));
        setShowSuggestions(codigos.length > 0);
      } catch {
        setSuggestions([]);
        setShowSuggestions(false);
      }
    }, 300);

    return () => clearTimeout(timeout);
  }, [saidaInput]);

  // Upseller check
  useEffect(() => {
    if (sessionStorage.getItem("stockflow_relatorio_baixado")) {
      setMostrarPopupUpseller(true);
    }
  }, []);

  const abrirPopupAlteracao = (sku: string) => {
    setPopupSaidaSku(sku.trim().toUpperCase());
    setPopupQtd(1);
    setPopupNovoTamanho(null);
    setPopupEtiqueta("");
    setShowAlteracaoPopup(true);
  };

  const handleSalvarAlteracaoRapida = async () => {
    if (!popupSaidaSku.trim()) {
      toast.error("SKU de saida nao informado!");
      return;
    }
    if (!popupNovoTamanho) {
      toast.error("Selecione o novo tamanho!");
      return;
    }
    if (!popupEtiqueta.trim()) {
      toast.error("Informe a etiqueta/codigo do pacote!");
      return;
    }
    if (popupQtd < 1) {
      toast.error("Informe a quantidade!");
      return;
    }

    setIsSubmitting(true);
    try {
      const saidaUpper = popupSaidaSku.trim().toUpperCase();
      const entradaUpper = replaceSize(saidaUpper, popupNovoTamanho);

      const res = await fetch("/api/alteracoes-estoque", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          saidas: [{ sku: saidaUpper, quantidade: popupQtd }],
          entradas: [{ sku: entradaUpper, quantidade: popupQtd }],
          codigoPacote: popupEtiqueta.trim(),
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Erro ao registrar");
      }

      toast.success(
        `Alteracao: ${saidaUpper} -> ${entradaUpper} (${popupQtd}x)`
      );
      setShowAlteracaoPopup(false);
      setSaidaInput("");
      setShowSuggestions(false);
      setOffset(0);
      fetchHistorico(0);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Erro ao registrar alteracao"
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRevisar = async (id: string) => {
    try {
      const res = await fetch(`/api/alteracoes-estoque/${id}/revisar`, {
        method: "PUT",
      });

      if (!res.ok) throw new Error("Erro ao revisar");

      toast.success("Alteracao marcada como revisada!");
      setOffset(0);
      fetchHistorico(0);
    } catch {
      toast.error("Erro ao revisar alteracao");
    }
  };

  const handleRevisarMultiplos = async () => {
    if (selecionados.size === 0) {
      toast.error("Selecione pelo menos uma alteracao!");
      return;
    }

    try {
      const res = await fetch("/api/alteracoes-estoque/bulk-revisar", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selecionados) }),
      });

      if (!res.ok) throw new Error("Erro ao revisar");

      toast.success(
        `${selecionados.size} alteracao(oes) marcada(s) como revisada(s)!`
      );
      setSelecionados(new Set());
      setOffset(0);
      fetchHistorico(0);
    } catch {
      toast.error("Erro ao revisar alteracoes");
    }
  };

  const handleDeletar = async (id: string) => {
    if (!confirm("Deseja realmente remover este registro?")) return;

    try {
      const res = await fetch(`/api/alteracoes-estoque/${id}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("Erro ao remover");

      toast.success("Registro removido!");
      setOffset(0);
      fetchHistorico(0);
    } catch {
      toast.error("Erro ao remover registro");
    }
  };

  const handleExport = async (
    tipo: "geral" | "resumido" | "saidas" | "entradas"
  ) => {
    try {
      const params = new URLSearchParams();
      params.set("limit", "10000");
      params.set("offset", "0");
      if (filtroDataInicio) params.set("dataInicio", filtroDataInicio);
      if (filtroDataFim) params.set("dataFim", filtroDataFim);
      if (filtroRevisado !== "todos") params.set("revisado", filtroRevisado);

      const res = await fetch(`/api/alteracoes-estoque?${params.toString()}`);
      if (!res.ok) throw new Error("Erro ao buscar dados para exportacao");
      const data = await res.json();

      if (data.registros.length === 0) {
        toast.error("Nenhum registro para exportar!");
        return;
      }

      const filtros = {
        dataInicio: filtroDataInicio || undefined,
        dataFim: filtroDataFim || undefined,
      };

      const dateStr = new Date().toISOString().split("T")[0];
      let conteudo: string;
      let filename: string;

      switch (tipo) {
        case "geral":
          conteudo = gerarRelatorioGeral(data.registros, filtros);
          filename = `Relatorio_Geral_Alteracoes_${dateStr}.txt`;
          break;
        case "resumido":
          conteudo = gerarRelatorioResumido(data.registros, filtros);
          filename = `Relatorio_Resumido_Alteracoes_${dateStr}.txt`;
          break;
        case "saidas":
          conteudo = gerarRelatorioSaidas(data.registros);
          filename = `Relatorio_Saidas_${dateStr}.txt`;
          break;
        case "entradas":
          conteudo = gerarRelatorioEntradas(data.registros);
          filename = `Relatorio_Entradas_${dateStr}.txt`;
          break;
      }

      downloadTxt(conteudo, filename);
      sessionStorage.setItem("stockflow_relatorio_baixado", "1");
      setMostrarPopupUpseller(true);
    } catch {
      toast.error("Erro ao gerar relatorio");
    }
  };

  const handleSelecionarTodos = () => {
    const pendentes = historico.filter((item) => !item.revisado);
    if (selecionados.size === pendentes.length && pendentes.length > 0) {
      setSelecionados(new Set());
    } else {
      setSelecionados(new Set(pendentes.map((item) => item.id)));
    }
  };

  const handleToggleSelecionar = (id: string) => {
    const novosSelecionados = new Set(selecionados);
    if (novosSelecionados.has(id)) {
      novosSelecionados.delete(id);
    } else {
      novosSelecionados.add(id);
    }
    setSelecionados(novosSelecionados);
  };

  return (
    <div className="space-y-8">
      {/* 1. Header */}
      <div className="flex justify-between items-center">
        <PageHeader
          title="Alteracao de Estoque"
          description="Registre trocas de tamanho e transferencias"
        />
        <Button
          variant="outline"
          onClick={() => setShowHistorico(!showHistorico)}
        >
          <History className="mr-2 h-4 w-4" />
          {showHistorico ? "Ocultar" : "Ver"} Historico ({totalRegistros})
        </Button>
      </div>

      {/* 2. History Panel */}
      {showHistorico && (
        <Card className="bg-slate-900 border-slate-700">
          <CardHeader>
            <CardTitle>Historico de Alteracoes</CardTitle>
            <CardDescription>
              {totalRegistros} registro(s) encontrado(s)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Filter bar */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="space-y-1">
                <Label className="text-xs flex items-center gap-1">
                  <Calendar className="h-3 w-3" /> Data Inicio
                </Label>
                <Input
                  type="date"
                  value={filtroDataInicio}
                  onChange={(e) => setFiltroDataInicio(e.target.value)}
                  className="bg-slate-800 border-slate-600"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs flex items-center gap-1">
                  <Calendar className="h-3 w-3" /> Data Fim
                </Label>
                <Input
                  type="date"
                  value={filtroDataFim}
                  onChange={(e) => setFiltroDataFim(e.target.value)}
                  className="bg-slate-800 border-slate-600"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs flex items-center gap-1">
                  <Filter className="h-3 w-3" /> Status
                </Label>
                <select
                  className="flex h-10 w-full items-center rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  value={filtroRevisado}
                  onChange={(e) =>
                    setFiltroRevisado(
                      e.target.value as "todos" | "revisados" | "pendentes"
                    )
                  }
                >
                  <option value="todos">Todos</option>
                  <option value="revisados">Revisados</option>
                  <option value="pendentes">Pendentes</option>
                </select>
              </div>
              <div className="flex items-end">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setFiltroDataInicio("");
                    setFiltroDataFim("");
                    setFiltroRevisado("todos");
                  }}
                >
                  Limpar Filtros
                </Button>
              </div>
            </div>

            {/* Action bar */}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={handleSelecionarTodos}>
                <CheckSquare className="mr-1 h-4 w-4" />
                Selecionar Pendentes
              </Button>
              <Button
                size="sm"
                disabled={selecionados.size === 0}
                onClick={handleRevisarMultiplos}
              >
                <CheckCircle2 className="mr-1 h-4 w-4" />
                Revisar Selecionados ({selecionados.size})
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleExport("geral")}
              >
                <Download className="mr-1 h-4 w-4" />
                Relatorio Geral
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleExport("resumido")}
              >
                <Download className="mr-1 h-4 w-4" />
                Resumido
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleExport("saidas")}
              >
                <Download className="mr-1 h-4 w-4" />
                Saidas
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleExport("entradas")}
              >
                <Download className="mr-1 h-4 w-4" />
                Entradas
              </Button>
            </div>

            {/* Records list */}
            <div className="space-y-3 max-h-[600px] overflow-auto">
              {isLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : historico.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  Nenhum registro encontrado.
                </p>
              ) : (
                historico.map((item) => (
                  <div
                    key={item.id}
                    className="p-4 border border-slate-700 rounded-lg bg-slate-800/50"
                  >
                    <div className="flex items-start gap-3">
                      {!item.revisado && (
                        <button
                          type="button"
                          onClick={() => handleToggleSelecionar(item.id)}
                          className="mt-1"
                        >
                          {selecionados.has(item.id) ? (
                            <CheckSquare className="h-5 w-5 text-orange-400" />
                          ) : (
                            <Square className="h-5 w-5 text-slate-500" />
                          )}
                        </button>
                      )}
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-red-400">
                            {formatItens(item.saidas)}
                          </span>
                          <ArrowRight className="h-4 w-4 text-slate-500" />
                          <span className="font-mono text-green-400">
                            {formatItens(item.entradas)}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {formatDate(item.createdAt)}
                          {item.codigoPacote &&
                            ` • Pacote: ${item.codigoPacote}`}
                          {item.usuarioNome && ` • ${item.usuarioNome}`}
                        </div>
                        {item.revisado && (
                          <span className="text-xs text-green-400">
                            Revisado por {item.revisadoPorNome} em{" "}
                            {formatDate(item.revisadoEm!)}
                          </span>
                        )}
                      </div>
                      <div className="flex gap-1">
                        {!item.revisado && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleRevisar(item.id)}
                          >
                            <CheckCircle2 className="h-4 w-4 text-green-400" />
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleDeletar(item.id)}
                        >
                          <Trash2 className="h-4 w-4 text-red-400" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Load More pagination */}
            {historico.length < totalRegistros && (
              <div className="flex justify-center pt-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    const newOffset = offset + 50;
                    setOffset(newOffset);
                    fetchHistorico(newOffset);
                  }}
                >
                  Carregar mais ({totalRegistros - historico.length} restantes)
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 3. Main Form: Quick Edit */}
      <Card className="bg-slate-900 border-slate-700">
        <CardHeader>
          <CardTitle>Alteracao Rapida</CardTitle>
          <CardDescription>
            Selecione o SKU que saiu e registre a troca de tamanho
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* SKU Input with Autocomplete */}
          <div className="space-y-2 relative">
            <Label>SKU do Produto</Label>
            <div className="relative">
              <Input
                type="text"
                placeholder="Digite o SKU (ex: LUA AZ G)"
                value={saidaInput}
                onChange={(e) => setSaidaInput(e.target.value)}
                onFocus={() => {
                  if (saidaInput.length > 0 && suggestions.length > 0) {
                    setShowSuggestions(true);
                  }
                }}
                onBlur={() => {
                  setTimeout(() => setShowSuggestions(false), 200);
                }}
                className="bg-slate-800 border-slate-600 h-12 text-lg font-mono"
              />

              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-slate-800 border border-slate-600 rounded-md shadow-lg max-h-60 overflow-auto">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="w-full text-left px-4 py-2 hover:bg-slate-700 cursor-pointer text-sm"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setSaidaInput(s);
                        setShowSuggestions(false);
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <Button
            className="w-full h-12 text-lg"
            disabled={!saidaInput.trim()}
            onClick={() => abrirPopupAlteracao(saidaInput.trim().toUpperCase())}
          >
            <ArrowLeftRight className="mr-2 h-5 w-5" />
            Registrar Alteracao deste Produto
          </Button>
        </CardContent>
      </Card>

      {/* 4. Quick Edit Dialog */}
      <Dialog open={showAlteracaoPopup} onOpenChange={setShowAlteracaoPopup}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Alteracao de Tamanho</DialogTitle>
          </DialogHeader>
          <div className="space-y-6">
            {/* Current SKU display */}
            <div className="text-center">
              <p className="text-sm text-muted-foreground">
                Produto que saiu:
              </p>
              <p className="text-2xl font-mono font-bold text-red-400">
                {popupSaidaSku}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Tamanho atual:{" "}
                <span className="font-bold">
                  {extractSize(popupSaidaSku) || "?"}
                </span>
              </p>
            </div>

            {/* Size selector buttons */}
            <div className="space-y-2">
              <Label>Novo Tamanho</Label>
              <div className="grid grid-cols-5 gap-2">
                {SIZES.map((size) => (
                  <Button
                    key={size}
                    variant={
                      popupNovoTamanho === size ? "default" : "outline"
                    }
                    disabled={size === extractSize(popupSaidaSku)}
                    onClick={() => setPopupNovoTamanho(size)}
                    className={cn(
                      size === extractSize(popupSaidaSku) && "opacity-30"
                    )}
                  >
                    {size}
                  </Button>
                ))}
              </div>
            </div>

            {/* Preview transformation */}
            {popupNovoTamanho && (
              <div className="text-center p-3 bg-slate-800 rounded-lg">
                <span className="text-red-400 font-mono">
                  {popupSaidaSku}
                </span>
                <ArrowRight className="inline mx-2 h-4 w-4" />
                <span className="text-green-400 font-mono">
                  {replaceSize(popupSaidaSku, popupNovoTamanho)}
                </span>
              </div>
            )}

            {/* Quantity +/- */}
            <div className="space-y-2">
              <Label>Quantidade</Label>
              <div className="flex items-center gap-3">
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => setPopupQtd((q) => Math.max(1, q - 1))}
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <Input
                  type="number"
                  value={popupQtd}
                  onChange={(e) =>
                    setPopupQtd(Math.max(1, parseInt(e.target.value) || 1))
                  }
                  className="text-center text-lg font-mono w-20 bg-slate-800 border-slate-600"
                />
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => setPopupQtd((q) => q + 1)}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Package code */}
            <div className="space-y-2">
              <Label>Codigo do Pacote / Etiqueta</Label>
              <Input
                value={popupEtiqueta}
                onChange={(e) => setPopupEtiqueta(e.target.value)}
                placeholder="Bipe ou digite o codigo"
                className="h-12 text-lg font-mono bg-slate-800 border-slate-600"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSalvarAlteracaoRapida();
                }}
              />
            </div>

            {/* Save button */}
            <Button
              className="w-full h-12"
              disabled={
                !popupNovoTamanho || !popupEtiqueta.trim() || isSubmitting
              }
              onClick={handleSalvarAlteracaoRapida}
            >
              {isSubmitting ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : (
                <ArrowLeftRight className="mr-2 h-5 w-5" />
              )}
              {isSubmitting ? "Salvando..." : "Salvar Alteracao"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 5. Upseller Dialog */}
      <Dialog
        open={mostrarPopupUpseller}
        onOpenChange={setMostrarPopupUpseller}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Atualizar Estoque</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Relatorio baixado! Deseja atualizar o estoque no Upseller?
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setMostrarPopupUpseller(false)}
            >
              Nao agora
            </Button>
            <Button
              className="flex-1"
              onClick={() => {
                window.open(
                  "https://app.upseller.com/pt/inventory/list?warehouseId=",
                  "_blank"
                );
                setMostrarPopupUpseller(false);
                sessionStorage.removeItem("stockflow_relatorio_baixado");
              }}
            >
              Abrir Upseller
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
