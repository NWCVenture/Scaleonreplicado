"use client";

// Dialog disparado pelo botão "Arquivar" na page principal (RITM-11).
// Opcionalmente coleta destinatários do email de resumo.

import { useState } from "react";
import { Archive, Mail } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_DESTINATARIOS = 10;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Recebe a lista de emails (vazia se não optar por enviar). */
  onConfirmar: (emails: string[]) => Promise<void> | void;
}

export function ArquivarDialog({ open, onOpenChange, onConfirmar }: Props) {
  const [enviarEmail, setEnviarEmail] = useState(false);
  const [emailsRaw, setEmailsRaw] = useState("");
  const [arquivando, setArquivando] = useState(false);

  const emails = enviarEmail
    ? emailsRaw
        .split(/[,;\n]/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const emailsInvalidos = emails.filter((e) => !EMAIL_REGEX.test(e));
  const passouLimite = emails.length > MAX_DESTINATARIOS;

  const podeArquivar =
    !arquivando &&
    (!enviarEmail ||
      (emails.length > 0 && emailsInvalidos.length === 0 && !passouLimite));

  async function confirmar() {
    setArquivando(true);
    try {
      await onConfirmar(emails);
      onOpenChange(false);
      setEnviarEmail(false);
      setEmailsRaw("");
    } finally {
      setArquivando(false);
    }
  }

  function fechar() {
    if (arquivando) return;
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && fechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Archive className="h-5 w-5" /> Arquivar planejamento
          </DialogTitle>
          <DialogDescription>
            Cria um snapshot imutável do planejamento atual. Você pode
            consultar depois em Histórico. Mudanças posteriores em regras
            de prazo ou aliases não afetam o snapshot.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={enviarEmail}
              onCheckedChange={(v) => setEnviarEmail(v === true)}
              className="mt-0.5"
            />
            <span className="flex items-center gap-1">
              <Mail className="h-4 w-4" />
              Enviar resumo por email
            </span>
          </label>

          {enviarEmail && (
            <div className="space-y-2">
              <Label>Destinatários (separar por vírgula, máx. 10)</Label>
              <Textarea
                value={emailsRaw}
                onChange={(e) => setEmailsRaw(e.target.value)}
                placeholder="operacao@nwc.com.br, gerente@nwc.com.br"
                rows={3}
              />
              {emails.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {emails.length} destinatário(s)
                  {emailsInvalidos.length > 0 && (
                    <span className="text-destructive">
                      {" "}
                      · {emailsInvalidos.length} email(s) inválido(s):{" "}
                      {emailsInvalidos.join(", ")}
                    </span>
                  )}
                  {passouLimite && (
                    <span className="text-destructive">
                      {" "}
                      · limite de {MAX_DESTINATARIOS} excedido
                    </span>
                  )}
                </p>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={fechar} disabled={arquivando}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={!podeArquivar}>
            {arquivando ? "Arquivando…" : "Arquivar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
