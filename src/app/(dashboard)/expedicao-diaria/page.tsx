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
  Layers,
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
} from "@/lib/pdf-expedicao-utils";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  deleteUserFiles,
  loadUserFiles,
  purgeOtherUsers,
  saveUserFiles,
} from "@/lib/pdf-session-storage";
import type { TrackingIdDuplicate } from "@/app/api/expedicao-diaria/tracking-ids/check/route";

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
  // Tracking IDs em conflito (impressos nos últimos 30d) — exibidos no
  // dialog de confirmação de reimpressão.
  conflictingTrackings: string[];
  // Detalhes (quem/quando) de cada tracking em conflito, pra exibir no dialog.
  conflictDetails: TrackingIdDuplicate[];
};

type DuplicatePage = {
  page: PageInfo;
  reason: "historico" | "queue"; // duplicada vs histórico OU repetida no PDF atual
  printedAt: string; // ISO; vazio quando reason="queue"
  printedBy: string | null;
  printedGroupLabel: string;
};

// Níveis togglaveis na fila de impressão. Transportadora é fixa (sempre topo).
// `model` = SKU principal (LUA / Misto / Não cadastrado).
// `qtd`   = Unitário / KIT N / MIX N.
// `color` = cor extraída do SKU "MODELO COR TAM".
// `size`  = tamanho.
type LevelKey = "model" | "qtd" | "color" | "size";
const ALL_LEVELS: readonly LevelKey[] = ["model", "qtd", "color", "size"];
const ACTIVE_LEVELS_STORAGE_KEY = "expedicao:activeLevels";

// localStorage namespaced por usuário — preferência de níveis é pessoal,
// e dois usuários compartilhando o mesmo navegador não devem herdar o
// estado um do outro. Quando userId não está disponível (sessão ainda
// carregando), cai pra chave global como fallback.
function levelsStorageKey(userId: string | null): string {
  return userId
    ? `${ACTIVE_LEVELS_STORAGE_KEY}:${userId}`
    : ACTIVE_LEVELS_STORAGE_KEY;
}

function readActiveLevels(userId: string | null): Set<LevelKey> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(levelsStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const valid = parsed.filter((v): v is LevelKey =>
      (ALL_LEVELS as readonly string[]).includes(v as string),
    );
    return new Set(valid);
  } catch {
    return null;
  }
}

const LEVEL_LABELS: Record<LevelKey, string> = {
  model: "Modelo",
  qtd: "QTD",
  color: "Cor",
  size: "Tamanho",
};

// Label do botão de download por profundidade do nó na árvore visível.
// Carrier é depth=0; demais níveis seguem a ordem dos LevelKey ativos.
function downloadButtonLabel(node: ViewNode): string {
  if (node.level === "carrier") return "Transportadora";
  if (node.level === "model") return "SKU";
  if (node.level === "qtd") return "Subgrupo";
  if (node.level === "color") return "Cor";
  if (node.level === "size") return "PDF";
  return "PDF";
}

// Nó da árvore renderizada. IDs derivam dos ids estáveis em filterGroups
// (carrier::sku::qtd::color::size); ground-truth pra dedup/download é
// sempre o conjunto de SizeLeaf.id descendentes (`leafIds`).
type ViewNode = {
  id: string;
  level: "carrier" | LevelKey;
  label: string;
  pageIndexes: number[];
  leafIds: string[];
  children: ViewNode[];
  downloaded: boolean;
  printedCount: number;
  isUnregistered: boolean;
  isMisto: boolean;
};

type TreeNodeProps = {
  node: ViewNode;
  depth: number;
  expandedNodeIds: Set<string>;
  selectedSubIds: Set<string>;
  printedSubgroupIds: Set<string>;
  pagesByIndex: Map<number, PageInfo>;
  toggleExpand: (nodeId: string) => void;
  toggleNode: (node: ViewNode) => void;
  toggleSub: (subId: string) => void;
  nodeSelectionState: (node: ViewNode) => "none" | "some" | "all";
  downloadViewNode: (node: ViewNode) => void;
};

// Componente recursivo. Indentação por inline style (Tailwind JIT não
// compila classes geradas em runtime). Cada profundidade recua 1.5rem.
// Folhas (level=size) usam toggleSub direto pra evitar pop indireto.
function TreeNode({
  node,
  depth,
  expandedNodeIds,
  selectedSubIds,
  printedSubgroupIds,
  pagesByIndex,
  toggleExpand,
  toggleNode,
  toggleSub,
  nodeSelectionState,
  downloadViewNode,
}: TreeNodeProps) {
  const isLeaf = node.level === "size";
  const isCarrier = node.level === "carrier";
  const expanded = expandedNodeIds.has(node.id);
  const hasChildren = node.children.length > 0;

  // Para leaves, checked vem direto do selectedSubIds; demais usam estado
  // derivado all/some/none (com indeterminate visual).
  const checked = isLeaf
    ? selectedSubIds.has(node.id)
    : nodeSelectionState(node) === "all";
  const isIndeterminate =
    !isLeaf && nodeSelectionState(node) === "some";

  const wasPrintedFallback = !isLeaf
    ? false
    : printedSubgroupIds.has(node.id);
  const wasPrinted = node.printedCount > 0 || wasPrintedFallback;

  const semTracking = isLeaf
    ? node.pageIndexes.filter((i) => {
        const pg = pagesByIndex.get(i);
        return !pg?.trackingId?.trim();
      }).length
    : 0;

  // Cor de borda/background da row. Carrier tem borda externa; níveis
  // intermediários só pintam sutil quando baixados.
  const rowBgClass = node.downloaded
    ? "bg-green-950/10"
    : node.isUnregistered
      ? "bg-amber-950/10"
      : "";

  return (
    <div
      className={cn(
        isCarrier && "rounded-lg border",
        isCarrier &&
          (node.downloaded
            ? "border-green-800 bg-green-950/20"
            : "border-slate-700 bg-slate-900"),
        !isCarrier && rowBgClass,
      )}
    >
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ paddingLeft: `${0.75 + depth * 1.5}rem` }}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {hasChildren ? (
            <button
              type="button"
              onClick={() => toggleExpand(node.id)}
              className="text-muted-foreground hover:text-foreground"
              aria-label={expanded ? "Recolher" : "Expandir"}
            >
              {expanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          ) : (
            <span className="w-4" />
          )}
          <input
            type="checkbox"
            checked={checked}
            ref={(el) => {
              if (el) el.indeterminate = isIndeterminate;
            }}
            onChange={() => (isLeaf ? toggleSub(node.id) : toggleNode(node))}
            className="accent-blue-500"
          />
          <div className="min-w-0">
            <p
              className={cn(
                "text-sm flex items-center gap-2",
                isCarrier && "font-semibold",
                node.level === "model" && "font-semibold",
                node.level === "qtd" && "font-medium",
                node.isUnregistered && "text-amber-300",
              )}
            >
              {isCarrier && <Truck className="h-4 w-4" />}
              {node.label}
              {wasPrinted && (
                <span className="text-[10px] text-amber-400 font-medium border border-amber-700/50 rounded px-1">
                  {node.printedCount > 0
                    ? `${node.printedCount} impressa(s)`
                    : "Impresso"}
                </span>
              )}
              {semTracking > 0 && (
                <span
                  title="Não foi possível verificar o tracking ID dessa(s) etiqueta(s) — serão impressas sem dedup."
                  className="text-[10px] text-amber-400 font-medium border border-amber-700/50 rounded px-1 inline-flex items-center gap-0.5"
                >
                  <AlertTriangle className="h-2.5 w-2.5" />
                  {semTracking} sem tracking
                </span>
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              {node.pageIndexes.length} página(s)
              {hasChildren && ` · ${node.children.length} ${childLabel(node)}`}
            </p>
          </div>
        </div>
        <div className="flex gap-2 items-center shrink-0">
          {node.downloaded && (
            <span className="text-xs text-green-400 font-medium">Baixado</span>
          )}
          <Button
            size="sm"
            variant={isCarrier && !node.downloaded ? "default" : "outline"}
            className={cn(
              isCarrier &&
                !node.downloaded &&
                "bg-blue-600 hover:bg-blue-700 text-white",
            )}
            onClick={() => downloadViewNode(node)}
          >
            <Download className="h-4 w-4 mr-1" /> {downloadButtonLabel(node)}
          </Button>
        </div>
      </div>
      {expanded && hasChildren && (
        <div
          className={cn(
            "border-t",
            isCarrier ? "border-slate-800" : "border-slate-800/40",
            "divide-y",
            isCarrier ? "divide-slate-800" : "divide-slate-800/40",
          )}
        >
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              expandedNodeIds={expandedNodeIds}
              selectedSubIds={selectedSubIds}
              printedSubgroupIds={printedSubgroupIds}
              pagesByIndex={pagesByIndex}
              toggleExpand={toggleExpand}
              toggleNode={toggleNode}
              toggleSub={toggleSub}
              nodeSelectionState={nodeSelectionState}
              downloadViewNode={downloadViewNode}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Sufixo do contador de filhos por nível (para o subtítulo na linha).
function childLabel(node: ViewNode): string {
  const childLevel = node.children[0]?.level;
  if (childLevel === "model") return node.children.length === 1 ? "SKU" : "SKUs";
  if (childLevel === "qtd") return "QTD";
  if (childLevel === "color")
    return node.children.length === 1 ? "cor" : "cores";
  if (childLevel === "size")
    return node.children.length === 1 ? "tamanho" : "tamanhos";
  return "filhos";
}

export default function ExpedicaoDiariaPage() {
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const [pdfPages, setPdfPages] = useState<PageInfo[] | null>(null);
  const [filterGroups, setFilterGroups] = useState<FilterGroup[]>([]);
  const [selectedSubIds, setSelectedSubIds] = useState<Set<string>>(new Set());
  // Set unificado de IDs expandidos (transportadora, sku, qtd, cor) — ids
  // são únicos entre níveis porque cada um carrega o path completo do pai.
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(
    new Set(),
  );
  // Quais níveis (Modelo/QTD/Cor/Tamanho) aparecem na árvore. Lazy-load
  // inicial usa chave global (sessão ainda não pronta no mount); um
  // useEffect mais abaixo recarrega da chave namespaced quando userId
  // chegar. Persiste entre PDFs e reloads (preferência pessoal).
  const [activeLevels, setActiveLevels] = useState<Set<LevelKey>>(
    () => readActiveLevels(null) ?? new Set(ALL_LEVELS),
  );
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
  const [reprintLoading, setReprintLoading] = useState(false);
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

  // Mapa preenchido pelo POST /tracking-ids/check após upload do PDF.
  // tracking ID → metadata da impressão anterior dentro da janela de 30d.
  // Em vez de puxar todo o histórico via GET (payload pesado), perguntamos
  // só pelos trackings deste PDF — lookup indexado no servidor.
  const [trackingDupsByTid, setTrackingDupsByTid] = useState<
    Map<string, TrackingIdDuplicate>
  >(new Map());

  // Páginas válidas e duplicadas internas. Tracking IDs já impressos no
  // histórico (30d) NÃO saem da fila — ficam em validPages com badge
  // "Impresso" nos níveis correspondentes; reimpressão exige senha no
  // momento do download (vide requestDownload + AlertDialog).
  // Só removemos o que é defeito puro do PDF atual: tracking ID repetido
  // dentro dele mesmo (a 1ª ocorrência fica, as demais saem).
  // Páginas sem trackingId (regex não pegou) entram em valid e mostram
  // indicador "tracking não verificado" no leaf.
  const { duplicatePages, validPages } = useMemo(() => {
    const dups: DuplicatePage[] = [];
    const valid: PageInfo[] = [];
    const seenInQueue = new Set<string>();
    for (const p of pdfPages ?? []) {
      const tid = p.trackingId?.trim() ?? "";
      if (tid && seenInQueue.has(tid)) {
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
  }, [pdfPages]);

  // Set de pageIndexes cujas etiquetas já foram impressas na janela de 30d.
  // Usado pra colorir badge "Impresso" nos leaves/níveis superiores e pra
  // detectar conflito no momento do download (já acontece via tracking IDs
  // em requestDownload, este set é só pra UI).
  const printedPageIndexes = useMemo(() => {
    const s = new Set<number>();
    for (const p of pdfPages ?? []) {
      const tid = p.trackingId?.trim() ?? "";
      if (tid && trackingDupsByTid.has(tid)) s.add(p.index);
    }
    return s;
  }, [pdfPages, trackingDupsByTid]);

  // Árvore visível na UI, derivada de filterGroups + activeLevels. Níveis
  // desligados são "achatados" — `descend` pula direto pro próximo nível
  // ativo, agregando contagens dos pulados. IDs continuam estáveis (mantêm
  // o path completo do filterGroups), garantindo que expand/select não
  // quebrem ao togglar níveis.
  const viewTree = useMemo<ViewNode[]>(() => {
    type SkuList = FilterGroup["subGroups"];
    type QtdList = SkuList[number]["subGroups"];
    type ColorList = QtdList[number]["subGroups"];
    type LeafList = ColorList[number]["subGroups"];

    const allLeavesUnder = (sks: SkuList): LeafList[number][] =>
      sks.flatMap((sk) =>
        sk.subGroups.flatMap((q) =>
          q.subGroups.flatMap((co) => co.subGroups),
        ),
      );

    const printedCountForPages = (idxs: number[]): number =>
      idxs.reduce((n, i) => (printedPageIndexes.has(i) ? n + 1 : n), 0);

    function descendFromSku(
      skus: SkuList,
      remaining: LevelKey[],
    ): ViewNode[] {
      if (remaining.length === 0 || remaining[0] !== "model") {
        // "model" desligado — flatten skus → próximo nível ativo
        const qtds = skus.flatMap((sk) => sk.subGroups);
        return descendFromQtd(qtds, remaining);
      }
      // "model" ligado — 1 ViewNode por sku
      const rest = remaining.slice(1);
      return skus.map((sk) => {
        const leaves = allLeavesUnder([sk]);
        return {
          id: sk.id,
          level: "model" as const,
          label: sk.label,
          pageIndexes: [...sk.pageIndexes],
          leafIds: leaves.map((l) => l.id),
          children: descendFromQtd(sk.subGroups, rest),
          downloaded: sk.downloaded,
          printedCount: printedCountForPages(sk.pageIndexes),
          isUnregistered: sk.isUnregistered,
          isMisto: sk.isMisto,
        };
      });
    }

    function descendFromQtd(
      qtds: QtdList,
      remaining: LevelKey[],
    ): ViewNode[] {
      const idx = remaining.indexOf("qtd");
      if (idx < 0) {
        // "qtd" desligado — flatten qtds → próximo nível
        const colors = qtds.flatMap((q) => q.subGroups);
        return descendFromColor(colors, remaining);
      }
      const rest = remaining.slice(idx + 1);
      return qtds.map((q) => {
        const leaves = q.subGroups.flatMap((co) => co.subGroups);
        return {
          id: q.id,
          level: "qtd" as const,
          label: q.label,
          pageIndexes: [...q.pageIndexes],
          leafIds: leaves.map((l) => l.id),
          children: descendFromColor(q.subGroups, rest),
          downloaded: q.downloaded,
          printedCount: printedCountForPages(q.pageIndexes),
          isUnregistered: false,
          isMisto: false,
        };
      });
    }

    function descendFromColor(
      colors: ColorList,
      remaining: LevelKey[],
    ): ViewNode[] {
      const idx = remaining.indexOf("color");
      if (idx < 0) {
        // "color" desligado — flatten colors → próximo nível
        const leaves = colors.flatMap((co) => co.subGroups);
        return descendFromSize(leaves, remaining);
      }
      const rest = remaining.slice(idx + 1);
      return colors.map((co) => ({
        id: co.id,
        level: "color" as const,
        label: co.color,
        pageIndexes: [...co.pageIndexes],
        leafIds: co.subGroups.map((l) => l.id),
        children: descendFromSize(co.subGroups, rest),
        downloaded: co.downloaded,
        printedCount: printedCountForPages(co.pageIndexes),
        isUnregistered: false,
        isMisto: false,
      }));
    }

    function descendFromSize(
      leaves: LeafList,
      remaining: LevelKey[],
    ): ViewNode[] {
      if (!remaining.includes("size")) {
        // "size" desligado — leaves não viram nodes; pageIndexes/leafIds
        // já agregados no nível pai. Retorna [] pra encerrar a recursão.
        return [];
      }
      return leaves.map((leaf) => ({
        id: leaf.id,
        level: "size" as const,
        label: leaf.size,
        pageIndexes: [...leaf.pageIndexes],
        leafIds: [leaf.id],
        children: [],
        downloaded: leaf.downloaded,
        printedCount: printedCountForPages(leaf.pageIndexes),
        isUnregistered: false,
        isMisto: false,
      }));
    }

    const remaining = ALL_LEVELS.filter((l) => activeLevels.has(l));

    return filterGroups.map((c) => {
      const leaves = allLeavesUnder(c.subGroups);
      return {
        id: c.id,
        level: "carrier" as const,
        label: c.label,
        pageIndexes: [...c.pageIndexes],
        leafIds: leaves.map((l) => l.id),
        children: descendFromSku(c.subGroups, remaining),
        downloaded: c.downloaded,
        printedCount: printedCountForPages(c.pageIndexes),
        isUnregistered: false,
        isMisto: false,
      };
    });
  }, [filterGroups, activeLevels, printedPageIndexes]);

  // Folhas visíveis na viewTree — usadas pelo botão "Selecionar Todos"
  // pra operar só sobre o que tá renderizado.
  const visibleLeafIds = useMemo<string[]>(() => {
    const out = new Set<string>();
    const visit = (n: ViewNode) => {
      for (const id of n.leafIds) out.add(id);
      n.children.forEach(visit);
    };
    viewTree.forEach(visit);
    return Array.from(out);
  }, [viewTree]);

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
          c.subGroups.flatMap((sk) =>
            sk.subGroups.flatMap((q) =>
              q.subGroups.flatMap((co) => co.subGroups),
            ),
          ),
        )
        .filter((leaf) => leaf.downloaded)
        .map((leaf) => leaf.id),
    );

    const groups = buildFilterGroups(validPages, registeredModels);

    const restored = groups.map((c) => {
      const skus = c.subGroups.map((sk) => {
        const qtds = sk.subGroups.map((q) => {
          const colors = q.subGroups.map((co) => {
            const leaves = co.subGroups.map((leaf) => ({
              ...leaf,
              downloaded: previousDownloaded.has(leaf.id),
            }));
            return {
              ...co,
              subGroups: leaves,
              downloaded:
                leaves.length > 0 && leaves.every((l) => l.downloaded),
            };
          });
          return {
            ...q,
            subGroups: colors,
            downloaded:
              colors.length > 0 && colors.every((co) => co.downloaded),
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
      // Default desmarcado — operador escolhe ativamente o que vai imprimir.
      setSelectedSubIds(new Set());
      // Expande transportadoras, SKUs, QTDs e cores de cara — assim qualquer
      // combinação de níveis ativos no dropdown já abre tudo. O componente
      // recursivo só renderiza os níveis ligados, então excesso de IDs no
      // set é benigno.
      const expandedIds = new Set<string>();
      for (const carrier of restored) {
        expandedIds.add(carrier.id);
        for (const sk of carrier.subGroups) {
          expandedIds.add(sk.id);
          for (const q of sk.subGroups) {
            expandedIds.add(q.id);
            for (const co of q.subGroups) {
              expandedIds.add(co.id);
            }
          }
        }
      }
      setExpandedNodeIds(expandedIds);
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
      setExpandedNodeIds(new Set());
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

        // Pergunta ao servidor quais tracking IDs deste PDF já estão
        // impressos na janela de 30d. Substitui o GET /historico inteiro.
        setProgress(92);
        setProgressText("Verificando duplicatas…");
        const trackingsToCheck = Array.from(
          new Set(
            pages
              .map((p) => p.trackingId?.trim() ?? "")
              .filter((t) => t.length > 0),
          ),
        );
        try {
          if (trackingsToCheck.length > 0) {
            const res = await fetch(
              "/api/expedicao-diaria/tracking-ids/check",
              {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ trackingIds: trackingsToCheck }),
              },
            );
            if (res.ok) {
              const data = (await res.json()) as {
                duplicados: TrackingIdDuplicate[];
              };
              const map = new Map<string, TrackingIdDuplicate>();
              for (const d of data.duplicados ?? []) map.set(d.trackingId, d);
              setTrackingDupsByTid(map);
            } else {
              setTrackingDupsByTid(new Map());
              console.error(
                "[expedicao] /tracking-ids/check retornou",
                res.status,
              );
            }
          } else {
            setTrackingDupsByTid(new Map());
          }
        } catch (err) {
          // Falha no check não impede o fluxo — o servidor barra duplicatas
          // no POST /historico de qualquer jeito.
          setTrackingDupsByTid(new Map());
          console.error("[expedicao] falha ao verificar duplicatas:", err);
        }

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
            const colors = q.subGroups.map((co) => {
              const leaves = co.subGroups.map((leaf) =>
                set.has(leaf.id) ? { ...leaf, downloaded: true } : leaf,
              );
              return {
                ...co,
                subGroups: leaves,
                downloaded:
                  leaves.length > 0 && leaves.every((l) => l.downloaded),
              };
            });
            return {
              ...q,
              subGroups: colors,
              downloaded:
                colors.length > 0 && colors.every((co) => co.downloaded),
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
  // `confirmReprint=true` autoriza reimpressão quando há tracking IDs já em
  // conflito na janela de 30d — sem ele, o servidor responde 409.
  const uploadToHistorico = useCallback(
    async (
      generated: { bytes: Uint8Array; fileName: string; pageCount: number },
      groupLabel: string,
      subgroupIds: string[],
      pages: PageInfo[],
      confirmReprint: boolean,
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
      // 30 dias. Páginas sem trackingId são ignoradas (impossível dedup).
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
          confirmReprint,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          conflicts?: string[];
        };
        const err = new Error(
          data?.error ?? `HTTP ${res.status}`,
        ) as Error & { status?: number; conflicts?: string[] };
        err.status = res.status;
        err.conflicts = Array.isArray(data?.conflicts) ? data.conflicts : [];
        throw err;
      }
    },
    [],
  );

  const executeDownload = useCallback(
    async (pending: PendingDownload, confirmReprint = false) => {
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
          confirmReprint,
        );
      } catch (e) {
        const err = e as Error & { status?: number; conflicts?: string[] };
        // 409: o servidor detectou conflito que o cliente não tinha mapeado
        // (race com outro operador, OU download anterior nesta mesma sessão
        // que ainda não estava em trackingDupsByTid). Refresca o map com os
        // detalhes vindos do /check e reabre o dialog de confirmação.
        if (err.status === 409 && !confirmReprint) {
          const conflictTids = err.conflicts ?? [];
          let details: TrackingIdDuplicate[] = [];
          if (conflictTids.length > 0) {
            try {
              const res = await fetch(
                "/api/expedicao-diaria/tracking-ids/check",
                {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ trackingIds: conflictTids }),
                },
              );
              if (res.ok) {
                const data = (await res.json()) as {
                  duplicados: TrackingIdDuplicate[];
                };
                details = data.duplicados ?? [];
              }
            } catch {
              // Fall through — sem detalhes, mas ainda mostra o dialog
            }
          }
          setTrackingDupsByTid((prev) => {
            const next = new Map(prev);
            for (const d of details) next.set(d.trackingId, d);
            return next;
          });
          setPendingDownload({
            ...pending,
            conflictingTrackings: conflictTids,
            conflictDetails: details,
          });
          toast.info(
            "Etiquetas já impressas — confirme pra reimprimir",
          );
          return;
        }
        toast.error(
          `Não foi possível registrar no histórico — download cancelado: ${err.message}`,
        );
        return;
      }

      triggerDownloadPDF(generated.bytes, generated.fileName);
      markSubgroupsDownloaded(pending.subgroupIds);

      // Marca localmente os trackings recém-impressos pra que próximas
      // seleções na mesma sessão acionem o dialog de confirmação sem
      // depender do estado server-side ter sido recarregado.
      setTrackingDupsByTid((prev) => {
        const next = new Map(prev);
        const nowIso = new Date().toISOString();
        const userName = session?.user?.name ?? null;
        const userEmail = session?.user?.email ?? "";
        for (const p of pending.pages) {
          const tid = p.trackingId?.trim() ?? "";
          if (!tid) continue;
          next.set(tid, {
            trackingId: tid,
            impressoEm: nowIso,
            groupLabel: pending.groupLabel,
            historicoId: "local",
            reimpressao: confirmReprint,
            impressoPor: userEmail
              ? { nome: userName, email: userEmail }
              : null,
          });
        }
        return next;
      });

      loadHistorico();
    },
    [
      pdfBytes,
      modelImages,
      markSubgroupsDownloaded,
      uploadToHistorico,
      loadHistorico,
      session,
    ],
  );

  const requestDownload = useCallback(
    (
      pages: PageInfo[],
      subgroupIds: string[],
      groupLabel: string,
      label: string,
    ) => {
      // Conflito = páginas deste recorte cujo trackingId já está na janela
      // de 30d (resposta do /check). Substitui o filtro antigo por subgroupId
      // — alinha com a janela real de dedup do servidor.
      const conflictDetails: TrackingIdDuplicate[] = [];
      const seen = new Set<string>();
      for (const p of pages) {
        const tid = p.trackingId?.trim() ?? "";
        if (!tid || seen.has(tid)) continue;
        const dup = trackingDupsByTid.get(tid);
        if (dup) {
          seen.add(tid);
          conflictDetails.push(dup);
        }
      }
      const conflictingTrackings = conflictDetails.map((d) => d.trackingId);

      const pending: PendingDownload = {
        pages,
        label,
        subgroupIds,
        groupLabel,
        conflictingTrackings,
        conflictDetails,
      };
      if (conflictingTrackings.length > 0) {
        setPendingDownload(pending);
      } else {
        void executeDownload(pending);
      }
    },
    [trackingDupsByTid, executeDownload],
  );

  // Confirma reimpressão: dispara executeDownload com confirmReprint=true.
  // O POST /historico aceita a flag e grava reimpressao=true em
  // tracking_id_impresso pra fins de auditoria.
  const confirmReprint = useCallback(async () => {
    if (!pendingDownload) return;
    const pending = pendingDownload;
    setReprintLoading(true);
    try {
      setPendingDownload(null);
      await executeDownload(pending, true);
    } finally {
      setReprintLoading(false);
    }
  }, [pendingDownload, executeDownload]);

  // Sanitiza label pra uso em filename (remove parêntese, acento, espaços).
  const slugify = (s: string): string =>
    s
      .replace(/[^\w\d]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "grupo";

  const downloadViewNode = useCallback(
    (node: ViewNode) => {
      const pages = node.pageIndexes
        .map((i) => pagesByIndex.get(i))
        .filter((p): p is PageInfo => !!p);
      if (pages.length === 0) return;
      const label = slugify(node.label);
      requestDownload(pages, node.leafIds, node.label, label);
    },
    [pagesByIndex, requestDownload],
  );

  const handleDownloadSelected = useCallback(() => {
    const selectedPages: PageInfo[] = [];
    const touchedSubIds: string[] = [];
    for (const carrier of filterGroups) {
      for (const sku of carrier.subGroups) {
        for (const qtd of sku.subGroups) {
          for (const co of qtd.subGroups) {
            for (const leaf of co.subGroups) {
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

  // Toggle de seleção em um nó qualquer da viewTree. Se TODAS as folhas
  // descendentes estão marcadas, desmarca todas; caso contrário, marca
  // todas. Operação batch sobre `node.leafIds`.
  const toggleNode = useCallback((node: ViewNode) => {
    const leafIds = node.leafIds;
    if (leafIds.length === 0) return;
    setSelectedSubIds((prev) => {
      const next = new Set(prev);
      const allSelected = leafIds.every((id) => next.has(id));
      if (allSelected) leafIds.forEach((id) => next.delete(id));
      else leafIds.forEach((id) => next.add(id));
      return next;
    });
  }, []);

  const toggleExpand = useCallback((nodeId: string) => {
    setExpandedNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const toggleLevel = useCallback(
    (level: LevelKey) => {
      setActiveLevels((prev) => {
        const next = new Set(prev);
        if (next.has(level)) next.delete(level);
        else next.add(level);
        try {
          window.localStorage.setItem(
            levelsStorageKey(userId),
            JSON.stringify(Array.from(next)),
          );
        } catch {
          // ignora — preferência fica só na sessão se localStorage falhar
        }
        return next;
      });
    },
    [userId],
  );

  // Recarrega activeLevels quando userId chega (sessão carrega async).
  // Procura primeiro a chave namespaced; se não houver, mantém o que já
  // foi lido no init lazy (chave global, fallback p/ usuários antigos).
  useEffect(() => {
    if (!userId) return;
    const stored = readActiveLevels(userId);
    if (stored) setActiveLevels(stored);
  }, [userId]);

  const clearQueue = useCallback(() => {
    setPdfBytes(null);
    setPdfPages(null);
    setPdfFiles([]);
    setFilterGroups([]);
    setSelectedSubIds(new Set());
    setExpandedNodeIds(new Set());
    setTrackingDupsByTid(new Map());
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

  // Estado da checkbox de qualquer nó da viewTree, derivado das folhas
  // descendentes (leafIds). all = todas marcadas; some = marcadas + não
  // marcadas; none = nenhuma.
  const nodeSelectionState = useCallback(
    (node: ViewNode): "none" | "some" | "all" => {
      const total = node.leafIds.length;
      if (total === 0) return "none";
      const sel = node.leafIds.filter((id) => selectedSubIds.has(id)).length;
      if (sel === 0) return "none";
      if (sel === total) return "all";
      return "some";
    },
    [selectedSubIds],
  );

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
              <AlertTriangle className="h-5 w-5" /> Etiquetas repetidas no PDF
              atual — não serão impressas ({duplicatePages.length})
            </CardTitle>
            <CardDescription>
              Tracking ID aparece mais de uma vez no PDF carregado. A primeira
              ocorrência fica na fila; as demais foram removidas pra evitar
              impressão dobrada.
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
                    <p>Repetida no PDF atual</p>
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
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                <Filter className="h-5 w-5" /> Fila de Impressão
              </CardTitle>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Layers className="h-4 w-4 mr-1" /> Níveis
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Mostrar níveis</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {ALL_LEVELS.map((level) => (
                    <DropdownMenuCheckboxItem
                      key={level}
                      checked={activeLevels.has(level)}
                      onCheckedChange={() => toggleLevel(level)}
                      onSelect={(e) => e.preventDefault()}
                    >
                      {LEVEL_LABELS[level]}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <CardDescription>
              {(() => {
                const allLeaves = filterGroups.flatMap((c) =>
                  c.subGroups.flatMap((sk) =>
                    sk.subGroups.flatMap((q) =>
                      q.subGroups.flatMap((co) => co.subGroups),
                    ),
                  ),
                );
                const downloaded = allLeaves.filter((l) => l.downloaded).length;
                return `${downloaded}/${allLeaves.length} subgrupos baixados`;
              })()}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              {viewTree.map((node) => (
                <TreeNode
                  key={node.id}
                  node={node}
                  depth={0}
                  expandedNodeIds={expandedNodeIds}
                  selectedSubIds={selectedSubIds}
                  printedSubgroupIds={printedSubgroupIds}
                  pagesByIndex={pagesByIndex}
                  toggleExpand={toggleExpand}
                  toggleNode={toggleNode}
                  toggleSub={toggleSub}
                  nodeSelectionState={nodeSelectionState}
                  downloadViewNode={downloadViewNode}
                />
              ))}
            </div>

            <div className="flex gap-2 flex-wrap pt-2 border-t border-slate-800">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedSubIds(new Set(visibleLeafIds))}
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
        onOpenChange={(open) => {
          if (!open) setPendingDownload(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Etiquetas já impressas</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  {pendingDownload?.conflictingTrackings.length} etiqueta(s)
                  deste recorte foram impressas nos últimos 30 dias. Confirme
                  para reimprimir.
                </p>
                {pendingDownload?.conflictDetails.slice(0, 5).map((d) => (
                  <p
                    key={d.trackingId}
                    className="text-xs text-muted-foreground font-mono"
                  >
                    · {d.trackingId} — {formatDate(d.impressoEm)}
                    {d.impressoPor?.nome && ` por ${d.impressoPor.nome}`}
                  </p>
                ))}
                {pendingDownload &&
                  pendingDownload.conflictDetails.length > 5 && (
                    <p className="text-xs text-muted-foreground">
                      … e mais{" "}
                      {pendingDownload.conflictDetails.length - 5} etiqueta(s)
                    </p>
                  )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => setPendingDownload(null)}
              disabled={reprintLoading}
            >
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmReprint();
              }}
              disabled={reprintLoading}
            >
              {reprintLoading ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : null}
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
              Arquivos ficam disponíveis por 10 dias após a geração
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
