"use client";

import {
  AlertCircle,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  Package,
} from "lucide-react";
import type { EstatisticasSessao } from "@/types/central-envios";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Props = {
  estatisticas: EstatisticasSessao | null;
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

export function DashboardTab({ estatisticas }: Props) {
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <ListaBreakdown titulo="Por canal" itens={porCanalItems} />
        <ListaBreakdown titulo="Top 10 modelos" itens={topModelos} />
      </div>
    </div>
  );
}
