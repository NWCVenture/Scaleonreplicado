"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, ChevronDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { emitContaTrocada } from "@/hooks/use-papel-ativo";

type ContaItem = {
  id: string;
  nome: string;
  plano: string;
  status: string;
  papel: string;
};

type ApiResponse = {
  contaAtivaId: string | null;
  contas: ContaItem[];
};

export function ContaSelector() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const router = useRouter();

  const fetchContas = async () => {
    try {
      const res = await fetch("/api/conta");
      if (!res.ok) return;
      const json = (await res.json()) as ApiResponse;
      setData(json);
    } catch {
      // silencioso — UI cai no placeholder
    }
  };

  useEffect(() => {
    fetchContas();
  }, []);

  if (!data) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-sidebar-foreground/50">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        carregando conta…
      </div>
    );
  }

  if (data.contas.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-red-400">
        <Building2 className="h-3.5 w-3.5" />
        Sem conta vinculada
      </div>
    );
  }

  const ativa = data.contas.find((c) => c.id === data.contaAtivaId) ?? data.contas[0];
  const temMultiplas = data.contas.length > 1;

  const handleSwitch = async (contaId: string) => {
    if (contaId === data.contaAtivaId) {
      setIsOpen(false);
      return;
    }
    setIsSwitching(true);
    try {
      const res = await fetch("/api/conta/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contaId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Falha" }));
        toast.error(err.error ?? "Falha ao trocar conta");
        return;
      }
      toast.success(`Conta ativa: ${data.contas.find((c) => c.id === contaId)?.nome}`);
      setIsOpen(false);
      emitContaTrocada();
      router.refresh();
      fetchContas();
    } finally {
      setIsSwitching(false);
    }
  };

  if (!temMultiplas) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs rounded-md bg-sidebar-accent/40 border border-sidebar-border">
        <Building2 className="h-3.5 w-3.5 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sidebar-foreground truncate">
            {ativa.nome}
          </p>
          <p className="text-[10px] text-sidebar-foreground/50 capitalize">
            {ativa.papel} · {ativa.plano}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen((v) => !v)}
        disabled={isSwitching}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs rounded-md bg-sidebar-accent/40 border border-sidebar-border hover:bg-sidebar-accent/70 transition-colors"
      >
        <Building2 className="h-3.5 w-3.5 text-primary shrink-0" />
        <div className="flex-1 min-w-0 text-left">
          <p className="font-semibold text-sidebar-foreground truncate">
            {ativa.nome}
          </p>
          <p className="text-[10px] text-sidebar-foreground/50 capitalize">
            {ativa.papel} · {ativa.plano}
          </p>
        </div>
        {isSwitching ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
        ) : (
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 transition-transform",
              isOpen && "rotate-180",
            )}
          />
        )}
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 right-0 mb-1 rounded-md bg-popover border border-border shadow-lg overflow-hidden z-50">
          {data.contas.map((c) => (
            <button
              key={c.id}
              onClick={() => handleSwitch(c.id)}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-accent",
                c.id === ativa.id && "bg-accent/60",
              )}
            >
              <div className="flex-1 min-w-0">
                <p className="font-semibold truncate">{c.nome}</p>
                <p className="text-[10px] text-muted-foreground capitalize">
                  {c.papel} · {c.plano} · {c.status}
                </p>
              </div>
              {c.id === ativa.id && (
                <Check className="h-3.5 w-3.5 text-primary shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
