"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  Filter,
  History,
  Loader2,
  Mail,
  Trash2,
  Truck,
  Upload,
  X,
} from "lucide-react";
import { upload } from "@vercel/blob/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/layout/page-header";
import {
  analyzePDFPages,
  buildFilterGroups,
  generateFilteredPDF,
  loadPDFLibraries,
  mergePDFs,
  triggerDownloadPDF,
  type FilterGroup,
  type ModelImageMap,
  type PageInfo,
  type QtdSubGroup,
  type SkuSubGroup,
} from "@/lib/pdf-expedicao-utils";
import {
  deleteUserFiles,
  loadUserFiles,
  purgeOtherUsers,
  saveUserFiles,
} from "@/lib/pdf-session-storage";

type DestinatarioUsuario = {
  id: string;
  nome: string | null;
  email: string;
  isAdmin: boolean;
  isCurrent: boolean;
};

type RelatorioPeriodo = "hoje" | "24h" | "7d";

type HistoricoItem = {
  id: string;
  blobUrl: string;
  fileName: string;
  groupLabel: string;
  subgroupIds: string[];
  trackingIds: string[];
  pageCount: number;
  expiresAt: string;
  createdAt: string;
  usuarioNome: string | null;
  usuarioEmail: string | null;
};

type PendingDownload = {
  pages: PageInfo[];
  label: string;
  subgroupIds: string[];
  groupLabel: string;
  conflicting: HistoricoItem[];
};

type DuplicatePage = {
  page: PageInfo;
  reason: "historico" | "queue"; // duplicada vs histórico OU repetida no PDF atual
  printedAt: string; // ISO; vazio quando reason="queue"
  printedBy: string | null;
  printedGroupLabel: string;
};

export default function ExpedicaoDiariaPage() {
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const [pdfPages, setPdfPages] = useState<PageInfo[] | null>(null);
  const [filterGroups, setFilterGroups] = useState<FilterGroup[]>([]);
  const [selectedSubIds, setSelectedSubIds] = useState<Set<string>>(new Set());
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(
    new Set(),
  );
  const [expandedSkuIds, setExpandedSkuIds] = useState<Set<string>>(new Set());
  const [expandedQtdIds, setExpandedQtdIds] = useState<Set<string>>(new Set());
  const [registeredModels, setRegisteredModels] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [historico, setHistorico] = useState<HistoricoItem[]>([]);
  const [modelImages, setModelImages] = useState<ModelImageMap>({});
  const [pendingDownload, setPendingDownload] = useState<PendingDownload | null>(
    null,
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const { data: session } = useSession();
  const userId = session?.user?.id ?? null;
  // Relatório por email (substitui o fluxo antigo de início/encerramento de sessão)
  const [relatorioOpen, setRelatorioOpen] = useState(false);
  const [relatorioLoading, setRelatorioLoading] = useState(false);
  const [relatorioPeriodo, setRelatorioPeriodo] =
    useState<RelatorioPeriodo>("hoje");
  const [destinatariosUsuarios, setDestinatariosUsuarios] = useState<
    DestinatarioUsuario[]
  >([]);
  const [destinatariosSelecionados, setDestinatariosSelecionados] = useState<
    Set<string>
  >(new Set());
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const filterGroupsRef = useRef<FilterGroup[]>([]);
  const restoredFromStorageRef = useRef(false);
  // Identidade do último pdfPages reconciliado pelo useEffect de derivação.
  // Distingue: (a) novo PDF carregado → resetar seleção/expand;
  //           (b) historic atualizou → preservar seleção/expand.
  const reconciledPdfPagesRef = useRef<PageInfo[] | null>(null);

  const pagesByIndex = useMemo(() => {
    const m = new Map<number, PageInfo>();
    pdfPages?.forEach((p) => m.set(p.index, p));
    return m;
  }, [pdfPages]);

  // Conjunto de subgroupIds já impressos (preserva o badge "Impresso"
  // legado em folhas onde nenhuma página tem tracking ID).
  const printedSubgroupIds = useMemo(() => {
    const s = new Set<string>();
    historico.forEach((h) => h.subgroupIds.forEach((id) => s.add(id)));
    return s;
  }, [historico]);

  // Mapa de tracking ID → entrada do histórico que o imprimiu pela 1ª vez
  // (mais recente). Usado pra detectar duplicatas e mostrar quem/quando
  // imprimiu antes.
  const printedTrackingMap = useMemo(() => {
    const m = new Map<string, HistoricoItem>();
    // Histórico vem desc por createdAt — ao percorrer, mantém a mais recente
    // como referência mostrada (sobrescrita silenciosa de mais antigas).
    for (const h of historico) {
      for (const tid of h.trackingIds) {
        if (!m.has(tid)) m.set(tid, h);
      }
    }
    return m;
  }, [historico]);

  // Páginas duplicadas e válidas. Duplicadas saem da árvore e nunca
  // entram em PDF baixado. Considera 2 origens de duplicação:
  //  1. trackingId já impresso no histórico (10 dias)
  //  2. trackingId repetido dentro do próprio PDF atual (1ª ocorrência
  //     fica em valid; demais saem em duplicatas)
  // Páginas sem trackingId (regex não pegou) entram em valid e mostram
  // indicador "tracking não verificado" no leaf.
  const { duplicatePages, validPages } = useMemo(() => {
    const dups: DuplicatePage[] = [];
    const valid: PageInfo[] = [];
    const seenInQueue = new Set<string>();
    for (const p of pdfPages ?? []) {
      const tid = p.trackingId?.trim() ?? "";
      const fromHistorico =
        tid && printedTrackingMap.has(tid)
          ? printedTrackingMap.get(tid)!
          : null;
      if (fromHistorico) {
        dups.push({
          page: p,
          reason: "historico",
          printedAt: fromHistorico.createdAt,
          printedBy: fromHistorico.usuarioNome,
          printedGroupLabel: fromHistorico.groupLabel,
        });
      } else if (tid && seenInQueue.has(tid)) {
        dups.push({
          page: p,
          reason: "queue",
          printedAt: "",
          printedBy: null,
          printedGroupLabel: "Repetido no PDF atual",
        });
      } else {
        if (tid) seenInQueue.add(tid);
        valid.push(p);
      }
    }
    return { duplicatePages: dups, validPages: valid };
  }, [pdfPages, printedTrackingMap]);

  // Deriva filterGroups a partir de validPages. Reconstrói quando:
  //  • novo PDF é carregado (pdfPages muda) → reseta seleção/expand
  //  • histórico atualiza e validPages muda → preserva seleção/expand,
  //    só recalcula a árvore (alguma página pode ter virado duplicata).
  useEffect(() => {
    if (!pdfPages) {
      setFilterGroups([]);
      filterGroupsRef.current = [];
      reconciledPdfPagesRef.current = null;
      return;
    }

    const isNewPdf = reconciledPdfPagesRef.current !== pdfPages;
    reconciledPdfPagesRef.current = pdfPages;

    const previousDownloaded = new Set(
      filterGroupsRef.current
        .flatMap((c) =>
          c.subGroups.flatMap((s) => s.subGroups.flatMap((q) => q.subGroups)),
        )
        .filter((leaf) => leaf.downloaded)
        .map((leaf) => leaf.id),
    );

    const groups = buildFilterGroups(validPages, registeredModels);

    const restored = groups.map((c) => {
      const skus = c.subGroups.map((sk) => {
        const qtds = sk.subGroups.map((q) => {
          const leaves = q.subGroups.map((leaf) => ({
            ...leaf,
            downloaded: previousDownloaded.has(leaf.id),
          }));
          return {
            ...q,
            subGroups: leaves,
            downloaded:
              leaves.length > 0 && leaves.every((l) => l.downloaded),
          };
        });
        return {
          ...sk,
          subGroups: qtds,
          downloaded: qtds.length > 0 && qtds.every((q) => q.downloaded),
        };
      });
      return {
        ...c,
        subGroups: skus,
        downloaded: skus.length > 0 && skus.every((sk) => sk.downloaded),
      };
    });

    setFilterGroups(restored);
    filterGroupsRef.current = restored;

    if (isNewPdf) {
      const allLeaves = restored.flatMap((c) =>
        c.subGroups.flatMap((sk) =>
          sk.subGroups.flatMap((q) => q.subGroups),
        ),
      );
      setSelectedSubIds(
        new Set(
          allLeaves.filter((leaf) => !leaf.downloaded).map((leaf) => leaf.id),
        ),
      );
      setExpandedGroupIds(new Set(restored.map((c) => c.id)));
      setExpandedSkuIds(
        new Set(restored.flatMap((c) => c.subGroups.map((sk) => sk.id))),
      );
      setExpandedQtdIds(
        new Set(
          restored.flatMap((c) =>
            c.subGroups.flatMap((sk) => sk.subGroups.map((q) => q.id)),
          ),
        ),
      );
    }
  }, [pdfPages, validPages, registeredModels]);

  const loadHistorico = useCallback(async () => {
    try {
      const res = await fetch("/api/expedicao-diaria/historico");
      if (!res.ok) return;
      const data = (await res.json()) as { historico: HistoricoItem[] };
      setHistorico(data.historico ?? []);
    } catch {
      // silencioso — histórico é secundário
    }
  }, []);

  useEffect(() => {
    loadHistorico();
  }, [loadHistorico]);

  // Carrega lista de destinatários da conta (admins + demais ativos) e
  // pré-seleciona admins + usuário corrente. Re-fetch a cada abertura
  // do dialog pra refletir mudanças de admin sem reload.
  const loadDestinatarios = useCallback(async () => {
    try {
      const res = await fetch(
        "/api/expedicao-diaria/relatorio/destinatarios",
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        usuarios: DestinatarioUsuario[];
      };
      const usuarios = data.usuarios ?? [];
      setDestinatariosUsuarios(usuarios);
      setDestinatariosSelecionados(
        new Set(
          usuarios
            .filter((u) => u.isAdmin || u.isCurrent)
            .map((u) => u.email),
        ),
      );
    } catch {
      // silencioso — abrir dialog sem lista é OK; user pode digitar emails extras
    }
  }, []);

  const enviarRelatorio = useCallback(async () => {
    const emails = Array.from(destinatariosSelecionados);
    if (emails.length === 0) {
      toast.error("Selecione pelo menos um destinatário");
      return;
    }
    setRelatorioLoading(true);
    try {
      const res = await fetch("/api/expedicao-diaria/relatorio", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          destinatarios: emails,
          periodo: relatorioPeriodo,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        sent: number;
        failed: number;
        totalEtiquetas: number;
      };
      if (data.sent > 0) {
        toast.success(
          `Relatório enviado para ${data.sent} destinatário(s) · ${data.totalEtiquetas} etiqueta(s)`,
        );
      } else {
        toast.error("Falha ao enviar relatório — nenhum email entregue");
      }
      setRelatorioOpen(false);
    } catch (e) {
      toast.error(
        `Não foi possível enviar o relatório: ${(e as Error).message}`,
      );
    } finally {
      setRelatorioLoading(false);
    }
  }, [destinatariosSelecionados, relatorioPeriodo]);

  // Carrega mapa de modelos ativos com imagem cadastrada
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/modelo-principal");
        if (!res.ok) return;
        const data = (await res.json()) as {
          modelos: Array<{
            codigo: string;
            etiquetaImagemUrl: string | null;
          }>;
        };
        const map: ModelImageMap = {};
        for (const m of data.modelos) {
          if (m.etiquetaImagemUrl) map[m.codigo] = m.etiquetaImagemUrl;
        }
        setModelImages(map);
        setRegisteredModels(data.modelos.map((m) => m.codigo));
      } catch {
        // silencioso
      }
    })();
  }, []);

  // Replace mode: substitui o conteúdo da fila pelos arquivos passados.
  // Usado por removePDFAt e pela restauração de sessão (que já carrega
  // o conjunto completo do IndexedDB).
  const handlePDFFiles = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files).filter((f) => f.name.endsWith(".pdf"));
      if (!arr.length) {
        toast.error("Nenhum PDF encontrado");
        return;
      }

      // Reset de estado da fila — o useEffect de derivação reconstrói os
      // grupos a partir de pdfPages quando ele é setado mais abaixo.
      setPdfPages(null);
      setFilterGroups([]);
      filterGroupsRef.current = [];
      setSelectedSubIds(new Set());
      setExpandedGroupIds(new Set());
      setExpandedSkuIds(new Set());
      setExpandedQtdIds(new Set());
      setIsProcessing(true);
      setProgress(5);
      setProgressText("Carregando bibliotecas…");

      try {
        await loadPDFLibraries();
        setProgress(10);
        setProgressText("Mesclando PDFs…");

        let bytes: Uint8Array;
        if (arr.length > 1) {
          bytes = await mergePDFs(arr);
        } else {
          bytes = new Uint8Array(await arr[0].arrayBuffer());
        }
        setPdfBytes(bytes);
        setPdfFiles(arr);

        // Persiste no IndexedDB sob a chave do usuário — sobrevive a
        // reload e troca de aba sem precisar de sessão explícita.
        if (userId) {
          saveUserFiles(userId, arr).catch((err) =>
            console.error("[expedicao] falha ao salvar PDFs do usuário:", err),
          );
        }

        const pages = await analyzePDFPages(
          bytes,
          (val, text) => {
            setProgress(val);
            setProgressText(text);
          },
          { models: registeredModels },
        );
        setProgress(95);
        setProgressText("Construindo grupos…");
        // setPdfPages dispara o useEffect que monta filterGroups +
        // selecionadas + expandidas a partir de validPages.
        setPdfPages(pages);
        setProgress(100);
        setProgressText("Concluído");
        toast.success(`PDF analisado: ${pages.length} página(s)`);
      } catch (e) {
        toast.error(`Erro ao processar PDF: ${(e as Error).message}`);
      } finally {
        setIsProcessing(false);
      }
    },
    [userId, registeredModels],
  );

  // Append mode: anexa os novos PDFs aos que já estão na sessão. Re-merge
  // e re-analyze do conjunto completo. Usado por drag/drop e pelo input.
  const handlePDFAppend = useCallback(
    (files: FileList | File[]) => {
      const newFiles = Array.from(files).filter((f) =>
        f.name.endsWith(".pdf"),
      );
      if (!newFiles.length) {
        toast.error("Nenhum PDF encontrado");
        return;
      }
      // Não duplica arquivo com mesmo nome (replace silencioso).
      const existing = pdfFiles.filter(
        (f) => !newFiles.some((nf) => nf.name === f.name),
      );
      void handlePDFFiles([...existing, ...newFiles]);
    },
    [pdfFiles, handlePDFFiles],
  );

  // Restauração: quando o usuário logado é descoberto, carregar PDFs
  // que ele havia subido em sessões anteriores. Roda só na 1ª vez por
  // userId, e dropa buckets de outros usuários como housekeeping.
  useEffect(() => {
    if (!userId || restoredFromStorageRef.current) return;
    restoredFromStorageRef.current = true;

    (async () => {
      try {
        await purgeOtherUsers(userId);
        const files = await loadUserFiles(userId);
        if (files.length > 0 && pdfFiles.length === 0) {
          await handlePDFFiles(files);
          toast.info(`${files.length} PDF(s) restaurado(s)`);
        }
      } catch (err) {
        console.error("[expedicao] falha ao restaurar PDFs:", err);
      }
    })();
    // pdfFiles intencionalmente fora das deps — só queremos restaurar na primeira vez
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, handlePDFFiles]);

  const handlePDFDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      handlePDFAppend(e.dataTransfer.files);
    },
    [handlePDFAppend],
  );

  const markSubgroupsDownloaded = useCallback((subIds: string[]) => {
    const set = new Set(subIds);
    setFilterGroups((prev) => {
      const updated = prev.map((c) => {
        const skus = c.subGroups.map((sk) => {
          const qtds = sk.subGroups.map((q) => {
            const leaves = q.subGroups.map((leaf) =>
              set.has(leaf.id) ? { ...leaf, downloaded: true } : leaf,
            );
            return {
              ...q,
              subGroups: leaves,
              downloaded:
                leaves.length > 0 && leaves.every((l) => l.downloaded),
            };
          });
          return {
            ...sk,
            subGroups: qtds,
            downloaded: qtds.length > 0 && qtds.every((q) => q.downloaded),
          };
        });
        return {
          ...c,
          subGroups: skus,
          downloaded: skus.length > 0 && skus.every((sk) => sk.downloaded),
        };
      });
      filterGroupsRef.current = updated;
      return updated;
    });
  }, []);

  // Grava PDF no histórico. Lança erro em falhas — o caller deve abortar o
  // download do browser pra garantir que toda exportação esteja registrada.
  // Fluxo: client faz upload direto pro Vercel Blob (contorna o limite de
  // ~4,5MB de body das Functions) e depois manda JSON com o blobUrl.
  const uploadToHistorico = useCallback(
    async (
      generated: { bytes: Uint8Array; fileName: string; pageCount: number },
      groupLabel: string,
      subgroupIds: string[],
      pages: PageInfo[],
    ) => {
      // Conta SKUs no lote. Cada página contribui com 1 unidade pra cada
      // SKU detectado nela (em kits com 2+ SKUs distintos, todos somam).
      const skusCount: Record<string, number> = {};
      for (const p of pages) {
        for (const sku of p.skus) {
          skusCount[sku] = (skusCount[sku] ?? 0) + 1;
        }
      }

      // Tracking IDs únicos exportados — usados pra dedup nos próximos
      // 10 dias. Páginas sem trackingId são ignoradas (impossível dedup).
      const trackingIds = Array.from(
        new Set(
          pages
            .map((p) => p.trackingId?.trim() ?? "")
            .filter((t) => t.length > 0),
        ),
      );

      const blobFile = new Blob([generated.bytes as BlobPart], {
        type: "application/pdf",
      });
      const safeName = generated.fileName.replace(/[^\w.\-]/g, "_");
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2);
      const pathname = `expedicao-diaria/${id}/${safeName}`;

      const blob = await upload(pathname, blobFile, {
        access: "public",
        handleUploadUrl: "/api/expedicao-diaria/historico/upload-url",
        contentType: "application/pdf",
      });

      const res = await fetch("/api/expedicao-diaria/historico", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          blobUrl: blob.url,
          fileName: generated.fileName,
          groupLabel,
          pageCount: generated.pageCount,
          subgroupIds,
          trackingIds,
          skusCount,
          sessaoId: null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as { error?: string })?.error ?? `HTTP ${res.status}`,
        );
      }
    },
    [],
  );

  const executeDownload = useCallback(
    async (pending: PendingDownload) => {
      if (!pdfBytes) return;
      let generated;
      try {
        generated = await generateFilteredPDF(
          pdfBytes,
          pending.pages,
          pending.label,
          modelImages,
        );
      } catch (e) {
        toast.error(`Erro ao gerar PDF: ${(e as Error).message}`);
        return;
      }

      // Grava no histórico ANTES de baixar — requisito: toda exportação
      // precisa estar no histórico. Se o upload falhar, abortamos.
      try {
        await uploadToHistorico(
          generated,
          pending.groupLabel,
          pending.subgroupIds,
          pending.pages,
        );
      } catch (e) {
        toast.error(
          `Não foi possível registrar no histórico — download cancelado: ${(e as Error).message}`,
        );
        return;
      }

      triggerDownloadPDF(generated.bytes, generated.fileName);
      markSubgroupsDownloaded(pending.subgroupIds);
      loadHistorico();
    },
    [
      pdfBytes,
      modelImages,
      markSubgroupsDownloaded,
      uploadToHistorico,
      loadHistorico,
    ],
  );

  const requestDownload = useCallback(
    (
      pages: PageInfo[],
      subgroupIds: string[],
      groupLabel: string,
      label: string,
    ) => {
      const conflicting = historico.filter((h) =>
        h.subgroupIds.some((id) => subgroupIds.includes(id)),
      );
      const pending: PendingDownload = {
        pages,
        label,
        subgroupIds,
        groupLabel,
        conflicting,
      };
      if (conflicting.length > 0) {
        setPendingDownload(pending);
      } else {
        void executeDownload(pending);
      }
    },
    [historico, executeDownload],
  );

  // Sanitiza label pra uso em filename (remove parêntese, acento, espaços).
  const slugify = (s: string): string =>
    s
      .replace(/[^\w\d]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "grupo";

  const downloadSubgroup = useCallback(
    (
      carrier: FilterGroup,
      sku: SkuSubGroup,
      qtd: QtdSubGroup,
      leafId: string,
    ) => {
      const leaf = qtd.subGroups.find((s) => s.id === leafId);
      if (!leaf) return;
      const pages = leaf.pageIndexes
        .map((i) => pagesByIndex.get(i))
        .filter((p): p is PageInfo => !!p);
      const label = slugify(
        `${carrier.label}_${sku.label}_${qtd.label}_${leaf.size}`,
      );
      const groupLabel = `${carrier.label} · ${sku.label} · ${qtd.label} · ${leaf.size}`;
      requestDownload(pages, [leaf.id], groupLabel, label);
    },
    [pagesByIndex, requestDownload],
  );

  const downloadQtdGroup = useCallback(
    (carrier: FilterGroup, sku: SkuSubGroup, qtd: QtdSubGroup) => {
      const pages = qtd.pageIndexes
        .map((i) => pagesByIndex.get(i))
        .filter((p): p is PageInfo => !!p);
      const label = slugify(`${carrier.label}_${sku.label}_${qtd.label}`);
      const groupLabel = `${carrier.label} · ${sku.label} · ${qtd.label}`;
      const leafIds = qtd.subGroups.map((s) => s.id);
      requestDownload(pages, leafIds, groupLabel, label);
    },
    [pagesByIndex, requestDownload],
  );

  const downloadSkuGroup = useCallback(
    (carrier: FilterGroup, sku: SkuSubGroup) => {
      const pages = sku.pageIndexes
        .map((i) => pagesByIndex.get(i))
        .filter((p): p is PageInfo => !!p);
      const label = slugify(`${carrier.label}_${sku.label}`);
      const groupLabel = `${carrier.label} · ${sku.label}`;
      const leafIds = sku.subGroups.flatMap((q) =>
        q.subGroups.map((leaf) => leaf.id),
      );
      requestDownload(pages, leafIds, groupLabel, label);
    },
    [pagesByIndex, requestDownload],
  );

  const downloadParentGroup = useCallback(
    (carrier: FilterGroup) => {
      const pages = carrier.pageIndexes
        .map((i) => pagesByIndex.get(i))
        .filter((p): p is PageInfo => !!p);
      const label = slugify(carrier.label);
      const leafIds = carrier.subGroups.flatMap((sk) =>
        sk.subGroups.flatMap((q) => q.subGroups.map((leaf) => leaf.id)),
      );
      requestDownload(pages, leafIds, carrier.label, label);
    },
    [pagesByIndex, requestDownload],
  );

  const handleDownloadSelected = useCallback(() => {
    const selectedPages: PageInfo[] = [];
    const touchedSubIds: string[] = [];
    for (const carrier of filterGroups) {
      for (const sku of carrier.subGroups) {
        for (const qtd of sku.subGroups) {
          for (const leaf of qtd.subGroups) {
            if (!selectedSubIds.has(leaf.id)) continue;
            touchedSubIds.push(leaf.id);
            for (const idx of leaf.pageIndexes) {
              const p = pagesByIndex.get(idx);
              if (p) selectedPages.push(p);
            }
          }
        }
      }
    }
    if (selectedPages.length === 0) {
      toast.error("Nenhum grupo selecionado");
      return;
    }
    const label = `Selecao_${touchedSubIds.length}grupos`;
    const groupLabel = `Seleção (${touchedSubIds.length} subgrupos)`;
    requestDownload(selectedPages, touchedSubIds, groupLabel, label);
  }, [filterGroups, selectedSubIds, pagesByIndex, requestDownload]);

  const toggleSub = useCallback((subId: string) => {
    setSelectedSubIds((prev) => {
      const next = new Set(prev);
      if (next.has(subId)) next.delete(subId);
      else next.add(subId);
      return next;
    });
  }, []);

  const toggleParent = useCallback((carrier: FilterGroup) => {
    const subIds = carrier.subGroups.flatMap((sk) =>
      sk.subGroups.flatMap((q) => q.subGroups.map((leaf) => leaf.id)),
    );
    setSelectedSubIds((prev) => {
      const next = new Set(prev);
      const allSelected = subIds.every((id) => next.has(id));
      if (allSelected) subIds.forEach((id) => next.delete(id));
      else subIds.forEach((id) => next.add(id));
      return next;
    });
  }, []);

  const toggleSku = useCallback((sku: SkuSubGroup) => {
    const subIds = sku.subGroups.flatMap((q) =>
      q.subGroups.map((leaf) => leaf.id),
    );
    setSelectedSubIds((prev) => {
      const next = new Set(prev);
      const allSelected = subIds.every((id) => next.has(id));
      if (allSelected) subIds.forEach((id) => next.delete(id));
      else subIds.forEach((id) => next.add(id));
      return next;
    });
  }, []);

  const toggleQtd = useCallback((qtd: QtdSubGroup) => {
    const subIds = qtd.subGroups.map((s) => s.id);
    setSelectedSubIds((prev) => {
      const next = new Set(prev);
      const allSelected = subIds.every((id) => next.has(id));
      if (allSelected) subIds.forEach((id) => next.delete(id));
      else subIds.forEach((id) => next.add(id));
      return next;
    });
  }, []);

  const toggleExpand = useCallback((groupId: string) => {
    setExpandedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  const toggleSkuExpand = useCallback((skuId: string) => {
    setExpandedSkuIds((prev) => {
      const next = new Set(prev);
      if (next.has(skuId)) next.delete(skuId);
      else next.add(skuId);
      return next;
    });
  }, []);

  const toggleQtdExpand = useCallback((qtdId: string) => {
    setExpandedQtdIds((prev) => {
      const next = new Set(prev);
      if (next.has(qtdId)) next.delete(qtdId);
      else next.add(qtdId);
      return next;
    });
  }, []);

  const clearQueue = useCallback(() => {
    setPdfBytes(null);
    setPdfPages(null);
    setPdfFiles([]);
    setFilterGroups([]);
    setSelectedSubIds(new Set());
    setExpandedGroupIds(new Set());
    setExpandedSkuIds(new Set());
    setExpandedQtdIds(new Set());
    setProgress(0);
    setProgressText("");
    filterGroupsRef.current = [];
    if (pdfInputRef.current) pdfInputRef.current.value = "";
    if (userId) {
      deleteUserFiles(userId).catch((err) =>
        console.error("[expedicao] falha ao limpar PDFs do usuário:", err),
      );
    }
    toast.success("Fila limpa");
  }, [userId]);

  const removePDFAt = useCallback(
    (index: number) => {
      const next = pdfFiles.filter((_, i) => i !== index);
      if (next.length === 0) {
        clearQueue();
        return;
      }
      void handlePDFFiles(next);
    },
    [pdfFiles, handlePDFFiles, clearQueue],
  );

  const parentSelectionState = (
    carrier: FilterGroup,
  ): "none" | "some" | "all" => {
    const leaves = carrier.subGroups.flatMap((sk) =>
      sk.subGroups.flatMap((q) => q.subGroups),
    );
    const total = leaves.length;
    if (total === 0) return "none";
    const sel = leaves.filter((s) => selectedSubIds.has(s.id)).length;
    if (sel === 0) return "none";
    if (sel === total) return "all";
    return "some";
  };

  const skuSelectionState = (sku: SkuSubGroup): "none" | "some" | "all" => {
    const leaves = sku.subGroups.flatMap((q) => q.subGroups);
    const total = leaves.length;
    if (total === 0) return "none";
    const sel = leaves.filter((s) => selectedSubIds.has(s.id)).length;
    if (sel === 0) return "none";
    if (sel === total) return "all";
    return "some";
  };

  const qtdSelectionState = (qtd: QtdSubGroup): "none" | "some" | "all" => {
    const total = qtd.subGroups.length;
    if (total === 0) return "none";
    const sel = qtd.subGroups.filter((s) => selectedSubIds.has(s.id)).length;
    if (sel === 0) return "none";
    if (sel === total) return "all";
    return "some";
  };

  const formatDate = (iso: string): string => {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          title="Expedição Diária"
          description="Upload de PDF de etiquetas (Upseller) · Separação por kit e tamanho pra impressão Zebra ZD220"
          icon={<Truck className="h-8 w-8 text-primary" />}
        />
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              loadDestinatarios();
              setRelatorioPeriodo("hoje");
              setRelatorioOpen(true);
            }}
          >
            <Mail className="h-4 w-4 mr-1" /> Enviar Relatório
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              loadHistorico();
              setHistoryOpen(true);
            }}
          >
            <History className="h-4 w-4 mr-1" /> Histórico ({historico.length})
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" /> Upload de Etiquetas
          </CardTitle>
          <CardDescription>
            Carregue o PDF de etiquetas (extraído manualmente do Upseller) para
            separar por tipo de kit e tamanho
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className={cn(
              "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
              isDragging
                ? "border-blue-500 bg-blue-500/5"
                : "border-muted-foreground/30 hover:border-blue-500/50",
            )}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handlePDFDrop}
            onClick={() => pdfInputRef.current?.click()}
          >
            <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Arraste os PDFs de etiquetas ou clique para selecionar
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Suporta múltiplos PDFs (ML + TikTok misturados)
            </p>
          </div>
          <input
            ref={pdfInputRef}
            type="file"
            accept=".pdf"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) handlePDFAppend(e.target.files);
              // Reseta o value pra permitir reupload do mesmo arquivo
              if (pdfInputRef.current) pdfInputRef.current.value = "";
            }}
          />
          {pdfFiles.length > 0 && (
            <ul className="space-y-1">
              {pdfFiles.map((file, i) => (
                <li
                  key={`${file.name}-${i}`}
                  className="flex items-center gap-2 text-xs rounded-md border border-slate-800 bg-slate-900/50 px-2 py-1.5"
                >
                  <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="truncate flex-1">{file.name}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removePDFAt(i);
                    }}
                    disabled={isProcessing}
                    className="text-muted-foreground hover:text-destructive disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label={`Remover ${file.name}`}
                    title={`Remover ${file.name}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {isProcessing && (
            <div className="space-y-1">
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground text-center">
                {progressText}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {pdfBytes && !isProcessing && duplicatePages.length > 0 && (
        <Card className="border-amber-700/60 bg-amber-950/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-300">
              <AlertTriangle className="h-5 w-5" /> Etiquetas duplicadas — não
              serão impressas ({duplicatePages.length})
            </CardTitle>
            <CardDescription>
              Etiquetas com tracking ID já impresso nos últimos 10 dias ou
              repetido no PDF atual. Foram removidas da fila pra evitar
              reimpressão.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-64 overflow-auto space-y-1.5 pr-1">
              {duplicatePages.map((d) => (
                <div
                  key={`${d.page.index}-${d.page.trackingId}`}
                  className="flex items-start justify-between gap-3 rounded-md border border-amber-800/40 bg-slate-900/60 px-3 py-2 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-mono font-semibold">
                      Pág. {d.page.pageNum}
                      {d.page.skus[0] ? ` · ${d.page.skus[0]}` : ""}
                    </p>
                    <p className="text-muted-foreground truncate">
                      Tracking:{" "}
                      <span className="font-mono">
                        {d.page.trackingId || "—"}
                      </span>
                    </p>
                  </div>
                  <div className="text-right text-[11px] text-muted-foreground shrink-0">
                    {d.reason === "historico" ? (
                      <>
                        <p>{formatDate(d.printedAt)}</p>
                        <p>
                          {d.printedBy ? `por ${d.printedBy}` : ""}
                          {d.printedGroupLabel && (
                            <span className="block truncate max-w-[160px]">
                              {d.printedGroupLabel}
                            </span>
                          )}
                        </p>
                      </>
                    ) : (
                      <p>Repetida no PDF atual</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {pdfBytes && !isProcessing && filterGroups.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Filter className="h-5 w-5" /> Fila de Impressão
            </CardTitle>
            <CardDescription>
              {
                filterGroups
                  .flatMap((c) =>
                    c.subGroups.flatMap((sk) =>
                      sk.subGroups.flatMap((q) => q.subGroups),
                    ),
                  )
                  .filter((leaf) => leaf.downloaded).length
              }
              /
              {
                filterGroups.flatMap((c) =>
                  c.subGroups.flatMap((sk) =>
                    sk.subGroups.flatMap((q) => q.subGroups),
                  ),
                ).length
              }{" "}
              subgrupos baixados
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              {filterGroups.map((c) => {
                const carrierExpanded = expandedGroupIds.has(c.id);
                const carrierState = parentSelectionState(c);
                const carrierLeaves = c.subGroups.flatMap((sk) =>
                  sk.subGroups.flatMap((q) => q.subGroups),
                );
                const carrierAnyPrinted = carrierLeaves.some((leaf) =>
                  printedSubgroupIds.has(leaf.id),
                );
                return (
                  <div
                    key={c.id}
                    className={cn(
                      "rounded-lg border",
                      c.downloaded
                        ? "border-green-800 bg-green-950/20"
                        : "border-slate-700 bg-slate-900",
                    )}
                  >
                    {/* Nível 1: Transportadora */}
                    <div className="flex items-center justify-between p-3">
                      <div className="flex items-center gap-3 flex-1">
                        <button
                          type="button"
                          onClick={() => toggleExpand(c.id)}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label={carrierExpanded ? "Recolher" : "Expandir"}
                        >
                          {carrierExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </button>
                        <input
                          type="checkbox"
                          checked={carrierState === "all"}
                          ref={(el) => {
                            if (el)
                              el.indeterminate = carrierState === "some";
                          }}
                          onChange={() => toggleParent(c)}
                          className="accent-blue-500"
                        />
                        <div>
                          <p className="font-semibold text-sm flex items-center gap-2">
                            <Truck className="h-4 w-4" />
                            {c.label}
                            {carrierAnyPrinted && (
                              <span className="text-[10px] text-amber-400 font-medium border border-amber-700/50 rounded px-1">
                                Impresso
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {c.pageIndexes.length} página(s) ·{" "}
                            {c.subGroups.length} SKU(s) · {carrierLeaves.length}{" "}
                            tamanho(s)
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2 items-center">
                        {c.downloaded && (
                          <span className="text-xs text-green-400 font-medium">
                            Baixado
                          </span>
                        )}
                        <Button
                          size="sm"
                          variant={c.downloaded ? "outline" : "default"}
                          className={cn(
                            !c.downloaded &&
                              "bg-blue-600 hover:bg-blue-700 text-white",
                          )}
                          onClick={() => downloadParentGroup(c)}
                        >
                          <Download className="h-4 w-4 mr-1" /> Transportadora
                        </Button>
                      </div>
                    </div>

                    {/* Nível 2: SKU */}
                    {carrierExpanded && c.subGroups.length > 0 && (
                      <div className="border-t border-slate-800 divide-y divide-slate-800">
                        {c.subGroups.map((sk) => {
                          const skuExpanded = expandedSkuIds.has(sk.id);
                          const skuState = skuSelectionState(sk);
                          const skuLeaves = sk.subGroups.flatMap(
                            (q) => q.subGroups,
                          );
                          const skuAnyPrinted = skuLeaves.some((leaf) =>
                            printedSubgroupIds.has(leaf.id),
                          );
                          return (
                            <div
                              key={sk.id}
                              className={cn(
                                sk.isUnregistered && "bg-amber-950/10",
                                sk.downloaded && "bg-green-950/10",
                              )}
                            >
                              <div className="flex items-center justify-between px-3 py-2 pl-10">
                                <div className="flex items-center gap-3 flex-1">
                                  <button
                                    type="button"
                                    onClick={() => toggleSkuExpand(sk.id)}
                                    className="text-muted-foreground hover:text-foreground"
                                    aria-label={
                                      skuExpanded ? "Recolher" : "Expandir"
                                    }
                                  >
                                    {skuExpanded ? (
                                      <ChevronDown className="h-4 w-4" />
                                    ) : (
                                      <ChevronRight className="h-4 w-4" />
                                    )}
                                  </button>
                                  <input
                                    type="checkbox"
                                    checked={skuState === "all"}
                                    ref={(el) => {
                                      if (el)
                                        el.indeterminate =
                                          skuState === "some";
                                    }}
                                    onChange={() => toggleSku(sk)}
                                    className="accent-blue-500"
                                  />
                                  <div>
                                    <p
                                      className={cn(
                                        "text-sm font-semibold flex items-center gap-2",
                                        sk.isUnregistered && "text-amber-300",
                                      )}
                                    >
                                      {sk.label}
                                      {skuAnyPrinted && (
                                        <span className="text-[10px] text-amber-400 font-medium border border-amber-700/50 rounded px-1">
                                          Impresso
                                        </span>
                                      )}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {sk.pageIndexes.length} página(s) ·{" "}
                                      {sk.subGroups.length} QTD ·{" "}
                                      {skuLeaves.length} tamanho(s)
                                    </p>
                                  </div>
                                </div>
                                <div className="flex gap-2 items-center">
                                  {sk.downloaded && (
                                    <span className="text-xs text-green-400">
                                      Baixado
                                    </span>
                                  )}
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => downloadSkuGroup(c, sk)}
                                  >
                                    <Download className="h-4 w-4 mr-1" /> SKU
                                  </Button>
                                </div>
                              </div>

                              {/* Nível 3: QTD */}
                              {skuExpanded && sk.subGroups.length > 0 && (
                                <div className="divide-y divide-slate-800/60 border-t border-slate-800/60">
                                  {sk.subGroups.map((q) => {
                                    const qtdExpanded = expandedQtdIds.has(
                                      q.id,
                                    );
                                    const qtdState = qtdSelectionState(q);
                                    return (
                                      <div
                                        key={q.id}
                                        className={cn(
                                          q.downloaded && "bg-green-950/10",
                                        )}
                                      >
                                        <div className="flex items-center justify-between px-3 py-2 pl-16">
                                          <div className="flex items-center gap-3 flex-1">
                                            <button
                                              type="button"
                                              onClick={() =>
                                                toggleQtdExpand(q.id)
                                              }
                                              className="text-muted-foreground hover:text-foreground"
                                              aria-label={
                                                qtdExpanded
                                                  ? "Recolher"
                                                  : "Expandir"
                                              }
                                            >
                                              {qtdExpanded ? (
                                                <ChevronDown className="h-4 w-4" />
                                              ) : (
                                                <ChevronRight className="h-4 w-4" />
                                              )}
                                            </button>
                                            <input
                                              type="checkbox"
                                              checked={qtdState === "all"}
                                              ref={(el) => {
                                                if (el)
                                                  el.indeterminate =
                                                    qtdState === "some";
                                              }}
                                              onChange={() => toggleQtd(q)}
                                              className="accent-blue-500"
                                            />
                                            <div>
                                              <p className="text-sm font-medium">
                                                {q.label}
                                              </p>
                                              <p className="text-xs text-muted-foreground">
                                                {q.pageIndexes.length}{" "}
                                                página(s) ·{" "}
                                                {q.subGroups.length}{" "}
                                                tamanho(s)
                                              </p>
                                            </div>
                                          </div>
                                          <div className="flex gap-2 items-center">
                                            {q.downloaded && (
                                              <span className="text-xs text-green-400">
                                                Baixado
                                              </span>
                                            )}
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              onClick={() =>
                                                downloadQtdGroup(c, sk, q)
                                              }
                                            >
                                              <Download className="h-4 w-4 mr-1" />{" "}
                                              Subgrupo
                                            </Button>
                                          </div>
                                        </div>

                                        {/* Nível 4: tamanho */}
                                        {qtdExpanded &&
                                          q.subGroups.length > 0 && (
                                            <div className="divide-y divide-slate-800/40 border-t border-slate-800/40">
                                              {q.subGroups.map((leaf) => {
                                                const wasPrinted =
                                                  printedSubgroupIds.has(
                                                    leaf.id,
                                                  );
                                                return (
                                                  <div
                                                    key={leaf.id}
                                                    className={cn(
                                                      "flex items-center justify-between px-3 py-2 pl-20",
                                                      leaf.downloaded &&
                                                        "bg-green-950/10",
                                                    )}
                                                  >
                                                    <div className="flex items-center gap-3">
                                                      <input
                                                        type="checkbox"
                                                        checked={selectedSubIds.has(
                                                          leaf.id,
                                                        )}
                                                        onChange={() =>
                                                          toggleSub(leaf.id)
                                                        }
                                                        className="accent-blue-500"
                                                      />
                                                      <div>
                                                        <p className="text-sm flex items-center gap-2">
                                                          {leaf.size}
                                                          {wasPrinted && (
                                                            <span className="text-[10px] text-amber-400 font-medium border border-amber-700/50 rounded px-1">
                                                              Impresso
                                                            </span>
                                                          )}
                                                          {(() => {
                                                            const semTracking =
                                                              leaf.pageIndexes.filter(
                                                                (i) => {
                                                                  const pg =
                                                                    pagesByIndex.get(
                                                                      i,
                                                                    );
                                                                  return (
                                                                    !pg?.trackingId?.trim()
                                                                  );
                                                                },
                                                              ).length;
                                                            return semTracking >
                                                              0 ? (
                                                              <span
                                                                title="Não foi possível verificar o tracking ID dessa(s) etiqueta(s) — serão impressas sem dedup."
                                                                className="text-[10px] text-amber-400 font-medium border border-amber-700/50 rounded px-1 inline-flex items-center gap-0.5"
                                                              >
                                                                <AlertTriangle className="h-2.5 w-2.5" />
                                                                {semTracking}{" "}
                                                                sem tracking
                                                              </span>
                                                            ) : null;
                                                          })()}
                                                        </p>
                                                        <p className="text-xs text-muted-foreground">
                                                          {
                                                            leaf.pageIndexes
                                                              .length
                                                          }{" "}
                                                          página(s)
                                                        </p>
                                                      </div>
                                                    </div>
                                                    <div className="flex gap-2 items-center">
                                                      {leaf.downloaded && (
                                                        <span className="text-xs text-green-400">
                                                          Baixado
                                                        </span>
                                                      )}
                                                      <Button
                                                        size="sm"
                                                        variant="outline"
                                                        onClick={() =>
                                                          downloadSubgroup(
                                                            c,
                                                            sk,
                                                            q,
                                                            leaf.id,
                                                          )
                                                        }
                                                      >
                                                        <Download className="h-4 w-4 mr-1" />{" "}
                                                        PDF
                                                      </Button>
                                                    </div>
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex gap-2 flex-wrap pt-2 border-t border-slate-800">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setSelectedSubIds(
                    new Set(
                      filterGroups.flatMap((c) =>
                        c.subGroups.flatMap((sk) =>
                          sk.subGroups.flatMap((q) =>
                            q.subGroups.map((leaf) => leaf.id),
                          ),
                        ),
                      ),
                    ),
                  )
                }
              >
                Selecionar Todos
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedSubIds(new Set())}
              >
                Limpar Seleção
              </Button>
              <Button
                size="sm"
                disabled={selectedSubIds.size === 0}
                className="bg-blue-600 hover:bg-blue-700 text-white"
                onClick={handleDownloadSelected}
              >
                <Download className="h-4 w-4 mr-1" /> Baixar Selecionados (
                {selectedSubIds.size})
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={clearQueue}
                className="ml-auto text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4 mr-1" /> Limpar Fila
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <AlertDialog
        open={pendingDownload !== null}
        onOpenChange={(open) => !open && setPendingDownload(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Etiquetas já impressas</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  {pendingDownload?.conflicting.length} impressão(ões) recente(s)
                  nas últimas 48h incluem etiquetas destes grupos. Tem certeza
                  que quer reimprimir?
                </p>
                {pendingDownload?.conflicting.slice(0, 5).map((h) => (
                  <p key={h.id} className="text-xs text-muted-foreground">
                    · {h.groupLabel} — {formatDate(h.createdAt)}
                    {h.usuarioNome && ` por ${h.usuarioNome}`}
                  </p>
                ))}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingDownload(null)}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDownload) {
                  void executeDownload(pendingDownload);
                  setPendingDownload(null);
                }
              }}
            >
              Reimprimir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={relatorioOpen} onOpenChange={setRelatorioOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" /> Enviar Relatório por Email
            </DialogTitle>
            <DialogDescription>
              Resumo agregado das etiquetas que você baixou no período. Os
              administradores da conta vêm pré-selecionados.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Período
              </p>
              <div className="flex gap-2">
                {(
                  [
                    { v: "hoje" as const, label: "Hoje" },
                    { v: "24h" as const, label: "Últimas 24h" },
                    { v: "7d" as const, label: "Últimos 7 dias" },
                  ]
                ).map((opt) => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => setRelatorioPeriodo(opt.v)}
                    className={cn(
                      "flex-1 px-3 py-1.5 rounded-md text-sm border transition-colors",
                      relatorioPeriodo === opt.v
                        ? "border-blue-500 bg-blue-500/10 text-blue-300"
                        : "border-slate-700 hover:border-slate-500",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Destinatários ({destinatariosSelecionados.size})
              </p>
              <div className="max-h-56 overflow-auto space-y-1 rounded-md border border-slate-800 p-1">
                {destinatariosUsuarios.length === 0 ? (
                  <p className="px-2 py-3 text-xs text-muted-foreground text-center">
                    Carregando lista de usuários...
                  </p>
                ) : (
                  destinatariosUsuarios.map((u) => {
                    const checked = destinatariosSelecionados.has(u.email);
                    return (
                      <label
                        key={u.id}
                        className={cn(
                          "flex items-center gap-2 px-2 py-1.5 rounded-md text-sm cursor-pointer hover:bg-slate-800/50",
                          checked && "bg-slate-800/30",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            setDestinatariosSelecionados((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(u.email);
                              else next.delete(u.email);
                              return next;
                            });
                          }}
                          className="accent-blue-500"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">
                            {u.nome ?? u.email}
                            {u.isCurrent && (
                              <span className="ml-1 text-[10px] text-muted-foreground">
                                (você)
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {u.email}
                          </p>
                        </div>
                        {u.isAdmin && (
                          <span className="text-[10px] text-blue-400 border border-blue-700/50 rounded px-1">
                            admin
                          </span>
                        )}
                      </label>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRelatorioOpen(false)}
              disabled={relatorioLoading}
            >
              Cancelar
            </Button>
            <Button
              onClick={enviarRelatorio}
              disabled={
                relatorioLoading || destinatariosSelecionados.size === 0
              }
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {relatorioLoading ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Mail className="h-4 w-4 mr-1" />
              )}
              Enviar ({destinatariosSelecionados.size})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Histórico de Impressão</DialogTitle>
            <DialogDescription>
              Arquivos ficam disponíveis por 48h após a geração
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto space-y-2">
            {historico.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                Nenhuma impressão recente
              </p>
            )}
            {historico.map((h) => (
              <div
                key={h.id}
                className="border border-slate-700 rounded-lg p-3 flex items-center justify-between gap-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{h.groupLabel}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {h.fileName} · {h.pageCount} página(s)
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(h.createdAt)}
                    {h.usuarioNome && ` · ${h.usuarioNome}`}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(h.blobUrl, "_blank")}
                >
                  <Download className="h-4 w-4 mr-1" /> Baixar
                </Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
