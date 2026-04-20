"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "@/lib/auth-client";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn, copyToClipboard } from "@/lib/utils";
import {
  Loader2,
  Package,
  History,
  Clock,
  Settings,
  Trash2,
  Copy,
  Save,
  Send,
  FileDown,
  Search,
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
import { ContinuarView } from "@/components/coletas/continuar-view";
import { HistoricoView } from "@/components/coletas/historico-view";
import type {
  BipagemTemporariaRecord,
  CarrierPattern,
  SkuKitRule,
  DevolucaoFormData,
  BipagemRecord,
  TransportadoraLabel,
} from "@/types/coletas";
import {
  FUNCTION_TYPES,
  OPERATIONS,
  FUNCTION_DISPLAY,
  OPERATION_DISPLAY,
} from "@/types/coletas";

type ViewMode = "bipagem" | "historico" | "continuar" | "configuracoes";

export default function ColetasPage() {
  const { data: session, isPending } = useSession();
  const [viewMode, setViewMode] = useState<ViewMode>("bipagem");

  // Bipagem hook
  const bipagem = useColetasBipagem();

  // Temporarias
  const [temporarias, setTemporarias] = useState<BipagemTemporariaRecord[]>([]);

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

  // Remove search
  const [removeInputValue, setRemoveInputValue] = useState("");

  // Loading / sending
  const [isLoading, setIsLoading] = useState(true);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);

  // Refs
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const audioSuccessRef = useRef<HTMLAudioElement>(null);
  const audioErrorRef = useRef<HTMLAudioElement>(null);

  // ── Fetch configs on mount ────────────────────────────────────────────────
  useEffect(() => {
    if (!session) return;

    const fetchAll = async () => {
      setIsLoading(true);
      try {
        const [transpRes, kitRes, skuRes, tempRes] = await Promise.all([
          fetch("/api/coletas/configuracoes/transportadoras"),
          fetch("/api/coletas/configuracoes/kit-rules"),
          fetch("/api/sku-catalogo"),
          fetch("/api/coletas/temporarias"),
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

        if (tempRes.ok) {
          const { temporarias: temps } = await tempRes.json();
          setTemporarias(temps);
        }
      } catch {
        toast.error("Erro ao carregar configuracoes");
      } finally {
        setIsLoading(false);
      }
    };

    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // ── Auto-focus textarea ───────────────────────────────────────────────────
  useEffect(() => {
    if (viewMode !== "bipagem") return;
    const interval = setInterval(() => {
      if (
        !devolucaoModalOpen &&
        document.activeElement !== inputRef.current
      ) {
        inputRef.current?.focus();
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [viewMode, devolucaoModalOpen]);

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

  // ── Handle input change → process scanned text ────────────────────────────
  const handleInputChange = useCallback(
    (value: string) => {
      bipagem.handleInput(value);
      // processText is called inside handleInput with debounce;
      // we need to observe new IDs for overlay
    },
    [bipagem],
  );

  // We wrap processText to trigger overlay after processing
  const handleTextareaChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      bipagem.setInputValue(value);

      // Use a small debounce to process
      const timer = setTimeout(() => {
        const result = bipagem.processText(value);
        if (result.newIds.length > 0) {
          const lastId = result.newIds[result.newIds.length - 1];
          const carrier = detectCarrier(lastId, bipagem.carrierPatterns);
          showOverlay(lastId, false, carrier);
        } else if (result.duplicates.length > 0) {
          showOverlay(result.duplicates[0], true);
        }
        if (bipagem.autoClear) {
          bipagem.setInputValue("");
        }
      }, 5);

      return () => clearTimeout(timer);
    },
    [bipagem, showOverlay],
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
      await copyToClipboard(bipagem.ids.join("\n"));
      toast.success(`Copiado! (${bipagem.ids.length})`);
    } catch {
      toast.error("Erro ao copiar — verifique permissões do navegador");
    }
  }, [bipagem.ids]);

  // ── Clear ─────────────────────────────────────────────────────────────────
  const handleClear = useCallback(() => {
    bipagem.clear();
    toast.info("Lista zerada");
  }, [bipagem]);

  // ── Save Temp ─────────────────────────────────────────────────────────────
  const handleSaveTemp = useCallback(async () => {
    if (!bipagem.ids.length) {
      toast.error("Sem itens para salvar");
      return;
    }

    try {
      const pacotes = bipagem.ids.map((id) => ({
        codigo: id,
        transportadora: detectCarrier(id, bipagem.carrierPatterns),
      }));

      const res = await fetch("/api/coletas/temporarias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo: bipagem.currentFunction,
          conta: bipagem.currentAccount,
          total: bipagem.ids.length,
          dados: {
            pacotes,
            devolucoes: Object.fromEntries(
              Object.entries(bipagem.devolucoesData).map(([k, v]) => [
                k,
                { ...v, avaria: v.avaria ? "SIM" : "NAO", obs: v.obs || "" },
              ])
            ),
          },
        }),
      });

      if (!res.ok) throw new Error();

      const { id } = await res.json();
      const newTemp: BipagemTemporariaRecord = {
        id,
        tipo: bipagem.currentFunction,
        conta: bipagem.currentAccount,
        total: bipagem.ids.length,
        dados: {
          pacotes,
          devolucoes: Object.fromEntries(
            Object.entries(bipagem.devolucoesData).map(([k, v]) => [
              k,
              { ...v, avaria: v.avaria ? "SIM" : "NAO", obs: v.obs || "" },
            ])
          ),
        },
        usuarioId: session?.user?.id || "",
        createdAt: new Date().toISOString(),
      };
      setTemporarias((prev) => [newTemp, ...prev]);
      bipagem.clear();
      toast.success(`Bipagem salva! (${newTemp.total} itens)`);
    } catch {
      toast.error("Erro ao salvar bipagem temporaria");
    }
  }, [bipagem, session]);

  // ── Resume Temp ───────────────────────────────────────────────────────────
  const handleResumeTemp = useCallback(
    (temp: BipagemTemporariaRecord) => {
      bipagem.loadFromTemp(temp.dados, temp.tipo, temp.conta);
      setTemporarias((prev) => prev.filter((t) => t.id !== temp.id));
      setViewMode("bipagem");
      toast.success(`Bipagem carregada! (${temp.total} itens)`);
      setTimeout(() => inputRef.current?.focus(), 100);

      // Delete from server
      fetch(`/api/coletas/temporarias/${temp.id}`, { method: "DELETE" }).catch(
        () => {},
      );
    },
    [bipagem],
  );

  // ── Delete Temp ───────────────────────────────────────────────────────────
  const handleDeleteTemp = useCallback(async (id: string) => {
    try {
      await fetch(`/api/coletas/temporarias/${id}`, { method: "DELETE" });
      setTemporarias((prev) => prev.filter((t) => t.id !== id));
      toast.success("Bipagem temporaria excluida");
    } catch {
      toast.error("Erro ao excluir bipagem temporaria");
    }
  }, []);

  // ── Finalize ──────────────────────────────────────────────────────────────
  const handleFinalize = useCallback(async () => {
    if (!bipagem.ids.length) {
      toast.error("Sem itens para finalizar");
      return;
    }

    setIsFinalizing(true);
    try {
      const pacotes = bipagem.ids.map((id) => ({
        codigo: id,
        transportadora: detectCarrier(id, bipagem.carrierPatterns),
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

      const res = await fetch("/api/coletas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo: bipagem.currentFunction,
          conta: bipagem.currentAccount,
          pacotes,
          devolucoes,
        }),
      });

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

      // Send email
      setIsSendingEmail(true);
      try {
        const emailRes = await fetch("/api/coletas/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ids: bipagem.ids,
            conta: accDisplay,
            tipo: currentFn,
          }),
        });
        if (emailRes.ok) {
          const emailData = await emailRes.json();
          if (emailData.simulated) {
            toast.warning("Servidor de e-mail nao configurado");
          } else {
            toast.success("E-mail enviado!");
          }
        }
      } catch {
        toast.warning("E-mail nao enviado - servidor offline");
      } finally {
        setIsSendingEmail(false);
      }

      bipagem.clear();
      toast.success("Bipagem finalizada!");
    } catch {
      toast.error("Erro ao finalizar bipagem");
    } finally {
      setIsFinalizing(false);
    }
  }, [bipagem]);

  // ── Devolucao Modal ───────────────────────────────────────────────────────
  const handleOpenDevolucao = useCallback((pacoteId: string) => {
    setDevolucaoPacketId(pacoteId);
    setDevolucaoModalOpen(true);
  }, []);

  const handleSaveDevolucao = useCallback(
    (data: DevolucaoFormData) => {
      bipagem.setDevolucao(devolucaoPacketId, data);
    },
    [bipagem, devolucaoPacketId],
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
      await copyToClipboard(codes.join("\n"));
      toast.success(`Copiado! (${codes.length} IDs)`);
    } catch {
      toast.error("Erro ao copiar codigos");
    }
  }, []);

  const handleResumeBipagem = useCallback(
    async (bipagemId: string) => {
      try {
        const res = await fetch(`/api/coletas/${bipagemId}`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        const pacoteCodes = data.pacotes.map(
          (p: { codigo: string }) => p.codigo,
        );
        pacoteCodes.forEach((code: string) => bipagem.addId(code));
        bipagem.setCurrentFunction(data.tipo);
        bipagem.setCurrentAccount(data.conta);
        setViewMode("bipagem");
        toast.success(`Bipagem de ${pacoteCodes.length} pacotes carregada!`);
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
  if (isPending || isLoading) {
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
        currentAccount={bipagem.currentAccount}
        skuCatalog={bipagem.skuCatalog}
        kitRules={bipagem.kitRules}
        existingData={bipagem.devolucoesData[devolucaoPacketId]}
        onSave={handleSaveDevolucao}
      />

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
          { key: "continuar" as const, label: "Continuar", icon: Clock },
          { key: "configuracoes" as const, label: "Configuracoes", icon: Settings },
        ].map(({ key, label, icon: Icon }) => (
          <Button
            key={key}
            variant={viewMode === key ? "default" : "outline"}
            onClick={() => setViewMode(key)}
            className={cn(
              viewMode === key
                ? "bg-orange-500 hover:bg-orange-600 text-white"
                : "border-zinc-700 text-zinc-300 hover:bg-zinc-800",
            )}
          >
            <Icon className="mr-2 h-4 w-4" />
            {label}
            {key === "continuar" && temporarias.length > 0 && (
              <span className="ml-1 bg-zinc-700 text-zinc-200 text-xs px-1.5 py-0.5 rounded-full">
                {temporarias.length}
              </span>
            )}
          </Button>
        ))}
      </div>

      {/* ── BIPAGEM VIEW ─────────────────────────────────────────────── */}
      {viewMode === "bipagem" && (
        <div className="space-y-4">
          {/* Function type selector */}
          <Card className="bg-zinc-950 border-zinc-800">
            <CardContent className="p-4 space-y-4">
              <div>
                <label className="block text-xs font-bold text-zinc-400 mb-2">
                  Tipo
                </label>
                <div className="flex gap-2 flex-wrap">
                  {FUNCTION_TYPES.map((fn) => (
                    <Button
                      key={fn}
                      variant="outline"
                      size="sm"
                      onClick={() => bipagem.setCurrentFunction(fn)}
                      className={cn(
                        "flex-1",
                        bipagem.currentFunction === fn
                          ? fn === "FLEX"
                            ? "bg-orange-500 text-white border-orange-500"
                            : fn === "COLETA"
                              ? "bg-blue-500 text-white border-blue-500"
                              : fn === "DEVOLUCAO"
                                ? "bg-green-500 text-white border-green-500"
                                : "bg-amber-500 text-white border-amber-500"
                          : "border-zinc-700 text-zinc-400 hover:bg-zinc-800",
                      )}
                    >
                      {FUNCTION_DISPLAY[fn]}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Account selector (hidden for FLEX) */}
              {bipagem.currentFunction !== "FLEX" && (
                <div>
                  <label className="block text-xs font-bold text-zinc-400 mb-2">
                    Conta
                  </label>
                  <div className="flex gap-2 flex-wrap">
                    {OPERATIONS.map((op) => (
                      <Button
                        key={op}
                        variant="outline"
                        size="sm"
                        onClick={() => bipagem.setCurrentAccount(op)}
                        className={cn(
                          "flex-1",
                          bipagem.currentAccount === op
                            ? "bg-primary text-primary-foreground border-primary"
                            : "border-zinc-700 text-zinc-400 hover:bg-zinc-800",
                        )}
                      >
                        {OPERATION_DISPLAY[op]}
                      </Button>
                    ))}
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
                    className="accent-orange-500"
                  />
                  Deduplicar
                </label>
                <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={bipagem.autoClear}
                    onChange={(e) => bipagem.setAutoClear(e.target.checked)}
                    className="accent-orange-500"
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
                      key={`${id}-${index}`}
                      codigo={id}
                      index={index}
                      carrier={detectCarrier(id, bipagem.carrierPatterns)}
                      hasDevolucao={!!bipagem.devolucoesData[id]}
                      onRemove={() => bipagem.removeId(id)}
                      onEditDevolucao={() => handleOpenDevolucao(id)}
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
              onClick={handleSaveTemp}
              disabled={!bipagem.ids.length}
              className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            >
              <Save className="mr-2 h-4 w-4" /> Salvar Temp
            </Button>
            <Button
              onClick={handleFinalize}
              disabled={!bipagem.ids.length || isFinalizing}
              className="bg-orange-500 hover:bg-orange-600 text-white"
            >
              {isFinalizing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Finalizar
            </Button>
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

      {/* ── CONTINUAR VIEW ───────────────────────────────────────────── */}
      {viewMode === "continuar" && (
        <ContinuarView
          temporarias={temporarias}
          onResume={handleResumeTemp}
          onDelete={handleDeleteTemp}
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
