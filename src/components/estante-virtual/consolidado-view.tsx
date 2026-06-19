"use client";

// Aba "Consolidado" do Estante Virtual: visão unificada de todas as estantes
// da conta. Carrega /api/estantes/consolidado, renderiza a MatrizView com
// todos os fardos agregados e oferece 3 exports:
//   - CSV cru de todos os fardos (com coluna "Estante" pra rastrear origem).
//   - XLSX pivotado da matriz consolidada (reusa exportarEstanteXlsx).
//   - Upseller XLSX (offset +1000, pausados excluídos, custos por modelo).
//
// Um seletor de estantes (multi-select) deixa o operador excluir estantes de
// controle específicas (ex.: estantes com SKUs anômalos PP/P1/P2/P MEDIO) da
// visão e dos exports sem precisar mexer em cadastro.
//
// O export Upseller emite alertas (sem custo, prefixo desconhecido, pausado
// ignorado, fora do catálogo). Mostramos esses alertas num Dialog após o
// download pra que o operador resolva pendências antes de subir o arquivo.

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  FileDown,
  Filter,
  Loader2,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { agregarFardos } from "@/lib/estante-virtual/agregar";
import { exportarEstanteXlsx } from "@/lib/estante-virtual/exportar-xlsx";
import {
  exportarUpseller,
  type AlertaUpseller,
  type ModeloUpseller,
  type SkuCatalogoUpseller,
} from "@/lib/estante-virtual/exportar-upseller";
import { formatDate } from "@/lib/utils";
import { MatrizView } from "./matriz-view";

type EstanteRef = { id: string; nome: string };

type FardoBruto = {
  id: string;
  estanteId: string;
  qrCode: string;
  sku: string;
  lote: string;
  quantidade: number;
  adicionadoPor: string;
  createdAt: string;
};

type ConsolidadoResp = {
  estantes: EstanteRef[];
  fardos: FardoBruto[];
  modelos: ModeloUpseller[];
  skus: SkuCatalogoUpseller[];
};

const ROTULO_ALERTA: Record<AlertaUpseller["tipo"], string> = {
  sem_custo: "Sem custo cadastrado",
  prefixo_desconhecido: "Prefixo desconhecido",
  pausado_ignorado: "SKU pausado",
  fora_do_catalogo: "Fora do catálogo",
};

export function ConsolidadoView() {
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [data, setData] = useState<ConsolidadoResp | null>(null);
  const [alertasUpseller, setAlertasUpseller] = useState<AlertaUpseller[]>([]);
  const [alertasOpen, setAlertasOpen] = useState(false);
  // null = ainda não inicializado (default = todas as estantes); um Set vazio
  // significa deliberadamente nenhuma estante selecionada.
  const [estantesIncluidas, setEstantesIncluidas] = useState<Set<string> | null>(
    null,
  );

  const fetchConsolidado = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const r = await fetch("/api/estantes/consolidado", {
        cache: "no-store",
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = (await r.json()) as ConsolidadoResp;
      setData(json);
      setEstantesIncluidas(new Set(json.estantes.map((e) => e.id)));
    } catch (err) {
      console.error("consolidado:", err);
      setErro((err as Error).message);
      toast.error("Falha ao carregar dados consolidados");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConsolidado();
  }, [fetchConsolidado]);

  // Resumo por estante: usado pelo seletor pra mostrar fardo/peça por linha.
  const resumoPorEstante = useMemo(() => {
    const map = new Map<string, { fardos: number; pecas: number }>();
    if (!data) return map;
    for (const f of data.fardos) {
      const r = map.get(f.estanteId) ?? { fardos: 0, pecas: 0 };
      r.fardos++;
      r.pecas += f.quantidade;
      map.set(f.estanteId, r);
    }
    return map;
  }, [data]);

  // Fardos efetivamente considerados após o filtro de estantes. Em todos os
  // exports e na MatrizView usamos essa lista, não data.fardos cru.
  const fardosFiltrados = useMemo(() => {
    if (!data) return [];
    if (!estantesIncluidas) return data.fardos;
    return data.fardos.filter((f) => estantesIncluidas.has(f.estanteId));
  }, [data, estantesIncluidas]);

  const toggleEstante = useCallback((id: string) => {
    setEstantesIncluidas((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selecionarTodas = useCallback(() => {
    if (!data) return;
    setEstantesIncluidas(new Set(data.estantes.map((e) => e.id)));
  }, [data]);

  const limparSelecao = useCallback(() => {
    setEstantesIncluidas(new Set());
  }, []);

  const downloadCsv = useCallback(() => {
    if (!data || fardosFiltrados.length === 0) return;
    const nomePorEstante = new Map(data.estantes.map((e) => [e.id, e.nome]));
    const header = "Estante,SKU,Lote,Quantidade,Data";
    const rows = fardosFiltrados.map(
      (f) =>
        `"${nomePorEstante.get(f.estanteId) ?? "?"}","${f.sku}","${f.lote}",${f.quantidade},"${formatDate(f.createdAt)}"`,
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob(["﻿" + csv], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `estante_consolidado_${new Date().toLocaleDateString("pt-BR").replace(/\//g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [data, fardosFiltrados]);

  const downloadXlsxPivotado = useCallback(async () => {
    if (!data || fardosFiltrados.length === 0) return;
    try {
      const agregado = agregarFardos(fardosFiltrados);
      await exportarEstanteXlsx({
        agregado,
        fardosBrutos: fardosFiltrados,
        nomeEstante: "CONSOLIDADO",
      });
    } catch (err) {
      console.error("xlsx pivotado:", err);
      toast.error("Erro ao gerar XLSX");
    }
  }, [data, fardosFiltrados]);

  const downloadUpseller = useCallback(async () => {
    if (!data) return;
    try {
      const resultado = await exportarUpseller({
        fardos: fardosFiltrados,
        skusCatalogo: data.skus,
        modelos: data.modelos,
        escopo: "modulo",
      });
      if (resultado.alertas.length > 0) {
        setAlertasUpseller(resultado.alertas);
        setAlertasOpen(true);
      }
      toast.success(
        `Update_warehouse gerado · ${resultado.linhasExportadas} SKU(s)` +
          (resultado.alertas.length > 0
            ? ` · ${resultado.alertas.length} alerta(s)`
            : ""),
      );
    } catch (err) {
      console.error("upseller:", err);
      toast.error("Erro ao gerar XLSX da Upseller");
    }
  }, [data, fardosFiltrados]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (erro || !data) {
    return (
      <div className="flex flex-col items-center py-16 text-center">
        <AlertTriangle className="h-10 w-10 text-destructive/60 mb-3" />
        <p className="text-sm text-muted-foreground">
          Erro ao carregar dados consolidados.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={fetchConsolidado}
        >
          <RefreshCw className="h-4 w-4 mr-2" /> Tentar novamente
        </Button>
      </div>
    );
  }

  const totalFardos = fardosFiltrados.length;
  const totalPecas = fardosFiltrados.reduce((s, f) => s + f.quantidade, 0);
  const numSelecionadas = estantesIncluidas?.size ?? data.estantes.length;
  const totalEstantes = data.estantes.length;
  const estantesOrdenadas = [...data.estantes].sort((a, b) =>
    a.nome.localeCompare(b.nome, "pt-BR"),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm text-muted-foreground">
          {numSelecionadas} de {totalEstantes} estante(s) · {totalFardos}{" "}
          fardo(s) · {totalPecas.toLocaleString("pt-BR")} peças
        </div>
        <div className="flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5"
              >
                <Filter className="h-3.5 w-3.5" /> Estantes ({numSelecionadas}/
                {totalEstantes})
                <ChevronDown className="h-3 w-3" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-0">
              <div className="flex items-center justify-between px-3 py-2 border-b">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Incluir estantes
                </span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={selecionarTodas}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Todas
                  </button>
                  <span className="text-xs text-muted-foreground">·</span>
                  <button
                    type="button"
                    onClick={limparSelecao}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Nenhuma
                  </button>
                </div>
              </div>
              <div className="max-h-80 overflow-y-auto py-1">
                {estantesOrdenadas.map((e) => {
                  const resumo = resumoPorEstante.get(e.id);
                  const marcada = estantesIncluidas?.has(e.id) ?? true;
                  return (
                    <label
                      key={e.id}
                      className="flex items-center gap-2 px-3 py-1.5 hover:bg-accent cursor-pointer"
                    >
                      <Checkbox
                        checked={marcada}
                        onCheckedChange={() => toggleEstante(e.id)}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{e.nome}</div>
                        <div className="text-xs text-muted-foreground">
                          {resumo
                            ? `${resumo.fardos} fardo(s) · ${resumo.pecas.toLocaleString("pt-BR")} peças`
                            : "vazia"}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchConsolidado}
            className="h-7 text-xs gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Atualizar
          </Button>
          {totalFardos > 0 && (
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
                <DropdownMenuItem onClick={downloadCsv}>
                  CSV (cru)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={downloadXlsxPivotado}>
                  XLSX (pivotado)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={downloadUpseller}>
                  Upseller (.xlsx)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <MatrizView
        fardos={fardosFiltrados}
        nomeEstante="CONSOLIDADO"
        ultimaBipagem={null}
      />

      <Dialog open={alertasOpen} onOpenChange={setAlertasOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" /> Alertas do
              Export Upseller
            </DialogTitle>
            <DialogDescription>
              {alertasUpseller.length} pendência(s) detectada(s). Revise antes
              de importar na Upseller.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto space-y-2">
            {alertasUpseller.map((a, i) => (
              <div
                key={i}
                className="border border-yellow-700/50 bg-yellow-950/30 rounded-md px-3 py-2 text-sm"
              >
                <div className="flex items-center gap-2 text-yellow-200 font-medium">
                  <span className="text-xs uppercase tracking-wide">
                    {ROTULO_ALERTA[a.tipo]}
                  </span>
                </div>
                <p className="text-yellow-100/80 mt-0.5">{a.mensagem}</p>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button onClick={() => setAlertasOpen(false)}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
