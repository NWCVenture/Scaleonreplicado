"use client";

// Top defeitos — RITM-21.
// BarChart horizontal mostrando frequência de cada tipo de defeito.

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const LABEL_DEFEITO: Record<string, string> = {
  rebarba: "Rebarba",
  costura_desalinhada: "Costura desalinhada",
  costura_incompleta: "Costura incompleta",
  gola: "Gola",
  mancha: "Mancha",
  tecido: "Tecido",
  furo: "Furo",
  outros: "Outros",
};

interface TopDefeitoItem {
  tipo: string;
  contagem: number;
  percentual: number;
}

interface TopDefeitosChartProps {
  data: TopDefeitoItem[];
}

export function TopDefeitosChart({ data }: TopDefeitosChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        Nenhum defeito registrado no período.
      </div>
    );
  }

  const chartData = data.map((d) => ({
    label: LABEL_DEFEITO[d.tipo] ?? d.tipo,
    contagem: d.contagem,
    percentual: (d.percentual * 100).toFixed(1),
  }));

  // Altura proporcional ao número de barras (mín 200, ~36px por barra).
  const height = Math.max(200, chartData.length * 36 + 40);

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 8, right: 24, left: 8, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} horizontal={false} />
          <XAxis type="number" allowDecimals={false} fontSize={12} />
          <YAxis
            type="category"
            dataKey="label"
            width={140}
            fontSize={12}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{
              fontSize: 12,
              borderRadius: 6,
              border: "1px solid hsl(var(--border))",
            }}
            formatter={(value, _name, item) => {
              const p = item?.payload as
                | { contagem: number; percentual: string }
                | undefined;
              if (!p) return [String(value ?? ""), "Marcações"];
              return [`${p.contagem} (${p.percentual}%)`, "Marcações"];
            }}
          />
          <Bar dataKey="contagem" fill="#f59e0b" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
