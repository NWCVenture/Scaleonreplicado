"use client";

// Botão "Reabrir subtask" — visível só pra admin em subtask concluída.
// Modal pede justificativa obrigatória (≥ 5 chars).

import { useState } from "react";
import { RotateCcw } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";

export interface ReabrirSubtaskButtonProps {
  subtaskId: string;
  subtaskNumero: string;
  onReaberta: () => void;
}

export function ReabrirSubtaskButton({
  subtaskId,
  subtaskNumero,
  onReaberta,
}: ReabrirSubtaskButtonProps) {
  const { isAdmin } = usePapelAtivo();
  const [open, setOpen] = useState(false);
  const [justificativa, setJustificativa] = useState("");
  const [salvando, setSalvando] = useState(false);

  if (!isAdmin) return null;

  async function reabrir() {
    if (justificativa.trim().length < 5) {
      toast.error("Justificativa precisa ter pelo menos 5 caracteres");
      return;
    }
    setSalvando(true);
    try {
      const res = await fetch(
        `/api/confeccao/subtasks/${subtaskId}/reabrir`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ justificativa: justificativa.trim() }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Erro ao reabrir");
        return;
      }
      toast.success(`Subtask ${subtaskNumero} reaberta`);
      setOpen(false);
      setJustificativa("");
      onReaberta();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="h-7"
        title="Reabrir subtask"
      >
        <RotateCcw className="size-3" />
        Reabrir
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reabrir subtask {subtaskNumero}</DialogTitle>
            <DialogDescription>
              A subtask volta pra &quot;em andamento&quot; e a próxima
              continua destravada. Essa ação fica registrada nas notas com
              data e justificativa.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="justif">Justificativa</Label>
            <Textarea
              id="justif"
              value={justificativa}
              onChange={(e) => setJustificativa(e.target.value)}
              rows={3}
              placeholder="Ex: marcada como concluída por engano, faltou registrar peso de 2 rolos"
              maxLength={2000}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={reabrir}
              disabled={salvando || justificativa.trim().length < 5}
            >
              {salvando ? "Reabrindo…" : "Reabrir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
