"use client";

// Card que substitui o antigo "Caixas a consolidar" na MatrizView. Consome o
// último import de /api/analise-pedidos/import e cruza com o estoque atual da
// estante pra dar uma noção de giro. 2 barras simples (estoque × média/dia),
// período ajustável (default 14d), e cobertura em dias como texto auxiliar.

import { useEffect, useMemo, useState } from "react";
import { Loader2, TrendingDown, ExternalLink } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { rehidratarLinhas } from "@/lib/analise-pedidos/rehidratar";
import type { LinhaPedido } from "@/lib/analise-pedidos/parser";
import {
  calcularMediaVendas,
  coberturaDias,
  type PresetGiro,
} from "@/lib/estante-virtual/giro";
import { cn } from "@/lib/utils";

const PRESETS: { label: string; value: PresetGiro }[] = [
  { label: "7d", value: 7 },
  { label: "14d", value: 14 },
  { label: "30d", value: 30 },
  { label: "Tudo", value: "tudo" },
];
// Estados que contam como "saída efetiva" do estoque, igual ao default da
// página de análise. Quando o CSV não tiver nenhum desses, caímos pra "todos".
const ESTADOS_PADRAO = ["Enviado", "Retirada"];

interface ImportPayload {
  nomeArquivo: string;
  periodoMin: string;
  periodoMax: string;
  estadosDistintos: string[];
  linhas: unknown[];
}

interface EstoqueVsVendasProps {
  totalPecasEstante: number;
}

export function EstoqueVsVendasCard({ totalPecasEstante }: EstoqueVsVendasProps) {
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [importMeta, setImportMeta] = useState<{
    nomeArquivo: string;
    periodoMin: Date;
    periodoMax: Date;
    estadosDistintos: string[];
  } | null>(null);
  const [linhas, setLinhas] = useState<LinhaPedido[]>([]);
  const [preset, setPreset] = useState<PresetGiro>(14);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const res = await fetch("/api/analise-pedidos/import");
        if (!res.ok) {
          if (!cancelado) setErro("Falha ao carregar dados de vendas.");
          return;
        }
        const data = await res.json();
        const reg = data.import as ImportPayload | null;
        if (cancelado) return;
        if (!reg) {
          setImportMeta(null);
          setLinhas([]);
          return;
        }
        setImportMeta({
          nomeArquivo: reg.nomeArquivo,
          periodoMin: new Date(reg.periodoMin),
          periodoMax: new Date(reg.periodoMax),
          estadosDistintos: reg.estadosDistintos,
        });
        setLinhas(rehidratarLinhas(reg.linhas));
      } catch {
        if (!cancelado) setErro("Falha ao carregar dados de vendas.");
      } finally {
        if (!cancelado) setCarregando(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  const estadosFiltro = useMemo(() => {
    if (!importMeta) return new Set<string>();
    const aplicaveis = ESTADOS_PADRAO.filter((e) =>
      importMeta.estadosDistintos.includes(e),
    );
    // Sem nenhum dos defaults presentes no CSV → não filtra (libera tudo).
    return new Set(aplicaveis);
  }, [importMeta]);

  const media = useMemo(() => {
    if (!importMeta) return null;
    return calcularMediaVendas(linhas, {
      periodoMin: importMeta.periodoMin,
      periodoMax: importMeta.periodoMax,
      preset,
      estados: estadosFiltro,
    });
  }, [importMeta, linhas, preset, estadosFiltro]);

  const cobertura = media ? coberturaDias(totalPecasEstante, media.mediaPorDia) : null;

  return (
    <div>
      <div className="flex items-end justify-between gap-3 mb-2 flex-wrap">
        <div>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Estoque × Média de vendas
          </h2>
          {importMeta && (
            <p className="text-[11px] text-muted-foreground/70 mt-0.5 tabular-nums">
              Fonte: {importMeta.nomeArquivo} · CSV {fmtData(importMeta.periodoMin)} → {fmtData(importMeta.periodoMax)}
            </p>
          )}
        </div>
        {importMeta && (
          <div className="flex gap-1">
            {PRESETS.map((p) => (
              <button
                key={String(p.value)}
                type="button"
                onClick={() => setPreset(p.value)}
                className={cn(
                  "h-7 px-2.5 text-xs rounded border",
                  preset === p.value
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-slate-700 text-slate-300 hover:bg-slate-800",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {carregando ? (
        <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground border border-slate-700 rounded-lg">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando dados de vendas…
        </div>
      ) : erro ? (
        <div className="px-4 py-4 text-sm text-red-300/80 border border-red-900/60 bg-red-950/20 rounded-lg">
          {erro}
        </div>
      ) : !importMeta ? (
        <div className="flex items-center justify-between gap-3 px-4 py-4 text-sm border border-slate-700 rounded-lg">
          <span className="text-muted-foreground">
            Nenhum CSV importado em <span className="font-mono">/analise-pedidos</span>.
          </span>
          <a
            href="/analise-pedidos"
            className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
          >
            Ir para Análise de Pedidos
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      ) : media ? (
        <EstoqueVsVendasGrafico
          totalPecasEstante={totalPecasEstante}
          mediaPorDia={media.mediaPorDia}
          totalItensPeriodo={media.totalItens}
          dias={media.periodo.dias}
          cobertura={cobertura ?? Infinity}
        />
      ) : null}
    </div>
  );
}

function EstoqueVsVendasGrafico({
  totalPecasEstante,
  mediaPorDia,
  totalItensPeriodo,
  dias,
  cobertura,
}: {
  totalPecasEstante: number;
  mediaPorDia: number;
  totalItensPeriodo: number;
  dias: number;
  cobertura: number;
}) {
  const dadosGrafico = [
    {
      categoria: "Estoque atual",
      valor: totalPecasEstante,
      labelValor: `${totalPecasEstante.toLocaleString("pt-BR")} peças`,
      cor: "var(--color-primary)",
    },
    {
      categoria: "Média / dia",
      valor: Math.round(mediaPorDia * 10) / 10,
      labelValor: `${mediaPorDia.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} peças/dia`,
      cor: "var(--color-amber-500)",
    },
  ];

  // Cobertura: estoque ÷ média. Cap visual em 999d pra não estourar o layout
  // quando média é 0 (Infinity) ou muito baixa.
  const coberturaTexto =
    cobertura === Infinity
      ? "—"
      : cobertura >= 999
        ? "999+ dias"
        : `${cobertura.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} dias`;
  const coberturaCor =
    cobertura === Infinity || cobertura >= 21
      ? "text-emerald-300"
      : cobertura >= 7
        ? "text-amber-300"
        : "text-red-300";

  return (
    <div className="border border-slate-700 rounded-lg p-4 space-y-4">
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={dadosGrafico}
            margin={{ top: 24, right: 24, left: 8, bottom: 4 }}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-slate-700/50" />
            <XAxis
              dataKey="categoria"
              tick={{ fontSize: 12 }}
              className="fill-muted-foreground"
            />
            <YAxis
              allowDecimals
              tick={{ fontSize: 11 }}
              className="fill-muted-foreground"
            />
            <Tooltip
              cursor={{ className: "fill-muted/40" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as (typeof dadosGrafico)[number];
                return (
                  <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
                    <div className="font-semibold">{d.categoria}</div>
                    <div className="tabular-nums">{d.labelValor}</div>
                  </div>
                );
              }}
            />
            <Bar dataKey="valor" radius={[6, 6, 0, 0]}>
              {dadosGrafico.map((d, i) => (
                <Cell
                  key={i}
                  className={i === 0 ? "fill-primary" : "fill-amber-500"}
                />
              ))}
              <LabelList
                dataKey="labelValor"
                position="top"
                className="fill-foreground text-xs font-medium"
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center justify-between gap-4 text-xs border-t border-slate-700/60 pt-3 flex-wrap">
        <div className="text-muted-foreground">
          Período de referência: <span className="text-foreground tabular-nums">{dias} {dias === 1 ? "dia" : "dias"}</span>
          {" · "}
          <span className="tabular-nums">{totalItensPeriodo.toLocaleString("pt-BR")}</span> peças vendidas no total
        </div>
        <div className="flex items-center gap-1.5">
          <TrendingDown className={cn("h-3.5 w-3.5", coberturaCor)} />
          <span className="text-muted-foreground">Cobertura estimada:</span>
          <span className={cn("font-semibold tabular-nums", coberturaCor)}>
            {coberturaTexto}
          </span>
        </div>
      </div>
    </div>
  );
}

function fmtData(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}
