// Hook centralizador da UI de Configurações da Central de Envios (RITM-10).
//
// Orquestra 5 escopos de CRUD: regras-prazo, alias-tamanho, alias-cor,
// feriado, categoria-sku. Cada escopo tem seu próprio estado (itens,
// loading, erro) + metadados (papel + selects auxiliares).
//
// Mutações sempre disparam `recarregar(scope)` após sucesso (sem otimismo,
// 5 escopos é gerenciável sem SWR/React Query).

"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type {
  AliasClient,
  CanalVendaResumo,
  CategoriaSkuClient,
  FeriadoClient,
  ModeloResumo,
  PapelClient,
  RegraPrazoClient,
} from "@/types/central-envios";

export type ConfigScope =
  | "regrasPrazo"
  | "aliasTamanho"
  | "aliasCor"
  | "feriado"
  | "categoria";

type EstadoBase<T> = {
  itens: T[];
  loading: boolean;
  erro: string | null;
};

type EstadoRegrasPrazo = EstadoBase<RegraPrazoClient> & {
  canaisDisponiveis: CanalVendaResumo[];
};

type EstadoAlias = EstadoBase<AliasClient> & {
  modelosDisponiveis: ModeloResumo[];
};

type EstadoFeriado = EstadoBase<FeriadoClient>;

type EstadoCategoria = EstadoBase<CategoriaSkuClient> & {
  modelosDisponiveis: ModeloResumo[];
};

const ENDPOINTS: Record<ConfigScope, string> = {
  regrasPrazo: "/api/central-envios/configuracoes/regras-prazo",
  aliasTamanho: "/api/central-envios/configuracoes/alias-tamanho",
  aliasCor: "/api/central-envios/configuracoes/alias-cor",
  feriado: "/api/central-envios/configuracoes/feriado",
  categoria: "/api/central-envios/configuracoes/categoria-sku",
};

async function jsonOrThrow(r: Response): Promise<unknown> {
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${r.status}`);
  }
  return r.json();
}

export function useCentralEnviosConfiguracoes() {
  const [papel, setPapel] = useState<PapelClient | null>(null);
  const [podeEditar, setPodeEditar] = useState<boolean>(false);

  const [regrasPrazo, setRegrasPrazo] = useState<EstadoRegrasPrazo>({
    itens: [],
    loading: true,
    erro: null,
    canaisDisponiveis: [],
  });
  const [aliasTamanho, setAliasTamanho] = useState<EstadoAlias>({
    itens: [],
    loading: true,
    erro: null,
    modelosDisponiveis: [],
  });
  const [aliasCor, setAliasCor] = useState<EstadoAlias>({
    itens: [],
    loading: true,
    erro: null,
    modelosDisponiveis: [],
  });
  const [feriado, setFeriado] = useState<EstadoFeriado>({
    itens: [],
    loading: true,
    erro: null,
  });
  const [categoria, setCategoria] = useState<EstadoCategoria>({
    itens: [],
    loading: true,
    erro: null,
    modelosDisponiveis: [],
  });

  const carregarRegrasPrazo = useCallback(async () => {
    setRegrasPrazo((s) => ({ ...s, loading: true, erro: null }));
    try {
      const json = (await jsonOrThrow(
        await fetch(ENDPOINTS.regrasPrazo, { cache: "no-store" }),
      )) as {
        regras: RegraPrazoClient[];
        meta: {
          papel: PapelClient;
          podeEditar: boolean;
          canaisDisponiveis: CanalVendaResumo[];
        };
      };
      setPapel(json.meta.papel);
      setPodeEditar(json.meta.podeEditar);
      setRegrasPrazo({
        itens: json.regras,
        loading: false,
        erro: null,
        canaisDisponiveis: json.meta.canaisDisponiveis,
      });
    } catch (err) {
      setRegrasPrazo((s) => ({
        ...s,
        loading: false,
        erro: (err as Error).message,
      }));
    }
  }, []);

  const carregarAliasTamanho = useCallback(async () => {
    setAliasTamanho((s) => ({ ...s, loading: true, erro: null }));
    try {
      const json = (await jsonOrThrow(
        await fetch(ENDPOINTS.aliasTamanho, { cache: "no-store" }),
      )) as {
        aliases: AliasClient[];
        meta: {
          papel: PapelClient;
          podeEditar: boolean;
          modelosDisponiveis: ModeloResumo[];
        };
      };
      setPapel(json.meta.papel);
      setPodeEditar(json.meta.podeEditar);
      setAliasTamanho({
        itens: json.aliases,
        loading: false,
        erro: null,
        modelosDisponiveis: json.meta.modelosDisponiveis,
      });
    } catch (err) {
      setAliasTamanho((s) => ({
        ...s,
        loading: false,
        erro: (err as Error).message,
      }));
    }
  }, []);

  const carregarAliasCor = useCallback(async () => {
    setAliasCor((s) => ({ ...s, loading: true, erro: null }));
    try {
      const json = (await jsonOrThrow(
        await fetch(ENDPOINTS.aliasCor, { cache: "no-store" }),
      )) as {
        aliases: AliasClient[];
        meta: {
          papel: PapelClient;
          podeEditar: boolean;
          modelosDisponiveis: ModeloResumo[];
        };
      };
      setPapel(json.meta.papel);
      setPodeEditar(json.meta.podeEditar);
      setAliasCor({
        itens: json.aliases,
        loading: false,
        erro: null,
        modelosDisponiveis: json.meta.modelosDisponiveis,
      });
    } catch (err) {
      setAliasCor((s) => ({
        ...s,
        loading: false,
        erro: (err as Error).message,
      }));
    }
  }, []);

  const carregarFeriado = useCallback(async (ano?: number) => {
    setFeriado((s) => ({ ...s, loading: true, erro: null }));
    try {
      const qs = ano ? `?ano=${ano}` : "";
      const json = (await jsonOrThrow(
        await fetch(ENDPOINTS.feriado + qs, { cache: "no-store" }),
      )) as {
        feriados: FeriadoClient[];
        meta: { papel: PapelClient; podeEditar: boolean };
      };
      setPapel(json.meta.papel);
      setPodeEditar(json.meta.podeEditar);
      setFeriado({
        itens: json.feriados,
        loading: false,
        erro: null,
      });
    } catch (err) {
      setFeriado((s) => ({
        ...s,
        loading: false,
        erro: (err as Error).message,
      }));
    }
  }, []);

  const carregarCategoria = useCallback(async () => {
    setCategoria((s) => ({ ...s, loading: true, erro: null }));
    try {
      const json = (await jsonOrThrow(
        await fetch(ENDPOINTS.categoria, { cache: "no-store" }),
      )) as {
        categorias: CategoriaSkuClient[];
        meta: {
          papel: PapelClient;
          podeEditar: boolean;
          modelosDisponiveis: ModeloResumo[];
        };
      };
      setPapel(json.meta.papel);
      setPodeEditar(json.meta.podeEditar);
      setCategoria({
        itens: json.categorias,
        loading: false,
        erro: null,
        modelosDisponiveis: json.meta.modelosDisponiveis,
      });
    } catch (err) {
      setCategoria((s) => ({
        ...s,
        loading: false,
        erro: (err as Error).message,
      }));
    }
  }, []);

  const recarregar = useCallback(
    async (scope: ConfigScope, opts?: { ano?: number }) => {
      switch (scope) {
        case "regrasPrazo":
          return carregarRegrasPrazo();
        case "aliasTamanho":
          return carregarAliasTamanho();
        case "aliasCor":
          return carregarAliasCor();
        case "feriado":
          return carregarFeriado(opts?.ano);
        case "categoria":
          return carregarCategoria();
      }
    },
    [
      carregarRegrasPrazo,
      carregarAliasTamanho,
      carregarAliasCor,
      carregarFeriado,
      carregarCategoria,
    ],
  );

  useEffect(() => {
    carregarRegrasPrazo();
    carregarAliasTamanho();
    carregarAliasCor();
    carregarFeriado();
    carregarCategoria();
  }, [
    carregarRegrasPrazo,
    carregarAliasTamanho,
    carregarAliasCor,
    carregarFeriado,
    carregarCategoria,
  ]);

  const mutar = useCallback(
    async (
      scope: ConfigScope,
      method: "POST" | "PATCH" | "DELETE",
      payload: unknown,
      mensagemSucesso: string,
    ) => {
      try {
        const r = await fetch(ENDPOINTS[scope], {
          method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        await jsonOrThrow(r);
        toast.success(mensagemSucesso);
        await recarregar(scope);
        return true;
      } catch (err) {
        toast.error((err as Error).message ?? "Falha na operação");
        return false;
      }
    },
    [recarregar],
  );

  const syncFeriadosNacionais = useCallback(
    async (anos?: number[]) => {
      try {
        const r = await fetch(
          "/api/central-envios/configuracoes/feriado/sync-nacional",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(anos ? { anos } : {}),
          },
        );
        const json = (await jsonOrThrow(r)) as {
          resultados: { ano: number; inseridos: number; atualizados: number }[];
        };
        const totalInseridos = json.resultados.reduce(
          (a, b) => a + (b.inseridos ?? 0),
          0,
        );
        const totalAtualizados = json.resultados.reduce(
          (a, b) => a + (b.atualizados ?? 0),
          0,
        );
        toast.success(
          `Sync nacional: ${totalInseridos} inseridos · ${totalAtualizados} atualizados`,
        );
        await recarregar("feriado");
        return true;
      } catch (err) {
        toast.error((err as Error).message ?? "Falha no sync");
        return false;
      }
    },
    [recarregar],
  );

  return {
    papel,
    podeEditar,
    regrasPrazo,
    aliasTamanho,
    aliasCor,
    feriado,
    categoria,
    recarregar,
    mutar,
    syncFeriadosNacionais,
  };
}
