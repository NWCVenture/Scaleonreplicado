"use client";

// Header fixo da OP — sempre visível no topo do stepper. Inclui:
// - número, produto, atribuído, % progresso
// - botões: Editar atribuição (admin), Histórico, Cancelar OP (placeholder)

import { useState } from "react";
import {
  Ban,
  Edit2,
  Factory,
  History,
  MoreVertical,
  Printer,
  ReceiptText,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { LookupUsuarioConta } from "./lookup-usuario-conta";
import { CancelarOpDialog } from "./cancelar-op-dialog";
import { EvidenciasSheet } from "./evidencias-sheet";

interface OPHeaderProps {
  numero: string;
  status: "em_andamento" | "concluida" | "cancelada";
  temVies: boolean;
  produtoNome: string;
  criadaPorNome: string | null;
  atribuidoAId: string;
  atribuidoNome: string | null;
  progresso: {
    subtasksConcluidas: number;
    subtasksTotal: number;
    percentual: number;
  };
  isAdmin: boolean;
  usuarioAtualId: string;
  onAtualizado: () => void;
  onAbrirHistorico: () => void;
}

export function OPHeader(props: OPHeaderProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [novoAtribuidoId, setNovoAtribuidoId] = useState(props.atribuidoAId);
  const [saving, setSaving] = useState(false);
  const [cancelarOpen, setCancelarOpen] = useState(false);
  const [evidenciasOpen, setEvidenciasOpen] = useState(false);
  const podeCancelar =
    props.isAdmin && props.status !== "cancelada";

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!novoAtribuidoId || novoAtribuidoId === props.atribuidoAId) {
      setEditOpen(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/confeccao/ops/${props.numero}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ atribuidoAId: novoAtribuidoId }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Erro ao atualizar");
        return;
      }
      toast.success("Atribuição atualizada");
      setEditOpen(false);
      props.onAtualizado();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="sticky top-0 z-10 -mx-6 px-6 pt-6 pb-4 bg-background border-b">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Factory className="size-6 text-blue-500" />
            <h1 className="text-2xl font-bold tracking-tight font-mono">
              {props.numero}
            </h1>
            <Badge
              variant={
                props.status === "cancelada"
                  ? "destructive"
                  : props.status === "concluida"
                    ? "secondary"
                    : "default"
              }
            >
              {props.status === "em_andamento"
                ? "Em andamento"
                : props.status === "concluida"
                  ? "Concluída"
                  : "Cancelada"}
            </Badge>
            {props.temVies && <Badge variant="outline">Com Viés</Badge>}
          </div>
          <div className="text-sm text-muted-foreground">
            {props.produtoNome}
          </div>
          <div className="text-xs text-muted-foreground">
            Criada por {props.criadaPorNome ?? "—"} • Atribuída a{" "}
            {props.atribuidoNome ?? "—"}
          </div>
        </div>

        <div className="flex gap-1">
          {props.isAdmin && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setNovoAtribuidoId(props.atribuidoAId);
                setEditOpen(true);
              }}
            >
              <Edit2 className="size-3.5" />
              Editar atribuição
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            title="Imprimir"
          >
            <Printer className="size-3.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={props.onAbrirHistorico}
            title="Histórico"
          >
            <History className="size-3.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEvidenciasOpen(true)}
            title="Evidências de Pagamento"
            aria-label="Evidências de Pagamento"
          >
            <ReceiptText className="size-3.5" />
          </Button>
          {podeCancelar && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  title="Mais ações"
                  aria-label="Mais ações"
                >
                  <MoreVertical className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setCancelarOpen(true)}
                >
                  <Ban className="size-3.5" />
                  Cancelar OP
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <Progress
          value={props.progresso.percentual}
          className="h-2 flex-1 max-w-md"
        />
        <span className="text-xs text-muted-foreground tabular-nums">
          {props.progresso.subtasksConcluidas}/{props.progresso.subtasksTotal}{" "}
          subtasks ({props.progresso.percentual}%)
        </span>
      </div>

      <CancelarOpDialog
        open={cancelarOpen}
        onOpenChange={setCancelarOpen}
        opNumero={props.numero}
        opStatus={props.status}
        usuarioAtualId={props.usuarioAtualId}
        onCancelado={props.onAtualizado}
      />

      <EvidenciasSheet
        open={evidenciasOpen}
        onOpenChange={setEvidenciasOpen}
        opNumero={props.numero}
      />

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar atribuição</DialogTitle>
          </DialogHeader>
          <form onSubmit={salvar} className="space-y-4">
            <div className="space-y-2">
              <Label>Atribuído a</Label>
              <LookupUsuarioConta
                value={novoAtribuidoId}
                onChange={(id) => setNovoAtribuidoId(id)}
                className="w-full"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditOpen(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={saving || !novoAtribuidoId}>
                {saving ? "Salvando…" : "Salvar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
