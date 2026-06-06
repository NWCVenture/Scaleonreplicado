"use client";

import { useMemo } from "react";
import { Package } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { PedidoEnriquecido } from "@/types/central-envios";

type Props = {
  dados: PedidoEnriquecido[];
};

type Agregado = {
  modeloCodigo: string;
  cores: string[];
  tamanhos: string[];
  // matriz [cor][tamanho] = qtd
  matriz: Map<string, Map<string, number>>;
  total: number;
};

function agregarPorModelo(dados: PedidoEnriquecido[]): Agregado[] {
  const porModelo = new Map<string, Agregado>();
  for (const p of dados) {
    for (const linha of p.linhasExplodidas) {
      const m =
        porModelo.get(linha.modeloCodigo) ??
        ({
          modeloCodigo: linha.modeloCodigo,
          cores: [],
          tamanhos: [],
          matriz: new Map<string, Map<string, number>>(),
          total: 0,
        } satisfies Agregado);
      const linhaCor = m.matriz.get(linha.cor) ?? new Map<string, number>();
      linhaCor.set(linha.tamanho, (linhaCor.get(linha.tamanho) ?? 0) + linha.qtd);
      m.matriz.set(linha.cor, linhaCor);
      m.total += linha.qtd;
      porModelo.set(linha.modeloCodigo, m);
    }
  }
  // Deriva cores/tamanhos ordenados
  const lista: Agregado[] = [];
  for (const ag of porModelo.values()) {
    const cores = [...ag.matriz.keys()].sort();
    const tamanhosSet = new Set<string>();
    for (const linhaCor of ag.matriz.values()) {
      for (const tam of linhaCor.keys()) tamanhosSet.add(tam);
    }
    ag.cores = cores;
    ag.tamanhos = [...tamanhosSet].sort();
    lista.push(ag);
  }
  return lista.sort((a, b) => b.total - a.total);
}

export function CronogramaTab({ dados }: Props) {
  const agregados = useMemo(() => agregarPorModelo(dados), [dados]);

  if (agregados.length === 0) {
    return (
      <div className="rounded-lg border border-dashed py-12 px-4 text-center text-muted-foreground">
        <Package className="mx-auto h-10 w-10 opacity-40" />
        <p className="mt-3 text-sm">
          Nenhuma linha explodida. Verifique se há pedidos não-ambíguos.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {agregados.map((ag) => (
        <Card key={ag.modeloCodigo}>
          <CardContent className="py-4">
            <div className="flex items-baseline justify-between mb-3">
              <h3 className="text-lg font-semibold tracking-tight">
                {ag.modeloCodigo}
              </h3>
              <span className="text-sm text-muted-foreground">
                Total{" "}
                <span className="font-mono font-medium text-foreground tabular-nums">
                  {ag.total.toLocaleString("pt-BR")}
                </span>
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left font-medium text-muted-foreground pb-2 pr-3">
                      Cor / Tamanho
                    </th>
                    {ag.tamanhos.map((t) => (
                      <th
                        key={t}
                        className="text-right font-medium text-muted-foreground pb-2 px-2"
                      >
                        {t}
                      </th>
                    ))}
                    <th className="text-right font-medium text-muted-foreground pb-2 pl-3">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ag.cores.map((cor) => {
                    const linhaCor = ag.matriz.get(cor)!;
                    const totalCor = ag.tamanhos.reduce(
                      (acc, t) => acc + (linhaCor.get(t) ?? 0),
                      0,
                    );
                    return (
                      <tr key={cor} className="border-t">
                        <td className="py-1.5 pr-3 font-medium">{cor}</td>
                        {ag.tamanhos.map((t) => {
                          const v = linhaCor.get(t) ?? 0;
                          return (
                            <td
                              key={t}
                              className={
                                v === 0
                                  ? "text-right py-1.5 px-2 text-muted-foreground/40 tabular-nums"
                                  : "text-right py-1.5 px-2 font-mono tabular-nums"
                              }
                            >
                              {v === 0 ? "·" : v.toLocaleString("pt-BR")}
                            </td>
                          );
                        })}
                        <td className="text-right py-1.5 pl-3 font-mono font-medium tabular-nums">
                          {totalCor.toLocaleString("pt-BR")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
