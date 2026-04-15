"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Package,
  ChevronDown,
  ChevronUp,
  Trash2,
  Plus,
  Loader2,
} from "lucide-react";
import { compareSKU } from "@/lib/estante-utils";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface FardoItem {
  id: string;
  sku: string;
  lote: string;
  quantidade: number;
  adicionadoPor: string;
  createdAt: string;
}

interface FardosAgrupadosProps {
  fardos: FardoItem[];
  expandedGroups: Set<string>;
  toggleGroup: (sku: string) => void;
  onRemove: (fardoId: string) => void;
  onAddFirst: () => void;
  removingId?: string | null;
}

export function FardosAgrupados({
  fardos,
  expandedGroups,
  toggleGroup,
  onRemove,
  onAddFirst,
  removingId,
}: FardosAgrupadosProps) {
  const grouped: Record<string, FardoItem[]> = {};
  fardos.forEach((f) => {
    if (!grouped[f.sku]) grouped[f.sku] = [];
    grouped[f.sku].push(f);
  });
  const sortedSkus = Object.keys(grouped).sort(compareSKU);

  if (sortedSkus.length === 0) {
    return (
      <div className="flex flex-col items-center py-12 text-center border border-dashed border-slate-700 rounded-xl">
        <Package className="h-10 w-10 text-muted-foreground/20 mb-3" />
        <p className="text-sm text-muted-foreground">
          Nenhum fardo nesta estante
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={onAddFirst}
        >
          <Plus className="h-4 w-4 mr-1" /> Adicionar Fardo
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {sortedSkus.map((sku) => {
        const grupo = grouped[sku];
        const totalPecas = grupo.reduce((s, f) => s + f.quantidade, 0);
        const isExpanded = expandedGroups.has(sku);
        return (
          <div
            key={sku}
            className="border border-slate-700 rounded-lg overflow-hidden"
          >
            <button
              className="w-full flex items-center justify-between px-4 py-3 bg-slate-800/60 hover:bg-slate-800 transition-colors"
              onClick={() => toggleGroup(sku)}
            >
              <div className="flex items-center gap-3">
                <span className="font-mono font-bold text-sm">{sku}</span>
                <span className="text-xs bg-slate-900 border border-slate-700 px-2 py-0.5 rounded-full">
                  {grupo.length} fardos
                </span>
                <span className="text-xs text-muted-foreground font-semibold">
                  {totalPecas} pcs
                </span>
              </div>
              {isExpanded ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
            </button>
            {isExpanded && (
              <div className="divide-y divide-slate-700">
                {grupo.map((fardo) => (
                  <div
                    key={fardo.id}
                    className="flex items-center justify-between px-4 py-2.5 gap-2"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs bg-slate-800 px-2 py-0.5 rounded font-mono">
                          {fardo.lote}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {fardo.quantidade} un/fardo
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                        <span>{formatDate(fardo.createdAt)}</span>
                        <span>{fardo.adicionadoPor}</span>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                      disabled={removingId === fardo.id}
                      onClick={() => onRemove(fardo.id)}
                    >
                      {removingId === fardo.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
