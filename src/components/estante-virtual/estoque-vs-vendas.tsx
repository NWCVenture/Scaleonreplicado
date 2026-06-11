"use client";

// Card "Estoque × média de vendas" — substitui o antigo "Caixas a consolidar".
//
// Consome o último import persistido em /api/analise-pedidos/import e cruza
// com o estoque atual da estante. Mostra a previsibilidade do giro ao longo
// da semana (Seg→Dom):
//  - Pra cada dia da semana, a média histórica de peças que precisam ser
//    entregues (com base em data_pedido + 2 dias úteis, plataforma TikTok).
//  - O estoque restante ao início de cada dia, consumindo a média do dia
//    anterior cumulativamente.
//
// Período histórico ajustável (default 14d).

import { useEffect, useMemo, useState } from "react";
import { Loader2, TrendingDown, ExternalLink } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { rehidratarLinhas } from "@/lib/analise-pedidos/rehidratar";
import type { LinhaPedido } from "@/lib/analise-pedidos/parser";
import {
  calcularMediaPorDiaSemana,
  DOW_NOMES_CURTOS,
  gerarOrdemDow,
  PLATAFORMA_TIKTOK,
  simularEstoqueSemanal,
  type PresetGiro,
} from "@/lib/estante-virtual/giro";
import { cn } from "@/lib/utils";

const PRESETS: { label: string; value: PresetGiro }[] = [
  { label: "7d", value: 7 },
  { label: "14d", value: 14 },
  { label: "30d", value: 30 },
  { label: "Tudo", value: "tudo" },
];
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
    return new Set(
      ESTADOS_PADRAO.filter((e) => importMeta.estadosDistintos.includes(e)),
    );
  }, [importMeta]);

  const dados = useMemo(() => {
    if (!importMeta) return null;
    const medias = calcularMediaPorDiaSemana(linhas, {
      periodoMin: importMeta.periodoMin,
      periodoMax: importMeta.periodoMax,
      preset,
      estados: estadosFiltro,
      plataforma: PLATAFORMA_TIKTOK,
    });
    // A projeção começa em "hoje" (DOW do cliente). new Date() é OK aqui porque
    // o componente roda no client e só queremos a data civil pra escolher o
    // ponto de partida — não há risco de hidratação porque o cálculo só roda
    // depois do useEffect que setou importMeta.
    const dowHoje = new Date().getDay();
    const semana = simularEstoqueSemanal(totalPecasEstante, medias, dowHoje);
    const totalSemana = medias.reduce((acc, m) => acc + m.media, 0);
    return { medias, semana, totalSemana, dowHoje };
  }, [importMeta, linhas, preset, estadosFiltro, totalPecasEstante]);

  return (
    <div>
      <div className="flex items-end justify-between gap-3 mb-2 flex-wrap">
        <div>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            Estoque × Média de vendas
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 tracking-normal normal-case">
              TikTok Shop · +2 dias úteis
            </span>
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
      ) : dados ? (
        <GiroSemanalGrafico
          estoqueAtual={totalPecasEstante}
          totalSemana={dados.totalSemana}
          semana={dados.semana}
        />
      ) : null}
    </div>
  );
}

function GiroSemanalGrafico({
  estoqueAtual,
  totalSemana,
  semana,
}: {
  estoqueAtual: number;
  totalSemana: number;
  semana: ReturnType<typeof simularEstoqueSemanal>;
}) {
  // `semana` já vem em ordem cronológica a partir do dowInicial (= hoje).
  // Primeiro dia recebe label "Hoje"; demais usam o nome curto do DOW.
  const data = semana.map((sim, i) => ({
    dia: i === 0 ? "Hoje" : DOW_NOMES_CURTOS[sim.diaSemana],
    diaSemana: sim.diaSemana,
    nomeDia: DOW_NOMES_CURTOS[sim.diaSemana],
    estoque: Math.round(sim.estoqueInicial),
    mediaEntregar: Math.round(sim.mediaEntregar * 10) / 10,
  }));

  // Cobertura semanal: estoque atual ÷ média total da semana (peças/semana).
  // 7 dias → quantas semanas o estoque dura.
  const coberturaSemanas = totalSemana > 0 ? estoqueAtual / totalSemana : Infinity;
  const coberturaTexto =
    coberturaSemanas === Infinity
      ? "—"
      : `${coberturaSemanas.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} semana${coberturaSemanas >= 2 ? "s" : ""}`;
  const coberturaCor =
    coberturaSemanas === Infinity || coberturaSemanas >= 3
      ? "text-emerald-300"
      : coberturaSemanas >= 1
        ? "text-amber-300"
        : "text-red-300";

  return (
    <div className="border border-slate-700 rounded-lg p-4 space-y-3">
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 12, right: 12, left: 0, bottom: 4 }}
            barGap={4}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-slate-700/50" />
            <XAxis
              dataKey="dia"
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
                const d = payload[0].payload as (typeof data)[number];
                const titulo = d.dia === "Hoje" ? `Hoje (${d.nomeDia})` : d.nomeDia;
                return (
                  <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md space-y-0.5">
                    <div className="font-semibold mb-1">{titulo}</div>
                    <div className="tabular-nums">
                      <span className="text-primary">■</span> Estoque no início:{" "}
                      <span className="font-medium">
                        {d.estoque.toLocaleString("pt-BR")}
                      </span>{" "}
                      peças
                    </div>
                    <div className="tabular-nums">
                      <span className="text-amber-400">■</span> Média a entregar:{" "}
                      <span className="font-medium">
                        {d.mediaEntregar.toLocaleString("pt-BR", {
                          minimumFractionDigits: 1,
                          maximumFractionDigits: 1,
                        })}
                      </span>{" "}
                      peças
                    </div>
                  </div>
                );
              }}
            />
            <Legend
              verticalAlign="top"
              height={24}
              iconSize={10}
              wrapperStyle={{ fontSize: 11 }}
            />
            <Bar
              dataKey="estoque"
              name="Estoque no início do dia"
              radius={[4, 4, 0, 0]}
              className="fill-primary"
            />
            <Bar
              dataKey="mediaEntregar"
              name="A entregar (média)"
              radius={[4, 4, 0, 0]}
              className="fill-amber-500"
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center justify-between gap-4 text-xs border-t border-slate-700/60 pt-3 flex-wrap">
        <div className="text-muted-foreground tabular-nums">
          Média total/semana:{" "}
          <span className="text-foreground">
            {totalSemana.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}
          </span>{" "}
          peças
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
