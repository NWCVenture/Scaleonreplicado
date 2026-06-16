"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSession } from "@/lib/auth-client";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn, copyToClipboard } from "@/lib/utils";
import {
  Loader2,
  Package,
  History,
  Settings,
  Trash2,
  Copy,
  Send,
  FileDown,
  Search,
  Mail,
  StopCircle,
  FileText,
  Check,
  AlertCircle,
} from "lucide-react";
import { useColetasBipagem } from "@/hooks/use-coletas-bipagem";
import {
  detectCarrier,
  downloadTxt,
  buildManifestHTML,
  buildDevolucaoExportTxt,
  buildHistoricoReport,
} from "@/lib/coletas-utils";
import { ScanOverlay } from "@/components/coletas/scan-overlay";
import { PacoteListItem } from "@/components/coletas/pacote-list-item";
import { DevolucaoModal } from "@/components/coletas/devolucao-modal";
import { ConfiguracoesView } from "@/components/coletas/configuracoes-view";
import { HistoricoView } from "@/components/coletas/historico-view";
import type {
  CarrierPattern,
  SkuKitRule,
  DevolucaoFormData,
  BipagemRecord,
  TransportadoraLabel,
  TipoColeta,
  ContaOperacao,
} from "@/types/coletas";
import {
  FUNCTION_TYPES,
  OPERATIONS,
  FUNCTION_DISPLAY,
  OPERATION_DISPLAY,
} from "@/types/coletas";

// Throttle entre tentativas automáticas de criar sessão depois de uma falha.
// Sem isso, cada bipe seguinte refaz POST → spam de toast.
const INIT_RETRY_THROTTLE_MS = 5000;

type ViewMode = "bipagem" | "historico" | "configuracoes";
type SaveState = "idle" | "saving" | "saved" | "error";

export default function ColetasPage() {
  const { data: session, isPending } = useSession();
  const [viewMode, setViewMode] = useState<ViewMode>("bipagem");

  // Bipagem hook
  const bipagem = useColetasBipagem();

  // Overlay
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [overlayContent, setOverlayContent] = useState<{
    id: string;
    isDup: boolean;
    carrier?: TransportadoraLabel;
  }>({ id: "", isDup: false });

  // Devolucao modal
  const [devolucaoModalOpen, setDevolucaoModalOpen] = useState(false);
  const [devolucaoPacketId, setDevolucaoPacketId] = useState("");
  const [devolucaoCarrier, setDevolucaoCarrier] = useState<TransportadoraLabel | null>(null);

  // Remove search
  const [removeInputValue, setRemoveInputValue] = useState("");

  // Loading / sending
  const [isLoading, setIsLoading] = useState(true);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isForcingStop, setIsForcingStop] = useState(false);

  // ── Sessão server-side ───────────────────────────────────────────────────
  // Substitui o localStorage. Sessão com TTL de 8h, gerenciada no servidor.
  const [sessaoId, setSessaoId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  // Modo "Bipar Mais": quando o usuário clica em "Bipar Mais" no histórico,
  // continuamos a bipagem original em vez de criar um clone. O finalize usa
  // PUT /api/coletas/[id]/continuar (substitui pacotes do registro original).
  const [continuandoBipagemId, setContinuandoBipagemId] = useState<string | null>(
    null,
  );
  const continuandoBipagemIdRef = useRef<string | null>(null);
  continuandoBipagemIdRef.current = continuandoBipagemId;

  // Sessão ativa achada no GET inicial — abre modal "Continuar / Finalizar agora".
  // Não carregamos no estado client antes do usuário decidir.
  const [pendingRestore, setPendingRestore] = useState<{
    id: string;
    tipo: TipoColeta;
    conta: ContaOperacao;
    pacotes: string[];
    devolucoesData: Record<string, unknown>;
    iniciouEm: string;
  } | null>(null);
  const [isFinalizingFromRestore, setIsFinalizingFromRestore] = useState(false);

  // Refs
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const audioSuccessRef = useRef<HTMLAudioElement>(null);
  const audioErrorRef = useRef<HTMLAudioElement>(null);
  const sessaoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const sessaoIdRef = useRef<string | null>(null);
  sessaoIdRef.current = sessaoId;
  // Idempotência: evita criar sessão 2× em React StrictMode (o effect roda 2×
  // em dev). Sem isso, o 2º POST colide no índice único `status=ativa`.
  const initLockRef = useRef(false);
  // Snapshot do último body que tentamos salvar — usado pelo botão de retry
  // manual quando saveState === 'error'.
  const lastSaveBodyRef = useRef<string | null>(null);
  // Snapshot do último body confirmadamente salvo no servidor. Se o body atual
  // for igual, pulamos o PATCH (evita ida ao servidor quando o estado oscilou
  // mas voltou ao mesmo, e reduz tráfego em sessões grandes).
  const lastSentBodyRef = useRef<string | null>(null);
  // Re-entrância: o useEffect que dispara handleFinalize pelo modal de
  // restauração roda múltiplas vezes durante a execução (cada setState dentro
  // do handleFinalize causa re-render → handleFinalize muda de identidade →
  // useEffect roda de novo). Esse ref garante que só uma execução acontece.
  const finalizingFromRestoreRef = useRef(false);
  // Throttle de auto-retry do init de sessão. Sem isso, cada bipe seguinte a
  // uma falha de POST refaz a tentativa imediatamente — gera spam de toast.
  const lastInitErrorAtRef = useRef<number>(0);

  // Cache de detectCarrier por código. Em cada render da lista, cada item
  // chamava detectCarrier (regex + loop em carrierPatterns). Pra 500 pacotes
  // isso é 500 regex tests por re-render. O Map é resetado se carrierPatterns
  // mudar (o usuário alterou configuração).
  const carrierCache = useMemo(
    () => new Map<string, TransportadoraLabel>(),
    [bipagem.carrierPatterns],
  );
  const getCarrier = useCallback(
    (id: string): TransportadoraLabel => {
      const cached = carrierCache.get(id);
      if (cached !== undefined) return cached;
      const result = detectCarrier(id, bipagem.carrierPatterns);
      carrierCache.set(id, result);
      return result;
    },
    [carrierCache, bipagem.carrierPatterns],
  );

  // Restore sessão ativa do servidor ao montar
  useEffect(() => {
    if (!session) return;
    let cancelado = false;

    (async () => {
      try {
        const res = await fetch("/api/coletas/sessao");
        if (!res.ok) {
          setHydrated(true);
          return;
        }
        const data = await res.json();
        const s = data.sessao as {
          id: string;
          tipo: TipoColeta;
          conta: ContaOperacao;
          pacotes: string[];
          devolucoesData: Record<string, unknown>;
          iniciouEm: string;
        } | null;

        if (cancelado) return;

        if (s && s.pacotes?.length > 0) {
          // Sessão com dados — abre modal pra usuário escolher continuar ou
          // finalizar agora. Não carregamos no estado antes da decisão pra
          // evitar auto-save sobrescrever a sessão se o usuário simplesmente
          // não fizer nada.
          setPendingRestore({
            id: s.id,
            tipo: s.tipo,
            conta: s.conta,
            pacotes: s.pacotes,
            devolucoesData: s.devolucoesData ?? {},
            iniciouEm: s.iniciouEm,
          });
        } else if (s) {
          // Sessão vazia — adota silenciosamente
          setSessaoId(s.id);
          sessaoIdRef.current = s.id;
        }
      } catch {
        // Offline ou servidor instável — segue sem sessão restaurada
      } finally {
        if (!cancelado) setHydrated(true);
      }
    })();

    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  // PATCH com retry exponencial (1s, 2s, 4s). Atualiza saveState a cada
  // tentativa pra UI refletir 'saving' / 'saved' / 'error'.
  const patchSessaoWithRetry = useCallback(
    async (id: string, body: string): Promise<boolean> => {
      const delays = [0, 1000, 2000, 4000];
      for (let i = 0; i < delays.length; i++) {
        if (delays[i] > 0) {
          await new Promise((r) => setTimeout(r, delays[i]));
        }
        setSaveState("saving");
        try {
          const res = await fetch(`/api/coletas/sessao/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body,
          });
          if (res.ok) {
            setSaveState("saved");
            lastSentBodyRef.current = body;
            return true;
          }
        } catch {
          // tenta de novo
        }
      }
      setSaveState("error");
      return false;
    },
    [],
  );

  // 1ª gravação: cria sessão e faz o primeiro PATCH em sequência, sem
  // debounce. Em falha do POST, libera o lock pra próxima bipagem tentar
  // de novo (caso a rede volte) — mas o useEffect respeita um throttle de
  // INIT_RETRY_THROTTLE_MS pra não spammar toast a cada bipe.
  const initSessaoAndFlush = useCallback(
    async (body: string) => {
      setSaveState("saving");
      let id: string | null = null;
      try {
        const res = await fetch("/api/coletas/sessao", { method: "POST" });
        if (!res.ok) throw new Error(`POST sessão falhou: ${res.status}`);
        const created = await res.json();
        id = created.id as string;
      } catch {
        setSaveState("error");
        initLockRef.current = false;
        lastInitErrorAtRef.current = Date.now();
        toast.error(
          "Falha ao iniciar sessão — clique no badge para tentar novamente",
          { id: "coletas-sessao-init-error" },
        );
        return;
      }
      setSessaoId(id);
      sessaoIdRef.current = id;
      await patchSessaoWithRetry(id, body);
    },
    [patchSessaoWithRetry],
  );

  // Retry manual quando o badge mostrar 'error'. Cobre dois cenários:
  //  - Sessão já existe e o PATCH falhou → reenvia o último body.
  //  - Sessão nunca foi criada (POST falhou) → refaz init+flush e libera o
  //    throttle pra próxima auto-tentativa.
  const handleRetrySave = useCallback(() => {
    const body = lastSaveBodyRef.current;
    if (!body) return;
    const id = sessaoIdRef.current;
    if (!id) {
      lastInitErrorAtRef.current = 0;
      initLockRef.current = true;
      void initSessaoAndFlush(body);
      return;
    }
    void patchSessaoWithRetry(id, body);
  }, [patchSessaoWithRetry, initSessaoAndFlush]);

  // Auto-save sessão no servidor.
  //
  // Estratégia em duas pontas:
  //  1) **1ª gravação imediata** — quando ainda não há sessão e o usuário
  //     acabou de bipar o primeiro pacote, criamos a sessão E fazemos o
  //     primeiro PATCH SEM esperar 800ms. Isso fecha a janela em que o
  //     usuário podia fechar a aba antes do flush e perder o pacote.
  //  2) **Saves seguintes** — debounce 800ms, com retry exponencial em caso
  //     de falha de rede.
  //
  // Cria sessão sob demanda (sem dados, sem sessão → nada acontece).
  useEffect(() => {
    if (!hydrated || !session) return;
    // Suprime auto-save durante finalize/restore-finalize: evita PATCH contra
    // sessão que está sendo encerrada e gera saveState='error' barulhento.
    if (isFinalizing || isFinalizingFromRestore) return;
    // Modal de restauração aberto: não salva — usuário ainda não decidiu.
    if (pendingRestore) return;

    const hasData =
      bipagem.ids.length > 0 ||
      Object.keys(bipagem.devolucoesData).length > 0;
    if (!hasData && !sessaoIdRef.current) return;

    const body = JSON.stringify({
      tipo: bipagem.currentFunction,
      conta: bipagem.currentAccount,
      pacotes: bipagem.ids,
      devolucoesData: bipagem.devolucoesData,
    });
    lastSaveBodyRef.current = body;

    // Estado não mudou desde o último save bem-sucedido — não faz sentido bater
    // no servidor de novo. Reduz tráfego e CPU em sessões grandes.
    if (body === lastSentBodyRef.current) return;

    // 1ª gravação: cria sessão + PATCH imediatos (sem debounce).
    // Se o último POST falhou há menos de INIT_RETRY_THROTTLE_MS, não tenta
    // de novo automaticamente — evita o loop "bipa → POST falha → toast"
    // a cada keystroke. O usuário pode forçar via badge "clique para tentar".
    if (!sessaoIdRef.current && hasData && !initLockRef.current) {
      const desdeUltimoErro = Date.now() - lastInitErrorAtRef.current;
      if (desdeUltimoErro < INIT_RETRY_THROTTLE_MS) return;
      initLockRef.current = true;
      void initSessaoAndFlush(body);
      return;
    }

    // Saves subsequentes: debounce 800ms
    if (sessaoSaveTimeoutRef.current) {
      clearTimeout(sessaoSaveTimeoutRef.current);
    }
    sessaoSaveTimeoutRef.current = setTimeout(() => {
      const id = sessaoIdRef.current;
      if (!id) return;
      void patchSessaoWithRetry(id, body);
    }, 800);

    return () => {
      if (sessaoSaveTimeoutRef.current) {
        clearTimeout(sessaoSaveTimeoutRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hydrated,
    session?.user?.id,
    bipagem.ids,
    bipagem.devolucoesData,
    bipagem.currentFunction,
    bipagem.currentAccount,
    isFinalizing,
    isFinalizingFromRestore,
    pendingRestore,
  ]);

  // Auto-reset 'saved' → 'idle' depois de 3s (badge volta a sumir)
  useEffect(() => {
    if (saveState !== "saved") return;
    const t = setTimeout(() => setSaveState("idle"), 3000);
    return () => clearTimeout(t);
  }, [saveState]);

  // ── Fetch configs on mount ────────────────────────────────────────────────
  useEffect(() => {
    if (!session) return;

    const fetchAll = async () => {
      setIsLoading(true);
      try {
        const [transpRes, kitRes, skuRes] = await Promise.all([
          fetch("/api/coletas/configuracoes/transportadoras"),
          fetch("/api/coletas/configuracoes/kit-rules"),
          fetch("/api/sku-catalogo"),
        ]);

        if (transpRes.ok) {
          const { transportadoras } = await transpRes.json();
          bipagem.setCarrierPatterns(
            transportadoras.map(
              (t: { id: string; transportadora: string; prefixos: string[] }) => ({
                id: t.id,
                transportadora: t.transportadora,
                prefixos: t.prefixos,
              }),
            ),
          );
        }

        if (kitRes.ok) {
          const { kitRules } = await kitRes.json();
          bipagem.setKitRules(
            kitRules.map(
              (r: {
                id: string;
                kitSku: string;
                components: { sku: string; quantidade: number }[];
              }) => ({
                id: r.id,
                kitSku: r.kitSku,
                components: r.components.map((c) => ({
                  sku: c.sku,
                  qtd: c.quantidade,
                })),
              }),
            ),
          );
        }

        if (skuRes.ok) {
          const { skus } = await skuRes.json();
          bipagem.setSkuCatalog(
            skus.map((s: { codigo: string }) => s.codigo),
          );
        }
      } catch {
        toast.error("Erro ao carregar configuracoes");
      } finally {
        setIsLoading(false);
      }
    };

    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  // ── Auto-focus textarea ───────────────────────────────────────────────────
  // Não rouba foco de outros campos interativos — antes o polling pisava no
  // botão "Copiar" no meio do clique, invalidando user activation do
  // clipboard.writeText e fazendo a cópia falhar intermitentemente.
  useEffect(() => {
    if (viewMode !== "bipagem") return;
    const interval = setInterval(() => {
      if (devolucaoModalOpen || pendingRestore) return;
      const active = document.activeElement as HTMLElement | null;
      if (active === inputRef.current) return;
      const tag = active?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "BUTTON" ||
        tag === "SELECT"
      ) {
        return;
      }
      inputRef.current?.focus();
    }, 500);
    return () => clearInterval(interval);
  }, [viewMode, devolucaoModalOpen, pendingRestore]);

  // ── Auto-scroll list ──────────────────────────────────────────────────────
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [bipagem.ids]);

  // ── Arm audio on first interaction ────────────────────────────────────────
  useEffect(() => {
    const arm = () => {
      audioSuccessRef.current
        ?.play()
        .then(() => {
          audioSuccessRef.current?.pause();
          if (audioSuccessRef.current) audioSuccessRef.current.currentTime = 0;
        })
        .catch(() => {});
      audioErrorRef.current
        ?.play()
        .then(() => {
          audioErrorRef.current?.pause();
          if (audioErrorRef.current) audioErrorRef.current.currentTime = 0;
        })
        .catch(() => {});
    };
    ["click", "keydown", "touchstart"].forEach((e) =>
      window.addEventListener(e, arm, { once: true }),
    );
  }, []);

  // ── Audio ─────────────────────────────────────────────────────────────────
  const playSound = useCallback((type: "success" | "error") => {
    const audio =
      type === "success" ? audioSuccessRef.current : audioErrorRef.current;
    if (audio) {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    }
  }, []);

  // ── Show scan overlay ─────────────────────────────────────────────────────
  const showOverlay = useCallback(
    (id: string, isDup: boolean, carrier?: TransportadoraLabel) => {
      playSound(isDup ? "error" : "success");
      setOverlayContent({ id, isDup, carrier });
      setOverlayVisible(true);
    },
    [playSound],
  );

  // Debounce o processText em vez de empilhar um setTimeout por keystroke.
  // Scanner manda burst de 10-20 chars em ~50ms — antes a gente rodava o
  // extrator de IDs N vezes (uma por keystroke), agora roda 1 vez com o
  // texto completo. Isso reduz drasticamente CPU em sessões longas.
  const processTimerRef = useRef<NodeJS.Timeout | null>(null);
  const handleTextareaChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      bipagem.setInputValue(value);

      if (processTimerRef.current) {
        clearTimeout(processTimerRef.current);
      }
      processTimerRef.current = setTimeout(() => {
        const result = bipagem.processText(value);
        if (result.newIds.length > 0) {
          const lastId = result.newIds[result.newIds.length - 1];
          const carrier = getCarrier(lastId);
          showOverlay(lastId, false, carrier);
          if (
            bipagem.currentFunction === "DEVOLUCAO" ||
            bipagem.currentFunction === "CANCELADO"
          ) {
            setDevolucaoPacketId(lastId);
            setDevolucaoCarrier(carrier ?? null);
            setDevolucaoModalOpen(true);
          }
        } else if (result.duplicates.length > 0) {
          showOverlay(result.duplicates[0], true);
        }
        if (bipagem.autoClear) {
          bipagem.setInputValue("");
        }
      }, 30);
    },
    [bipagem, showOverlay, getCarrier, setDevolucaoPacketId, setDevolucaoModalOpen],
  );

  // ── Remove package by search ──────────────────────────────────────────────
  const handleSearchRemove = useCallback(() => {
    const search = removeInputValue.trim().toLowerCase();
    if (!search) return;
    const found = bipagem.ids.find(
      (id) => id.trim().toLowerCase() === search,
    );
    if (found) {
      bipagem.removeId(found);
      toast.success(`Pacote ${found} removido`);
    } else {
      toast.error(`Pacote "${removeInputValue.trim()}" nao encontrado`);
    }
    setRemoveInputValue("");
  }, [removeInputValue, bipagem]);

  // ── Copy IDs ──────────────────────────────────────────────────────────────
  const handleCopy = useCallback(async () => {
    try {
      await copyToClipboard(bipagem.ids.join(","));
      toast.success(`Copiado! (${bipagem.ids.length})`);
    } catch {
      toast.error("Erro ao copiar — verifique permissões do navegador");
    }
  }, [bipagem.ids]);

  // ── Limpar lista (NÃO encerra a sessão — só limpa o estado local) ────────
  const handleClear = useCallback(() => {
    bipagem.clear();
    // Sai do modo "continuação" — se o usuário limpou a tela, não quer mais
    // sobrescrever a bipagem original.
    if (continuandoBipagemIdRef.current) {
      setContinuandoBipagemId(null);
      continuandoBipagemIdRef.current = null;
      initLockRef.current = false;
    }
    toast.info("Lista zerada");
  }, [bipagem]);

  // ── Forçar Parada: encerra a sessão no servidor e limpa o estado ─────────
  const handleForcarParada = useCallback(async () => {
    if (!sessaoIdRef.current) {
      bipagem.clear();
      return;
    }
    if (
      !confirm(
        "Forçar parada encerra a sessão no servidor e apaga o progresso atual. Continuar?",
      )
    ) {
      return;
    }
    setIsForcingStop(true);
    try {
      await fetch(`/api/coletas/sessao/${sessaoIdRef.current}/encerrar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo: "forcada" }),
      });
    } catch {
      // segue fluxo — limpa local mesmo se falhar
    } finally {
      bipagem.clear();
      setSessaoId(null);
      sessaoIdRef.current = null;
      initLockRef.current = false;
      lastSaveBodyRef.current = null;
      lastSentBodyRef.current = null;
      lastInitErrorAtRef.current = 0;
      setSaveState("idle");
      setContinuandoBipagemId(null);
      continuandoBipagemIdRef.current = null;
      setIsForcingStop(false);
      toast.dismiss("coletas-sessao-init-error");
      toast.info("Sessão encerrada");
    }
  }, [bipagem]);

  // ── Exportar resumo da sessão atual (TXT local) ──────────────────────────
  const handleExportResumo = useCallback(() => {
    if (!bipagem.ids.length) {
      toast.error("Sem pacotes para exportar");
      return;
    }
    const tipo = bipagem.currentFunction;
    const conta = bipagem.currentAccount;
    const pacotes = bipagem.ids;
    const devolucoes = bipagem.devolucoesData;

    const tipoDisplay = FUNCTION_DISPLAY[tipo];
    const contaDisplay = OPERATION_DISPLAY[conta];
    const now = new Date();

    let out = "";
    out += "RESUMO DA SESSAO DE COLETAS\n";
    out += "----------------------------------------\n";
    out += `Tipo        : ${tipoDisplay}\n`;
    out += `Conta       : ${contaDisplay}\n`;
    out += `Gerado em   : ${now.toLocaleString("pt-BR")}\n`;
    out += `Total       : ${pacotes.length} pacote(s)\n`;
    out += "\n";

    const isDev = tipo === "DEVOLUCAO" || tipo === "CANCELADO";
    if (isDev) {
      const totals: Record<string, number> = {};
      for (const dev of Object.values(devolucoes)) {
        for (const line of dev.skuLines ?? []) {
          if (!line.sku) continue;
          totals[line.sku] = (totals[line.sku] || 0) + (line.qtd || 0);
        }
      }
      const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
      if (sorted.length > 0) {
        out += "SKUs DEVOLVIDOS\n";
        out += "----------------------------------------\n";
        for (const [sku, qtd] of sorted) {
          out += `${sku.padEnd(20)} = ${qtd}\n`;
        }
        out += "\n";
      }
    }

    out += "PACOTES\n";
    out += "----------------------------------------\n";
    for (const codigo of pacotes) {
      out += `${codigo}${devolucoes[codigo] ? " [devolucao]" : ""}\n`;
    }

    const dateStr = `${now.getDate().toString().padStart(2, "0")}-${(now.getMonth() + 1).toString().padStart(2, "0")}-${now.getFullYear()}`;
    downloadTxt(
      out,
      `RESUMO-COLETAS-${tipoDisplay}-${contaDisplay}-${dateStr}.txt`.replace(
        / /g,
        "_",
      ),
    );
    toast.success("Resumo exportado!");
  }, [bipagem.ids, bipagem.devolucoesData, bipagem.currentFunction, bipagem.currentAccount]);

  // ── Enviar resumo da sessão por email (operador + admins) ────────────────
  const handleEnviarEmailResumo = useCallback(async () => {
    if (!sessaoIdRef.current || !bipagem.ids.length) {
      toast.error("Sessão vazia — nada para enviar");
      return;
    }
    setIsSendingEmail(true);
    try {
      // Força o flush do estado pendente antes de enviar — garante que
      // o email reflita a UI atual mesmo com debounce pendente.
      await fetch(`/api/coletas/sessao/${sessaoIdRef.current}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo: bipagem.currentFunction,
          conta: bipagem.currentAccount,
          pacotes: bipagem.ids,
          devolucoesData: bipagem.devolucoesData,
        }),
      });

      const res = await fetch(
        `/api/coletas/sessao/${sessaoIdRef.current}/enviar-email`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Erro ao enviar");
      toast.success("Resumo enviado por email!", {
        description: `${data.sent ?? 0} destinatário(s)${data.failed ? ` · ${data.failed} falha(s)` : ""}`,
      });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao enviar email",
      );
    } finally {
      setIsSendingEmail(false);
    }
  }, [
    bipagem.ids,
    bipagem.devolucoesData,
    bipagem.currentFunction,
    bipagem.currentAccount,
  ]);

  // ── Finalize ──────────────────────────────────────────────────────────────
  // Retorna `true` em sucesso, `false` em qualquer falha. O modal de
  // restauração usa esse retorno pra decidir se fecha ou mantém aberto.
  const handleFinalize = useCallback(async (): Promise<boolean> => {
    if (!bipagem.ids.length) {
      toast.error("Sem itens para finalizar");
      return false;
    }

    setIsFinalizing(true);
    try {
      const pacotes = bipagem.ids.map((id) => ({
        codigo: id,
        transportadora: getCarrier(id),
      }));

      // Build devolucoes record for API
      const devolucoes: Record<string, unknown> = {};
      for (const [code, devData] of Object.entries(bipagem.devolucoesData)) {
        devolucoes[code] = {
          skuLines: devData.skuLines,
          operacao: devData.operacao,
          avaria: devData.avaria,
          obs: devData.obs,
          tipo: devData.tipo,
          fotoPacoteBase64: devData.fotoPacoteBase64,
          fotoAvariaBase64: devData.fotoAvariaBase64,
        };
      }

      const continuandoId = continuandoBipagemIdRef.current;
      const res = await fetch(
        continuandoId
          ? `/api/coletas/${continuandoId}/continuar`
          : "/api/coletas",
        {
          method: continuandoId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tipo: bipagem.currentFunction,
            conta: bipagem.currentAccount,
            pacotes,
            devolucoes,
          }),
        },
      );

      if (!res.ok) throw new Error();

      // Export TXT
      const date = new Date();
      const dateStr = `${date.getDate().toString().padStart(2, "0")}-${(date.getMonth() + 1).toString().padStart(2, "0")}-${date.getFullYear()}`;

      const currentFn = bipagem.currentFunction;
      const currentAcc = bipagem.currentAccount;
      const accDisplay = OPERATION_DISPLAY[currentAcc];

      const filename =
        currentFn === "DEVOLUCAO"
          ? `DEVOLUCOES-${accDisplay}-${dateStr}.txt`
          : currentFn === "CANCELADO"
            ? `CANCELADOS-${accDisplay}-${dateStr}.txt`
            : `${accDisplay}-${dateStr}.txt`;

      downloadTxt(bipagem.ids.join("\n"), filename);

      // Export devolucoes TXT if applicable
      if (currentFn === "DEVOLUCAO") {
        const devTxt = buildDevolucaoExportTxt(
          bipagem.ids,
          bipagem.devolucoesData,
          bipagem.kitRules,
        );
        if (devTxt) {
          downloadTxt(devTxt, `DEVOLUCOES-DETALHES-${dateStr}.txt`);
        }
      }

      // Open manifest for FLEX
      if (currentFn === "FLEX") {
        const html = buildManifestHTML(
          bipagem.ids,
          accDisplay,
          currentFn,
        );
        const blob = new Blob([html], { type: "text/html;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const w = window.open(url, "_blank");
        if (!w) {
          const a = document.createElement("a");
          a.href = url;
          a.download = `ROMANEIO-${accDisplay}-${dateStr}.html`;
          a.click();
        }
        URL.revokeObjectURL(url);
      }

      // TODO(coletas): envio automático de email no finalize foi removido
      // em 2026-04-27 a pedido. Revisitar a regra (talvez condicional ao
      // tipo da coleta, ou opt-in via toggle no UI). O botão "Enviar
      // Resumo" continua disponível para envio manual.

      // Encerra a sessão com motivo=finalizada
      if (sessaoIdRef.current) {
        await fetch(
          `/api/coletas/sessao/${sessaoIdRef.current}/encerrar`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ motivo: "finalizada" }),
          },
        ).catch(() => {});
        setSessaoId(null);
        sessaoIdRef.current = null;
      }

      bipagem.clear();
      initLockRef.current = false;
      lastSaveBodyRef.current = null;
      lastSentBodyRef.current = null;
      lastInitErrorAtRef.current = 0;
      setSaveState("idle");
      setContinuandoBipagemId(null);
      continuandoBipagemIdRef.current = null;
      toast.dismiss("coletas-sessao-init-error");
      toast.success(
        continuandoId ? "Bipagem atualizada!" : "Bipagem finalizada!",
      );
      return true;
    } catch {
      toast.error("Erro ao finalizar bipagem");
      return false;
    } finally {
      setIsFinalizing(false);
    }
  }, [bipagem]);

  // ── Modal de restauração de sessão ──────────────────────────────────────
  const handleContinueRestore = useCallback(() => {
    if (!pendingRestore) return;
    bipagem.loadFromTemp(
      {
        pacotes: pendingRestore.pacotes.map((codigo) => ({ codigo })),
        devolucoes: pendingRestore.devolucoesData as Record<
          string,
          Record<string, unknown>
        >,
      },
      pendingRestore.tipo,
      pendingRestore.conta,
    );
    setSessaoId(pendingRestore.id);
    sessaoIdRef.current = pendingRestore.id;
    // Evita o auto-save de criar uma nova sessão por cima desta
    initLockRef.current = true;
    setPendingRestore(null);
    toast.success(`Bipagem retomada (${pendingRestore.pacotes.length})`);
  }, [pendingRestore, bipagem]);

  // "Finalizar agora": carrega no estado + dispara handleFinalize quando o
  // estado tiver propagado. Em falha, mantém modal aberto pra nova tentativa.
  const handleFinalizeFromRestore = useCallback(() => {
    if (!pendingRestore) return;
    bipagem.loadFromTemp(
      {
        pacotes: pendingRestore.pacotes.map((codigo) => ({ codigo })),
        devolucoes: pendingRestore.devolucoesData as Record<
          string,
          Record<string, unknown>
        >,
      },
      pendingRestore.tipo,
      pendingRestore.conta,
    );
    setSessaoId(pendingRestore.id);
    sessaoIdRef.current = pendingRestore.id;
    initLockRef.current = true;
    setIsFinalizingFromRestore(true);
  }, [pendingRestore, bipagem]);

  // Dispara handleFinalize após o estado ter propagado (esperar bipagem.ids
  // refletir os pacotes da sessão restaurada). Sem este indireto, handleFinalize
  // captura o array vazio anterior por closure.
  //
  // O useEffect dispara várias vezes durante a execução do handleFinalize
  // (setState intermediários re-renderizam → handleFinalize muda de identidade
  // por ser useCallback([bipagem]) → effect roda de novo). O ref abaixo
  // garante que apenas a primeira execução faz fetch — re-entradas são
  // ignoradas até a anterior terminar.
  useEffect(() => {
    if (!isFinalizingFromRestore || !pendingRestore) return;
    if (bipagem.ids.length !== pendingRestore.pacotes.length) return;
    if (finalizingFromRestoreRef.current) return;
    finalizingFromRestoreRef.current = true;
    (async () => {
      const ok = await handleFinalize();
      setIsFinalizingFromRestore(false);
      if (ok) setPendingRestore(null);
      finalizingFromRestoreRef.current = false;
    })();
  }, [isFinalizingFromRestore, pendingRestore, bipagem.ids, handleFinalize]);

  // ── Devolucao Modal ───────────────────────────────────────────────────────
  const handleOpenDevolucao = useCallback((pacoteId: string) => {
    setDevolucaoPacketId(pacoteId);
    setDevolucaoCarrier(getCarrier(pacoteId));
    setDevolucaoModalOpen(true);
  }, [getCarrier]);

  // Callback estável para PacoteListItem — sem isso, ref nova a cada render
  // quebraria o React.memo do item e re-renderizaria a lista inteira por bipe.
  const handleRemovePacote = useCallback(
    (codigo: string) => {
      bipagem.removeId(codigo);
      setTimeout(() => inputRef.current?.focus(), 0);
    },
    [bipagem.removeId],
  );

  const handleSaveDevolucao = useCallback(
    (data: DevolucaoFormData) => {
      bipagem.setDevolucao(devolucaoPacketId, data);
      setTimeout(() => inputRef.current?.focus(), 100);
    },
    [bipagem, devolucaoPacketId, inputRef],
  );

  // ── Historico callbacks ───────────────────────────────────────────────────
  const handleReview = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/coletas/${id}/revisar`, {
        method: "PUT",
      });
      if (!res.ok) throw new Error();
      toast.success("Revisado com sucesso!");
      setViewMode("bipagem");
      bipagem.clear();
    } catch {
      toast.error("Erro ao revisar");
    }
  }, [bipagem]);

  const handleExportGeral = useCallback((bipagens: BipagemRecord[]) => {
    if (!bipagens.length) {
      toast.warning("Nenhum registro para exportar");
      return;
    }
    const content = buildHistoricoReport("geral", bipagens);
    const date = new Date();
    const dateStr = `${date.getDate().toString().padStart(2, "0")}-${(date.getMonth() + 1).toString().padStart(2, "0")}-${date.getFullYear()}`;
    downloadTxt(content, `HISTORICO_GERAL_${dateStr}.txt`);
    toast.success("Relatorio exportado!");
  }, []);

  const handleExportResumido = useCallback((bipagens: BipagemRecord[]) => {
    if (!bipagens.length) {
      toast.warning("Nenhum registro para exportar");
      return;
    }
    const content = buildHistoricoReport("resumido", bipagens);
    const date = new Date();
    const dateStr = `${date.getDate().toString().padStart(2, "0")}-${(date.getMonth() + 1).toString().padStart(2, "0")}-${date.getFullYear()}`;
    downloadTxt(content, `HISTORICO_RESUMIDO_${dateStr}.txt`);
    toast.success("Relatorio exportado!");
  }, []);

  const handleCopyCodes = useCallback(async (bipagemId: string) => {
    try {
      const res = await fetch(`/api/coletas/${bipagemId}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      const codes = data.pacotes.map(
        (p: { codigo: string }) => p.codigo,
      );
      await copyToClipboard(codes.join(","));
      toast.success(`Copiado! (${codes.length} IDs)`);
    } catch {
      toast.error("Erro ao copiar codigos");
    }
  }, []);

  const handleResumeBipagem = useCallback(
    async (bipagemId: string) => {
      // Bloqueia se o usuário já está em uma sessão ativa — senão sobrescreve
      // pacotes sem que ele perceba.
      if (bipagem.ids.length > 0) {
        toast.error(
          "Finalize ou pare a bipagem atual antes de continuar outra",
        );
        return;
      }
      try {
        const res = await fetch(`/api/coletas/${bipagemId}`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        const pacotes = data.pacotes as Array<{
          codigo: string;
          devolucao: {
            operacao: "TIKTOK_SHOP" | "MERCADO_LIVRE" | "SHOPEE";
            avaria: boolean;
            observacao: string | null;
            tipo: TipoColeta;
            skuLines: Array<{ sku: string; quantidade: number }>;
          } | null;
        }>;

        // Reconstrói devoluções para a UI poder editar
        const devolucoes: Record<string, unknown> = {};
        for (const p of pacotes) {
          if (!p.devolucao) continue;
          devolucoes[p.codigo] = {
            skuLines: p.devolucao.skuLines.map((l) => ({
              sku: l.sku,
              qtd: l.quantidade,
            })),
            operacao: p.devolucao.operacao,
            avaria: p.devolucao.avaria,
            obs: p.devolucao.observacao ?? "",
            tipo: p.devolucao.tipo,
          };
        }

        bipagem.loadFromTemp(
          {
            pacotes: pacotes.map((p) => ({ codigo: p.codigo })),
            devolucoes: devolucoes as Record<string, Record<string, unknown>>,
          },
          data.tipo,
          data.conta,
        );

        // Marca o modo "continuação" — o finalize vai usar PUT no registro
        // original em vez de POST (clone).
        setContinuandoBipagemId(bipagemId);
        continuandoBipagemIdRef.current = bipagemId;
        // Evita o auto-save criar uma nova sessão por cima — a continuação
        // mantém o estado puramente local até o finalize.
        initLockRef.current = true;

        setViewMode("bipagem");
        toast.success(
          `Continuando bipagem (${pacotes.length} pacote(s)) — bipe mais e finalize para atualizar o registro`,
        );
        setTimeout(() => inputRef.current?.focus(), 100);
      } catch {
        toast.error("Erro ao carregar bipagem");
      }
    },
    [bipagem],
  );

  // ── Config CRUD callbacks ─────────────────────────────────────────────────
  const handleAddSkus = useCallback(
    async (skus: string[]) => {
      const results: string[] = [];
      for (const sku of skus) {
        try {
          const res = await fetch("/api/sku-catalogo", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ codigo: sku }),
          });
          if (res.ok || res.status === 409) {
            results.push(sku);
          }
        } catch {
          // skip failed
        }
      }
      // Refresh catalog
      try {
        const res = await fetch("/api/sku-catalogo");
        if (res.ok) {
          const { skus: freshSkus } = await res.json();
          bipagem.setSkuCatalog(
            freshSkus.map((s: { codigo: string }) => s.codigo),
          );
        }
      } catch {
        // fallback: just add locally
        bipagem.setSkuCatalog((prev: string[]) =>
          Array.from(new Set([...prev, ...results])),
        );
      }
    },
    [bipagem],
  );

  const handleRemoveSku = useCallback(
    (sku: string) => {
      // No delete endpoint for individual SKU — remove from local state
      bipagem.setSkuCatalog((prev: string[]) =>
        prev.filter((s) => s !== sku),
      );
    },
    [bipagem],
  );

  const handleClearSkus = useCallback(() => {
    bipagem.setSkuCatalog([]);
  }, [bipagem]);

  const handleSaveKitRule = useCallback(
    async (rule: {
      kitSku: string;
      components: { sku: string; qtd: number }[];
    }) => {
      try {
        const res = await fetch("/api/coletas/configuracoes/kit-rules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kitSku: rule.kitSku,
            components: rule.components.map((c) => ({
              sku: c.sku,
              quantidade: c.qtd,
            })),
          }),
        });
        if (!res.ok) throw new Error();
        const created = await res.json();
        bipagem.setKitRules((prev: SkuKitRule[]) => [
          ...prev,
          {
            id: created.id,
            kitSku: created.kitSku,
            components: created.components.map(
              (c: { sku: string; quantidade: number }) => ({
                sku: c.sku,
                qtd: c.quantidade,
              }),
            ),
          },
        ]);
      } catch {
        toast.error("Erro ao salvar regra de kit");
      }
    },
    [bipagem],
  );

  const handleDeleteKitRule = useCallback(
    async (id: string) => {
      try {
        const res = await fetch("/api/coletas/configuracoes/kit-rules", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        if (!res.ok) throw new Error();
        bipagem.setKitRules((prev: SkuKitRule[]) =>
          prev.filter((r) => r.id !== id),
        );
      } catch {
        toast.error("Erro ao remover regra de kit");
      }
    },
    [bipagem],
  );

  const handleSaveCarrierPattern = useCallback(
    async (pattern: { transportadora: string; prefixos: string[] }) => {
      try {
        const res = await fetch(
          "/api/coletas/configuracoes/transportadoras",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(pattern),
          },
        );
        if (!res.ok) throw new Error();
        const updated = await res.json();
        bipagem.setCarrierPatterns((prev: CarrierPattern[]) => {
          const exists = prev.find(
            (p) => p.transportadora === pattern.transportadora,
          );
          if (exists) {
            return prev.map((p) =>
              p.transportadora === pattern.transportadora
                ? { ...p, id: updated.id, prefixos: pattern.prefixos }
                : p,
            );
          }
          return [
            ...prev,
            {
              id: updated.id,
              transportadora: pattern.transportadora,
              prefixos: pattern.prefixos,
            },
          ];
        });
      } catch {
        toast.error("Erro ao salvar padrao de transportadora");
      }
    },
    [bipagem],
  );

  const handleDeleteCarrierPattern = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(
          "/api/coletas/configuracoes/transportadoras",
          {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id }),
          },
        );
        if (!res.ok) throw new Error();
        bipagem.setCarrierPatterns((prev: CarrierPattern[]) =>
          prev.filter((p) => p.id !== id),
        );
      } catch {
        toast.error("Erro ao remover padrao de transportadora");
      }
    },
    [bipagem],
  );

  // ── Devolucao TXT export per operation ────────────────────────────────────
  const handleExportDevolucaoTxt = useCallback(
    (operacao?: string) => {
      const txt = buildDevolucaoExportTxt(
        bipagem.ids,
        bipagem.devolucoesData,
        bipagem.kitRules,
        operacao as any,
      );
      if (!txt) {
        toast.warning("Sem devolucoes para exportar");
        return;
      }
      const date = new Date();
      const dateStr = `${date.getDate().toString().padStart(2, "0")}-${(date.getMonth() + 1).toString().padStart(2, "0")}-${date.getFullYear()}`;
      const opLabel = operacao
        ? OPERATION_DISPLAY[operacao as keyof typeof OPERATION_DISPLAY]
        : "TODAS";
      downloadTxt(
        txt,
        `DEVOLUCOES-${opLabel.replace(/ /g, "_")}-${dateStr}.txt`,
      );
      toast.success("Relatorio de devolucoes exportado!");
    },
    [bipagem],
  );

  // ── Render ────────────────────────────────────────────────────────────────
  // Só esconde a tela na primeira carga (sem configs ainda). Se a sessão
  // do better-auth revalidar no meio do uso (ex.: focus event do scanner),
  // mantemos a UI montada — caso contrário a tela "pisca" a cada bipe.
  const isFirstLoad =
    isLoading && bipagem.carrierPatterns.length === 0 && bipagem.kitRules.length === 0;
  if (isPending || isFirstLoad) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
      </div>
    );
  }

  if (!session) return null;

  const isDevolucaoType =
    bipagem.currentFunction === "DEVOLUCAO" ||
    bipagem.currentFunction === "CANCELADO";

  return (
    <div className="space-y-6">
      {/* Audio elements */}
      <audio ref={audioSuccessRef} src="/sounds/bipado.mp3" preload="auto" />
      <audio ref={audioErrorRef} src="/sounds/erro.mp3" preload="auto" />

      {/* Scan overlay */}
      <ScanOverlay
        visible={overlayVisible}
        content={overlayContent}
        onHide={() => setOverlayVisible(false)}
      />

      {/* Devolucao modal */}
      <DevolucaoModal
        open={devolucaoModalOpen}
        onOpenChange={setDevolucaoModalOpen}
        pacoteId={devolucaoPacketId}
        carrier={devolucaoCarrier}
        currentAccount={bipagem.currentAccount}
        currentFunction={bipagem.currentFunction}
        skuCatalog={bipagem.skuCatalog}
        kitRules={bipagem.kitRules}
        existingData={bipagem.devolucoesData[devolucaoPacketId]}
        onSave={handleSaveDevolucao}
      />

      {/* Modal: sessão em andamento na restauração */}
      <AlertDialog open={pendingRestore !== null}>
        <AlertDialogContent
          className="bg-zinc-950 border-zinc-800"
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="text-zinc-100">
              Sessão de bipagem em andamento
            </AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400">
              {pendingRestore && (
                <>
                  Você tem{" "}
                  <strong className="text-zinc-100">
                    {pendingRestore.pacotes.length} pacote(s)
                  </strong>{" "}
                  de uma sessão anterior (
                  <strong className="text-zinc-200">
                    {FUNCTION_DISPLAY[pendingRestore.tipo]}
                  </strong>{" "}
                  ·{" "}
                  <strong className="text-zinc-200">
                    {OPERATION_DISPLAY[pendingRestore.conta]}
                  </strong>
                  ) iniciada em{" "}
                  <strong className="text-zinc-200">
                    {new Date(pendingRestore.iniciouEm).toLocaleString(
                      "pt-BR",
                    )}
                  </strong>
                  . Deseja continuar ou finalizá-la agora?
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={handleContinueRestore}
              disabled={isFinalizingFromRestore}
              className="border-zinc-700 text-zinc-200 hover:bg-zinc-800"
            >
              Continuar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Impede o AlertDialog de fechar automaticamente — o modal só
                // fecha quando o handleFinalize confirma sucesso (via useEffect).
                e.preventDefault();
                handleFinalizeFromRestore();
              }}
              disabled={isFinalizingFromRestore || isFinalizing}
              className="bg-green-700 hover:bg-green-800 text-white"
            >
              {isFinalizingFromRestore || isFinalizing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Finalizando...
                </>
              ) : (
                "Finalizar agora"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Header */}
      <PageHeader
        title="Coletas"
        description="Bipagem de pacotes para coleta, devolucao e cancelamento"
        icon={<Package className="h-6 w-6" />}
      />

      {/* View tabs */}
      <div className="flex gap-2 flex-wrap">
        {[
          { key: "bipagem" as const, label: "Bipagem", icon: Package },
          { key: "historico" as const, label: "Historico", icon: History },
          { key: "configuracoes" as const, label: "Configuracoes", icon: Settings },
        ].map(({ key, label, icon: Icon }) => (
          <Button
            key={key}
            variant={viewMode === key ? "default" : "outline"}
            onClick={() => setViewMode(key)}
            className={cn(
              viewMode === key
                ? "bg-green-700 hover:bg-green-800 text-white"
                : "border-zinc-700 text-zinc-300 hover:bg-zinc-800",
            )}
          >
            <Icon className="mr-2 h-4 w-4" />
            {label}
          </Button>
        ))}
      </div>

      {/* ── BIPAGEM VIEW ─────────────────────────────────────────────── */}
      {viewMode === "bipagem" && (
        <div className="space-y-4">
          {/* Banner: modo continuação (Bipar Mais) */}
          {continuandoBipagemId && (
            <div className="rounded-lg border border-blue-700 bg-blue-950/40 px-3 py-2 flex items-center justify-between gap-3">
              <p className="text-sm text-blue-200">
                <strong>Continuando bipagem</strong> — ao finalizar, os pacotes
                serão adicionados ao registro original (sem criar um novo).
              </p>
              <button
                type="button"
                onClick={() => {
                  setContinuandoBipagemId(null);
                  continuandoBipagemIdRef.current = null;
                  initLockRef.current = false;
                  toast.info(
                    "Modo continuação cancelado — finalize para criar nova bipagem",
                  );
                }}
                className="text-xs text-blue-300 hover:text-blue-100 underline whitespace-nowrap"
              >
                Cancelar continuação
              </button>
            </div>
          )}

          {/* Function type selector */}
          <Card className="bg-zinc-950 border-zinc-800">
            <CardContent className="p-4 space-y-4">
              <div>
                <label className="block text-xs font-bold text-zinc-300 mb-2 uppercase tracking-wider">
                  Tipo
                </label>
                <div className="flex gap-2 flex-wrap">
                  {FUNCTION_TYPES.map((fn) => {
                    const selected = bipagem.currentFunction === fn;
                    return (
                      <Button
                        key={fn}
                        variant={selected ? "default" : "outline"}
                        size="sm"
                        onClick={() => bipagem.setCurrentFunction(fn)}
                        aria-pressed={selected}
                        className={cn(
                          "flex-1 transition-all",
                          selected
                            ? cn(
                                "text-white font-bold ring-2 ring-offset-2 ring-offset-zinc-950 shadow-lg",
                                fn === "FLEX" &&
                                  "bg-teal-600 hover:bg-teal-700 ring-teal-400",
                                fn === "COLETA" &&
                                  "bg-blue-500 hover:bg-blue-600 ring-blue-400",
                                fn === "DEVOLUCAO" &&
                                  "bg-green-600 hover:bg-green-700 ring-green-400",
                                fn === "CANCELADO" &&
                                  "bg-amber-500 hover:bg-amber-600 ring-amber-400",
                              )
                            : "border-zinc-500 text-zinc-200 hover:bg-zinc-700 hover:text-white",
                        )}
                      >
                        {selected && <Check className="h-3.5 w-3.5" />}
                        {FUNCTION_DISPLAY[fn]}
                      </Button>
                    );
                  })}
                </div>
              </div>

              {/* Account selector (hidden for FLEX) */}
              {bipagem.currentFunction !== "FLEX" && (
                <div>
                  <label className="block text-xs font-bold text-zinc-300 mb-2 uppercase tracking-wider">
                    Conta
                  </label>
                  <div className="flex gap-2 flex-wrap">
                    {OPERATIONS.map((op) => {
                      const selected = bipagem.currentAccount === op;
                      return (
                        <Button
                          key={op}
                          variant={selected ? "default" : "outline"}
                          size="sm"
                          onClick={() => bipagem.setCurrentAccount(op)}
                          aria-pressed={selected}
                          className={cn(
                            "flex-1 transition-all",
                            selected
                              ? "bg-green-700 hover:bg-green-800 text-white font-bold ring-2 ring-green-400 ring-offset-2 ring-offset-zinc-950 shadow-lg"
                              : "border-zinc-500 text-zinc-200 hover:bg-zinc-700 hover:text-white",
                          )}
                        >
                          {selected && <Check className="h-3.5 w-3.5" />}
                          {OPERATION_DISPLAY[op]}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Toggles */}
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={bipagem.dedup}
                    onChange={(e) => bipagem.setDedup(e.target.checked)}
                    className="accent-green-700"
                  />
                  Deduplicar
                </label>
                <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={bipagem.autoClear}
                    onChange={(e) => bipagem.setAutoClear(e.target.checked)}
                    className="accent-green-700"
                  />
                  Auto-limpar
                </label>
              </div>
            </CardContent>
          </Card>

          {/* Scanner textarea */}
          <Card className="bg-zinc-950 border-zinc-800">
            <CardContent className="p-4">
              <Textarea
                ref={inputRef}
                value={bipagem.inputValue}
                onChange={handleTextareaChange}
                placeholder="Bipe o codigo do pacote aqui..."
                rows={3}
                className="font-mono text-sm bg-zinc-900 border-zinc-700 text-zinc-100 resize-none"
              />
              {bipagem.statusMsg && (
                <p
                  className={cn(
                    "text-xs mt-2 font-semibold",
                    bipagem.statusType === "success"
                      ? "text-green-400"
                      : bipagem.statusType === "error"
                        ? "text-red-400"
                        : "text-amber-400",
                  )}
                >
                  {bipagem.statusMsg}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Package list */}
          {bipagem.ids.length > 0 && (
            <Card className="bg-zinc-950 border-zinc-800">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-zinc-200">
                    Pacotes ({bipagem.ids.length})
                  </h3>
                  {/* Remove search */}
                  <div className="flex gap-2">
                    <input
                      value={removeInputValue}
                      onChange={(e) => setRemoveInputValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSearchRemove();
                      }}
                      placeholder="Buscar p/ remover..."
                      className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs font-mono text-zinc-100 w-40"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleSearchRemove}
                      className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                    >
                      <Search className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                <div
                  ref={listRef}
                  className="max-h-[400px] overflow-y-auto space-y-1"
                >
                  {bipagem.ids.map((id, index) => (
                    <PacoteListItem
                      key={id}
                      codigo={id}
                      index={index}
                      carrier={getCarrier(id)}
                      hasDevolucao={!!bipagem.devolucoesData[id]}
                      onRemove={handleRemovePacote}
                      onEditDevolucao={handleOpenDevolucao}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Export devolucao TXT buttons */}
          {isDevolucaoType &&
            bipagem.ids.length > 0 &&
            Object.keys(bipagem.devolucoesData).length > 0 && (
              <Card className="bg-zinc-950 border-zinc-800">
                <CardContent className="p-4">
                  <label className="block text-xs font-bold text-zinc-400 mb-2">
                    Exportar Devolucoes (TXT)
                  </label>
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleExportDevolucaoTxt()}
                      className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                    >
                      <FileDown className="mr-1 h-4 w-4" /> Todas
                    </Button>
                    {OPERATIONS.map((op) => (
                      <Button
                        key={op}
                        variant="outline"
                        size="sm"
                        onClick={() => handleExportDevolucaoTxt(op)}
                        className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                      >
                        <FileDown className="mr-1 h-4 w-4" />{" "}
                        {OPERATION_DISPLAY[op]}
                      </Button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

          {/* Action buttons */}
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="outline"
              onClick={handleClear}
              disabled={!bipagem.ids.length}
              className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            >
              <Trash2 className="mr-2 h-4 w-4" /> Limpar
            </Button>
            <Button
              variant="outline"
              onClick={handleCopy}
              disabled={!bipagem.ids.length}
              className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            >
              <Copy className="mr-2 h-4 w-4" /> Copiar
            </Button>
            <Button
              variant="outline"
              onClick={handleExportResumo}
              disabled={!bipagem.ids.length}
              className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            >
              <FileText className="mr-2 h-4 w-4" /> Exportar Resumo
            </Button>
            <Button
              variant="outline"
              onClick={handleEnviarEmailResumo}
              disabled={!bipagem.ids.length || isSendingEmail || !sessaoId}
              className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            >
              {isSendingEmail ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Mail className="mr-2 h-4 w-4" />
              )}
              Enviar Resumo
            </Button>
            <Button
              variant="outline"
              onClick={handleForcarParada}
              disabled={isForcingStop || (!sessaoId && !bipagem.ids.length)}
              className="border-red-900 text-red-300 hover:bg-red-950 hover:text-red-200"
            >
              {isForcingStop ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <StopCircle className="mr-2 h-4 w-4" />
              )}
              Forçar Parada
            </Button>
            <Button
              onClick={handleFinalize}
              disabled={!bipagem.ids.length || isFinalizing}
              className="bg-green-700 hover:bg-green-800 text-white"
            >
              {isFinalizing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Finalizar
            </Button>
            {saveState !== "idle" && (
              <button
                type="button"
                onClick={saveState === "error" ? handleRetrySave : undefined}
                disabled={saveState !== "error"}
                className={cn(
                  "ml-auto self-center inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium",
                  saveState === "saving" &&
                    "bg-zinc-800 text-zinc-300 cursor-default",
                  saveState === "saved" &&
                    "bg-green-900/30 text-green-400 cursor-default",
                  saveState === "error" &&
                    "bg-red-900/40 text-red-300 hover:bg-red-900/60 cursor-pointer",
                )}
                title={
                  saveState === "error"
                    ? "Falha ao salvar — clique para tentar novamente"
                    : undefined
                }
              >
                {saveState === "saving" && (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    salvando...
                  </>
                )}
                {saveState === "saved" && (
                  <>
                    <Check className="h-3 w-3" />
                    salvo
                  </>
                )}
                {saveState === "error" && (
                  <>
                    <AlertCircle className="h-3 w-3" />
                    falha — clique para tentar
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── HISTORICO VIEW ────────────────────────────────────────────── */}
      {viewMode === "historico" && (
        <HistoricoView
          onReview={handleReview}
          onExportGeral={handleExportGeral}
          onExportResumido={handleExportResumido}
          onCopyCodes={handleCopyCodes}
          onResumeBipagem={handleResumeBipagem}
        />
      )}

      {/* ── CONFIGURACOES VIEW ───────────────────────────────────────── */}
      {viewMode === "configuracoes" && (
        <ConfiguracoesView
          skuCatalog={bipagem.skuCatalog}
          kitRules={bipagem.kitRules}
          carrierPatterns={bipagem.carrierPatterns}
          onAddSkus={handleAddSkus}
          onRemoveSku={handleRemoveSku}
          onClearSkus={handleClearSkus}
          onSaveKitRule={handleSaveKitRule}
          onDeleteKitRule={handleDeleteKitRule}
          onSaveCarrierPattern={handleSaveCarrierPattern}
          onDeleteCarrierPattern={handleDeleteCarrierPattern}
        />
      )}
    </div>
  );
}
