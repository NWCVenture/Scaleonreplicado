"use client";

// Seção "Saídas reais" abaixo do "Estoque × Média de vendas" na MatrizView.
// Consome /api/central-envios/saidas-semanais (sessão ativa mais recente da
// conta) e renderiza 3 cards:
//
// 1. Total por dia (vertical, próximos 7 dias começando hoje) — análogo ao
//    de média, mas com saídas reais e projeção do estoque dia a dia.
// 2. Por SKU × dia da semana (horizontal, stacked) — uma linha por SKU,
//    cores por DOW. Útil pra ver em quais dias um SKU concentra saídas.
// 3. Estoque × saídas semanais por SKU (horizontal, 2 barras) — flagra
//    visualmente os SKUs com déficit (saída > estoque atual da estante).

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Loader2, TrendingDown } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  DOW_NOMES_CURTOS as DOW_NOMES_CENTRAL,
  type PorSkuPorDow,
} from "@/lib/central-envios/agregacao-semanal";
import {
  DOW_NOMES_CURTOS,
  gerarOrdemDow,
  simularEstoqueSemanal,
  type MediaPorDiaSemana,
} from "@/lib/estante-virtual/giro";
import type { ResumoSku } from "@/lib/estante-virtual/agregar";
import { cn } from "@/lib/utils";

// Paleta por DOW (índice 0=Dom..6=Sáb). Reusada nos gráficos por SKU.
const CORES_POR_DOW = [
  "#94a3b8", // Dom — cinza claro
  "#3b82f6", // Seg — azul
  "#10b981", // Ter — verde
  "#f59e0b", // Qua — âmbar
  "#ef4444", // Qui — vermelho
  "#8b5cf6", // Sex — roxo
  "#ec4899", // Sáb — pink
];

interface SaidasResponse {
  semSessao?: boolean;
  inicioIso?: string;
  fimIso?: string;
  totalPorDow?: number[];
  topSkus?: PorSkuPorDow[];
  outrosPorDow?: number[];
  outrosCount?: number;
  pedidosConsiderados?: number;
  totalSkus?: number;
  fonte?: { nome: string | null; sessaoId: string } | null;
}

interface SaidasReaisProps {
  totalPecasEstante: number;
  porSku: ResumoSku[];
}

export function SaidasReaisSection({ totalPecasEstante, porSku }: SaidasReaisProps) {
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [dados, setDados] = useState<SaidasResponse | null>(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const res = await fetch("/api/central-envios/saidas-semanais");
        if (!res.ok) {
          if (!cancelado) setErro("Falha ao carregar saídas da central de envios.");
          return;
        }
        const data = (await res.json()) as SaidasResponse;
        if (!cancelado) setDados(data);
      } catch {
        if (!cancelado) setErro("Falha ao carregar saídas da central de envios.");
      } finally {
        if (!cancelado) setCarregando(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  const estoquePorSku = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of porSku) m.set(s.sku, s.pecas);
    return m;
  }, [porSku]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Saídas reais — central de envios
        </h2>
        {dados?.fonte?.nome && (
          <p className="text-[11px] text-muted-foreground/70 mt-0.5">
            Fonte: {dados.fonte.nome} · {dados.pedidosConsiderados ?? 0} pedido(s)
            considerado(s) na janela {fmtIso(dados.inicioIso)} →{" "}
            {fmtIso(dados.fimIso)}
          </p>
        )}
      </div>

      {carregando ? (
        <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground border border-slate-700 rounded-lg">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando saídas da central de envios…
        </div>
      ) : erro ? (
        <div className="px-4 py-4 text-sm text-red-300/80 border border-red-900/60 bg-red-950/20 rounded-lg">
          {erro}
        </div>
      ) : !dados || dados.semSessao ? (
        <div className="flex items-center justify-between gap-3 px-4 py-4 text-sm border border-slate-700 rounded-lg">
          <span className="text-muted-foreground">
            Nenhuma sessão ativa na <span className="font-mono">/central-envios</span>.
          </span>
          <a
            href="/central-envios"
            className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
          >
            Ir para Central de Envios
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      ) : (
        <SaidasReaisCharts
          totalPecasEstante={totalPecasEstante}
          totalPorDow={dados.totalPorDow ?? [0, 0, 0, 0, 0, 0, 0]}
          topSkus={dados.topSkus ?? []}
          outrosPorDow={dados.outrosPorDow ?? [0, 0, 0, 0, 0, 0, 0]}
          outrosCount={dados.outrosCount ?? 0}
          inicioIso={dados.inicioIso ?? ""}
          estoquePorSku={estoquePorSku}
        />
      )}
    </div>
  );
}

function SaidasReaisCharts({
  totalPecasEstante,
  totalPorDow,
  topSkus,
  outrosPorDow,
  outrosCount,
  inicioIso,
  estoquePorSku,
}: {
  totalPecasEstante: number;
  totalPorDow: number[];
  topSkus: PorSkuPorDow[];
  outrosPorDow: number[];
  outrosCount: number;
  inicioIso: string;
  estoquePorSku: Map<string, number>;
}) {
  // DOW do "hoje" = primeiro dia da janela. Backend já retorna inicioIso =
  // hoje em SP, então não dependemos do relógio do browser pra ordenar.
  const dowHoje = useMemo(() => dowFromIso(inicioIso), [inicioIso]);
  const ordemDow = useMemo(() => gerarOrdemDow(dowHoje), [dowHoje]);
  return (
    <div className="space-y-4">
      <TotalDiaChart
        totalPecasEstante={totalPecasEstante}
        totalPorDow={totalPorDow}
        ordemDow={ordemDow}
      />
      <PorSkuPorDowChart
        topSkus={topSkus}
        outrosPorDow={outrosPorDow}
        outrosCount={outrosCount}
        ordemDow={ordemDow}
      />
      <EstoqueVsSaidasPorSkuChart
        topSkus={topSkus}
        estoquePorSku={estoquePorSku}
      />
    </div>
  );
}

// ── Chart 1: total por dia + projeção do estoque ────────────────────────────
function TotalDiaChart({
  totalPecasEstante,
  totalPorDow,
  ordemDow,
}: {
  totalPecasEstante: number;
  totalPorDow: number[];
  ordemDow: number[];
}) {
  // Reusa simularEstoqueSemanal: as "médias" aqui são as saídas reais do DOW.
  const medias: MediaPorDiaSemana[] = totalPorDow.map((total, dow) => ({
    diaSemana: dow,
    totalItens: total,
    ocorrencias: 1,
    media: total,
  }));
  const semana = simularEstoqueSemanal(totalPecasEstante, medias, ordemDow[0]);
  const data = semana.map((sim, i) => ({
    dia: i === 0 ? "Hoje" : DOW_NOMES_CURTOS[sim.diaSemana],
    nomeDia: DOW_NOMES_CURTOS[sim.diaSemana],
    estoque: Math.max(0, Math.round(sim.estoqueInicial)),
    saidas: Math.round(sim.mediaEntregar),
  }));
  const totalSemana = totalPorDow.reduce((a, b) => a + b, 0);
  const sobraFinal = data[data.length - 1]?.estoque ?? 0;
  return (
    <div className="border border-slate-700 rounded-lg p-4 space-y-3">
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold">Estoque × Saídas reais (próximos 7 dias)</h3>
          <p className="text-xs text-muted-foreground">
            Estoque do início de cada dia × peças a entregar (saídas reais
            da sessão da central).
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <TrendingDown className={cn("h-3.5 w-3.5", sobraFinal > 0 ? "text-emerald-300" : "text-red-300")} />
          <span className="text-muted-foreground">Saldo no fim da semana:</span>
          <span className={cn("font-semibold tabular-nums", sobraFinal > 0 ? "text-emerald-300" : "text-red-300")}>
            {sobraFinal.toLocaleString("pt-BR")}
          </span>
          <span className="text-muted-foreground">peças</span>
          <span className="text-muted-foreground/70 ml-2 tabular-nums">
            (saída total: {totalSemana.toLocaleString("pt-BR")})
          </span>
        </div>
      </div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 16, right: 12, left: 0, bottom: 4 }} barGap={4}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-slate-700/50" />
            <XAxis dataKey="dia" tick={{ fontSize: 12 }} className="fill-muted-foreground" />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} className="fill-muted-foreground" />
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
                      <span className="font-medium">{d.estoque.toLocaleString("pt-BR")}</span>
                    </div>
                    <div className="tabular-nums">
                      <span className="text-amber-400">■</span> A entregar (real):{" "}
                      <span className="font-medium">{d.saidas.toLocaleString("pt-BR")}</span>
                    </div>
                  </div>
                );
              }}
            />
            <Legend verticalAlign="top" height={24} iconSize={10} wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="estoque" name="Estoque no início do dia" radius={[4, 4, 0, 0]} fill="#3b82f6" />
            <Bar dataKey="saidas" name="A entregar (real)" radius={[4, 4, 0, 0]} fill="#f59e0b" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Chart 2: por SKU, stacked por DOW (horizontal) ──────────────────────────
function PorSkuPorDowChart({
  topSkus,
  outrosPorDow,
  outrosCount,
  ordemDow,
}: {
  topSkus: PorSkuPorDow[];
  outrosPorDow: number[];
  outrosCount: number;
  ordemDow: number[];
}) {
  // Cada linha = SKU. Cada segmento da barra horizontal = um DOW (cor).
  const todasLinhas: Array<{ sku: string; total: number; [k: string]: number | string }> = [];
  for (const s of topSkus) {
    const linha: { sku: string; total: number; [k: string]: number | string } = {
      sku: s.sku,
      total: s.total,
    };
    for (const dow of ordemDow) linha[`dow${dow}`] = s.porDow[dow];
    todasLinhas.push(linha);
  }
  if (outrosCount > 0) {
    const linha: { sku: string; total: number; [k: string]: number | string } = {
      sku: `Outros (${outrosCount})`,
      total: outrosPorDow.reduce((a, b) => a + b, 0),
    };
    for (const dow of ordemDow) linha[`dow${dow}`] = outrosPorDow[dow];
    todasLinhas.push(linha);
  }
  todasLinhas.sort((a, b) => b.total - a.total);

  const altura = Math.max(220, todasLinhas.length * 26 + 80);

  if (todasLinhas.length === 0) {
    return (
      <div className="border border-slate-700 rounded-lg p-6 text-center text-sm text-muted-foreground">
        Nenhuma saída na janela.
      </div>
    );
  }

  return (
    <div className="border border-slate-700 rounded-lg p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Por SKU — saídas por dia da semana</h3>
        <p className="text-xs text-muted-foreground">
          Cada linha é um SKU. Cor por dia da semana — útil pra ver em qual
          dia um produto concentra saídas.
        </p>
      </div>
      <div style={{ height: altura }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={todasLinhas}
            layout="vertical"
            margin={{ top: 8, right: 24, left: 0, bottom: 4 }}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-slate-700/50" />
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} className="fill-muted-foreground" />
            <YAxis
              type="category"
              dataKey="sku"
              tick={{ fontSize: 11 }}
              className="fill-muted-foreground"
              width={140}
            />
            <Tooltip
              cursor={{ className: "fill-muted/20" }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const linhas = payload
                  .filter((p) => typeof p.value === "number" && p.value > 0)
                  .sort((a, b) => (b.value as number) - (a.value as number));
                if (linhas.length === 0) return null;
                const total = payload.reduce((a, p) => a + ((p.value as number) || 0), 0);
                return (
                  <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md space-y-0.5">
                    <div className="font-semibold mb-1">{label}</div>
                    {linhas.map((p) => {
                      const dow = Number(String(p.dataKey).slice(3));
                      return (
                        <div key={String(p.dataKey)} className="flex items-center gap-1.5 tabular-nums">
                          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: p.color as string }} />
                          <span className="flex-1">{DOW_NOMES_CENTRAL[dow]}</span>
                          <span className="font-medium">{(p.value as number).toLocaleString("pt-BR")}</span>
                        </div>
                      );
                    })}
                    <div className="border-t pt-1 mt-1 flex justify-between tabular-nums font-semibold">
                      <span>Total</span>
                      <span>{total.toLocaleString("pt-BR")}</span>
                    </div>
                  </div>
                );
              }}
            />
            <Legend
              verticalAlign="top"
              height={28}
              iconSize={8}
              wrapperStyle={{ fontSize: 11 }}
              formatter={(value) => {
                const dow = Number(String(value).slice(3));
                return DOW_NOMES_CENTRAL[dow] ?? value;
              }}
            />
            {ordemDow.map((dow) => (
              <Bar
                key={dow}
                dataKey={`dow${dow}`}
                stackId="saidas"
                fill={CORES_POR_DOW[dow]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Chart 3: por SKU, estoque atual × saídas semanais (horizontal) ──────────
function EstoqueVsSaidasPorSkuChart({
  topSkus,
  estoquePorSku,
}: {
  topSkus: PorSkuPorDow[];
  estoquePorSku: Map<string, number>;
}) {
  // Cruza SKUs do agregado com estoque da estante atual. SKUs sem entrada no
  // estoque dessa estante caem em 0 (déficit total). SKUs do estoque sem
  // saídas ficam de fora — esta visão é orientada à demanda.
  const linhas = topSkus
    .map((s) => {
      const estoque = estoquePorSku.get(s.sku) ?? 0;
      const saidas = s.total;
      return {
        sku: s.sku,
        estoque,
        saidas,
        deficit: saidas - estoque,
      };
    })
    .sort((a, b) => b.deficit - a.deficit);

  if (linhas.length === 0) {
    return (
      <div className="border border-slate-700 rounded-lg p-6 text-center text-sm text-muted-foreground">
        Nenhuma saída na janela.
      </div>
    );
  }

  const altura = Math.max(220, linhas.length * 26 + 80);
  const totalDeficit = linhas.filter((l) => l.deficit > 0).length;

  return (
    <div className="border border-slate-700 rounded-lg p-4 space-y-3">
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold">Estoque (estante atual) × Saídas semanais por SKU</h3>
          <p className="text-xs text-muted-foreground">
            Ordenado por déficit (saídas − estoque). Vermelho = barra de
            estoque não cobre a saída prevista.
          </p>
        </div>
        {totalDeficit > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-red-950/40 border border-red-900/60 text-red-300 tabular-nums">
            {totalDeficit} SKU{totalDeficit === 1 ? "" : "s"} com déficit
          </span>
        )}
      </div>
      <div style={{ height: altura }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={linhas}
            layout="vertical"
            margin={{ top: 8, right: 24, left: 0, bottom: 4 }}
            barGap={2}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-slate-700/50" />
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} className="fill-muted-foreground" />
            <YAxis
              type="category"
              dataKey="sku"
              tick={{ fontSize: 11 }}
              className="fill-muted-foreground"
              width={140}
            />
            <Tooltip
              cursor={{ className: "fill-muted/20" }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as (typeof linhas)[number];
                return (
                  <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md space-y-0.5">
                    <div className="font-semibold mb-1">{label}</div>
                    <div className="tabular-nums flex items-center gap-1.5">
                      <span className="inline-block h-2 w-2 rounded-sm bg-blue-500" />
                      <span className="flex-1">Estoque</span>
                      <span className="font-medium">{d.estoque.toLocaleString("pt-BR")}</span>
                    </div>
                    <div className="tabular-nums flex items-center gap-1.5">
                      <span className="inline-block h-2 w-2 rounded-sm bg-amber-500" />
                      <span className="flex-1">Saídas semanais</span>
                      <span className="font-medium">{d.saidas.toLocaleString("pt-BR")}</span>
                    </div>
                    <div
                      className={cn(
                        "border-t pt-1 mt-1 flex justify-between tabular-nums font-semibold",
                        d.deficit > 0 ? "text-red-300" : "text-emerald-300",
                      )}
                    >
                      <span>{d.deficit > 0 ? "Déficit" : "Sobra"}</span>
                      <span>{Math.abs(d.deficit).toLocaleString("pt-BR")}</span>
                    </div>
                  </div>
                );
              }}
            />
            <Legend verticalAlign="top" height={28} iconSize={8} wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="estoque" name="Estoque atual" fill="#3b82f6" radius={[2, 2, 2, 2]} />
            <Bar dataKey="saidas" name="Saídas semanais" radius={[2, 2, 2, 2]}>
              {linhas.map((l, i) => (
                <Cell key={i} fill={l.deficit > 0 ? "#ef4444" : "#f59e0b"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function fmtIso(iso: string | undefined): string {
  if (!iso) return "—";
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

function dowFromIso(ymd: string): number {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return new Date().getDay();
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
}
