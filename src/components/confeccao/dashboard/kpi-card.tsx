"use client";

// Card de KPI do dashboard (RITM-20).

import type { LucideIcon } from "lucide-react";

interface KpiCardProps {
  label: string;
  valor: number | string;
  icon: LucideIcon;
  variant?: "default" | "warning" | "success";
  hint?: string;
}

const VARIANT_CLASSES: Record<NonNullable<KpiCardProps["variant"]>, string> = {
  default: "text-foreground",
  warning: "text-amber-600 dark:text-amber-400",
  success: "text-emerald-600 dark:text-emerald-400",
};

export function KpiCard({
  label,
  valor,
  icon: Icon,
  variant = "default",
  hint,
}: KpiCardProps) {
  return (
    <div className="rounded-md border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <Icon className={`size-4 ${VARIANT_CLASSES[variant]}`} />
      </div>
      <div
        className={`mt-2 text-3xl font-semibold tabular-nums ${VARIANT_CLASSES[variant]}`}
      >
        {valor}
      </div>
      {hint && (
        <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
      )}
    </div>
  );
}
