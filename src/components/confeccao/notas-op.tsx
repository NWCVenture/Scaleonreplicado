"use client";

// Lista de notas (manuais + auditoria) da OP. Auditoria automática
// tem visual distinto (italic + ícone). Form simples no final.

import { useCallback, useEffect, useState } from "react";
import { History, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface NotaItem {
  id: string;
  ordemProducaoId: string | null;
  subtaskId: string | null;
  autorId: string | null;
  autorNome: string | null;
  conteudo: string;
  isAuditoria: boolean;
  isInterna: boolean;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface NotasOPProps {
  opNumero: string;
  incluirSubtasks?: boolean;
}

export function NotasOP({ opNumero, incluirSubtasks = false }: NotasOPProps) {
  const [notas, setNotas] = useState<NotaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [novaNota, setNovaNota] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [apenasAuditoria, setApenasAuditoria] = useState(false);

  const fetchNotas = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (incluirSubtasks) sp.set("incluirSubtasks", "true");
      if (apenasAuditoria) sp.set("apenasAuditoria", "true");
      const url = `/api/confeccao/ops/${opNumero}/notas${
        sp.size > 0 ? `?${sp.toString()}` : ""
      }`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setNotas(data.items);
    } catch {
      toast.error("Erro ao carregar notas");
    } finally {
      setLoading(false);
    }
  }, [opNumero, incluirSubtasks, apenasAuditoria]);

  useEffect(() => {
    void fetchNotas();
  }, [fetchNotas]);

  async function adicionar(e: React.FormEvent) {
    e.preventDefault();
    if (!novaNota.trim()) return;
    setEnviando(true);
    try {
      const res = await fetch(`/api/confeccao/ops/${opNumero}/notas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conteudo: novaNota.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Erro ao adicionar nota");
        return;
      }
      setNovaNota("");
      toast.success("Nota adicionada");
      await fetchNotas();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <History className="size-4" />
          Histórico ({notas.length})
        </h3>
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={apenasAuditoria}
            onChange={(e) => setApenasAuditoria(e.target.checked)}
            className="size-3"
          />
          Apenas auditoria
        </label>
      </div>

      <div className="space-y-2 max-h-96 overflow-y-auto">
        {loading && (
          <div className="text-xs text-muted-foreground">Carregando…</div>
        )}
        {!loading && notas.length === 0 && (
          <div className="text-xs text-muted-foreground">
            Nenhuma nota ainda.
          </div>
        )}
        {notas.map((n) => (
          <div
            key={n.id}
            className={cn(
              "rounded border p-3 text-sm",
              n.isAuditoria
                ? "bg-muted/40 border-dashed italic"
                : "bg-card",
            )}
          >
            <div className="flex items-start gap-2">
              {n.isAuditoria && (
                <Sparkles className="size-3.5 text-muted-foreground shrink-0 mt-0.5" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-xs text-muted-foreground mb-1">
                  {n.isAuditoria
                    ? "Sistema"
                    : (n.autorNome ?? "Usuário desconhecido")}{" "}
                  • {new Date(n.createdAt).toLocaleString("pt-BR")}
                </div>
                <div className="whitespace-pre-wrap">{n.conteudo}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={adicionar} className="space-y-2 pt-2 border-t">
        <Textarea
          placeholder="Adicionar nota manual…"
          value={novaNota}
          onChange={(e) => setNovaNota(e.target.value)}
          rows={3}
          maxLength={5000}
        />
        <div className="flex justify-end">
          <Button
            type="submit"
            size="sm"
            disabled={enviando || !novaNota.trim()}
          >
            <Send className="size-3.5" />
            {enviando ? "Enviando…" : "Adicionar"}
          </Button>
        </div>
      </form>
    </div>
  );
}
