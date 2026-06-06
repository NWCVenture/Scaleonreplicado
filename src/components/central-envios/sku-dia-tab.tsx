"use client";

import { useMemo } from "react";
import { Calendar } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { PedidoEnriquecido } from "@/types/central-envios";

type Props = {
  dados: PedidoEnriquecido[];
  hojeIso: string;
};

const COLUNAS_MAX = 14;

type Agregado = {
  sku: string; // "MODELO COR TAMANHO"
  total: number;
  porData: Map<string, number>; // YYYY-MM-DD ou "ATRASADO"
};

function montarPivot(
  dados: PedidoEnriquecido[],
  hojeIso: string,
): { agregados: Agregado[]; colunas: string[] } {
  const porSku = new Map<string, Agregado>();
  const datasSet = new Set<string>();

  for (const p of dados) {
    if (p.parsed.kind !== "OK") continue;
    if (p.linhasExplodidas.length === 0) continue;
    let bucket: string;
    if (!p.prazo.prazoIso) bucket = "SEM_DATA";
    else if (p.prazo.prazoIso < hojeIso) bucket = "ATRASADO";
    else bucket = p.prazo.prazoIso;
    datasSet.add(bucket);

    for (const l of p.linhasExplodidas) {
      const sku = `${l.modeloCodigo} ${l.cor} ${l.tamanho}`;
      const agg =
        porSku.get(sku) ??
        ({ sku, total: 0, porData: new Map<string, number>() } satisfies Agregado);
      agg.porData.set(bucket, (agg.porData.get(bucket) ?? 0) + l.qtd);
      agg.total += l.qtd;
      porSku.set(sku, agg);
    }
  }

  // Ordena datas: ATRASADO primeiro, depois datas crescentes (até COLUNAS_MAX),
  // depois SEM_DATA.
  const datasOrdenadas = [...datasSet]
    .filter((d) => d !== "ATRASADO" && d !== "SEM_DATA")
    .sort();
  const colunas: string[] = [];
  if (datasSet.has("ATRASADO")) colunas.push("ATRASADO");
  colunas.push(...datasOrdenadas.slice(0, COLUNAS_MAX));
  if (datasSet.has("SEM_DATA")) colunas.push("SEM_DATA");

  const agregados = [...porSku.values()].sort((a, b) => b.total - a.total);
  return { agregados, colunas };
}

function formatarColuna(col: string, hojeIso: string): string {
  if (col === "ATRASADO") return "Atrasado";
  if (col === "SEM_DATA") return "Sem data";
  if (col === hojeIso) return "Hoje";
  // YYYY-MM-DD → DD/MM (compact)
  const [, m, d] = col.split("-");
  return `${d}/${m}`;
}

function classeColuna(col: string, hojeIso: string): string {
  if (col === "ATRASADO") return "text-red-700";
  if (col === hojeIso) return "text-orange-700 font-semibold";
  if (col === "SEM_DATA") return "text-muted-foreground";
  return "";
}

export function SkuDiaTab({ dados, hojeIso }: Props) {
  const { agregados, colunas } = useMemo(
    () => montarPivot(dados, hojeIso),
    [dados, hojeIso],
  );

  if (agregados.length === 0) {
    return (
      <div className="rounded-lg border border-dashed py-12 px-4 text-center text-muted-foreground">
        <Calendar className="mx-auto h-10 w-10 opacity-40" />
        <p className="mt-3 text-sm">
          Nenhuma linha explodida com prazo. Suba pedidos pra ver a demanda por
          dia.
        </p>
      </div>
    );
  }

  return (
    <Card>
      <CardContent className="py-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left font-medium text-muted-foreground py-2 pr-3 sticky left-0 bg-background">
                  SKU
                </th>
                {colunas.map((c) => (
                  <th
                    key={c}
                    className={`text-right font-medium py-2 px-2 ${classeColuna(c, hojeIso)}`}
                  >
                    {formatarColuna(c, hojeIso)}
                  </th>
                ))}
                <th className="text-right font-medium text-muted-foreground py-2 pl-3">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {agregados.map((ag) => (
                <tr key={ag.sku} className="border-b last:border-b-0">
                  <td className="py-1.5 pr-3 font-mono text-xs sticky left-0 bg-background">
                    {ag.sku}
                  </td>
                  {colunas.map((c) => {
                    const v = ag.porData.get(c) ?? 0;
                    return (
                      <td
                        key={c}
                        className={
                          v === 0
                            ? "text-right py-1.5 px-2 text-muted-foreground/40 tabular-nums"
                            : `text-right py-1.5 px-2 font-mono tabular-nums ${classeColuna(c, hojeIso)}`
                        }
                      >
                        {v === 0 ? "·" : v.toLocaleString("pt-BR")}
                      </td>
                    );
                  })}
                  <td className="text-right py-1.5 pl-3 font-mono font-medium tabular-nums">
                    {ag.total.toLocaleString("pt-BR")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
