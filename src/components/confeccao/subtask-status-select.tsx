"use client";

// Seletor de status da subtask — substitui os botões Iniciar/Concluir.
// Opções disponíveis dependem do status atual:
//
//   bloqueada    → (read-only; só sistema desbloqueia)
//   pendente     → em_andamento (iniciar)
//                · cancelada (com justificativa)
//   em_andamento → pendente (voltar)
//                · concluida (valida payload server-side)
//                · cancelada (com justificativa)
//   concluida    → em_andamento (admin + justificativa via /reabrir)
//                · cancelada (com justificativa)
//   cancelada    → pendente (admin + justificativa via /transicionar)
//
// Pre-save: componentes de subtask passam `onAntesDeMudar(novoStatus)`
// pra salvar rascunho antes da transição (ex: subtask-corte salva o
// payload local antes de bater no /concluir do servidor).

import { useState } from "react";
import {
  Ban,
  Check,
  CircleDashed,
  CircleSlash,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { usePapelAtivo } from "@/hooks/use-papel-ativo";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ConfeccaoSubtaskStatus } from "@/lib/db/schema";

export interface SubtaskStatusSelectProps {
  subtaskId: string;
  subtaskNumero: string;
  status: ConfeccaoSubtaskStatus;
  /**
   * Chamado antes da transição. Retorne false pra abortar (ex: falha de
   * salvamento, validação client-side). Default = noop true.
   */
  onAntesDeMudar?: (novoStatus: ConfeccaoSubtaskStatus) => Promise<boolean>;
  onMudou: () => void;
  className?: string;
}

const STATUS_CONFIG: Record<
  ConfeccaoSubtaskStatus,
  {
    label: string;
    classes: string;
    Icon: React.ComponentType<{ className?: string }>;
  }
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

/** Quais opções (status alvo) o usuário vê no dropdown, dado o status atual. */
function opcoesDisponiveis(
  atual: ConfeccaoSubtaskStatus,
): ConfeccaoSubtaskStatus[] {
  switch (atual) {
    case "bloqueada":
      return ["bloqueada"]; // só o próprio (read-only)
    case "pendente":
      return ["pendente", "em_andamento", "concluida", "cancelada"];
    case "em_andamento":
      return ["pendente", "em_andamento", "concluida", "cancelada"];
    case "concluida":
      return ["em_andamento", "concluida", "cancelada"];
    case "cancelada":
      return ["pendente", "cancelada"];
  }
}

export function SubtaskStatusSelect({
  subtaskId,
  subtaskNumero,
  status,
  onAntesDeMudar,
  onMudou,
  className,
}: SubtaskStatusSelectProps) {
  const { isAdmin } = usePapelAtivo();
  const [enviando, setEnviando] = useState(false);

  /** Modal de justificativa — usado pra cancelar, reabrir, descancelar. */
  const [modalAlvo, setModalAlvo] =
    useState<ConfeccaoSubtaskStatus | null>(null);
  const [justificativa, setJustificativa] = useState("");
  const [modalSalvando, setModalSalvando] = useState(false);

  const opcoes = opcoesDisponiveis(status);
  const readOnly = status === "bloqueada";

  async function aplicarTransicao(
    alvo: ConfeccaoSubtaskStatus,
    justif?: string,
  ): Promise<boolean> {
    // Pre-save da subtask (rascunho) — só pra alvos onde o backend
    // precisa do payload mais recente.
    if (alvo === "concluida" || alvo === "em_andamento") {
      if (onAntesDeMudar) {
        const ok = await onAntesDeMudar(alvo);
        if (!ok) return false;
      }
    }

    let url: string;
    let body: unknown = undefined;
    if (status === "pendente" && alvo === "em_andamento") {
      url = `/api/confeccao/subtasks/${subtaskId}/iniciar`;
    } else if (alvo === "concluida") {
      // Pendente → concluida e em_andamento → concluida: ambos validam
      // via /concluir. Se status atual é pendente, o backend agora
      // recusa (status_invalido). Por simplicidade: pendente → concluida
      // exige passar por em_andamento primeiro (iniciar inline).
      if (status === "pendente") {
        const r0 = await fetch(
          `/api/confeccao/subtasks/${subtaskId}/iniciar`,
          { method: "POST" },
        );
        if (!r0.ok) {
          const d = await r0.json().catch(() => ({}));
          toast.error(
            (d as { error?: string }).error ?? "Erro ao iniciar antes de concluir",
          );
          return false;
        }
      }
      url = `/api/confeccao/subtasks/${subtaskId}/concluir`;
    } else if (status === "concluida" && alvo === "em_andamento") {
      url = `/api/confeccao/subtasks/${subtaskId}/reabrir`;
      body = { justificativa: justif ?? "" };
    } else {
      // Outras transições passam pelo endpoint unificado
      url = `/api/confeccao/subtasks/${subtaskId}/transicionar`;
      body = { para: alvo, justificativa: justif };
    }

    const res = await fetch(url, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      subtask?: { proximaDesbloqueada?: { numero: string } | null };
    };
    if (!res.ok) {
      toast.error(data.error ?? "Erro ao mudar status");
      return false;
    }
    const proxima = data.subtask?.proximaDesbloqueada;
    toast.success(
      proxima
        ? `Status: ${STATUS_CONFIG[alvo].label}. Próxima desbloqueada: ${proxima.numero}`
        : `Status: ${STATUS_CONFIG[alvo].label}`,
    );
    onMudou();
    return true;
  }

  async function handleChange(novo: string) {
    const alvo = novo as ConfeccaoSubtaskStatus;
    if (alvo === status) return;

    // Casos que precisam de modal de justificativa antes de aplicar
    if (alvo === "cancelada") {
      setModalAlvo(alvo);
      setJustificativa("");
      return;
    }
    if (status === "concluida" && alvo === "em_andamento") {
      if (!isAdmin) {
        toast.error("Só admins podem reabrir subtarefa concluída");
        return;
      }
      setModalAlvo(alvo);
      setJustificativa("");
      return;
    }
    if (status === "cancelada" && alvo === "pendente") {
      if (!isAdmin) {
        toast.error("Só admins podem reativar subtarefa cancelada");
        return;
      }
      setModalAlvo(alvo);
      setJustificativa("");
      return;
    }

    setEnviando(true);
    try {
      await aplicarTransicao(alvo);
    } finally {
      setEnviando(false);
    }
  }

  async function confirmarComJustificativa() {
    if (justificativa.trim().length < 5) {
      toast.error("Justificativa precisa ter pelo menos 5 caracteres");
      return;
    }
    if (!modalAlvo) return;
    setModalSalvando(true);
    try {
      const ok = await aplicarTransicao(modalAlvo, justificativa.trim());
      if (ok) {
        setModalAlvo(null);
        setJustificativa("");
      }
    } finally {
      setModalSalvando(false);
    }
  }

  const { Icon, classes } = STATUS_CONFIG[status];

  // Bloqueada: render só o badge (não editável)
  if (readOnly) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded border",
          classes,
          className,
        )}
      >
        <Icon className="size-3" />
        {STATUS_CONFIG[status].label}
      </span>
    );
  }

  return (
    <>
      <Select value={status} onValueChange={handleChange} disabled={enviando}>
        <SelectTrigger
          className={cn(
            "h-7 text-xs font-medium border w-auto min-w-[10rem] gap-1.5 px-2",
            classes,
            className,
          )}
          aria-label={`Status: ${STATUS_CONFIG[status].label}`}
        >
          <Icon className="size-3" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {opcoes.map((s) => {
            const cfg = STATUS_CONFIG[s];
            const SubIcon = cfg.Icon;
            const desabilitado =
              (status === "concluida" && s === "em_andamento" && !isAdmin) ||
              (status === "cancelada" && s === "pendente" && !isAdmin);
            return (
              <SelectItem
                key={s}
                value={s}
                disabled={desabilitado}
                className="text-xs"
              >
                <span className="inline-flex items-center gap-1.5">
                  <SubIcon className="size-3" />
                  {cfg.label}
                  {desabilitado && (
                    <span className="text-[10px] text-muted-foreground ml-1">
                      (admin)
                    </span>
                  )}
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>

      <Dialog
        open={modalAlvo !== null}
        onOpenChange={(open) => {
          if (!open) {
            setModalAlvo(null);
            setJustificativa("");
          }
        }}
      >
        <DialogContent
          className="sm:max-w-md"
          onClick={(e) => e.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle>
              {modalAlvo === "cancelada"
                ? `Cancelar subtask ${subtaskNumero}`
                : modalAlvo === "em_andamento"
                  ? `Reabrir subtask ${subtaskNumero}`
                  : `Reativar subtask ${subtaskNumero}`}
            </DialogTitle>
            <DialogDescription>
              {modalAlvo === "cancelada"
                ? "A subtask vira 'cancelada' e fica fora do fluxo. Ação registrada nas notas com justificativa."
                : modalAlvo === "em_andamento"
                  ? "A subtask volta pra 'em andamento'. Ação registrada nas notas com justificativa."
                  : "A subtask volta pra 'pendente' e pode ser executada novamente. Ação registrada nas notas com justificativa."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="justif-status">Justificativa</Label>
            <Textarea
              id="justif-status"
              value={justificativa}
              onChange={(e) => setJustificativa(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder={
                modalAlvo === "cancelada"
                  ? "Ex: oficina cancelou a parceria, OP descartada"
                  : "Ex: marcada por engano, faltou registrar dados"
              }
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setModalAlvo(null);
                setJustificativa("");
              }}
            >
              Cancelar
            </Button>
            <Button
              onClick={confirmarComJustificativa}
              disabled={
                modalSalvando || justificativa.trim().length < 5
              }
            >
              {modalSalvando ? "Aplicando…" : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
