"use client";

// Cabeçalho enxuto + conteúdo de uma subtask direto na tela, sem card.
// Usado pela tela da OP (navegação por abas) e pela página single-subtask.

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  SUBTASK_PREFIXO_LABEL,
  SubtaskStatusBadge,
} from "./subtask-status-badge";
import { SubtaskConteudoRouter } from "./subtask-conteudo-router";
import { ReabrirSubtaskButton } from "./reabrir-subtask-button";
import type { ConfeccaoSubtask } from "@/lib/db/schema";

export function SubtaskPagina({
  subtask,
  opNumero,
  contaId,
  onAlterado,
  mostrarAbrirEmNovaAba = false,
}: {
  subtask: ConfeccaoSubtask & { atribuidoNome?: string | null };
  opNumero: string;
  contaId: string;
  onAlterado: () => void;
  mostrarAbrirEmNovaAba?: boolean;
}) {
  const labelTipo = SUBTASK_PREFIXO_LABEL[subtask.prefixo] ?? subtask.prefixo;
  const bloqueada = subtask.status === "bloqueada";

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-medium">{labelTipo}</h2>
            <span className="font-mono text-xs text-muted-foreground">
              {subtask.numero}
            </span>
            <SubtaskStatusBadge status={subtask.status} />
          </div>
          {subtask.atribuidoNome && (
            <div className="text-xs text-muted-foreground mt-0.5">
              Atribuída a {subtask.atribuidoNome}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {subtask.status === "concluida" && (
            <ReabrirSubtaskButton
              subtaskId={subtask.id}
              subtaskNumero={subtask.numero}
              onReaberta={onAlterado}
            />
          )}
          {mostrarAbrirEmNovaAba && !bloqueada && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              asChild
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
      </div>

      {bloqueada ? (
        <p className="text-sm text-muted-foreground">
          Subtask bloqueada — aguardando conclusão da subtask anterior.
        </p>
      ) : (
        <SubtaskConteudoRouter
          subtask={subtask}
          opNumero={opNumero}
          contaId={contaId}
          onAlterado={onAlterado}
        />
      )}
    </div>
  );
}
