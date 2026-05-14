"use client";

// Dialog de cancelamento de OP (RITM-18).
//
// - Justificativa obrigatória (min 10 chars)
// - Checkbox de confirmação obrigatório
// - Se OP `concluida`: select de autorizador (admin/owner ativo,
//   diferente do usuário atual) também obrigatório
// - Botão destrutivo dispara POST /cancelar e redireciona pro detalhe
//   atualizado da OP.

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

interface MembroAdmin {
  id: string;
  nome: string;
  email: string;
  papel: string;
}

interface CancelarOpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  opNumero: string;
  opStatus: "em_andamento" | "concluida" | "cancelada";
  usuarioAtualId: string;
  onCancelado: () => void;
}

export function CancelarOpDialog({
  open,
  onOpenChange,
  opNumero,
  opStatus,
  usuarioAtualId,
  onCancelado,
}: CancelarOpDialogProps) {
  const exigeAutorizador = opStatus === "concluida";

  const [justificativa, setJustificativa] = useState("");
  const [autorizadoPorId, setAutorizadoPorId] = useState<string>("");
  const [confirma, setConfirma] = useState(false);
  const [admins, setAdmins] = useState<MembroAdmin[]>([]);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!open) {
      // reset ao fechar
      setJustificativa("");
      setAutorizadoPorId("");
      setConfirma(false);
      return;
    }
    if (!exigeAutorizador) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/confeccao/membros-conta`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { items: MembroAdmin[] };
        if (cancelled) return;
        // só admins/owners diferentes do usuário atual
        setAdmins(
          data.items.filter(
            (m) =>
              (m.papel === "admin" || m.papel === "owner") &&
              m.id !== usuarioAtualId,
          ),
        );
      } catch {
        // silencioso — sem autorizadores, o submit fica desabilitado
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, exigeAutorizador, usuarioAtualId]);

  const justificativaValida = justificativa.trim().length >= 10;
  const autorizadorValido = !exigeAutorizador || autorizadoPorId.length > 0;
  const podeSubmeter =
    justificativaValida && autorizadorValido && confirma && !enviando;

  async function submeter() {
    setEnviando(true);
    try {
      const res = await fetch(`/api/confeccao/ops/${opNumero}/cancelar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          justificativa: justificativa.trim(),
          autorizadoPorId: exigeAutorizador ? autorizadoPorId : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Erro ao cancelar OP");
        return;
      }
      toast.success(`OP ${opNumero} cancelada`);
      onOpenChange(false);
      onCancelado();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-destructive" />
            Cancelar OP {opNumero}
          </DialogTitle>
          <DialogDescription>
            Esta ação é definitiva — a OP não poderá ser reaberta. Custos e
            materiais já registrados ficam preservados, mas categorizados
            como cancelados para contabilidade separada.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cancel-justificativa">
              Justificativa <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="cancel-justificativa"
              value={justificativa}
              onChange={(e) => setJustificativa(e.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="Explique por que esta OP está sendo cancelada (mínimo 10 caracteres)..."
            />
            <p className="text-xs text-muted-foreground">
              {justificativa.trim().length}/2000
            </p>
          </div>

          {exigeAutorizador && (
            <div className="space-y-2">
              <Label>
                Autorizado por (outro admin){" "}
                <span className="text-destructive">*</span>
              </Label>
              <Select
                value={autorizadoPorId}
                onValueChange={(v) => setAutorizadoPorId(v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o admin autorizador" />
                </SelectTrigger>
                <SelectContent>
                  {admins.length === 0 ? (
                    <SelectItem value="__nenhum__" disabled>
                      Nenhum outro admin disponível
                    </SelectItem>
                  ) : (
                    admins.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.nome} ({a.email})
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                OP já concluída — cancelamento exige autorização de outro admin.
              </p>
            </div>
          )}

          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={confirma}
              onCheckedChange={(v) => setConfirma(v === true)}
              className="mt-0.5"
            />
            <span>
              Tenho certeza que quero cancelar esta OP. Esta ação é
              <strong> irreversível</strong>.
            </span>
          </label>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={enviando}
          >
            Voltar
          </Button>
          <Button
            variant="destructive"
            onClick={submeter}
            disabled={!podeSubmeter}
          >
            {enviando ? "Cancelando…" : "Confirmar cancelamento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
