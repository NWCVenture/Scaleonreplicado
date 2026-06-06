// Hook centralizador da UI da Central de Envios.
//
// Responsabilidades:
//   - Carregar/criar sessão ativa.
//   - Receber arquivos do dropzone, detectar tipo (CSV TT / XLSX ML),
//     subir e iniciar polling de status.
//   - Quando ingestão conclui, chamar /processar e atualizar dados +
//     estatísticas.
//   - Auto-save de tipoVisualizacao e filtrosExtrator (debounce 800ms).
//   - Permitir encerro de sessão (finalizada / forcada).

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { nanoid } from "nanoid";
import type {
  ArquivoIngerido,
  CategoriaSkuClient,
  EstatisticasSessao,
  PedidoEnriquecido,
  SessaoCentralEnviosResumo,
  UploadEmAndamento,
} from "@/types/central-envios";

type Status = "loading" | "ready" | "error";

const POLL_INICIAL_MS = 1500;
const POLL_NORMAL_MS = 3000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

const DEBOUNCE_SAVE_MS = 800;

function detectarTipo(file: File): "tiktok_csv" | "ml_xlsx" | null {
  const nome = file.name.toLowerCase();
  if (nome.endsWith(".csv") || file.type === "text/csv") return "tiktok_csv";
  if (
    nome.endsWith(".xlsx") ||
    nome.endsWith(".xls") ||
    file.type.includes("spreadsheetml") ||
    file.type === "application/vnd.ms-excel"
  ) {
    return "ml_xlsx";
  }
  return null;
}

function endpointParaTipo(tipo: "tiktok_csv" | "ml_xlsx"): string {
  return tipo === "tiktok_csv"
    ? "/api/central-envios/ingestao/tiktok"
    : "/api/central-envios/ingestao/mercado-livre";
}

export function useCentralEnviosPlanejamento() {
  const [status, setStatus] = useState<Status>("loading");
  const [sessao, setSessao] = useState<SessaoCentralEnviosResumo | null>(null);
  const [dados, setDados] = useState<PedidoEnriquecido[]>([]);
  const [estatisticas, setEstatisticas] = useState<EstatisticasSessao | null>(
    null,
  );
  const [arquivosIngeridos, setArquivosIngeridos] = useState<ArquivoIngerido[]>(
    [],
  );
  const [uploads, setUploads] = useState<UploadEmAndamento[]>([]);
  const [abaAtiva, setAbaAtivaState] = useState<string>("upload");
  const [filtrosExtrator, setFiltrosExtratorState] = useState<
    Record<string, unknown>
  >({});
  const [categorias, setCategorias] = useState<CategoriaSkuClient[]>([]);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );

  const sessionIdRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollersRef = useRef<Map<string, AbortController>>(new Map());
  const ultimaSavePayloadRef = useRef<string>("");

  // ---- carregar/garantir sessão -----------------------------------
  const carregarSessao = useCallback(async () => {
    try {
      const resp = await fetch("/api/central-envios/sessao", {
        cache: "no-store",
      });
      if (!resp.ok) throw new Error(`GET sessão: ${resp.status}`);
      const json = (await resp.json()) as {
        sessao: (SessaoCentralEnviosResumo & {
          dados?: PedidoEnriquecido[] | null;
          estatisticas?: EstatisticasSessao;
          arquivosIngeridos?: ArquivoIngerido[];
        }) | null;
      };
      let ativa = json.sessao;
      if (!ativa) {
        // Cria nova
        const create = await fetch("/api/central-envios/sessao", {
          method: "POST",
        });
        if (!create.ok) throw new Error(`POST sessão: ${create.status}`);
        const created = (await create.json()) as { sessao: typeof ativa };
        ativa = created.sessao;
      }
      if (!ativa) throw new Error("Sessão null após criação");
      sessionIdRef.current = ativa.id;
      setSessao({
        id: ativa.id,
        status: ativa.status,
        tipoVisualizacao: ativa.tipoVisualizacao ?? "upload",
        filtrosExtrator: ativa.filtrosExtrator ?? {},
        iniciouEm: ativa.iniciouEm,
        ultimaAtividadeEm: ativa.ultimaAtividadeEm,
        dadosBlobUrl: ativa.dadosBlobUrl ?? null,
      });
      setAbaAtivaState(ativa.tipoVisualizacao ?? "upload");
      setFiltrosExtratorState(
        (ativa.filtrosExtrator as Record<string, unknown>) ?? {},
      );
      setArquivosIngeridos(
        (ativa.arquivosIngeridos as ArquivoIngerido[]) ?? [],
      );
      if (ativa.estatisticas) {
        setEstatisticas(ativa.estatisticas as EstatisticasSessao);
      }
      // Carrega dados (inline ou via blob)
      if (Array.isArray(ativa.dados)) {
        setDados(ativa.dados as PedidoEnriquecido[]);
      } else if (ativa.dadosBlobUrl) {
        try {
          const blob = await fetch(ativa.dadosBlobUrl, { cache: "no-store" });
          if (blob.ok) {
            const lista = (await blob.json()) as PedidoEnriquecido[];
            setDados(lista);
          }
        } catch {
          /* offload falhou — UI mostra vazio mas estatísticas continuam */
        }
      }
      setStatus("ready");
    } catch (err) {
      console.error("[useCentralEnviosPlanejamento] load:", err);
      setStatus("error");
      toast.error("Falha ao carregar sessão");
    }
  }, []);

  // Carrega categorias do extrator uma vez por mount.
  const carregarCategorias = useCallback(async () => {
    try {
      const r = await fetch(
        "/api/central-envios/configuracoes/categoria-sku",
        { cache: "no-store" },
      );
      if (!r.ok) return;
      const json = (await r.json()) as { categorias: CategoriaSkuClient[] };
      setCategorias(json.categorias ?? []);
    } catch {
      /* silencioso — extrator funciona sem categorias */
    }
  }, []);

  useEffect(() => {
    carregarSessao();
    carregarCategorias();
    const pollers = pollersRef.current;
    const saveTimer = saveTimerRef.current;
    return () => {
      // Cancela polls ao desmontar
      for (const ctl of pollers.values()) ctl.abort();
      pollers.clear();
      if (saveTimer) clearTimeout(saveTimer);
    };
  }, [carregarSessao, carregarCategorias]);

  // ---- auto-save filtros / aba ------------------------------------
  const agendarSave = useCallback(
    (payload: Record<string, unknown>) => {
      const sessaoId = sessionIdRef.current;
      if (!sessaoId) return;
      const key = JSON.stringify(payload);
      if (key === ultimaSavePayloadRef.current) return;
      ultimaSavePayloadRef.current = key;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      setSaveState("saving");
      saveTimerRef.current = setTimeout(async () => {
        try {
          const r = await fetch(`/api/central-envios/sessao/${sessaoId}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (!r.ok) throw new Error(`PATCH ${r.status}`);
          setSaveState("saved");
        } catch (err) {
          console.error("save error:", err);
          setSaveState("error");
        }
      }, DEBOUNCE_SAVE_MS);
    },
    [],
  );

  const setAbaAtiva = useCallback(
    (aba: string) => {
      setAbaAtivaState(aba);
      agendarSave({ tipoVisualizacao: aba });
    },
    [agendarSave],
  );

  const setFiltrosExtrator = useCallback(
    (f: Record<string, unknown>) => {
      setFiltrosExtratorState(f);
      agendarSave({ filtrosExtrator: f });
    },
    [agendarSave],
  );

  // ---- upload + polling --------------------------------------------
  const processarRunIds = useCallback(async (runIds: string[]) => {
    const sessaoId = sessionIdRef.current;
    if (!sessaoId || runIds.length === 0) return;
    try {
      const r = await fetch(
        `/api/central-envios/sessao/${sessaoId}/processar`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ runIds }),
        },
      );
      if (!r.ok) {
        const errBody = (await r.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(errBody.error ?? `Processar ${r.status}`);
      }
      // Re-busca tudo (mais simples que mesclar localmente).
      await carregarSessao();
      toast.success("Pedidos enriquecidos com sucesso");
    } catch (err) {
      console.error("processar:", err);
      toast.error((err as Error).message ?? "Falha ao processar");
    }
  }, [carregarSessao]);

  const pollUpload = useCallback(
    async (uploadId: string, runId: string) => {
      // Cancela poller anterior (se reupload)
      pollersRef.current.get(uploadId)?.abort();
      const ctl = new AbortController();
      pollersRef.current.set(uploadId, ctl);

      const inicio = Date.now();
      let intervalo = POLL_INICIAL_MS;
      while (!ctl.signal.aborted) {
        if (Date.now() - inicio > POLL_TIMEOUT_MS) {
          setUploads((prev) =>
            prev.map((u) =>
              u.id === uploadId
                ? { ...u, estado: { status: "erro", erro: "timeout" } }
                : u,
            ),
          );
          break;
        }
        try {
          const r = await fetch(
            `/api/central-envios/ingestao/${runId}`,
            { cache: "no-store", signal: ctl.signal },
          );
          if (!r.ok) throw new Error(`GET status ${r.status}`);
          const data = (await r.json()) as {
            status: "pendente" | "processando" | "concluido" | "erro";
            totalLinhas: number | null;
            linhasValidas: number | null;
            linhasDescartadas: number | null;
            erro: string | null;
          };
          if (data.status === "concluido") {
            setUploads((prev) =>
              prev.map((u) =>
                u.id === uploadId
                  ? {
                      ...u,
                      estado: {
                        status: "concluido",
                        runId,
                        totalLinhas: data.totalLinhas ?? 0,
                        linhasValidas: data.linhasValidas ?? 0,
                        linhasDescartadas: data.linhasDescartadas ?? 0,
                      },
                    }
                  : u,
              ),
            );
            // Enfileira processar
            processarRunIds([runId]);
            break;
          }
          if (data.status === "erro") {
            setUploads((prev) =>
              prev.map((u) =>
                u.id === uploadId
                  ? {
                      ...u,
                      estado: {
                        status: "erro",
                        runId,
                        erro: data.erro ?? "erro desconhecido",
                      },
                    }
                  : u,
              ),
            );
            break;
          }
          // pendente | processando → continua
          setUploads((prev) =>
            prev.map((u) =>
              u.id === uploadId
                ? { ...u, estado: { status: "processando", runId } }
                : u,
            ),
          );
        } catch (err) {
          if ((err as Error).name === "AbortError") return;
          console.warn("poll err:", err);
        }
        // throttle adaptativo
        if (Date.now() - inicio > 10_000) intervalo = POLL_NORMAL_MS;
        await new Promise((res) => setTimeout(res, intervalo));
      }
    },
    [processarRunIds],
  );

  const subirArquivos = useCallback(
    async (files: FileList | File[]) => {
      const lista = Array.from(files);
      const novos: UploadEmAndamento[] = [];
      for (const file of lista) {
        const tipo = detectarTipo(file);
        if (!tipo) {
          toast.error(`Tipo não reconhecido: ${file.name}`);
          continue;
        }
        const uploadId = nanoid();
        novos.push({
          id: uploadId,
          arquivoNome: file.name,
          tipoIngestao: tipo,
          estado: { status: "enviando" },
        });
      }
      if (novos.length === 0) return;
      setUploads((prev) => [...prev, ...novos]);

      // Dispara uploads em paralelo
      novos.forEach(async (u, i) => {
        const file = lista[i];
        const tipo = u.tipoIngestao;
        try {
          const fd = new FormData();
          fd.append("arquivo", file);
          const r = await fetch(endpointParaTipo(tipo), {
            method: "POST",
            body: fd,
          });
          if (!r.ok) {
            const body = (await r.json().catch(() => ({}))) as {
              error?: string;
            };
            throw new Error(body.error ?? `Upload ${r.status}`);
          }
          const data = (await r.json()) as { runId: string };
          setUploads((prev) =>
            prev.map((up) =>
              up.id === u.id
                ? {
                    ...up,
                    estado: { status: "processando", runId: data.runId },
                  }
                : up,
            ),
          );
          pollUpload(u.id, data.runId);
        } catch (err) {
          setUploads((prev) =>
            prev.map((up) =>
              up.id === u.id
                ? {
                    ...up,
                    estado: {
                      status: "erro",
                      erro: (err as Error).message,
                    },
                  }
                : up,
            ),
          );
          toast.error(`Falha no upload de ${file.name}`);
        }
      });
    },
    [pollUpload],
  );

  const limparConcluidos = useCallback(() => {
    setUploads((prev) =>
      prev.filter(
        (u) => u.estado.status !== "concluido" && u.estado.status !== "erro",
      ),
    );
  }, []);

  const encerrarSessao = useCallback(
    async (motivo: "finalizada" | "forcada") => {
      const sessaoId = sessionIdRef.current;
      if (!sessaoId) return;
      try {
        const r = await fetch(
          `/api/central-envios/sessao/${sessaoId}/encerrar`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ motivo }),
          },
        );
        if (!r.ok) throw new Error(`Encerrar ${r.status}`);
        toast.success(
          motivo === "finalizada" ? "Planejamento arquivado" : "Sessão descartada",
        );
        // Recria sessão vazia
        sessionIdRef.current = null;
        setSessao(null);
        setDados([]);
        setEstatisticas(null);
        setArquivosIngeridos([]);
        setUploads([]);
        setAbaAtivaState("upload");
        setFiltrosExtratorState({});
        await carregarSessao();
      } catch (err) {
        console.error("encerrar:", err);
        toast.error("Falha ao encerrar sessão");
      }
    },
    [carregarSessao],
  );

  return {
    status,
    sessao,
    dados,
    estatisticas,
    arquivosIngeridos,
    uploads,
    abaAtiva,
    setAbaAtiva,
    filtrosExtrator,
    setFiltrosExtrator,
    categorias,
    saveState,
    subirArquivos,
    limparConcluidos,
    encerrarSessao,
  };
}
