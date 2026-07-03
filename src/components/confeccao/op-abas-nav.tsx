"use client";

// Barra de abas da OP (estilo abas de planilha, no topo da página).
// Navegação REAL entre páginas: "Visão geral" → /confeccao/ops/[numero],
// cada subtask → /confeccao/ops/[numero]/subtasks/[prefixo]. A aba ativa
// vem do pathname. Subtask bloqueada fica desabilitada.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { SUBTASK_PREFIXO_LABEL } from "./subtask-status-badge";
import type {
  ConfeccaoSubtask,
  ConfeccaoSubtaskStatus,
} from "@/lib/db/schema";

const STATUS_DOT: Record<ConfeccaoSubtaskStatus, string> = {
  bloqueada: "bg-slate-300",
  pendente: "bg-amber-400",
  em_andamento: "bg-blue-500",
  concluida: "bg-emerald-500",
  cancelada: "bg-red-500",
};

export function OpAbasNav({
  opNumero,
  subtasks,
}: {
  opNumero: string;
  subtasks: Array<
    Pick<ConfeccaoSubtask, "id" | "prefixo" | "ordemSequencial" | "status">
  >;
}) {
  const pathname = usePathname();
  const base = `/confeccao/ops/${opNumero}`;

  function classesAba(ativa: boolean, desabilitada = false) {
    return cn(
      "flex items-center gap-2 rounded-t-md border border-b-0 px-4 py-2 text-sm whitespace-nowrap transition-colors",
      ativa
        ? "-mb-px border-border bg-background font-medium"
        : "border-transparent bg-muted/50 text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      desabilitada && "cursor-not-allowed opacity-50 hover:bg-muted/50",
    );
  }

  return (
    <div className="flex items-end gap-1 overflow-x-auto border-b">
      {/* prefetch={true}: rota dinâmica sem loading.js não é pré-carregada
          por padrão — sem isso, cada clique de aba espera uma ida ao
          servidor buscar o payload RSC (~segundos). Com prefetch cheio,
          as rotas das abas carregam em background e a troca é imediata. */}
      <Link
        href={base}
        prefetch={true}
        className={classesAba(pathname === base)}
      >
        Visão geral
      </Link>
      {subtasks.map((s) => {
        const href = `${base}/subtasks/${s.prefixo}`;
        const label = SUBTASK_PREFIXO_LABEL[s.prefixo] ?? s.prefixo;
        const bloqueada = s.status === "bloqueada";
        const conteudo = (
          <>
            <span className="text-xs text-muted-foreground tabular-nums">
              {s.ordemSequencial}
            </span>
            {label}
            <span
              className={cn(
                "size-2 shrink-0 rounded-full",
                STATUS_DOT[s.status],
              )}
            />
          </>
        );
        if (bloqueada) {
          return (
            <span
              key={s.id}
              className={classesAba(false, true)}
              title="Aguardando conclusão da subtask anterior"
            >
              {conteudo}
            </span>
          );
        }
        return (
          <Link
            key={s.id}
            href={href}
            prefetch={true}
            className={classesAba(pathname === href)}
          >
            {conteudo}
          </Link>
        );
      })}
    </div>
  );
}
