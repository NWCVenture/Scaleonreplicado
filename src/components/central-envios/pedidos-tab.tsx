"use client";

import { useMemo } from "react";
import { Package } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { PedidoEnriquecido } from "@/types/central-envios";
import { deriveStatusPrazo } from "@/lib/central-envios/ui/avaliar-categoria";
import { cn } from "@/lib/utils";

type Props = {
  dados: PedidoEnriquecido[];
  hojeIso: string;
};

const LIMITE_UI = 500;

const LABEL_CANAL: Record<string, string> = {
  tiktok_shop: "TikTok",
  mercado_livre: "ML",
  shopee: "Shopee",
};

function badgeStatus(status: string) {
  const tom = {
    ATRASADO: "border-red-300 text-red-700 bg-red-50",
    HOJE: "border-orange-300 text-orange-700 bg-orange-50",
    NO_PRAZO: "border-emerald-300 text-emerald-700 bg-emerald-50",
    SEM_DATA: "border-zinc-300 text-zinc-700 bg-zinc-50",
  }[status] ?? "border-zinc-300 text-zinc-700";
  const label = {
    ATRASADO: "Atrasado",
    HOJE: "Hoje",
    NO_PRAZO: "No prazo",
    SEM_DATA: "Sem data",
  }[status] ?? status;
  return (
    <Badge variant="outline" className={cn("text-xs whitespace-nowrap", tom)}>
      {label}
    </Badge>
  );
}

export function PedidosTab({ dados, hojeIso }: Props) {
  const ordenados = useMemo(() => {
    return [...dados].sort((a, b) => {
      const ai = a.criadoEmIso ?? "";
      const bi = b.criadoEmIso ?? "";
      return bi.localeCompare(ai);
    });
  }, [dados]);

  if (ordenados.length === 0) {
    return (
      <div className="rounded-lg border border-dashed py-12 px-4 text-center text-muted-foreground">
        <Package className="mx-auto h-10 w-10 opacity-40" />
        <p className="mt-3 text-sm">Nenhum pedido carregado.</p>
      </div>
    );
  }

  const visiveis = ordenados.slice(0, LIMITE_UI);
  const truncado = ordenados.length > LIMITE_UI;

  return (
    <Card>
      <CardContent className="py-4 space-y-2">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {visiveis.length.toLocaleString("pt-BR")}
            {truncado && (
              <>
                {" de "}
                {ordenados.length.toLocaleString("pt-BR")}
                {" pedidos (limite UI 500 — use o Extrator pra filtrar)"}
              </>
            )}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b">
                <th className="text-left font-medium text-muted-foreground py-2 pr-2">
                  Canal
                </th>
                <th className="text-left font-medium text-muted-foreground py-2 pr-2">
                  Order ID
                </th>
                <th className="text-left font-medium text-muted-foreground py-2 pr-2">
                  Tracking
                </th>
                <th className="text-left font-medium text-muted-foreground py-2 pr-2">
                  SKU
                </th>
                <th className="text-left font-medium text-muted-foreground py-2 pr-2">
                  Modelo
                </th>
                <th className="text-left font-medium text-muted-foreground py-2 pr-2">
                  Cores
                </th>
                <th className="text-left font-medium text-muted-foreground py-2 pr-2">
                  Tam
                </th>
                <th className="text-right font-medium text-muted-foreground py-2 pr-2">
                  Qtd
                </th>
                <th className="text-left font-medium text-muted-foreground py-2 pr-2">
                  Prazo
                </th>
                <th className="text-left font-medium text-muted-foreground py-2">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((p, i) => {
                const status = deriveStatusPrazo(p.prazo.prazoIso, hojeIso);
                const parsedOk = p.parsed.kind === "OK" ? p.parsed : null;
                const isAmb = !parsedOk;
                const modelo = parsedOk ? parsedOk.modeloCodigo : "—";
                const tamanho = parsedOk ? parsedOk.tamanho : "—";
                const cores = parsedOk
                  ? parsedOk.cores
                      .map((c) => (c.qtd > 1 ? `${c.qtd}× ${c.cor}` : c.cor))
                      .join(" + ")
                  : "—";
                return (
                  <tr
                    key={`${p.canal}-${p.orderId}-${i}`}
                    className="border-b last:border-b-0 align-top"
                  >
                    <td className="py-1.5 pr-2">{LABEL_CANAL[p.canal] ?? p.canal}</td>
                    <td className="py-1.5 pr-2 font-mono">{p.orderId}</td>
                    <td className="py-1.5 pr-2 font-mono text-muted-foreground">
                      {p.trackingId ?? "—"}
                    </td>
                    <td className="py-1.5 pr-2 font-mono">{p.skuRaw}</td>
                    <td className="py-1.5 pr-2">
                      {isAmb ? (
                        <Badge
                          variant="outline"
                          className="border-amber-300 text-amber-700 bg-amber-50 text-xs"
                        >
                          Ambíguo
                        </Badge>
                      ) : (
                        modelo
                      )}
                    </td>
                    <td className="py-1.5 pr-2">{cores}</td>
                    <td className="py-1.5 pr-2">{tamanho}</td>
                    <td className="py-1.5 pr-2 text-right font-mono tabular-nums">
                      {p.quantidadeRaw}
                    </td>
                    <td className="py-1.5 pr-2 font-mono">
                      {p.prazo.prazoIso ?? "—"}
                    </td>
                    <td className="py-1.5">{badgeStatus(status)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
