"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  Package,
} from "lucide-react";
import type { EstatisticasSessao } from "@/types/central-envios";
import type { PedidoEnriquecido } from "@/lib/central-envios/sessao/types";
import {
  DOW_NOMES_CURTOS,
  DOW_VISUAL_SEG_DOM,
  montarAgregacaoSemanal,
} from "@/lib/central-envios/agregacao-semanal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
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

type Props = {
  estatisticas: EstatisticasSessao | null;
  dados: PedidoEnriquecido[];
  hojeIso: string;
};

type CardKpiProps = {
  label: string;
  valor: number;
  icone: typeof Package;
  tom: "neutro" | "vermelho" | "laranja" | "verde" | "cinza" | "ambar";
};

const TOM_CLASSES: Record<CardKpiProps["tom"], string> = {
  neutro: "text-foreground",
  vermelho: "text-red-700",
  laranja: "text-orange-700",
  verde: "text-emerald-700",
  cinza: "text-muted-foreground",
  ambar: "text-amber-700",
};

// Paleta fixa pro gráfico empilhado por SKU. 8 cores distintas + cinza pra
// "Outros". Hex codado pra recharts não depender de Tailwind runtime.
const CORES_SKU = [
  "#3b82f6", // blue-500
  "#10b981", // emerald-500
  "#f59e0b", // amber-500
  "#ef4444", // red-500
  "#8b5cf6", // violet-500
  "#ec4899", // pink-500
  "#14b8a6", // teal-500
  "#f97316", // orange-500
];
const COR_OUTROS = "#94a3b8"; // slate-400

function CardKpi({ label, valor, icone: Icone, tom }: CardKpiProps) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {label}
            </p>
            <p className={cn("text-3xl font-semibold mt-1", TOM_CLASSES[tom])}>
              {(valor ?? 0).toLocaleString("pt-BR")}
            </p>
          </div>
          <Icone className={cn("h-5 w-5", TOM_CLASSES[tom])} />
        </div>
      </CardContent>
    </Card>
  );
}

function ListaBreakdown({
  titulo,
  itens,
}: {
  titulo: string;
  itens: Array<[string, number]>;
}) {
  if (itens.length === 0) {
    return (
      <Card>
        <CardContent className="py-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
            {titulo}
          </p>
          <p className="text-sm text-muted-foreground italic">Nenhum dado</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
          {titulo}
        </p>
        <ul className="space-y-1">
          {itens.map(([nome, count]) => (
            <li key={nome} className="flex justify-between items-baseline text-sm">
              <span className="truncate mr-2">{nome}</span>
              <span className="font-mono font-medium tabular-nums">
                {(count ?? 0).toLocaleString("pt-BR")}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function formatarDataBr(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

// Cor por variação: usa skuCatalogo.hex_color (cadastrável; UI vem depois)
// e cai numa paleta determinística por hash quando vazio. Hash simples de
// FNV-like é suficiente — só precisa ser estável entre reloads.
function hashSku(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function resolverCorVariacao(
  sku: string,
  coresPorSku: Map<string, string | null>,
): string {
  const custom = coresPorSku.get(sku);
  if (custom && /^#[0-9a-fA-F]{6}$/.test(custom)) return custom;
  return CORES_SKU[hashSku(sku) % CORES_SKU.length];
}

// Soma N dias civis a uma data 'YYYY-MM-DD'. UTC pra evitar drift de fuso
// (data civil SP é tratada como ymd puro pelo composer e pelo agregador).
function somarDiasIso(ymd: string, dias: number): string {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + dias * 86400000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

const DIAS_UTEIS = [1, 2, 3, 4, 5] as const;
const NOMES_DOW_LONGOS = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
];

function PecasPorDiaCard({
  skus,
  dow,
  dataIso,
  coresPorSku,
}: {
  // Recebe a agregação semanal completa; filtra/ordena pelo DOW alvo.
  skus: Array<{ sku: string; porDow: number[]; total: number }>;
  dow: number;
  dataIso: string;
  coresPorSku: Map<string, string | null>;
}) {
  // 1 barra horizontal por variação com saída neste DOW. Cor cadastrável
  // (sku_catalogo.hex_color), fallback paleta determinística.
  // "Saída" = prazoIso do pedido cair neste dia — já é a data limite de
  // preparação/embarque (criação + dias úteis do canal, ex: TikTok +2).
  // TODO: tornar período selecionável (date-range picker). Hoje = semana
  // corrente Seg→Dom alinhado com `agregacaoCompleta`.
  const data = skus
    .map((s) => ({ sku: s.sku, total: s.porDow[dow] ?? 0 }))
    .filter((s) => s.total > 0)
    .sort((a, b) => b.total - a.total);
  const totalPecas = data.reduce((acc, d) => acc + d.total, 0);
  const altura = Math.max(180, data.length * 22 + 60);
  const semDados = data.length === 0;
  const nomeDia = NOMES_DOW_LONGOS[dow] ?? "";
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {nomeDia} · {formatarDataBr(dataIso)}
        </CardTitle>
        <p className="text-xs text-muted-foreground tabular-nums">
          {data.length} variação{data.length === 1 ? "" : "ões"} ·{" "}
          {totalPecas.toLocaleString("pt-BR")} peça
          {totalPecas === 1 ? "" : "s"} · cor por sku_catalogo.hex_color
          (fallback paleta automática).
        </p>
      </CardHeader>
      <CardContent>
        {semDados ? (
          <p className="text-sm text-muted-foreground italic py-4 text-center">
            Sem saídas neste dia.
          </p>
        ) : (
          <div style={{ height: altura }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data}
                layout="vertical"
                margin={{ top: 8, right: 24, left: 0, bottom: 4 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  className="stroke-muted"
                />
                <XAxis
                  type="number"
                  allowDecimals={false}
                  tick={{ fontSize: 11 }}
                  className="fill-muted-foreground"
                />
                <YAxis
                  type="category"
                  dataKey="sku"
                  tick={{ fontSize: 11 }}
                  className="fill-muted-foreground"
                  width={180}
                  interval={0}
                />
                <Tooltip
                  cursor={{ className: "fill-muted/40" }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload as (typeof data)[number];
                    return (
                      <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
                        <div className="font-semibold mb-0.5">{d.sku}</div>
                        <div className="tabular-nums">
                          {d.total.toLocaleString("pt-BR")} peça
                          {d.total === 1 ? "" : "s"}
                        </div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="total" radius={[2, 2, 2, 2]}>
                  {data.map((d, i) => (
                    <Cell
                      key={i}
                      fill={resolverCorVariacao(d.sku, coresPorSku)}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PorSkuCard({
  topSkus,
  outrosPorDow,
  outrosCount,
}: {
  topSkus: Array<{ sku: string; porDow: number[]; total: number }>;
  outrosPorDow: number[];
  outrosCount: number;
}) {
  // Cada entrada do data array é um DOW; as chaves dinâmicas são os SKUs.
  // Renderizamos um <Bar> por SKU + um pra "Outros" quando aplicável.
  // Filtra dias úteis (Seg–Sex); Sáb/Dom são omitidos pra alinhar com os
  // cards diários acima.
  const data = DOW_VISUAL_SEG_DOM.filter((dow) => dow >= 1 && dow <= 5).map(
    (dow) => {
      const ponto: Record<string, number | string> = {
        dia: DOW_NOMES_CURTOS[dow],
      };
      for (const s of topSkus) ponto[s.sku] = s.porDow[dow];
      if (outrosCount > 0) ponto.__outros = outrosPorDow[dow];
      return ponto;
    },
  );
  const semDados = topSkus.length === 0 && outrosCount === 0;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Por produto — peças por dia da semana</CardTitle>
        <p className="text-xs text-muted-foreground">
          {topSkus.length > 0
            ? `Top ${topSkus.length} SKUs`
            : "Nenhum SKU"}
          {outrosCount > 0
            ? ` + ${outrosCount} SKU${outrosCount === 1 ? "" : "s"} agrupados em "Outros"`
            : ""}
          .
        </p>
      </CardHeader>
      <CardContent>
        {semDados ? (
          <p className="text-sm text-muted-foreground italic py-6 text-center">
            Sem pedidos com data de entrega na semana corrente.
          </p>
        ) : (
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 16, right: 12, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="dia" tick={{ fontSize: 12 }} className="fill-muted-foreground" />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                <Tooltip
                  cursor={{ className: "fill-muted/40" }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    // Mostra cada série com >0 no tooltip, ordenado desc.
                    const linhas = payload
                      .filter((p) => typeof p.value === "number" && p.value > 0)
                      .sort((a, b) => (b.value as number) - (a.value as number));
                    if (linhas.length === 0) return null;
                    return (
                      <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md space-y-0.5 max-w-xs">
                        <div className="font-semibold mb-1">{label}</div>
                        {linhas.map((p) => (
                          <div key={String(p.dataKey)} className="flex items-center gap-1.5 tabular-nums">
                            <span
                              className="inline-block h-2 w-2 rounded-sm"
                              style={{ background: p.color as string }}
                            />
                            <span className="truncate flex-1">
                              {p.dataKey === "__outros" ? "Outros" : (p.dataKey as string)}
                            </span>
                            <span className="font-medium">{(p.value as number).toLocaleString("pt-BR")}</span>
                          </div>
                        ))}
                      </div>
                    );
                  }}
                />
                <Legend
                  verticalAlign="top"
                  height={36}
                  iconSize={8}
                  wrapperStyle={{ fontSize: 11 }}
                  formatter={(value) => (value === "__outros" ? "Outros" : value)}
                />
                {topSkus.map((s, i) => (
                  <Bar
                    key={s.sku}
                    dataKey={s.sku}
                    fill={CORES_SKU[i % CORES_SKU.length]}
                    radius={[2, 2, 0, 0]}
                  />
                ))}
                {outrosCount > 0 && (
                  <Bar dataKey="__outros" fill={COR_OUTROS} radius={[2, 2, 0, 0]} />
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Carrega o catálogo de SKUs (com hex_color cadastrada quando houver) pra
// pintar o gráfico por variação. Inativos incluídos — uma variação pode
// estar inativa no cadastro mas ainda ter saídas na sessão atual.
function useCoresPorSku(): Map<string, string | null> {
  const [coresPorSku, setCoresPorSku] = useState<Map<string, string | null>>(
    () => new Map(),
  );
  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const r = await fetch("/api/sku-catalogo?incluirInativos=1");
        if (!r.ok) return;
        const j = (await r.json()) as {
          skus?: Array<{ codigo: string; hexColor: string | null }>;
        };
        if (cancelado) return;
        const m = new Map<string, string | null>();
        for (const s of j.skus ?? []) m.set(s.codigo, s.hexColor ?? null);
        setCoresPorSku(m);
      } catch {
        // silencioso — gráfico cai no fallback determinístico.
      }
    })();
    return () => {
      cancelado = true;
    };
  }, []);
  return coresPorSku;
}

export function DashboardTab({ estatisticas, dados, hojeIso }: Props) {
  // Agregação "completa" — todas as variações sem bucket "Outros". Usado pelo
  // gráfico horizontal por variação. O `PorSkuCard` (stacked DOW) ainda usa
  // a versão com Top 8 + Outros pra não poluir as séries.
  const agregacaoCompleta = useMemo(
    () =>
      montarAgregacaoSemanal(dados, hojeIso, {
        maxSkus: Number.MAX_SAFE_INTEGER,
      }),
    [dados, hojeIso],
  );
  const agregacao = useMemo(
    () => montarAgregacaoSemanal(dados, hojeIso, { maxSkus: 8 }),
    [dados, hojeIso],
  );
  const coresPorSku = useCoresPorSku();

  if (!estatisticas || !estatisticas.totalPedidos) {
    return (
      <div className="rounded-lg border border-dashed py-12 px-4 text-center text-muted-foreground">
        <Package className="mx-auto h-10 w-10 opacity-40" />
        <p className="mt-3 text-sm">
          Nenhum pedido carregado. Suba arquivos na aba <strong>Upload</strong>.
        </p>
      </div>
    );
  }

  const porCanalItems = Object.entries(estatisticas.porCanal ?? {}).sort(
    (a, b) => b[1] - a[1],
  );
  const topModelos = Object.entries(estatisticas.porModelo ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <CardKpi
          label="Total"
          valor={estatisticas.totalPedidos}
          icone={Package}
          tom="neutro"
        />
        <CardKpi
          label="Atrasados"
          valor={estatisticas.totalAtrasados}
          icone={AlertCircle}
          tom="vermelho"
        />
        <CardKpi
          label="Hoje"
          valor={estatisticas.totalHoje}
          icone={Clock}
          tom="laranja"
        />
        <CardKpi
          label="No prazo"
          valor={estatisticas.totalNoPrazo}
          icone={CheckCircle2}
          tom="verde"
        />
        <CardKpi
          label="Sem data"
          valor={estatisticas.totalSemData}
          icone={Calendar}
          tom="cinza"
        />
        <CardKpi
          label="Ambíguos"
          valor={estatisticas.totalAmbiguos}
          icone={AlertTriangle}
          tom="ambar"
        />
      </div>

      <div className="space-y-4">
        {DIAS_UTEIS.map((dow) => (
          <PecasPorDiaCard
            key={dow}
            skus={agregacaoCompleta.topSkus}
            dow={dow}
            dataIso={somarDiasIso(agregacaoCompleta.inicioIso, dow - 1)}
            coresPorSku={coresPorSku}
          />
        ))}
      </div>

      <PorSkuCard
        topSkus={agregacao.topSkus}
        outrosPorDow={agregacao.outrosPorDow}
        outrosCount={agregacao.outrosCount}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <ListaBreakdown titulo="Por canal" itens={porCanalItems} />
        <ListaBreakdown titulo="Top 10 modelos" itens={topModelos} />
      </div>
    </div>
  );
}
