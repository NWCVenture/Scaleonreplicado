"use client";

import { cn } from "@/lib/utils";
import type { TransportadoraLabel } from "@/types/coletas";
import { CARRIER_COLORS, CARRIER_DISPLAY } from "@/types/coletas";
import { Trash2, RotateCcw } from "lucide-react";

interface PacoteListItemProps {
  codigo: string;
  index: number;
  carrier: TransportadoraLabel;
  hasDevolucao: boolean;
  onRemove: () => void;
  onEditDevolucao: () => void;
}

export function PacoteListItem({
  codigo,
  index,
  carrier,
  hasDevolucao,
  onRemove,
  onEditDevolucao,
}: PacoteListItemProps) {
  return (
    <div className="flex items-center gap-2 p-2 rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-zinc-800/80 group transition-all">
      <span className="text-zinc-500 w-6 text-right text-xs flex-shrink-0 tabular-nums">
        {index + 1}.
      </span>
      <span
        className={cn(
          "text-xs font-bold px-1.5 py-0.5 rounded border flex-shrink-0",
          CARRIER_COLORS[carrier],
        )}
      >
        {CARRIER_DISPLAY[carrier]}
      </span>
      <span className="font-mono font-medium text-zinc-200 flex-1 text-xs truncate">
        {codigo}
      </span>

      {hasDevolucao && (
        <button
          onClick={onEditDevolucao}
          className="flex-shrink-0 text-green-400 hover:text-green-300 p-1 rounded hover:bg-green-500/10 transition-colors"
          title="Editar devolucao"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      )}

      <button
        onClick={onRemove}
        className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-red-500/10 rounded text-red-400 hover:text-red-300"
        title="Remover pacote"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
