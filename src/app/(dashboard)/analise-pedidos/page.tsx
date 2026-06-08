"use client";

import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  BarChart3,
  Upload,
  FileSpreadsheet,
  CalendarRange,
  Download,
  AlertCircle,
  RefreshCw,
  ChevronDown,
  X,
} from "lucide-react";
import type { DateRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { PageHeader } from "@/components/layout/page-header";
import { cn } from "@/lib/utils";

import {
  parseUpsellerWorkbook,
  agrupar,
  type ParseResult,
  type Resultado,
} from "@/lib/analise-pedidos/parser";
import { gerarXlsxExportacao } from "@/lib/analise-pedidos/export";

const ESTADOS_DEFAULT = ["Enviado", "Retirada"];
const PRESETS: { label: string; dias: number }[] = [
  { label: "7d", dias: 7 },
  { label: "15d", dias: 15 },
  { label: "30d", dias: 30 },
];

function diaInicio(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}
function diaFim(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}
function fmt(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}
function downloadArrayBuffer(buf: ArrayBuffer, fileName: string) {
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function AnalisePedidosPage() {
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [intervalo, setIntervalo] = useState<{ de: Date; ate: Date } | null>(
    null
  );
  const [estados, setEstados] = useState<Set<string>>(new Set());
  const [rangeDialogAberto, setRangeDialogAberto] = useState(false);
  const [rangeTemp, setRangeTemp] = useState<DateRange | undefined>(undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function aplicarPreset(dias: number) {
    if (!parsed?.periodoDisponivel) return;
    const ate = diaFim(parsed.periodoDisponivel.max);
    const baseInicio = new Date(parsed.periodoDisponivel.max);
    baseInicio.setDate(baseInicio.getDate() - (dias - 1));
    const min = diaInicio(parsed.periodoDisponivel.min);
    const de = diaInicio(baseInicio) < min ? min : diaInicio(baseInicio);
    setIntervalo({ de, ate });
  }

  function aplicarTudo() {
    if (!parsed?.periodoDisponivel) return;
    setIntervalo({
      de: diaInicio(parsed.periodoDisponivel.min),
      ate: diaFim(parsed.periodoDisponivel.max),
    });
  }

  function resetar() {
    setFile(null);
    setParsed(null);
    setIntervalo(null);
    setEstados(new Set());
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setParsing(true);
    setParsed(null);
    setIntervalo(null);
    try {
      const buffer = await f.arrayBuffer();
      const result = parseUpsellerWorkbook(buffer);
      if (!result.periodoDisponivel || result.linhas.length === 0) {
        toast.error("Nenhuma linha válida encontrada na planilha.");
        return;
      }
      setParsed(result);
      const estadosIniciais = new Set(
        ESTADOS_DEFAULT.filter((s) => result.estadosDistintos.includes(s))
      );
      if (estadosIniciais.size === 0) {
        result.estadosDistintos.forEach((s) => estadosIniciais.add(s));
      }
      setEstados(estadosIniciais);
      const ate = diaFim(result.periodoDisponivel.max);
      const baseInicio = new Date(result.periodoDisponivel.max);
      baseInicio.setDate(baseInicio.getDate() - 6);
      const min = diaInicio(result.periodoDisponivel.min);
      const de = diaInicio(baseInicio) < min ? min : diaInicio(baseInicio);
      setIntervalo({ de, ate });
      toast.success(
        `${result.linhas.length} linhas carregadas. Período: ${fmt(result.periodoDisponivel.min)} a ${fmt(result.periodoDisponivel.max)}.`
      );
      if (result.avisos.length > 0) {
        toast.warning(result.avisos.join(" / "));
      }
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Erro ao ler planilha: ${msg}`);
    } finally {
      setParsing(false);
    }
  }

  const resultado: Resultado | null = useMemo(() => {
    if (!parsed || !intervalo) return null;
    return agrupar(parsed.linhas, {
      de: intervalo.de,
      ate: intervalo.ate,
      estados,
    });
  }, [parsed, intervalo, estados]);

  function toggleEstado(estado: string) {
    setEstados((prev) => {
      const next = new Set(prev);
      if (next.has(estado)) next.delete(estado);
      else next.add(estado);
      return next;
    });
  }

  function exportar() {
    if (!resultado || !intervalo || !parsed) return;
    try {
      const buffer = gerarXlsxExportacao(resultado, {
        de: intervalo.de,
        ate: intervalo.ate,
        estados: [...estados].sort(),
        totalLinhasOriginal: parsed.linhas.length,
      });
      const stamp = new Date().getTime();
      downloadArrayBuffer(buffer, `analise-pedidos-${stamp}.xlsx`);
      toast.success("Planilha exportada.");
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Erro ao exportar: ${msg}`);
    }
  }

  function abrirRangeDialog() {
    if (!parsed?.periodoDisponivel || !intervalo) return;
    setRangeTemp({ from: intervalo.de, to: intervalo.ate });
    setRangeDialogAberto(true);
  }

  function confirmarRange() {
    if (rangeTemp?.from && rangeTemp.to) {
      setIntervalo({ de: diaInicio(rangeTemp.from), ate: diaFim(rangeTemp.to) });
      setRangeDialogAberto(false);
    } else if (rangeTemp?.from && !rangeTemp.to) {
      setIntervalo({
        de: diaInicio(rangeTemp.from),
        ate: diaFim(rangeTemp.from),
      });
      setRangeDialogAberto(false);
    } else {
      toast.error("Selecione ao menos uma data.");
    }
  }

  function isPresetAtivo(dias: number): boolean {
    if (!intervalo || !parsed?.periodoDisponivel) return false;
    const ate = diaFim(parsed.periodoDisponivel.max);
    if (intervalo.ate.getTime() !== ate.getTime()) return false;
    const baseInicio = new Date(parsed.periodoDisponivel.max);
    baseInicio.setDate(baseInicio.getDate() - (dias - 1));
    const min = diaInicio(parsed.periodoDisponivel.min);
    const de = diaInicio(baseInicio) < min ? min : diaInicio(baseInicio);
    return intervalo.de.getTime() === de.getTime();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Análise de Pedidos"
        description="Suba a exportação de pedidos recentes da Upseller e analise saídas por cor e tamanho para planejar compras de tecido."
        icon={<BarChart3 className="h-8 w-8 text-primary" />}
      />

      {!parsed ? (
        <Card>
          <CardContent className="p-6">
            <div
              className={cn(
                "border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors",
                file
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25 hover:border-primary/50"
              )}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept=".xlsx"
                onChange={handleFileChange}
              />
              {parsing ? (
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <RefreshCw className="h-10 w-10 animate-spin" />
                  <span className="text-sm">Lendo planilha…</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <Upload className="h-10 w-10" />
                  <span className="text-sm">
                    Clique para selecionar o arquivo .xlsx exportado da
                    Upseller
                  </span>
                  <span className="text-xs">
                    Pedidos recentes — últimos 90 dias
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="sticky top-2 z-30 backdrop-blur bg-card/95 shadow-sm">
          <CardContent className="p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-primary/5 border border-primary/20 min-w-0">
                <FileSpreadsheet className="h-4 w-4 text-primary shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs font-medium truncate max-w-[220px]">
                    {file?.name ?? "planilha.xlsx"}
                  </div>
                  <div className="text-[11px] text-muted-foreground tabular-nums">
                    {fmt(parsed.periodoDisponivel!.min)} →{" "}
                    {fmt(parsed.periodoDisponivel!.max)} ·{" "}
                    {parsed.linhas.length.toLocaleString("pt-BR")} linhas
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 ml-1"
                  onClick={resetar}
                  title="Trocar arquivo"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>

              <div className="h-8 w-px bg-border" />

              <div className="flex items-center gap-1">
                {PRESETS.map((p) => (
                  <Button
                    key={p.dias}
                    variant={isPresetAtivo(p.dias) ? "default" : "outline"}
                    size="sm"
                    className="h-8 px-2.5"
                    onClick={() => aplicarPreset(p.dias)}
                  >
                    {p.label}
                  </Button>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-2.5"
                  onClick={aplicarTudo}
                >
                  Tudo
                </Button>
              </div>

              <Dialog
                open={rangeDialogAberto}
                onOpenChange={setRangeDialogAberto}
              >
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    onClick={abrirRangeDialog}
                  >
                    <CalendarRange className="h-3.5 w-3.5 mr-1.5" />
                    {intervalo
                      ? `${fmt(intervalo.de)} → ${fmt(intervalo.ate)}`
                      : "Período"}
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-fit">
                  <DialogHeader>
                    <DialogTitle>Escolha o intervalo</DialogTitle>
                  </DialogHeader>
                  <div className="flex justify-center">
                    <Calendar
                      mode="range"
                      numberOfMonths={2}
                      selected={rangeTemp}
                      onSelect={setRangeTemp}
                      defaultMonth={intervalo?.de}
                      disabled={{
                        before: parsed.periodoDisponivel!.min,
                        after: parsed.periodoDisponivel!.max,
                      }}
                    />
                  </div>
                  <DialogFooter>
                    <Button
                      variant="ghost"
                      onClick={() => setRangeDialogAberto(false)}
                    >
                      Cancelar
                    </Button>
                    <Button onClick={confirmarRange}>Aplicar</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <div className="h-8 w-px bg-border" />

              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8">
                    Estados:{" "}
                    <span className="font-semibold ml-1">
                      {estados.size}/{parsed.estadosDistintos.length}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 ml-1.5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-3" align="start">
                  <div className="text-xs text-muted-foreground mb-2">
                    Considere como saída efetiva:
                  </div>
                  <div className="space-y-2 max-h-72 overflow-y-auto">
                    {parsed.estadosDistintos.map((estado) => (
                      <label
                        key={estado}
                        className="flex items-center gap-2 cursor-pointer text-sm hover:bg-muted/40 rounded px-1 py-0.5"
                      >
                        <Checkbox
                          checked={estados.has(estado)}
                          onCheckedChange={() => toggleEstado(estado)}
                        />
                        <span>{estado}</span>
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-2 mt-3 pt-2 border-t">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs flex-1"
                      onClick={() =>
                        setEstados(new Set(parsed.estadosDistintos))
                      }
                    >
                      Todos
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs flex-1"
                      onClick={() =>
                        setEstados(
                          new Set(
                            ESTADOS_DEFAULT.filter((s) =>
                              parsed.estadosDistintos.includes(s)
                            )
                          )
                        )
                      }
                    >
                      Padrão
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs flex-1"
                      onClick={() => setEstados(new Set())}
                    >
                      Limpar
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>

              <div className="ml-auto">
                <Button
                  size="sm"
                  className="h-8"
                  onClick={exportar}
                  disabled={!resultado || resultado.totalItens === 0}
                >
                  <Download className="h-3.5 w-3.5 mr-1.5" /> Exportar XLSX
                </Button>
              </div>
            </div>

            {parsed.avisos.length > 0 && (
              <div className="mt-2 flex items-start gap-2 text-[11px] text-amber-700 dark:text-amber-300">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <div>{parsed.avisos.join(" · ")}</div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {resultado && parsed && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard label="Pedidos" valor={resultado.totalPedidos} />
            <KpiCard
              label="Itens (kits expandidos)"
              valor={resultado.totalItens}
            />
            <KpiCard label="SKUs distintos" valor={resultado.totalSkus} />
            <KpiCard
              label="Estados selecionados"
              valor={estados.size}
              detalhe={[...estados].sort().join(", ") || "—"}
            />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <Card className="xl:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Matriz Cor × Tamanho</CardTitle>
                <CardDescription>
                  Unidades efetivamente saídas no período/estado selecionados.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {resultado.matriz.linhas.length === 0 ? (
                  <EmptyState />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2 px-3 font-medium">
                            Cor
                          </th>
                          {resultado.matriz.tamanhos.map((t) => (
                            <th
                              key={t}
                              className="text-right py-2 px-3 font-medium"
                            >
                              {t}
                            </th>
                          ))}
                          <th className="text-right py-2 px-3 font-bold">
                            Total
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {resultado.matriz.linhas.map((l) => (
                          <tr key={l.cor} className="border-b hover:bg-muted/40">
                            <td className="py-2 px-3 font-medium">{l.cor}</td>
                            {resultado.matriz.tamanhos.map((t) => (
                              <td
                                key={t}
                                className="text-right py-2 px-3 tabular-nums"
                              >
                                {l.porTamanho[t] || ""}
                              </td>
                            ))}
                            <td className="text-right py-2 px-3 font-bold tabular-nums">
                              {l.total}
                            </td>
                          </tr>
                        ))}
                        <tr className="bg-muted/60">
                          <td className="py-2 px-3 font-bold">Total</td>
                          {resultado.matriz.tamanhos.map((t) => (
                            <td
                              key={t}
                              className="text-right py-2 px-3 font-bold tabular-nums"
                            >
                              {resultado.matriz.totalPorTamanho[t] || 0}
                            </td>
                          ))}
                          <td className="text-right py-2 px-3 font-bold tabular-nums">
                            {resultado.matriz.totalGeral}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="space-y-4">
              <RankingCard
                titulo="Top Cores"
                itens={resultado.topCores.slice(0, 10)}
              />
              <RankingCard titulo="Top Tamanhos" itens={resultado.topTamanhos} />
            </div>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Por SKU</CardTitle>
              <CardDescription>
                Ordenado por quantidade de itens (kits expandidos).
              </CardDescription>
            </CardHeader>
            <CardContent>
              {resultado.porSku.length === 0 ? (
                <EmptyState />
              ) : (
                <div className="overflow-x-auto max-h-[460px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-background border-b z-10">
                      <tr>
                        <th className="text-left py-2 px-3 font-medium">SKU</th>
                        <th className="text-left py-2 px-3 font-medium">
                          Anúncio
                        </th>
                        <th className="text-right py-2 px-3 font-medium">
                          Pedidos
                        </th>
                        <th className="text-right py-2 px-3 font-medium">
                          Itens
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {resultado.porSku.map((s) => (
                        <tr
                          key={s.sku}
                          className="border-b hover:bg-muted/40 align-top"
                        >
                          <td className="py-2 px-3 font-mono text-xs">
                            {s.sku}
                          </td>
                          <td className="py-2 px-3 text-xs max-w-[420px]">
                            {s.nomeAnuncio}
                          </td>
                          <td className="text-right py-2 px-3 tabular-nums">
                            {s.qtdPedidos}
                          </td>
                          <td className="text-right py-2 px-3 tabular-nums font-medium">
                            {s.qtdItens}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function KpiCard({
  label,
  valor,
  detalhe,
}: {
  label: string;
  valor: number;
  detalhe?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground uppercase tracking-wide">
          {label}
        </div>
        <div className="text-2xl font-bold tabular-nums mt-1">
          {valor.toLocaleString("pt-BR")}
        </div>
        {detalhe && (
          <div className="text-[11px] text-muted-foreground mt-1 truncate">
            {detalhe}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RankingCard({
  titulo,
  itens,
}: {
  titulo: string;
  itens: { nome: string; qtd: number; pct: number }[];
}) {
  const max = itens[0]?.qtd ?? 0;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{titulo}</CardTitle>
      </CardHeader>
      <CardContent>
        {itens.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="space-y-2">
            {itens.map((i) => (
              <li key={i.nome} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="font-medium">{i.nome}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {i.qtd.toLocaleString("pt-BR")} · {i.pct.toFixed(1)}%
                  </span>
                </div>
                <div className="h-2 bg-muted rounded overflow-hidden">
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${max ? (i.qtd / max) * 100 : 0}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <div className="text-sm text-muted-foreground py-6 text-center">
      Nenhum dado para os filtros atuais.
    </div>
  );
}
