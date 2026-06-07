"use client";

// Visualização Matriz da estante: KPIs estendidos, matriz cor × tamanho com
// totais marginais, e lista de caixas parciais (a consolidar) ordenada por
// "mais vazia primeiro". Tudo derivado on-the-fly via agregarFardos.

import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Package,
  Boxes,
  CheckCircle2,
  Inbox,
  Gauge,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  agregarFardos,
  type EstanteFardoItem,
} from "@/lib/estante-virtual/agregar";

interface MatrizViewProps {
  fardos: EstanteFardoItem[];
  nomeEstante: string;
  ultimaBipagem: string | null;
}

export function MatrizView({ fardos, nomeEstante }: MatrizViewProps) {
  const agregado = useMemo(() => agregarFardos(fardos), [fardos]);
  const [avisosOpen, setAvisosOpen] = useState(false);

  if (fardos.length === 0) {
    return (
      <div className="flex flex-col items-center py-12 text-center border border-dashed border-slate-700 rounded-xl">
        <Boxes className="h-10 w-10 text-muted-foreground/20 mb-3" />
        <p className="text-sm text-muted-foreground">
          Sem fardos em &quot;{nomeEstante}&quot; — adicione fardos para ver a
          visualização matriz.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Banner de avisos ───────────────────────────────────────────── */}
      {agregado.avisos.length > 0 && (
        <Collapsible open={avisosOpen} onOpenChange={setAvisosOpen}>
          <div className="border border-yellow-800/60 bg-yellow-950/30 rounded-lg">
            <CollapsibleTrigger className="w-full flex items-center justify-between px-4 py-2.5 text-left">
              <div className="flex items-center gap-2 text-yellow-200">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span className="text-sm font-semibold">
                  {agregado.avisos.length} aviso
                  {agregado.avisos.length === 1 ? "" : "s"}
                </span>
              </div>
              {avisosOpen ? (
                <ChevronUp className="h-4 w-4 text-yellow-300/70" />
              ) : (
                <ChevronDown className="h-4 w-4 text-yellow-300/70" />
              )}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="px-4 pb-3 space-y-1 text-xs text-yellow-100/80">
                {agregado.avisos.map((av, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="font-mono text-yellow-300/70 shrink-0">
                      {av.tipo}
                    </span>
                    <span>{av.mensagem}</span>
                  </li>
                ))}
              </ul>
            </CollapsibleContent>
          </div>
        </Collapsible>
      )}

      {/* ── KPIs estendidos ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard
          icon={<Package className="h-4 w-4" />}
          label="Peças"
          value={agregado.totalPecas}
        />
        <KpiCard
          icon={<Boxes className="h-4 w-4" />}
          label="Fardos"
          value={agregado.totalFardos}
        />
        <KpiCard
          icon={<CheckCircle2 className="h-4 w-4 text-green-500" />}
          label="Cheios"
          value={agregado.fardosCheios}
        />
        <KpiCard
          icon={<Inbox className="h-4 w-4 text-amber-500" />}
          label="Parciais"
          value={agregado.fardosParciais}
        />
        <Card className="bg-slate-900 border-slate-700">
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
              <Gauge className="h-4 w-4" />
              <span>Ocupação</span>
            </div>
            <p className="text-2xl font-bold leading-none mb-2">
              {agregado.ocupacaoPct}%
            </p>
            <Progress value={agregado.ocupacaoPct} className="h-1.5" />
          </CardContent>
        </Card>
      </div>

      {/* ── Matriz cor × tamanho ───────────────────────────────────────── */}
      <div>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Matriz cor × tamanho
        </h2>
        <div className="border border-slate-700 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/60">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-xs text-muted-foreground uppercase tracking-wider sticky left-0 bg-slate-800/60">
                  Cor
                </th>
                {agregado.tamanhosOrdenados.map((tam) => (
                  <th
                    key={tam}
                    className="px-3 py-2 text-right font-semibold text-xs text-muted-foreground uppercase tracking-wider"
                  >
                    {tam}
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-bold text-xs uppercase tracking-wider border-l border-slate-700">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {agregado.coresOrdenadas.map((cor) => (
                <tr key={cor} className="border-t border-slate-700">
                  <th className="px-3 py-2 text-left font-mono font-bold sticky left-0 bg-slate-900">
                    {cor}
                  </th>
                  {agregado.tamanhosOrdenados.map((tam) => {
                    const v = agregado.matriz[cor]?.[tam] ?? 0;
                    return (
                      <td
                        key={tam}
                        className={cn(
                          "px-3 py-2 text-right font-mono tabular-nums",
                          v === 0 && "text-muted-foreground/40",
                        )}
                      >
                        {v}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right font-mono font-bold tabular-nums border-l border-slate-700">
                    {agregado.totaisPorCor[cor] ?? 0}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-600 bg-slate-800/40">
                <th className="px-3 py-2 text-left font-bold sticky left-0 bg-slate-800/40">
                  Total
                </th>
                {agregado.tamanhosOrdenados.map((tam) => (
                  <td
                    key={tam}
                    className="px-3 py-2 text-right font-mono font-bold tabular-nums"
                  >
                    {agregado.totaisPorTamanho[tam] ?? 0}
                  </td>
                ))}
                <td className="px-3 py-2 text-right font-mono font-bold tabular-nums border-l border-slate-700">
                  {agregado.totalPecas}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Caixas a consolidar (parciais) ─────────────────────────────── */}
      <div>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Caixas a consolidar ({agregado.caixasParciais.length})
        </h2>
        {agregado.caixasParciais.length === 0 ? (
          <div className="flex items-center gap-2 px-4 py-3 text-sm text-green-300/80 border border-green-800/60 bg-green-950/20 rounded-lg">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Sem caixas parciais — todos os fardos estão cheios.
          </div>
        ) : (
          <div className="border border-slate-700 rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-800/60">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-xs text-muted-foreground uppercase tracking-wider">
                    SKU
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-xs text-muted-foreground uppercase tracking-wider">
                    Cor
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-xs text-muted-foreground uppercase tracking-wider">
                    Tam
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-xs text-muted-foreground uppercase tracking-wider">
                    Lote
                  </th>
                  <th className="px-3 py-2 text-right font-semibold text-xs text-muted-foreground uppercase tracking-wider">
                    Qtd
                  </th>
                  <th className="px-3 py-2 text-right font-semibold text-xs text-muted-foreground uppercase tracking-wider">
                    Falta
                  </th>
                </tr>
              </thead>
              <tbody>
                {agregado.caixasParciais.map((p) => (
                  <tr key={p.fardoId} className="border-t border-slate-700">
                    <td className="px-3 py-2 font-mono">{p.sku}</td>
                    <td className="px-3 py-2 font-mono">{p.cor}</td>
                    <td className="px-3 py-2 font-mono">{p.tamanho}</td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {p.lote}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {p.quantidade}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums font-bold text-amber-400">
                      {p.faltaParaCheia}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <Card className="bg-slate-900 border-slate-700">
      <CardContent className="p-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
          {icon}
          <span>{label}</span>
        </div>
        <p className="text-2xl font-bold leading-none">{value}</p>
      </CardContent>
    </Card>
  );
}
