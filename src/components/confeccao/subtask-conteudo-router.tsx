"use client";

// Router que decide qual conteúdo renderizar dentro de um SubtaskCard
// expandido, baseado no prefixo. As implementações específicas de cada
// subtask vêm nas RITMs 08-13; por ora todos os prefixos mostram placeholder.

import type {
  ConfeccaoSubtask,
  ConfeccaoSubtaskPrefixo,
} from "@/lib/db/schema";

const PLACEHOLDERS: Record<ConfeccaoSubtaskPrefixo, string> = {
  OPBUY: "RITM-08 — Compra de Tecido (em desenvolvimento)",
  OPRIS: "RITM-09 — Risco (em desenvolvimento)",
  OPCOR: "RITM-10 — Corte (em desenvolvimento)",
  OPVIE: "RITM-11 — Viés (em desenvolvimento)",
  OPSEW: "RITM-12 — Costura (em desenvolvimento)",
  OPCONF: "RITM-13 — Conferência (em desenvolvimento)",
};

export function SubtaskConteudoRouter({
  subtask,
}: {
  subtask: Pick<ConfeccaoSubtask, "prefixo" | "id" | "numero">;
}) {
  const msg = PLACEHOLDERS[subtask.prefixo];
  return (
    <div className="rounded-md border border-dashed bg-muted/30 p-6 text-sm">
      <p className="font-medium text-foreground mb-1">{msg}</p>
      <p className="text-muted-foreground text-xs">
        Os campos específicos desta subtask serão implementados na RITM
        correspondente. Por ora você pode ver os metadados básicos no header
        deste card.
      </p>
    </div>
  );
}
