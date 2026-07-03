"use client";

// Contexto da OP compartilhado entre as páginas sob /confeccao/ops/[numero]
// (visão geral, subtasks, matching). Vive no layout da rota, que PERSISTE
// entre navegações de aba — a OP é buscada uma vez e a troca de página
// renderiza instantâneo do cache; mutações revalidam via refetch().
// Também renderiza a barra de abas, que assim não pisca ao navegar.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";
import { OpAbasNav } from "./op-abas-nav";
import type { ConfeccaoSubtask } from "@/lib/db/schema";

export interface OPDetalhe {
  op: {
    id: string;
    numero: string;
    status: "em_andamento" | "concluida" | "cancelada";
    temVies: boolean;
    observacoes: string | null;
    produtoId: string;
    produtoNome: string;
    produtoDescricao: string | null;
    createdAt: string;
    atribuidoAId: string;
    canceladaEm: string | null;
    cancelamentoJustificativa: string | null;
    criadaPor: { id: string; name: string; email: string } | null;
    atribuidoA: { id: string; name: string; email: string } | null;
    canceladaPor: { id: string; name: string } | null;
    autorizadoPor: { id: string; name: string } | null;
  };
  subtasks: Array<
    ConfeccaoSubtask & {
      atribuidoNome: string | null;
    }
  >;
  progresso: {
    subtasksConcluidas: number;
    subtasksTotal: number;
    percentual: number;
  };
}

interface OpContextoValor {
  data: OPDetalhe | null;
  refetch: () => Promise<void>;
}

const OpContexto = createContext<OpContextoValor | null>(null);

export function useOpContexto(): OpContextoValor {
  const ctx = useContext(OpContexto);
  if (!ctx) {
    throw new Error("useOpContexto precisa estar sob OpContextoProvider");
  }
  return ctx;
}

export function OpContextoProvider({
  numero,
  children,
}: {
  numero: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [data, setData] = useState<OPDetalhe | null>(null);
  // Latches: fetch inicial e redirect-de-login rodam no máximo uma vez por
  // vida do provider — oscilações na referência de `session` (revalidação
  // em foco, StrictMode) não podem re-disparar loading full-page, senão os
  // formulários desmontam e o usuário perde o que digitou.
  const fetchOnceRef = useRef(false);
  const redirecionouRef = useRef(false);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`/api/confeccao/ops/${numero}`, {
        cache: "no-store",
      });
      if (res.status === 404) {
        toast.error("OP não encontrada");
        router.replace("/confeccao");
        return;
      }
      if (!res.ok) throw new Error();
      setData((await res.json()) as OPDetalhe);
    } catch {
      toast.error("Erro ao carregar OP");
    }
  }, [numero, router]);

  useEffect(() => {
    if (isPending) return;
    if (!session) {
      if (redirecionouRef.current) return;
      redirecionouRef.current = true;
      router.replace("/login");
      return;
    }
    if (fetchOnceRef.current) return;
    fetchOnceRef.current = true;
    void refetch();
  }, [isPending, session, router, refetch]);

  return (
    <OpContexto.Provider value={{ data, refetch }}>
      <div className="pt-4 space-y-4">
        {data && (
          <OpAbasNav opNumero={data.op.numero} subtasks={data.subtasks} />
        )}
        {children}
      </div>
    </OpContexto.Provider>
  );
}
