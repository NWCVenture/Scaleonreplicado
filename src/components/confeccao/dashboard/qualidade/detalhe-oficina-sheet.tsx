"use client";

// Sheet lateral com lista cronológica de subconferências de uma oficina.
// RITM-21. Aberto on-click numa linha do ranking.

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";

const LABEL_DEFEITO: Record<string, string> = {
  rebarba: "Rebarba",
  costura_desalinhada: "Costura desal.",
  costura_incompleta: "Costura incomp.",
  gola: "Gola",
  mancha: "Mancha",
  tecido: "Tecido",
  furo: "Furo",
  outros: "Outros",
};

export interface DetalheSubconferenciaItem {
  subconferenciaId: string;
  subconferenciaNumero: string;
  opNumero: string;
  dataInspecao: string | null;
  aprovadas: number;
  reprovadas: number;
  tiposDefeito: string[];
}

interface DetalheOficinaSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  oficinaNome: string | null;
  items: DetalheSubconferenciaItem[];
}

function formatarData(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function DetalheOficinaSheet({
  open,
  onOpenChange,
  oficinaNome,
  items,
}: DetalheOficinaSheetProps) {
  const totalAvaliadas = items.reduce(
    (s, i) => s + i.aprovadas + i.reprovadas,
    0,
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{oficinaNome ?? "Oficina"}</SheetTitle>
          <SheetDescription>
            {items.length} subconferência(s) no período • {totalAvaliadas}{" "}
            peças avaliadas
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-3 p-4 pt-0">
          {items.length === 0 && (
            <div className="text-sm text-muted-foreground">
              Nenhuma subconferência concluída.
            </div>
          )}
          {items.map((i) => {
            const total = i.aprovadas + i.reprovadas;
            const pctAprov = total > 0 ? (i.aprovadas / total) * 100 : 0;
            return (
              <div
                key={i.subconferenciaId}
                className="rounded-md border bg-card p-3 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {i.subconferenciaNumero}
                    </div>
                    <div className="text-sm font-medium">
                      OP {i.opNumero}
                    </div>
                  </div>
                  <Link
                    href={`/confeccao/ops/${encodeURIComponent(i.opNumero)}`}
                    target="_blank"
                    className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
                  >
                    Ver OP <ExternalLink className="size-3" />
                  </Link>
                </div>
                <div className="text-xs text-muted-foreground">
                  Inspeção: {formatarData(i.dataInspecao)}
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground">
                      Aprovadas
                    </div>
                    <div className="font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
                      {i.aprovadas}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">
                      Reprovadas
                    </div>
                    <div className="font-medium tabular-nums text-amber-600 dark:text-amber-400">
                      {i.reprovadas}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">
                      % aprovação
                    </div>
                    <div className="font-medium tabular-nums">
                      {pctAprov.toFixed(1)}%
                    </div>
                  </div>
                </div>
                {i.tiposDefeito.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {i.tiposDefeito.map((d) => (
                      <Badge
                        key={d}
                        variant="outline"
                        className="text-[10px]"
                      >
                        {LABEL_DEFEITO[d] ?? d}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
