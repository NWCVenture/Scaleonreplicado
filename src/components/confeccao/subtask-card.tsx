"use client";

// Card expansível de subtask. Renderiza header (status + número +
// atribuído) e, quando expandido, o conteúdo específico via
// SubtaskConteudoRouter. Card "bloqueada" não é expansível.

import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  SUBTASK_PREFIXO_LABEL,
  SubtaskStatusBadge,
} from "./subtask-status-badge";
import { SubtaskConteudoRouter } from "./subtask-conteudo-router";
import type { ConfeccaoSubtask } from "@/lib/db/schema";

export interface SubtaskCardProps {
  subtask: ConfeccaoSubtask & { atribuidoNome?: string | null };
  opNumero: string;
  expandido: boolean;
  onToggle: () => void;
  modoFullPage?: boolean;
}

export function SubtaskCard({
  subtask,
  opNumero,
  expandido,
  onToggle,
  modoFullPage = false,
}: SubtaskCardProps) {
  const bloqueada = subtask.status === "bloqueada";
  const podeExpandir = !bloqueada;
  const labelTipo = SUBTASK_PREFIXO_LABEL[subtask.prefixo] ?? subtask.prefixo;

  return (
    <div
      className={cn(
        "rounded-lg border bg-card transition-colors",
        bloqueada && "opacity-60",
        expandido && "ring-1 ring-primary/30",
      )}
    >
      <button
        type="button"
        className={cn(
          "w-full flex items-center gap-3 p-4 text-left",
          podeExpandir
            ? "cursor-pointer hover:bg-accent/40"
            : "cursor-not-allowed",
        )}
        onClick={() => podeExpandir && onToggle()}
        aria-expanded={expandido}
        aria-label={
          podeExpandir
            ? `${expandido ? "Recolher" : "Expandir"} ${labelTipo}`
            : `${labelTipo} (bloqueada — aguardando subtask anterior)`
        }
        title={
          bloqueada
            ? "Aguardando conclusão da subtask anterior"
            : undefined
        }
      >
        <div className="shrink-0">
          {podeExpandir ? (
            expandido ? (
              <ChevronDown className="size-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-4 text-muted-foreground" />
            )
          ) : (
            <ChevronRight className="size-4 text-muted-foreground/40" />
          )}
        </div>

        <div className="shrink-0 w-6 text-center text-sm font-medium text-muted-foreground tabular-nums">
          {subtask.ordemSequencial}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium">{labelTipo}</span>
            <span className="font-mono text-xs text-muted-foreground">
              {subtask.numero}
            </span>
          </div>
          {subtask.atribuidoNome && (
            <div className="text-xs text-muted-foreground mt-0.5">
              Atribuída a {subtask.atribuidoNome}
            </div>
          )}
        </div>

        <div className="shrink-0 flex items-center gap-2">
          <SubtaskStatusBadge status={subtask.status} />
          {!modoFullPage && podeExpandir && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              asChild
              onClick={(e) => e.stopPropagation()}
              title="Abrir em nova aba"
            >
              <Link
                href={`/confeccao/ops/${opNumero}/subtasks/${subtask.prefixo}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="size-3.5" />
              </Link>
            </Button>
          )}
        </div>
      </button>

      {expandido && podeExpandir && (
        <div className="border-t p-4">
          <SubtaskConteudoRouter subtask={subtask} />
        </div>
      )}
    </div>
  );
}
