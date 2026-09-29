"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  // Evita reabrir o menu (ou repetir a auto-seleção) a cada render.
  const avisouSemContaRef = useRef(false);
  const autoSelecionadaRef = useRef(false);

  const fetchContas = useCallback(async () => {
    try {
      const res = await fetch("/api/conta");
      if (!res.ok) return;
      const json = (await res.json()) as ApiResponse;
      setData(json);
    } catch {
      // silencioso — UI cai no placeholder
    }
  }, []);

  useEffect(() => {
    fetchContas();
  }, [fetchContas]);

  const trocarConta = useCallback(
    async (contaId: string, nome?: string) => {
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
          return false;
        }
        if (nome) toast.success(`Conta ativa: ${nome}`);
        setIsOpen(false);
        emitContaTrocada();
        router.refresh();
        fetchContas();
        return true;
      } finally {
        setIsSwitching(false);
      }
    },
    [router, fetchContas],
  );

  // Sessão sem conta ativa gravada: toda rota com escopo de conta responde 401
  // e a tela mostra falha genérica (ver `requireContaAtiva` em lib/tenancy.ts).
  // Com uma única conta, grava sozinho; com mais de uma, a escolha é do
  // operador — então abrimos o menu e avisamos, em vez de exibir a primeira
  // conta como se já estivesse ativa.
  useEffect(() => {
    if (!data || data.contaAtivaId || data.contas.length === 0) return;

    if (data.contas.length === 1) {
      if (autoSelecionadaRef.current) return;
      autoSelecionadaRef.current = true;
      trocarConta(data.contas[0].id);
      return;
    }

    if (avisouSemContaRef.current) return;
    avisouSemContaRef.current = true;
    setIsOpen(true);
    toast.warning("Escolha a conta para começar a usar o sistema.", {
      id: "sem-conta-ativa",
      duration: 8000,
    });
  }, [data, trocarConta]);

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

  // `null` quando a sessão não tem conta ativa — nunca assumir a primeira da
  // lista, senão a barra lateral mostra uma conta ativa que o servidor não tem.
  const ativa = data.contas.find((c) => c.id === data.contaAtivaId) ?? null;
  const temMultiplas = data.contas.length > 1;

  const handleSwitch = async (contaId: string) => {
    if (contaId === data.contaAtivaId) {
      setIsOpen(false);
      return;
    }
    const conta = data.contas.find((c) => c.id === contaId);
    await trocarConta(contaId, conta?.nome);
  };

  if (!temMultiplas) {
    // Conta única sem conta ativa: o efeito acima está gravando agora.
    if (!ativa) {
      return (
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-sidebar-foreground/50">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          definindo conta…
        </div>
      );
    }
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
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 text-xs rounded-md border transition-colors",
          ativa
            ? "bg-sidebar-accent/40 border-sidebar-border hover:bg-sidebar-accent/70"
            : "bg-amber-500/10 border-amber-500 hover:bg-amber-500/20",
        )}
      >
        <Building2
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            ativa ? "text-primary" : "text-amber-500",
          )}
        />
        <div className="flex-1 min-w-0 text-left">
          <p
            className={cn(
              "font-semibold truncate",
              ativa ? "text-sidebar-foreground" : "text-amber-400",
            )}
          >
            {ativa ? ativa.nome : "Escolha a conta"}
          </p>
          <p
            className={cn(
              "text-[10px] capitalize",
              ativa ? "text-sidebar-foreground/50" : "text-amber-400/80",
            )}
          >
            {ativa
              ? `${ativa.papel} · ${ativa.plano}`
              : "nenhuma conta ativa — clique para selecionar"}
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
                c.id === ativa?.id && "bg-accent/60",
              )}
            >
              <div className="flex-1 min-w-0">
                <p className="font-semibold truncate">{c.nome}</p>
                <p className="text-[10px] text-muted-foreground capitalize">
                  {c.papel} · {c.plano} · {c.status}
                </p>
              </div>
              {c.id === ativa?.id && (
                <Check className="h-3.5 w-3.5 text-primary shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
