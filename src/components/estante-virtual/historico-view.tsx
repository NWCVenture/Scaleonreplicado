"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ChevronLeft,
  Filter,
  Loader2,
  ArrowUpCircle,
  ArrowDownCircle,
  RefreshCw,
  Upload,
  ClipboardCheck,
  BarChart2,
  History,
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

type MovimentacaoItem = {
  id: string;
  estanteId: string;
  estanteNome: string;
  tipo: string;
  fardoSku: string | null;
  fardoLote: string | null;
  fardoQuantidade: number | null;
  totalAntes: number;
  totalDepois: number;
  totalPecas: number | null;
  usuarioNome: string | null;
  createdAt: string;
};

interface HistoricoViewProps {
  onBack: () => void;
}

const TIPO_FILTERS = [
  { key: "TODOS", label: "Todos", color: "" },
  { key: "SAIDA", label: "Saidas", color: "text-red-600" },
  { key: "ENTRADA", label: "Entradas", color: "text-green-600" },
  { key: "IMPORTACAO", label: "Importacoes", color: "text-amber-600" },
  { key: "BALANCO", label: "Balancos", color: "text-indigo-600" },
] as const;

function getTipoBadgeClasses(tipo: string) {
  switch (tipo) {
    case "ENTRADA":
      return "bg-green-950 text-green-200";
    case "SAIDA":
      return "bg-red-950 text-red-200";
    case "BIPAGEM_SEMANAL":
      return "bg-blue-950 text-blue-200";
    case "IMPORTACAO":
      return "bg-green-950 text-green-300";
    case "BALANCO":
      return "bg-indigo-950 text-indigo-200";
    default:
      return "bg-slate-800 text-slate-200";
  }
}

function getTipoIcon(tipo: string) {
  switch (tipo) {
    case "ENTRADA":
      return <ArrowDownCircle className="h-4 w-4 text-green-500 shrink-0" />;
    case "SAIDA":
      return <ArrowUpCircle className="h-4 w-4 text-red-500 shrink-0" />;
    case "BIPAGEM_SEMANAL":
      return <RefreshCw className="h-4 w-4 text-blue-500 shrink-0" />;
    case "IMPORTACAO":
      return <Upload className="h-4 w-4 text-amber-500 shrink-0" />;
    case "BALANCO":
      return <ClipboardCheck className="h-4 w-4 text-indigo-500 shrink-0" />;
    default:
      return null;
  }
}

function getTipoLabel(tipo: string) {
  switch (tipo) {
    case "ENTRADA":
      return "ENTRADA";
    case "SAIDA":
      return "SAIDA";
    case "BIPAGEM_SEMANAL":
      return "BIPAGEM";
    case "IMPORTACAO":
      return "IMPORTACAO";
    case "BALANCO":
      return "BALANCO";
    default:
      return tipo;
  }
}

function getRowClasses(tipo: string) {
  switch (tipo) {
    case "SAIDA":
      return "border-red-900 bg-red-950/20";
    case "ENTRADA":
      return "border-green-900 bg-green-950/20";
    case "BALANCO":
      return "border-indigo-900 bg-indigo-950/20";
    default:
      return "border-slate-700";
  }
}

export function HistoricoView({ onBack }: HistoricoViewProps) {
  const [movimentacoes, setMovimentacoes] = useState<MovimentacaoItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filtroTipo, setFiltroTipo] = useState<string>("TODOS");
  const [filtroData, setFiltroData] = useState("");

  const fetchMovimentacoes = async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (filtroTipo !== "TODOS") params.set("tipo", filtroTipo);
      if (filtroData) params.set("data", filtroData);
      const res = await fetch(
        `/api/estantes/movimentacoes?${params.toString()}`,
      );
      if (!res.ok) throw new Error("Erro ao buscar movimentacoes");
      const data = await res.json();
      setMovimentacoes(data.movimentacoes ?? []);
    } catch (error) {
      console.error("Erro ao carregar movimentacoes:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchMovimentacoes();
  }, [filtroTipo, filtroData]);

  // Daily summary
  const resumoDiario: Record<string, { saidas: number; entradas: number }> = {};
  const relevantes =
    filtroTipo === "TODOS" || filtroTipo === "SAIDA" || filtroTipo === "ENTRADA"
      ? movimentacoes
      : [];
  relevantes.forEach((m) => {
    const dia = new Date(m.createdAt).toLocaleDateString("pt-BR");
    if (!resumoDiario[dia]) resumoDiario[dia] = { saidas: 0, entradas: 0 };
    if (m.tipo === "SAIDA") resumoDiario[dia].saidas++;
    if (m.tipo === "ENTRADA" || m.tipo === "IMPORTACAO")
      resumoDiario[dia].entradas++;
  });
  const diasOrdenados = Object.keys(resumoDiario).sort((a, b) => {
    const [da, ma, ya] = a.split("/").map(Number);
    const [db, mb, yb] = b.split("/").map(Number);
    return (
      new Date(yb, mb - 1, db).getTime() - new Date(ya, ma - 1, da).getTime()
    );
  });

  const filteredMovs =
    filtroTipo === "TODOS"
      ? movimentacoes
      : movimentacoes.filter((m) => m.tipo === filtroTipo);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">Historico de Movimentacoes</h1>
          <p className="text-sm text-muted-foreground">
            {filteredMovs.length} de {movimentacoes.length} registros
          </p>
        </div>
      </div>

      {/* Date filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <Input
          type="date"
          value={filtroData}
          onChange={(e) => setFiltroData(e.target.value)}
          className="h-8 w-auto bg-slate-800 border-slate-600 text-sm"
        />
        {filtroData && (
          <button
            onClick={() => setFiltroData("")}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Limpar data
          </button>
        )}
      </div>

      {/* Type filter pills */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        {TIPO_FILTERS.map(({ key, label, color }) => (
          <button
            key={key}
            onClick={() => setFiltroTipo(key)}
            className={cn(
              "text-xs px-3 py-1 rounded-full border transition-colors",
              filtroTipo === key
                ? "bg-foreground text-background border-foreground"
                : cn("border-slate-700 hover:bg-slate-800", color),
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Daily summary */}
      {diasOrdenados.length > 0 &&
        (filtroTipo === "TODOS" ||
          filtroTipo === "SAIDA" ||
          filtroTipo === "ENTRADA") && (
          <div className="border border-slate-700 rounded-xl p-4 bg-slate-800/30">
            <div className="flex items-center gap-2 mb-3">
              <BarChart2 className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {filtroData
                  ? `Resumo do dia ${new Date(filtroData + "T12:00:00").toLocaleDateString("pt-BR")}`
                  : "Resumo por dia"}
              </span>
            </div>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {diasOrdenados.slice(0, 14).map((dia) => {
                const r = resumoDiario[dia];
                return (
                  <div
                    key={dia}
                    className="flex items-center justify-between text-xs"
                  >
                    <span className="text-muted-foreground font-medium w-24 shrink-0">
                      {dia}
                    </span>
                    <div className="flex gap-4">
                      <span className="flex items-center gap-1 text-red-400 font-semibold">
                        <ArrowUpCircle className="h-3 w-3" /> {r.saidas}{" "}
                        saida(s)
                      </span>
                      <span className="flex items-center gap-1 text-green-400 font-semibold">
                        <ArrowDownCircle className="h-3 w-3" /> {r.entradas}{" "}
                        entrada(s)
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

      {/* Loading */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filteredMovs.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <History className="h-12 w-12 text-muted-foreground/20 mb-3" />
          <p className="text-muted-foreground">
            Nenhuma movimentacao encontrada
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredMovs.slice(0, 200).map((mov) => (
            <div
              key={mov.id}
              className={cn("border rounded-lg p-3", getRowClasses(mov.tipo))}
            >
              <div className="flex items-center justify-between mb-1 flex-wrap gap-1">
                <div className="flex items-center gap-2 flex-wrap">
                  {getTipoIcon(mov.tipo)}
                  <span
                    className={cn(
                      "text-xs font-bold px-1.5 py-0.5 rounded",
                      getTipoBadgeClasses(mov.tipo),
                    )}
                  >
                    {getTipoLabel(mov.tipo)}
                  </span>
                  <span className="text-sm font-medium">
                    {mov.estanteNome}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {formatDate(mov.createdAt)}
                </span>
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                {mov.fardoSku && (
                  <span
                    className={cn(
                      "font-mono font-semibold",
                      mov.tipo === "SAIDA"
                        ? "text-red-300"
                        : "text-foreground",
                    )}
                  >
                    {mov.fardoSku}
                    {mov.fardoLote ? ` | ${mov.fardoLote}` : ""}
                    {mov.fardoQuantidade ? ` | ${mov.fardoQuantidade} un` : ""}
                  </span>
                )}
                {mov.tipo === "BALANCO" ? (
                  <span className="font-semibold text-indigo-300">
                    {mov.totalDepois} fardos - {mov.totalPecas ?? "?"} pecas
                  </span>
                ) : (
                  <span>
                    {mov.totalAntes} → {mov.totalDepois} fardos
                  </span>
                )}
                {mov.usuarioNome && <span>{mov.usuarioNome}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
