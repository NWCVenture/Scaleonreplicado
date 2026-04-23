"use client";

import { useCallback, useEffect, useState } from "react";

export type PapelConta =
  | "owner"
  | "admin"
  | "gerente"
  | "operador"
  | "costureiro"
  | "financeiro"
  | "fiscal"
  | "supervisor"
  | "funcionario"
  | "expedicao";

type MeResponse = {
  user: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
  };
  contaAtivaId: string | null;
  papelAtivo: PapelConta | null;
  isAdmin: boolean;
  contas: Array<{
    id: string;
    nome: string;
    plano: string;
    status: string;
    papel: PapelConta;
  }>;
};

const EVENT = "conta-ativa:changed";

export function emitContaTrocada() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVENT));
  }
}

export function usePapelAtivo() {
  const [data, setData] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/me", { cache: "no-store" });
      if (!res.ok) {
        setData(null);
        return;
      }
      setData((await res.json()) as MeResponse);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const handler = () => refresh();
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, [refresh]);

  return {
    me: data,
    papelAtivo: data?.papelAtivo ?? null,
    isAdmin: data?.isAdmin ?? false,
    loading,
    refresh,
  };
}
