"use client";

import {
  Ban,
  Check,
  CircleDashed,
  CircleSlash,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConfeccaoSubtaskStatus } from "@/lib/db/schema";

const CONFIG: Record<
  ConfeccaoSubtaskStatus,
  { label: string; classes: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  bloqueada: {
    label: "Bloqueada",
    classes: "bg-slate-100 text-slate-500 border-slate-200",
    Icon: CircleSlash,
  },
  pendente: {
    label: "Pendente",
    classes: "bg-amber-50 text-amber-700 border-amber-200",
    Icon: CircleDashed,
  },
  em_andamento: {
    label: "Em andamento",
    classes: "bg-blue-50 text-blue-700 border-blue-200",
    Icon: Loader2,
  },
  concluida: {
    label: "Concluída",
    classes: "bg-emerald-50 text-emerald-700 border-emerald-200",
    Icon: Check,
  },
  cancelada: {
    label: "Cancelada",
    classes: "bg-red-50 text-red-700 border-red-200",
    Icon: Ban,
  },
};

export function SubtaskStatusBadge({
  status,
  className,
}: {
  status: ConfeccaoSubtaskStatus;
  className?: string;
}) {
  const { label, classes, Icon } = CONFIG[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded border",
        classes,
        className,
      )}
    >
      <Icon className="size-3" />
      {label}
    </span>
  );
}

export const SUBTASK_PREFIXO_LABEL: Record<string, string> = {
  OPBUY: "Compra de Tecido",
  OPRIS: "Risco",
  OPCOR: "Corte",
  OPVIE: "Viés",
  OPSEW: "Costura",
  OPCONF: "Conferência",
};
