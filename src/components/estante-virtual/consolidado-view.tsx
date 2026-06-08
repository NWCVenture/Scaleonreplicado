"use client";

// Aba "Consolidado" do Estante Virtual: visão unificada de todas as estantes
// da conta. Carrega /api/estantes/consolidado, renderiza a MatrizView com
// todos os fardos agregados e oferece 3 exports:
//   - CSV cru de todos os fardos (com coluna "Estante" pra rastrear origem).
//   - XLSX pivotado da matriz consolidada (reusa exportarEstanteXlsx).
//   - Upseller XLSX (offset +1000, pausados excluídos, custos por modelo).
//
// O export Upseller emite alertas (sem custo, prefixo desconhecido, sku
// ausente). Mostramos esses alertas num Dialog após o download pra que o
// operador resolva pendências antes de subir o arquivo na Upseller.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  FileDown,
  Loader2,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  sku_ausente: "SKU sem estoque",
  pausado_ignorado: "SKU pausado",
  fora_do_catalogo: "Fora do catálogo",
};

export function ConsolidadoView() {
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [data, setData] = useState<ConsolidadoResp | null>(null);
  const [alertasUpseller, setAlertasUpseller] = useState<AlertaUpseller[]>([]);
  const [alertasOpen, setAlertasOpen] = useState(false);

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

  const downloadCsv = useCallback(() => {
    if (!data || data.fardos.length === 0) return;
    const nomePorEstante = new Map(data.estantes.map((e) => [e.id, e.nome]));
    const header = "Estante,SKU,Lote,Quantidade,Data";
    const rows = data.fardos.map(
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
  }, [data]);

  const downloadXlsxPivotado = useCallback(async () => {
    if (!data || data.fardos.length === 0) return;
    try {
      const agregado = agregarFardos(data.fardos);
      await exportarEstanteXlsx({
        agregado,
        fardosBrutos: data.fardos,
        nomeEstante: "CONSOLIDADO",
      });
    } catch (err) {
      console.error("xlsx pivotado:", err);
      toast.error("Erro ao gerar XLSX");
    }
  }, [data]);

  const downloadUpseller = useCallback(async () => {
    if (!data) return;
    try {
      const resultado = await exportarUpseller({
        fardos: data.fardos,
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
  }, [data]);

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

  const totalFardos = data.fardos.length;
  const totalPecas = data.fardos.reduce((s, f) => s + f.quantidade, 0);
  const numEstantes = data.estantes.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm text-muted-foreground">
          {numEstantes} estante(s) · {totalFardos} fardo(s) ·{" "}
          {totalPecas.toLocaleString("pt-BR")} peças
        </div>
        <div className="flex items-center gap-2">
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
        fardos={data.fardos}
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
