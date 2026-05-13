"use client";

// Botão WhatsApp com seletor de template (RITM-16).
//
// Comportamento:
//  - Mount → busca templates ativos da categoria.
//  - 0 templates → click dispara wa.me direto com `mensagemFallback`
//    (compatível com o comportamento anterior à RITM-16).
//  - ≥1 templates → click abre dialog com select + preview do corpo
//    resolvido. Usuário escolhe um template ou "Mensagem padrão" e
//    confirma. O servidor resolve os placeholders com base na OP.

import { useCallback, useEffect, useMemo, useState } from "react";
import { MessageCircle } from "lucide-react";
import { toast } from "sonner";
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
import { abrirWhatsAppComLog } from "@/lib/confeccao/whatsapp";
import type { ConfeccaoFornecedorCategoria } from "@/lib/db/schema";

interface TemplateLite {
  id: string;
  nome: string;
  categoria: ConfeccaoFornecedorCategoria;
}

export interface WhatsappTemplatePickerProps {
  categoria: ConfeccaoFornecedorCategoria;
  opNumero: string;
  subtaskId: string;
  telefone: string;
  destinatarioNome: string;
  /** Opcional: usado pra resolver {fornecedor_nome} via lookup server-side. */
  fornecedorId?: string;
  /** Mensagem usada quando o usuário escolhe "Mensagem padrão" ou não
   *  existem templates pra categoria. Pode conter placeholders — eles
   *  serão resolvidos pelo backend também. */
  mensagemFallback: string;
  contexto?: string;
  label?: string;
  className?: string;
  size?: "default" | "sm" | "lg" | "icon";
  variant?:
    | "default"
    | "outline"
    | "ghost"
    | "secondary"
    | "destructive"
    | "link";
  disabled?: boolean;
}

const SENTINEL_FALLBACK = "__fallback__";

export function WhatsappTemplatePicker({
  categoria,
  opNumero,
  subtaskId,
  telefone,
  destinatarioNome,
  fornecedorId,
  mensagemFallback,
  contexto,
  label,
  className,
  size = "sm",
  variant = "outline",
  disabled,
}: WhatsappTemplatePickerProps) {
  const [templates, setTemplates] = useState<TemplateLite[] | null>(null);
  const [open, setOpen] = useState(false);
  const [selecionadoId, setSelecionadoId] = useState<string>(SENTINEL_FALLBACK);
  const [preview, setPreview] = useState("");
  const [carregandoPreview, setCarregandoPreview] = useState(false);
  const [enviando, setEnviando] = useState(false);

  // Carrega templates da categoria uma vez (lista pequena, sem paginação)
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/confeccao/templates-whatsapp?categoria=${encodeURIComponent(categoria)}`,
          { cache: "no-store" },
        );
        if (!res.ok) {
          if (!cancelled) setTemplates([]);
          return;
        }
        const data = (await res.json()) as { items: TemplateLite[] };
        if (!cancelled) setTemplates(data.items);
      } catch {
        if (!cancelled) setTemplates([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [categoria]);

  const resolver = useCallback(
    async (corpoCru?: string, templateId?: string): Promise<string | null> => {
      try {
        const res = await fetch(
          `/api/confeccao/ops/${encodeURIComponent(opNumero)}/resolver-template`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              templateId,
              corpoCru,
              fornecedorId,
            }),
          },
        );
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error ?? "Erro ao resolver template");
          return null;
        }
        return data.corpoResolvido as string;
      } catch {
        toast.error("Erro ao resolver template");
        return null;
      }
    },
    [opNumero, fornecedorId],
  );

  // Atualiza preview quando a seleção muda
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCarregandoPreview(true);
    void (async () => {
      const corpo =
        selecionadoId === SENTINEL_FALLBACK
          ? await resolver(mensagemFallback)
          : await resolver(undefined, selecionadoId);
      if (!cancelled) {
        setPreview(corpo ?? "");
        setCarregandoPreview(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, selecionadoId, resolver, mensagemFallback]);

  const temTemplates = useMemo(
    () => (templates?.length ?? 0) > 0,
    [templates],
  );

  const buttonLabel = label ?? `WhatsApp com ${destinatarioNome}`;

  function disparar(mensagem: string) {
    abrirWhatsAppComLog({
      telefone,
      destinatarioNome,
      mensagem,
      subtaskId,
      contexto,
    });
  }

  async function onClickBotao(e: React.MouseEvent) {
    e.preventDefault();
    if (templates === null) {
      // ainda carregando — clique cedo, faz fallback direto
      disparar(mensagemFallback);
      return;
    }
    if (!temTemplates) {
      // resolve placeholders do próprio fallback (caso traga {op_numero} etc)
      const resolvido = await resolver(mensagemFallback);
      disparar(resolvido ?? mensagemFallback);
      return;
    }
    setSelecionadoId(SENTINEL_FALLBACK);
    setOpen(true);
  }

  async function confirmar() {
    if (!preview.trim()) {
      toast.error("Mensagem vazia");
      return;
    }
    setEnviando(true);
    try {
      disparar(preview);
      setOpen(false);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <Button
        size={size}
        variant={variant}
        onClick={onClickBotao}
        disabled={disabled}
        className={className}
        type="button"
      >
        <MessageCircle className="size-3.5" />
        {buttonLabel}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Enviar WhatsApp — {destinatarioNome}</DialogTitle>
            <DialogDescription>
              Selecione um template ou use a mensagem padrão. Os placeholders
              são preenchidos automaticamente com os dados desta OP.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Template</Label>
              <Select
                value={selecionadoId}
                onValueChange={(v) => setSelecionadoId(v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SENTINEL_FALLBACK}>
                    Mensagem padrão
                  </SelectItem>
                  {(templates ?? []).map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Pré-visualização</Label>
              <Textarea
                value={carregandoPreview ? "Carregando…" : preview}
                readOnly
                rows={8}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                A mensagem pode ser editada no app do WhatsApp antes do envio.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={confirmar}
              disabled={enviando || carregandoPreview || !preview.trim()}
            >
              <MessageCircle className="size-3.5" />
              Abrir WhatsApp
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
