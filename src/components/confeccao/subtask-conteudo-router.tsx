"use client";

// Router que decide qual conteúdo renderizar dentro de um SubtaskCard
// expandido, baseado no prefixo. RITM-08 implementa OPBUY; demais subtasks
// (09-13) mostram placeholder até que cada RITM seja entregue.

import { SubtaskCompra } from "./subtask-compra";
import { SubtaskCorte } from "./subtask-corte";
import { SubtaskRisco } from "./subtask-risco";
import { SubtaskVies } from "./subtask-vies";
import type {
  ConfeccaoSubtask,
  ConfeccaoSubtaskPrefixo,
} from "@/lib/db/schema";

const PLACEHOLDERS: Record<ConfeccaoSubtaskPrefixo, string> = {
  OPBUY: "RITM-08 — Compra de Tecido",
  OPRIS: "RITM-09 — Risco",
  OPCOR: "RITM-10 — Corte",
  OPVIE: "RITM-11 — Viés",
  OPSEW: "RITM-12 — Costura (em desenvolvimento)",
  OPCONF: "RITM-13 — Conferência (em desenvolvimento)",
};

export interface SubtaskConteudoRouterProps {
  subtask: ConfeccaoSubtask;
  opNumero: string;
  contaId: string;
  onAlterado: () => void;
}

export function SubtaskConteudoRouter({
  subtask,
  opNumero,
  contaId,
  onAlterado,
}: SubtaskConteudoRouterProps) {
  if (subtask.prefixo === "OPBUY") {
    return (
      <SubtaskCompra
        subtask={subtask}
        opNumero={opNumero}
        contaId={contaId}
        onAlterado={onAlterado}
      />
    );
  }
  if (subtask.prefixo === "OPRIS") {
    return (
      <SubtaskRisco
        subtask={subtask}
        opNumero={opNumero}
        contaId={contaId}
        onAlterado={onAlterado}
      />
    );
  }
  if (subtask.prefixo === "OPCOR") {
    return (
      <SubtaskCorte
        subtask={subtask}
        opNumero={opNumero}
        contaId={contaId}
        onAlterado={onAlterado}
      />
    );
  }
  if (subtask.prefixo === "OPVIE") {
    return (
      <SubtaskVies
        subtask={subtask}
        opNumero={opNumero}
        contaId={contaId}
        onAlterado={onAlterado}
      />
    );
  }

  const msg = PLACEHOLDERS[subtask.prefixo];
  return (
    <div className="rounded-md border border-dashed bg-muted/30 p-6 text-sm">
      <p className="font-medium text-foreground mb-1">{msg}</p>
      <p className="text-muted-foreground text-xs">
        Os campos específicos desta subtask serão implementados na RITM
        correspondente.
      </p>
    </div>
  );
}
