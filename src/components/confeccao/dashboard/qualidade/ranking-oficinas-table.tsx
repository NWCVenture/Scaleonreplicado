"use client";

// Tabela de ranking de oficinas — RITM-21.
// Colunas ordenáveis. Clicar numa linha abre o detalhe (callback).

import { useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface RankingOficinaItem {
  oficinaId: string;
  oficinaNome: string;
  pecasAvaliadas: number;
  aprovacao: number;
  tempoMedioDias: number | null;
  pontualidade: number | null;
  divergenciasConfirmadas: number;
}

type SortKey =
  | "oficinaNome"
  | "pecasAvaliadas"
  | "aprovacao"
  | "tempoMedioDias"
  | "pontualidade"
  | "divergenciasConfirmadas";

interface ColunaDef {
  key: SortKey;
  label: string;
  align?: "left" | "right";
}

const COLUNAS: ColunaDef[] = [
  { key: "oficinaNome", label: "Oficina", align: "left" },
  { key: "pecasAvaliadas", label: "Peças avaliadas", align: "right" },
  { key: "aprovacao", label: "% aprovação", align: "right" },
  { key: "tempoMedioDias", label: "Tempo médio (dias)", align: "right" },
  { key: "pontualidade", label: "% pontualidade", align: "right" },
  { key: "divergenciasConfirmadas", label: "Divergências", align: "right" },
];

function percent(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

interface RankingOficinasTableProps {
  data: RankingOficinaItem[];
  onSelect?: (oficinaId: string) => void;
}

export function RankingOficinasTable({
  data,
  onSelect,
}: RankingOficinasTableProps) {
  // Default sort do service já é "aprovação desc + peças desc". A UI
  // permite reordenar pela coluna clicada; um segundo clique inverte.
  const [sortKey, setSortKey] = useState<SortKey>("aprovacao");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sorted = [...data].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (av === null && bv === null) return 0;
    if (av === null) return 1; // null sempre por último
    if (bv === null) return -1;
    const cmp =
      typeof av === "string" && typeof bv === "string"
        ? av.localeCompare(bv)
        : (av as number) - (bv as number);
    return sortDir === "asc" ? cmp : -cmp;
  });

  if (data.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-md border border-dashed bg-card text-sm text-muted-foreground">
        Nenhuma oficina com subconferências concluídas no período.
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            {COLUNAS.map((c) => (
              <TableHead
                key={c.key}
                className={cn(
                  "cursor-pointer select-none",
                  c.align === "right" && "text-right",
                )}
                onClick={() => handleSort(c.key)}
              >
                <span
                  className={cn(
                    "inline-flex items-center gap-1",
                    c.align === "right" && "flex-row-reverse",
                  )}
                >
                  {c.label}
                  {sortKey === c.key ? (
                    sortDir === "asc" ? (
                      <ArrowUp className="size-3" />
                    ) : (
                      <ArrowDown className="size-3" />
                    )
                  ) : (
                    <ArrowUpDown className="size-3 opacity-30" />
                  )}
                </span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((r) => (
            <TableRow
              key={r.oficinaId}
              className={cn(
                onSelect && "cursor-pointer hover:bg-muted/40",
              )}
              onClick={() => onSelect?.(r.oficinaId)}
            >
              <TableCell className="font-medium">{r.oficinaNome}</TableCell>
              <TableCell className="text-right tabular-nums">
                {r.pecasAvaliadas}
              </TableCell>
              <TableCell
                className={cn(
                  "text-right tabular-nums",
                  r.aprovacao >= 0.95
                    ? "text-emerald-600 dark:text-emerald-400"
                    : r.aprovacao < 0.85
                      ? "text-amber-600 dark:text-amber-400"
                      : "",
                )}
              >
                {percent(r.aprovacao)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {r.tempoMedioDias === null
                  ? "—"
                  : r.tempoMedioDias.toFixed(1)}
              </TableCell>
              <TableCell
                className={cn(
                  "text-right tabular-nums",
                  r.pontualidade !== null && r.pontualidade < 0.85
                    ? "text-amber-600 dark:text-amber-400"
                    : "",
                )}
              >
                {r.pontualidade === null ? "—" : percent(r.pontualidade)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {r.divergenciasConfirmadas}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
