"use client";

// Hook compartilhado pelos cadastros do módulo Confecção (RITM-05).
// Encapsula listagem paginada com search + delete soft/hard.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

export interface ListResponse<T> {
  items: T[];
  total: number;
}

export interface UseCadastroPaginadoOptions {
  endpoint: string; // ex: "/api/confeccao/produtos"
  pageSize?: number;
  initialSearch?: string;
}

export function useCadastroPaginado<T extends { id: string }>({
  endpoint,
  pageSize = 20,
  initialSearch = "",
}: UseCadastroPaginadoOptions) {
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(initialSearch);
  const [incluirInativos, setIncluirInativos] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);

  const refresh = useCallback(() => {
    setRefreshTick((t) => t + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const sp = new URLSearchParams({
          page: String(page),
          pageSize: String(pageSize),
          incluirInativos: incluirInativos ? "true" : "false",
        });
        if (search.trim()) sp.set("search", search.trim());
        const res = await fetch(`${endpoint}?${sp.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as ListResponse<T>;
        if (!cancelled) {
          setItems(data.items);
          setTotal(data.total);
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        if (!cancelled) {
          toast.error("Erro ao carregar lista");
          setItems([]);
          setTotal(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(handle);
    };
  }, [endpoint, page, pageSize, search, incluirInativos, refreshTick]);

  async function softDelete(id: string) {
    const res = await fetch(`${endpoint}/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? "Erro ao desativar");
      return false;
    }
    toast.success("Desativado");
    refresh();
    return true;
  }

  async function reativar(id: string) {
    const res = await fetch(`${endpoint}/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ativo: true }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? "Erro ao reativar");
      return false;
    }
    toast.success("Reativado");
    refresh();
    return true;
  }

  return {
    items,
    total,
    page,
    setPage,
    pageSize,
    search,
    setSearch,
    incluirInativos,
    setIncluirInativos,
    loading,
    refresh,
    softDelete,
    reativar,
    totalPaginas: Math.max(1, Math.ceil(total / pageSize)),
  };
}
