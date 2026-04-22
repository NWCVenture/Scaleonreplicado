"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { generateId, copyToClipboard } from "@/lib/utils";
import { toast } from "sonner";
import {
  Upload, Copy, CheckCircle2, Trash2, FileText, X, Package,
  ClipboardList, Download, ChevronDown, ChevronUp, ScanLine,
  CheckCheck, Clock, AlertTriangle, Filter, Truck, FileDown, Shield,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";

// ─── Global PDF libs ────────────────────────────────────────────────────────
declare global {
  interface Window {
    pdfjsLib?: any;
    PDFLib?: any;
  }
}

// ─── Constants ───────────────────────────────────────────────────────────────
const PRODUCTS = ["LUA", "NBA", "BOB", "PUFFER", "CJ", "SOL"];
const KIT_TYPES = ["KIT 2", "KIT 3", "KIT 4", "MIX 4"];
const JT_PREFIX = "999880";
const JADLOG_SESSIONS_KEY = "pacotes_urgentes_jadlog_sessions";
const ADMIN_PASSWORD = "120304";

// ─── Types ───────────────────────────────────────────────────────────────────
type ParsedOrder = {
  orderId: string;
  trackingId: string;
  provider: string;
  skus: string[];
  cpf: string;
};

type UploadedFile = { name: string; orderCount: number };

type PageInfo = {
  index: number;
  pageNum: number;
  isKit: boolean;
  products: string[];
  kitType: string | null;
  trackingId: string;
  jadlogBarcode: string;
  jtBarcode: string;
  carrierFromPDF: string;
  cpfFromPDF: string;
};

type FilterGroup = {
  id: string;
  label: string;
  products: string[];
  kitType: string | null;
  pageIndexes: number[];
  downloaded: boolean;
};

type ScanStatus = "found" | "dup" | "unknown";
type OverlayState = { id: string; status: ScanStatus } | null;

type Bipador = "BEATRIZ" | "NICOLI";

type JadlogSession = {
  id: string;
  timestamp: number;
  codes: string[];
  bipador?: Bipador | null;
};

type AuditRecord = {
  date: number;
  user: string;
  orderCount: number;
  iMileCount: number;
  jadlogCount: number;
  semRastreioCount: number;
  filterGroupsSummary: { label: string; count: number; downloaded: boolean }[];
  scannedCount: number;
  confirmedCount: number;
  bipador?: Bipador | null;
  notSendingCodes?: string[];
  notSendingReason?: string;
};

type CloseConferenceState = {
  open: boolean;
  isJadlog: boolean | null;
  reason: string;
  notSendingCodes: string[];
  notSendingReason: string;
  notSendingInput: string;
};

// ─── Pure utilities ──────────────────────────────────────────────────────────
function parseCSVRaw(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const t = text.replace(/^\uFEFF/, ""); // BOM
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inQuotes) {
      if (ch === '"') {
        if (t[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\n" || (ch === "\r" && t[i + 1] === "\n")) {
        if (ch === "\r") i++;
        row.push(field); field = "";
        rows.push(row); row = [];
      } else if (ch === "\r") {
        row.push(field); field = "";
        rows.push(row); row = [];
      } else { field += ch; }
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function parseCSVToOrders(text: string): ParsedOrder[] {
  const rows = parseCSVRaw(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim());
  const idx = (name: string) => headers.findIndex((h) => h === name);
  const orderIdx = idx("Order ID");
  if (orderIdx === -1) throw new Error("Coluna 'Order ID' não encontrada");
  const trackIdx = idx("Tracking ID");
  const provIdx = idx("Shipping Provider Name");
  const skuIdx = idx("Seller SKU");
  const cpfIdx = idx("CPF Number");

  const map = new Map<string, ParsedOrder>();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[orderIdx]?.trim()) continue;
    const orderId = r[orderIdx].trim();
    const trackingId = trackIdx >= 0 ? (r[trackIdx] || "").trim() : "";
    const provider = provIdx >= 0 ? (r[provIdx] || "").trim() : "";
    const sku = skuIdx >= 0 ? (r[skuIdx] || "").trim() : "";
    const rawCpf = cpfIdx >= 0 ? (r[cpfIdx] || "").trim() : "";
    const cpf = rawCpf.replace(/\D/g, "");

    if (map.has(orderId)) {
      const ex = map.get(orderId)!;
      if (!ex.trackingId && trackingId) ex.trackingId = trackingId;
      if (!ex.provider && provider) ex.provider = provider;
      if (sku && !ex.skus.includes(sku)) ex.skus.push(sku);
      if (!ex.cpf && cpf) ex.cpf = cpf;
    } else {
      map.set(orderId, { orderId, trackingId, provider, skus: sku ? [sku] : [], cpf });
    }
  }
  return Array.from(map.values());
}

async function loadPDFLibraries(): Promise<void> {
  const inject = (src: string) =>
    new Promise<void>((res, rej) => {
      if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => res();
      s.onerror = () => rej(new Error(`Failed to load ${src}`));
      document.head.appendChild(s);
    });

  await inject("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js");
  await inject("https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js");

  await new Promise<void>((res) => {
    const poll = setInterval(() => {
      if (window.pdfjsLib && window.PDFLib) { clearInterval(poll); res(); }
    }, 100);
  });

  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }
}

async function mergePDFs(files: File[]): Promise<Uint8Array> {
  const { PDFDocument } = window.PDFLib;
  const merged = await PDFDocument.create();
  for (const file of files) {
    const buf = await file.arrayBuffer();
    const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    pages.forEach((p: any) => merged.addPage(p));
  }
  return merged.save();
}

async function analyzePDFPages(
  file: File | Uint8Array,
  onProgress: (val: number, text: string) => void
): Promise<PageInfo[]> {
  const pdfjsLib = window.pdfjsLib;
  let data: ArrayBuffer;
  if (file instanceof File) {
    data = await file.arrayBuffer();
  } else {
    // pdf.js detacha o ArrayBuffer — passamos uma cópia para preservar o original
    data = new Uint8Array(file).buffer;
  }
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const total = pdf.numPages;
  const pages: PageInfo[] = [];

  for (let i = 0; i < total; i++) {
    const progress = 15 + Math.round(((i + 1) / total) * 70);
    onProgress(progress, `Analisando página ${i + 1} de ${total}…`);

    const page = await pdf.getPage(i + 1);
    const content = await page.getTextContent();
    const text = content.items.map((it: any) => it.str).join(" ");

    // Tracking
    const trackMatch = text.match(/C[oó]digo\s+de\s+Rastreamento[:\s]+(\d{12,14})/i);
    const trackingId = trackMatch ? trackMatch[1] : "";

    // IDENTIFICAÇÃO DOS BENS section
    const bensMatch = text.match(
      /IDENTIFICA[CÇ][AÃ]O\s+DOS\s+BENS([\s\S]*?)(?:\d{2}-\d{2}-\d{4}|Total\s+\d|$)/i
    );
    const bensText = bensMatch ? bensMatch[1] : "";

    const products: string[] = [];
    for (const p of PRODUCTS) {
      if (new RegExp(`\\b${p}\\b`, "i").test(bensText)) products.push(p);
    }

    const kitMatch = text.match(/\b(KIT\s*[2-9]|MIX\s*[2-9])\b/i);
    const kitType = kitMatch
      ? kitMatch[1].replace(/\s+/, " ").toUpperCase()
      : null;

    // Carrier
    let carrierFromPDF = "Outro";
    if (/imile/i.test(text)) carrierFromPDF = "iMile";
    else if (/jadlog/i.test(text)) carrierFromPDF = "JadLog";
    else if (/j&t|j\s*&\s*t express|999880/i.test(text)) carrierFromPDF = "J&T";

    // Jadlog barcode
    let jadlogBarcode = "";
    if (carrierFromPDF === "JadLog") {
      const jm = text.match(/\b(139\d{8,}?)(?:\$|\b)/);
      if (jm) jadlogBarcode = jm[1];
    }

    // J&T barcode
    let jtBarcode = "";
    if (carrierFromPDF === "J&T") {
      const jt = text.match(/\b(999880\d{6,}?)(?:\$|\b)/);
      if (jt) jtBarcode = jt[1];
    }

    // CPF
    let cpfFromPDF = "";
    const cpfMatch =
      text.match(/CPF[\/\s]*CNPJ[:\s]*([\d.\-\/]+)/i) ||
      text.match(/\b(\d{3}\.\d{3}\.\d{3}-\d{2})\b/) ||
      text.match(/\b(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\b/);
    if (cpfMatch) cpfFromPDF = cpfMatch[1].replace(/\D/g, "");

    pages.push({
      index: i,
      pageNum: i + 1,
      isKit: kitType !== null,
      products,
      kitType,
      trackingId,
      jadlogBarcode,
      jtBarcode,
      carrierFromPDF,
      cpfFromPDF,
    });
  }
  onProgress(85, "Agrupando resultados…");
  return pages;
}

function buildFilterGroups(pages: PageInfo[]): FilterGroup[] {
  const map = new Map<string, FilterGroup>();

  for (const page of pages) {
    const prods = page.products.length ? page.products : ["(SKUs Fora do Padrão)"];
    for (const prod of prods) {
      const kt = page.kitType || "Individual";
      const id = `${prod}||${kt}`;
      if (!map.has(id)) {
        map.set(id, {
          id,
          label: kt === "Individual" ? prod : `${prod} · ${kt}`,
          products: [prod],
          kitType: page.kitType,
          pageIndexes: [],
          downloaded: false,
        });
      }
      map.get(id)!.pageIndexes.push(page.index);
    }
  }

  const kitOrder = ["KIT 2", "KIT 3", "KIT 4", "MIX 4"];
  return Array.from(map.values()).sort((a, b) => {
    const ai = a.kitType ? kitOrder.indexOf(a.kitType) : 99;
    const bi = b.kitType ? kitOrder.indexOf(b.kitType) : 99;
    if (ai !== bi) return ai - bi;
    return a.label.localeCompare(b.label);
  });
}

function rot90neg(cx: number, cy: number, px: number, py: number) {
  return { x: cx + (py - cy), y: cy - (px - cx) };
}

async function downloadFilteredPDF(
  sourceBytes: Uint8Array,
  pageIndexes: number[],
  label: string,
  addMoon: boolean,
  addBasketball: boolean,
  products: string[]
) {
  const { PDFDocument, rgb, degrees } = window.PDFLib;
  // Cópia defensiva — evita detach do buffer entre múltiplas chamadas
  const srcDoc = await PDFDocument.load(new Uint8Array(sourceBytes), { ignoreEncryption: true });
  const newDoc = await PDFDocument.create();
  const copied = await newDoc.copyPages(srcDoc, pageIndexes);

  for (const page of copied) {
    newDoc.addPage(page);
    const { width, height } = page.getSize();

    // Kit rectangle — only for KIT or MIX (qty > 1)
    if (label.includes("KIT") || label.includes("MIX")) {
      page.drawRectangle({
        x: width - 25,
        y: 15,
        width: 15,
        height: 15,
        color: rgb(0, 0, 0),
      });
    }

    const hasLua = products.includes("LUA");
    const hasNba = products.includes("NBA");
    let alertText = "";
    if (hasLua && hasNba) alertText = "ATENÇÃO: MANGA LONGA E REGATA";
    else if (hasLua) alertText = "ATENÇÃO: MANGA LONGA";
    else if (hasNba) alertText = "ATENÇÃO: REGATA";

    if (alertText) {
      const font = await newDoc.embedFont(window.PDFLib.StandardFonts.HelveticaBold);
      page.drawText(alertText, {
        x: 10,
        y: 200,
        size: 8,
        font,
        color: rgb(0, 0, 0),
        rotate: degrees(270),
      });
    }

    // Moon icon
    if (addMoon && hasLua) {
      const cx = width - 30;
      const cy = height / 2;
      const drawMoon = () => {
        page.drawCircle({ x: cx, y: cy, size: 10, color: rgb(0, 0, 0) });
        page.drawCircle({ x: cx + 4, y: cy + 3, size: 8, color: rgb(1, 1, 1) });
      };
      drawMoon();
    }

    // Basketball icon
    if (addBasketball && hasNba) {
      const cx = width - 50;
      const cy = height / 2;
      page.drawCircle({ x: cx, y: cy, size: 10, borderColor: rgb(0, 0, 0), borderWidth: 1 });
      page.drawLine({ start: { x: cx, y: cy - 10 }, end: { x: cx, y: cy + 10 }, thickness: 1, color: rgb(0, 0, 0) });
      page.drawLine({ start: { x: cx - 10, y: cy }, end: { x: cx + 10, y: cy }, thickness: 1, color: rgb(0, 0, 0) });
    }
  }

  const bytes = await newDoc.save();
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  a.download = `Urgentes_${label}_${dd}-${mm}-${yyyy}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

function extractCodes(text: string): string[] {
  const cleaned = text.replace(/(\d{12,14})\$[^\s\n]*/g, "$1");
  const re = /(4\d{10}|BR\d{12,13}[A-Z]?|\d{12,14})/g;
  const seen = new Set<string>();
  const results: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    if (!seen.has(m[1])) { seen.add(m[1]); results.push(m[1]); }
  }
  return results;
}

function extractJadlogCode(raw: string): string | null {
  const m = raw.match(/\b(139\d{8,}?)\$/) || raw.match(/\b(139\d{8,})\b/);
  return m ? m[1] : null;
}

function addMinutesToNow(minutes: number): string {
  const d = new Date(Date.now() + minutes * 60000);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function getUser(): { username: string; role: string } | null {
  try {
    const raw = localStorage.getItem("stockflow_user");
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// ─── StepBadge ───────────────────────────────────────────────────────────────
function StepBadge({ n, done }: { n: number; done?: boolean }) {
  return (
    <span
      className={cn(
        "flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold shrink-0",
        done ? "bg-green-500 text-white" : "bg-primary text-primary-foreground"
      )}
    >
      {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : n}
    </span>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────
export default function PacotesUrgentes() {
  // CSV
  const [allOrders, setAllOrders] = useState<Map<string, ParsedOrder>>(new Map());
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isDraggingCSV, setIsDraggingCSV] = useState(false);
  const [copiedIds, setCopiedIds] = useState(false);
  const [showSkuTable, setShowSkuTable] = useState(false);

  // PDF
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [pdfFileNames, setPdfFileNames] = useState<string[]>([]);
  const [pdfPages, setPdfPages] = useState<PageInfo[] | null>(null);
  const [filterGroups, setFilterGroups] = useState<FilterGroup[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());
  const [addMoon, setAddMoon] = useState(true);
  const [addBasketball, setAddBasketball] = useState(true);
  const [isPDFProcessing, setIsPDFProcessing] = useState(false);
  const [pdfProgress, setPdfProgress] = useState(0);
  const [pdfProgressText, setPdfProgressText] = useState("");
  const [isDraggingPDF, setIsDraggingPDF] = useState(false);
  const [showTaskList, setShowTaskList] = useState(true);

  // Scan
  const [scannedIds, setScannedIds] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [overlayState, setOverlayState] = useState<OverlayState>(null);
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [showScannedList, setShowScannedList] = useState(false);

  // Audit
  const [flowClosed, setFlowClosed] = useState(false);

  // Jadlog
  const [jadlogSessions, setJadlogSessions] = useState<JadlogSession[]>(() => {
    try {
      const raw = localStorage.getItem(JADLOG_SESSIONS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [jadlogActive, setJadlogActive] = useState(false);
  const [jadlogCurrentCodes, setJadlogCurrentCodes] = useState<string[]>([]);
  const [jadlogInputValue, setJadlogInputValue] = useState("");
  const [jadlogCopied, setJadlogCopied] = useState<string | null>(null);
  const [currentBipador, setCurrentBipador] = useState<Bipador | null>(null);

  // Countdown
  const [collectorTime, setCollectorTime] = useState("");
  const [countdown, setCountdown] = useState<string | null>(null);

  // Admin modal
  const [adminModalOpen, setAdminModalOpen] = useState(false);
  const [adminPasswordInput, setAdminPasswordInput] = useState("");
  const [adminPasswordError, setAdminPasswordError] = useState(false);
  const [pendingTXTCarrier, setPendingTXTCarrier] = useState<"iMile" | "JadLog" | "J&T" | null>(null);
  const [pendingAdminAction, setPendingAdminAction] = useState<"confirmarTodos" | "redownload" | null>(null);

  // Close conference dialog
  const [closeConference, setCloseConference] = useState<CloseConferenceState>({
    open: false,
    isJadlog: null,
    reason: "",
    notSendingCodes: [],
    notSendingReason: "",
    notSendingInput: "",
  });

  const [copiedMissing, setCopiedMissing] = useState(false);

  // Tab navigation
  const [pageTab, setPageTab] = useState<"urgentes" | "expedicao">("urgentes");

  // Expedicao Diaria tab state
  const [expPdfBytes, setExpPdfBytes] = useState<Uint8Array | null>(null);
  const [expPdfFileNames, setExpPdfFileNames] = useState<string[]>([]);
  const [expPdfPages, setExpPdfPages] = useState<PageInfo[] | null>(null);
  const [expFilterGroups, setExpFilterGroups] = useState<FilterGroup[]>([]);
  const [expSelectedGroupIds, setExpSelectedGroupIds] = useState<Set<string>>(new Set());
  const [expIsPDFProcessing, setExpIsPDFProcessing] = useState(false);
  const [expPdfProgress, setExpPdfProgress] = useState(0);
  const [expPdfProgressText, setExpPdfProgressText] = useState("");
  const [expIsDragging, setExpIsDragging] = useState(false);
  const [expAddMoon, setExpAddMoon] = useState(true);
  const [expAddBasketball, setExpAddBasketball] = useState(true);
  const expPdfInputRef = useRef<HTMLInputElement>(null);
  const expFilterGroupsRef = useRef<FilterGroup[]>([]);

  // Refs
  const csvInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const scanInputRef = useRef<HTMLTextAreaElement>(null);
  const audioSuccessRef = useRef<HTMLAudioElement>(null);
  const audioErrorRef = useRef<HTMLAudioElement>(null);
  const processTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastProcessedText = useRef("");
  const filterGroupsRef = useRef<FilterGroup[]>([]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const ordersArr = Array.from(allOrders.values());
  const iMileOrders = ordersArr.filter((o) => /imile/i.test(o.provider));
  const jadlogOrders = ordersArr.filter((o) => /jadlog/i.test(o.provider));
  const semRastreio = ordersArr.filter((o) => !o.trackingId);
  const hasOrders = allOrders.size > 0;

  const urgentTrackingSet: Record<string, boolean> = {};
  ordersArr.forEach((o) => { if (o.trackingId) urgentTrackingSet[o.trackingId] = true; });
  const confirmedIds = scannedIds.filter((id) => urgentTrackingSet[id]);
  const totalWithTracking = Object.keys(urgentTrackingSet).length;
  const allConfirmed = totalWithTracking > 0 && confirmedIds.length >= totalWithTracking;

  const skuMap = new Map<string, number>();
  ordersArr.forEach((o) => o.skus.forEach((s) => skuMap.set(s, (skuMap.get(s) || 0) + 1)));
  const skuRows = Array.from(skuMap.entries()).sort((a, b) => b[1] - a[1]);

  const iMilePDFPages = (pdfPages || []).filter((p) => p.carrierFromPDF === "iMile");
  const jadlogPDFPages = (pdfPages || []).filter((p) => p.carrierFromPDF === "JadLog");
  const jtPDFPages = (pdfPages || []).filter((p) => p.carrierFromPDF === "J&T");

  const pdfCount = pdfPages?.length ?? 0;
  const csvCount = allOrders.size;
  const pdfValidation = { pdfCount, csvCount, ok: pdfCount === csvCount, diff: Math.abs(pdfCount - csvCount) };

  const pendingGroups = filterGroups.filter((g) => !g.downloaded);
  const doneGroups = filterGroups.filter((g) => g.downloaded);

  const pdfCpfSet = new Set((pdfPages || []).map((p) => p.cpfFromPDF).filter(Boolean));
  const missingFromPDF = ordersArr.filter((o) => o.cpf && !pdfCpfSet.has(o.cpf));

  // ── Effects ────────────────────────────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem(JADLOG_SESSIONS_KEY, JSON.stringify(jadlogSessions));
  }, [jadlogSessions]);

  useEffect(() => { filterGroupsRef.current = filterGroups; }, [filterGroups]);

  useEffect(() => {
    const arm = () => {
      audioSuccessRef.current?.play().then(() => audioSuccessRef.current?.pause()).catch(() => {});
      audioErrorRef.current?.play().then(() => audioErrorRef.current?.pause()).catch(() => {});
      window.removeEventListener("click", arm);
      window.removeEventListener("keydown", arm);
    };
    window.addEventListener("click", arm);
    window.addEventListener("keydown", arm);
    return () => { window.removeEventListener("click", arm); window.removeEventListener("keydown", arm); };
  }, []);

  useEffect(() => {
    if (!hasOrders) return;
    const id = setInterval(() => {
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement
      ) return;
      scanInputRef.current?.focus({ preventScroll: true });
    }, 2500);
    return () => clearInterval(id);
  }, [hasOrders]);

  useEffect(() => {
    if (!collectorTime) return;
    const [hh, mm] = collectorTime.split(":").map(Number);
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0);
    const tick = () => {
      const diff = target.getTime() - Date.now();
      if (diff <= 0) { setCountdown("Chegou!"); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setCountdown(`${h > 0 ? `${h}h ` : ""}${m}m ${String(s).padStart(2, "0")}s`);
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [collectorTime]);

  // ── CSV handlers ──────────────────────────────────────────────────────────
  const processCSVFiles = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => f.name.endsWith(".csv"));
    if (!arr.length) { toast.error("Nenhum arquivo CSV encontrado"); return; }
    const newOrders = new Map(allOrders);
    const newFiles: UploadedFile[] = [];
    for (const file of arr) {
      try {
        const text = await file.text();
        const orders = parseCSVToOrders(text);
        let added = 0;
        orders.forEach((o) => {
          if (!newOrders.has(o.orderId)) { newOrders.set(o.orderId, o); added++; }
          else {
            const ex = newOrders.get(o.orderId)!;
            if (!ex.trackingId && o.trackingId) ex.trackingId = o.trackingId;
            if (!ex.provider && o.provider) ex.provider = o.provider;
            o.skus.forEach((s) => { if (!ex.skus.includes(s)) ex.skus.push(s); });
            if (!ex.cpf && o.cpf) ex.cpf = o.cpf;
          }
        });
        newFiles.push({ name: file.name, orderCount: added });
      } catch (e: any) {
        toast.error(`Erro em ${file.name}: ${e.message}`);
      }
    }
    setAllOrders(newOrders);
    setUploadedFiles((prev) => [...prev, ...newFiles]);
    toast.success(`${arr.length} arquivo(s) carregado(s). Total: ${newOrders.size} pedidos`);
  }, [allOrders]);

  const handleCSVDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDraggingCSV(false);
    processCSVFiles(e.dataTransfer.files);
  }, [processCSVFiles]);

  const handleClearAll = () => {
    setAllOrders(new Map()); setUploadedFiles([]); setPdfFile(null); setPdfBytes(null);
    setPdfFileNames([]); setPdfPages(null); setFilterGroups([]); setSelectedGroupIds(new Set());
    setScannedIds([]); setInputValue(""); setFlowClosed(false); setCollectorTime(""); setCountdown(null);
    toast.info("Sessão limpa");
  };

  const handleCopyIds = () => {
    copyToClipboard(Array.from(allOrders.keys()).join(","));
    setCopiedIds(true);
    setTimeout(() => setCopiedIds(false), 3000);
  };

  const handleCopyMissingIds = () => {
    copyToClipboard(missingFromPDF.map((o) => o.orderId).join(","));
    setCopiedMissing(true);
    setTimeout(() => setCopiedMissing(false), 3000);
  };

  // ── TXT download ──────────────────────────────────────────────────────────
  const openTXTDownload = (carrier: "iMile" | "JadLog" | "J&T") => openAdminModal("txt", carrier);

  const executeTXTDownload = (carrier: "iMile" | "JadLog" | "J&T") => {
    let codes: string[] = [];
    if (carrier === "iMile") {
      codes = iMileOrders.map((o) => o.trackingId).filter(Boolean);
    } else if (carrier === "JadLog") {
      const set = new Set<string>();
      (pdfPages || [])
        .filter((p) => p.carrierFromPDF === "JadLog" && p.jadlogBarcode)
        .forEach((p) => set.add(p.jadlogBarcode));
      codes = Array.from(set);
      if (!codes.length) { toast.error("Nenhum código Jadlog encontrado no PDF"); return; }
    } else {
      const set = new Set<string>();
      (pdfPages || [])
        .filter((p) => p.carrierFromPDF === "J&T" && p.jtBarcode)
        .forEach((p) => set.add(p.jtBarcode));
      codes = Array.from(set);
      if (!codes.length) { toast.error("Nenhum código J&T encontrado no PDF"); return; }
    }
    const blob = new Blob([codes.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const d = new Date();
    a.download = `Rastreios_${carrier}_${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 100);
  };

  const openAdminModal = (action: "txt" | "confirmarTodos" | "redownload", carrier?: "iMile" | "JadLog" | "J&T") => {
    if (action === "txt" && carrier) setPendingTXTCarrier(carrier);
    if (action === "confirmarTodos") setPendingAdminAction("confirmarTodos");
    if (action === "redownload") setPendingAdminAction("redownload");
    setAdminModalOpen(true);
    setAdminPasswordInput("");
    setAdminPasswordError(false);
  };

  const handleAdminPasswordSubmit = () => {
    if (adminPasswordInput === ADMIN_PASSWORD) {
      setAdminModalOpen(false);
      if (pendingTXTCarrier) { executeTXTDownload(pendingTXTCarrier); setPendingTXTCarrier(null); }
      if (pendingAdminAction === "confirmarTodos") {
        const allIds = ordersArr.map((o) => o.trackingId).filter(Boolean);
        setScannedIds((prev) => {
          const merged = [...prev];
          allIds.forEach((id) => { if (!merged.includes(id)) merged.push(id); });
          return merged;
        });
        toast.success("Todos os pacotes confirmados");
        setPendingAdminAction(null);
      }
      if (pendingAdminAction === "redownload") {
        setPendingAdminAction(null);
        setFilterGroups((prev) =>
          prev.map((g) => selectedGroupIds.has(g.id) ? { ...g, downloaded: false } : g)
        );
        setTimeout(() => handleDownloadFiltered(), 50);
      }
    } else {
      setAdminPasswordError(true);
    }
  };

  // ── PDF handlers ──────────────────────────────────────────────────────────
  const handlePDFFiles = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => f.name.endsWith(".pdf"));
    if (!arr.length) { toast.error("Nenhum PDF encontrado"); return; }

    const previousDownloaded = new Set(
      filterGroupsRef.current.filter((g) => g.downloaded).map((g) => g.id)
    );

    setPdfPages(null); setFilterGroups([]); setSelectedGroupIds(new Set());
    setIsPDFProcessing(true); setPdfProgress(5); setPdfProgressText("Carregando bibliotecas…");

    try {
      await loadPDFLibraries();
      setPdfProgress(10); setPdfProgressText("Mesclando PDFs…");

      let bytes: Uint8Array;
      if (arr.length > 1) {
        bytes = await mergePDFs(arr);
      } else {
        bytes = new Uint8Array(await arr[0].arrayBuffer());
      }
      setPdfBytes(bytes);
      setPdfFileNames(arr.map((f) => f.name));
      if (arr.length === 1) setPdfFile(arr[0]);

      const pages = await analyzePDFPages(bytes, (val, text) => {
        setPdfProgress(val); setPdfProgressText(text);
      });
      setPdfProgress(90); setPdfProgressText("Construindo grupos…");
      const groups = buildFilterGroups(pages);

      const restoredGroups = groups.map((g) => ({
        ...g,
        downloaded: previousDownloaded.has(g.id),
      }));

      const newGroupIds = new Set(
        restoredGroups.filter((g) => !g.downloaded).map((g) => g.id)
      );

      setPdfPages(pages);
      setFilterGroups(restoredGroups);
      setSelectedGroupIds(newGroupIds);
      setPdfProgress(100); setPdfProgressText("Concluído");
      toast.success(`PDF analisado: ${pages.length} página(s) em ${groups.length} grupo(s)`);
    } catch (e: any) {
      toast.error(`Erro ao processar PDF: ${e.message}`);
    } finally {
      setIsPDFProcessing(false);
    }
  }, []);

  const handlePDFDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDraggingPDF(false);
    handlePDFFiles(e.dataTransfer.files);
  }, [handlePDFFiles]);

  // ── Expedicao Diaria handlers ─────────────────────────────────────────────
  const handleExpPDFFiles = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => f.name.endsWith(".pdf"));
    if (!arr.length) { toast.error("Nenhum PDF encontrado"); return; }

    const previousDownloaded = new Set(
      expFilterGroupsRef.current.filter((g) => g.downloaded).map((g) => g.id)
    );

    setExpPdfPages(null); setExpFilterGroups([]); setExpSelectedGroupIds(new Set());
    setExpIsPDFProcessing(true); setExpPdfProgress(5); setExpPdfProgressText("Carregando bibliotecas…");

    try {
      await loadPDFLibraries();
      setExpPdfProgress(10); setExpPdfProgressText("Mesclando PDFs…");

      let bytes: Uint8Array;
      if (arr.length > 1) {
        bytes = await mergePDFs(arr);
      } else {
        bytes = new Uint8Array(await arr[0].arrayBuffer());
      }
      setExpPdfBytes(bytes);
      setExpPdfFileNames(arr.map((f) => f.name));

      const pages = await analyzePDFPages(bytes, (val, text) => {
        setExpPdfProgress(val); setExpPdfProgressText(text);
      });
      setExpPdfProgress(90); setExpPdfProgressText("Construindo grupos…");
      const groups = buildFilterGroups(pages);

      const restoredGroups = groups.map((g) => ({
        ...g,
        downloaded: previousDownloaded.has(g.id),
      }));

      const newGroupIds = new Set(
        restoredGroups.filter((g) => !g.downloaded).map((g) => g.id)
      );

      setExpPdfPages(pages);
      setExpFilterGroups(restoredGroups);
      expFilterGroupsRef.current = restoredGroups;
      setExpSelectedGroupIds(newGroupIds);
      setExpPdfProgress(100); setExpPdfProgressText("Concluído");
      toast.success(`PDF analisado: ${pages.length} página(s) em ${groups.length} grupo(s)`);
    } catch (e: any) {
      toast.error(`Erro ao processar PDF: ${e.message}`);
    } finally {
      setExpIsPDFProcessing(false);
    }
  }, []);

  const handleExpPDFDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setExpIsDragging(false);
    handleExpPDFFiles(e.dataTransfer.files);
  }, [handleExpPDFFiles]);

  const handleExpDownloadGroup = useCallback(async (group: FilterGroup) => {
    if (!expPdfBytes) return;
    try {
      await downloadFilteredPDF(expPdfBytes, group.pageIndexes, group.label, expAddMoon, expAddBasketball, group.products);
      setExpFilterGroups((prev) => prev.map((g) => g.id === group.id ? { ...g, downloaded: true } : g));
    } catch (e: any) {
      toast.error(`Erro ao gerar PDF: ${e.message}`);
    }
  }, [expPdfBytes, expAddMoon, expAddBasketball]);

  const handleExpDownloadSelected = useCallback(async () => {
    if (!expPdfBytes) return;
    const selected = expFilterGroups.filter((g) => expSelectedGroupIds.has(g.id));
    for (const group of selected) {
      try {
        await downloadFilteredPDF(expPdfBytes, group.pageIndexes, group.label, expAddMoon, expAddBasketball, group.products);
        setExpFilterGroups((prev) => prev.map((g) => g.id === group.id ? { ...g, downloaded: true } : g));
      } catch {}
    }
    toast.success(`${selected.length} grupo(s) baixado(s)!`);
  }, [expPdfBytes, expFilterGroups, expSelectedGroupIds, expAddMoon, expAddBasketball]);

  const toggleGroupSelection = (id: string) => {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleDownloadFiltered = async () => {
    if (!pdfBytes || selectedGroupIds.size === 0) return;
    const selected = filterGroups.filter((g) => selectedGroupIds.has(g.id));
    const allIndexes = [...new Set(selected.flatMap((g) => g.pageIndexes))];
    const allProducts = [...new Set(selected.flatMap((g) => g.products))];
    const label = selected.length === 1 ? selected[0].label : `${selected.length}_grupos`;
    try {
      await downloadFilteredPDF(pdfBytes, allIndexes, label, addMoon, addBasketball, allProducts);
      setFilterGroups((prev) =>
        prev.map((g) => selectedGroupIds.has(g.id) ? { ...g, downloaded: true } : g)
      );
      toast.success("PDF baixado e grupos marcados como impressos");
    } catch (e: any) {
      toast.error(`Erro ao gerar PDF: ${e.message}`);
    }
  };

  const previewFilteredPDF = async (indexes: number[], label: string, products: string[]) => {
    if (!pdfBytes) return;
    try {
      await downloadFilteredPDF(pdfBytes, indexes, `PREVIEW_${label}`, addMoon, addBasketball, products);
    } catch (e: any) {
      toast.error(`Erro ao visualizar PDF: ${e.message}`);
    }
  };

  const downloadCarrierPDF = async (carrier: "iMile" | "JadLog" | "J&T", pages: PageInfo[]) => {
    if (!pdfBytes) return;
    const carrierIndexSet = new Set(pages.map((p) => p.index));
    const indexes = pages.map((p) => p.index);
    const products = [...new Set(pages.flatMap((p) => p.products))];
    try {
      await downloadFilteredPDF(pdfBytes, indexes, carrier, addMoon, addBasketball, products);
      setFilterGroups((prev) =>
        prev.map((g) => {
          if (g.pageIndexes.every((idx) => carrierIndexSet.has(idx))) return { ...g, downloaded: true };
          return g;
        })
      );
    } catch (e: any) {
      toast.error(`Erro ao gerar PDF ${carrier}: ${e.message}`);
    }
  };

  // ── Scan handlers ─────────────────────────────────────────────────────────
  const playSound = (type: "success" | "error") => {
    const el = type === "success" ? audioSuccessRef.current : audioErrorRef.current;
    if (!el) return;
    el.currentTime = 0;
    el.play().catch(() => {});
  };

  const showPopup = useCallback((id: string, status: ScanStatus) => {
    setOverlayState({ id, status });
    setOverlayVisible(true);
    if (status === "found") playSound("success"); else playSound("error");
    setTimeout(() => setOverlayVisible(false), 1400);
  }, []);

  const processText = useCallback((text: string) => {
    if (text.trim() === lastProcessedText.current) return;
    lastProcessedText.current = text.trim();
    const codes = extractCodes(text);
    if (!codes.length) return;
    setInputValue("");
    codes.forEach((code) => {
      setScannedIds((prev) => {
        if (prev.includes(code)) { showPopup(code, "dup"); return prev; }
        const status: ScanStatus = urgentTrackingSet[code] ? "found" : "unknown";
        showPopup(code, status);
        return [...prev, code];
      });
    });
    setTimeout(() => { lastProcessedText.current = ""; }, 50);
  }, [urgentTrackingSet, showPopup]);

  const handleScanInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInputValue(val);
    if (processTimeoutRef.current) clearTimeout(processTimeoutRef.current);
    processTimeoutRef.current = setTimeout(() => processText(val), 5);
  };

  const handleScanKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Tab" || e.key === "Enter") {
      e.preventDefault();
      processText(inputValue);
    }
  };

  // ── Jadlog scan ───────────────────────────────────────────────────────────
  const handleJadlogScanInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setJadlogInputValue(val);
    if (!val.includes("\n") && !val.includes("\r")) return;
    const lines = val.split(/[\n\r]+/).filter(Boolean);
    const newCodes: string[] = [];
    lines.forEach((line) => {
      const code = extractJadlogCode(line) || extractCodes(line)[0];
      if (!code) return;
      if (!jadlogCurrentCodes.includes(code) && !newCodes.includes(code)) {
        newCodes.push(code);
        playSound("success");
      } else {
        playSound("error");
      }
    });
    if (newCodes.length) setJadlogCurrentCodes((prev) => [...prev, ...newCodes]);
    setJadlogInputValue("");
  };

  const handleSaveJadlogSession = () => {
    if (!currentBipador) {
      toast.error("Selecione quem está bipando: BEATRIZ ou NICOLI");
      return;
    }
    if (!jadlogCurrentCodes.length) { toast.error("Nenhum código bipado"); return; }
    const session: JadlogSession = {
      id: generateId(),
      timestamp: Date.now(),
      codes: [...jadlogCurrentCodes],
      bipador: currentBipador,
    };
    setJadlogSessions((prev) => [session, ...prev]);
    setJadlogCurrentCodes([]);
    setJadlogActive(false);
    toast.success("Sessão Jadlog salva");
  };

  const handleCopyJadlogSession = (session: JadlogSession) => {
    copyToClipboard(session.codes.join("\n"));
    setJadlogCopied(session.id);
    setTimeout(() => setJadlogCopied(null), 2500);
  };

  // ── Countdown ─────────────────────────────────────────────────────────────
  const adjustCollectorHour = (delta: number) => {
    if (!collectorTime) { setCollectorTime(addMinutesToNow(0)); return; }
    const [hh, mm] = collectorTime.split(":").map(Number);
    const newH = ((hh + delta) + 24) % 24;
    setCollectorTime(`${String(newH).padStart(2, "0")}:${String(mm).padStart(2, "0")}`);
  };

  const adjustCollectorMinute = (delta: number) => {
    if (!collectorTime) { setCollectorTime(addMinutesToNow(0)); return; }
    const [hh, mm] = collectorTime.split(":").map(Number);
    let newM = mm + delta;
    let newH = hh;
    if (newM >= 60) { newH = (newH + 1) % 24; newM -= 60; }
    if (newM < 0) { newH = ((newH - 1) + 24) % 24; newM += 60; }
    setCollectorTime(`${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`);
  };

  // ── Pending PDFs ──────────────────────────────────────────────────────────
  const downloadPendingPDFs = async () => {
    if (!pdfBytes) return;
    const pending = (pdfPages || []).filter((p) => !scannedIds.includes(p.trackingId) && p.trackingId);
    if (!pending.length) { toast.info("Nenhum pedido pendente"); return; }
    const indexes = pending.map((p) => p.index);
    const products = [...new Set(pending.flatMap((p) => p.products))];
    try {
      await downloadFilteredPDF(pdfBytes, indexes, "Pendentes", addMoon, addBasketball, products);
    } catch (e: any) {
      toast.error(`Erro: ${e.message}`);
    }
  };

  // ── Close conference ──────────────────────────────────────────────────────
  const handleConfirmClose = () => {
    const user = getUser();
    const record: AuditRecord = {
      date: Date.now(),
      user: user?.username || "desconhecido",
      orderCount: allOrders.size,
      iMileCount: iMileOrders.filter((o) => o.trackingId).length,
      jadlogCount: jadlogOrders.filter((o) => o.trackingId).length,
      semRastreioCount: semRastreio.length,
      filterGroupsSummary: filterGroups.map((g) => ({
        label: g.label,
        count: g.pageIndexes.length,
        downloaded: g.downloaded,
      })),
      scannedCount: scannedIds.length,
      confirmedCount: confirmedIds.length,
      bipador: currentBipador,
      notSendingCodes: closeConference.notSendingCodes,
      notSendingReason: closeConference.notSendingReason,
    };
    try {
      const existing: AuditRecord[] = JSON.parse(localStorage.getItem("pacotes_urgentes_audits") || "[]");
      localStorage.setItem("pacotes_urgentes_audits", JSON.stringify([record, ...existing].slice(0, 60)));
    } catch {}
    setCloseConference({ open: false, isJadlog: null, reason: "", notSendingCodes: [], notSendingReason: "", notSendingInput: "" });
    setFlowClosed(true);
    toast.success("Conferência encerrada e auditoria salva");
  };

  // ── Overlay colors ────────────────────────────────────────────────────────
  const overlayColor =
    overlayState?.status === "found"
      ? "bg-green-500"
      : overlayState?.status === "dup"
      ? "bg-red-500"
      : "bg-amber-500";

  const overlayText =
    overlayState?.status === "found"
      ? "URGENTE CONFIRMADO"
      : overlayState?.status === "dup"
      ? "JÁ BIPADO"
      : "NÃO ESTÁ NA LISTA";

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6 pb-10">
      {/* Audio */}
      <audio ref={audioSuccessRef} src="/sounds/bipado.mp3" preload="auto" />
      <audio ref={audioErrorRef} src="/sounds/erro.mp3" preload="auto" />

      {/* Scan overlay */}
      {overlayState && (
        <div
          className={cn(
            "fixed inset-0 z-50 flex flex-col items-center justify-center transition-opacity duration-200",
            overlayColor,
            overlayVisible ? "opacity-90" : "opacity-0 pointer-events-none"
          )}
        >
          <span className="text-white text-4xl font-black tracking-widest">{overlayText}</span>
          <span className="text-white/80 text-lg mt-2 font-mono">{overlayState.id}</span>
        </div>
      )}

      {/* Admin modal */}
      {adminModalOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50">
          <div className="bg-background rounded-xl shadow-xl p-6 w-80 flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              <span className="font-semibold">
                {pendingAdminAction === "confirmarTodos" ? "Confirmar todos os pacotes" :
                 pendingAdminAction === "redownload" ? "Baixar novamente" :
                 "Senha de administrador"}
              </span>
            </div>
            <input
              type="password"
              className="border rounded-md px-3 py-2 text-sm w-full"
              placeholder="Digite a senha"
              value={adminPasswordInput}
              onChange={(e) => { setAdminPasswordInput(e.target.value); setAdminPasswordError(false); }}
              onKeyDown={(e) => e.key === "Enter" && handleAdminPasswordSubmit()}
              autoFocus
            />
            {adminPasswordError && (
              <p className="text-red-500 text-xs">Senha incorreta</p>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setAdminModalOpen(false)}>
                Cancelar
              </Button>
              <Button size="sm" onClick={handleAdminPasswordSubmit}>
                Confirmar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Close conference dialog */}
      {closeConference.open && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50">
          <div className="bg-background rounded-xl shadow-xl p-6 w-[480px] max-w-[95vw] flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
            <h3 className="font-semibold text-lg">Fechar Conferência</h3>

            {/* Pacotes que não serão enviados */}
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">Pacotes que NÃO serão enviados hoje:</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="border rounded-md px-3 py-2 text-sm flex-1 font-mono"
                  placeholder="Bipe ou cole o código"
                  value={closeConference.notSendingInput}
                  onChange={(e) => setCloseConference((s) => ({ ...s, notSendingInput: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === "Tab") {
                      e.preventDefault();
                      const val = closeConference.notSendingInput.trim();
                      if (val && !closeConference.notSendingCodes.includes(val)) {
                        setCloseConference((s) => ({ ...s, notSendingCodes: [...s.notSendingCodes, val], notSendingInput: "" }));
                      } else {
                        setCloseConference((s) => ({ ...s, notSendingInput: "" }));
                      }
                    }
                  }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const val = closeConference.notSendingInput.trim();
                    if (val && !closeConference.notSendingCodes.includes(val)) {
                      setCloseConference((s) => ({ ...s, notSendingCodes: [...s.notSendingCodes, val], notSendingInput: "" }));
                    }
                  }}
                >
                  +
                </Button>
              </div>
              {closeConference.notSendingCodes.length > 0 && (
                <div className="flex flex-col gap-1 max-h-28 overflow-y-auto border rounded-md p-2">
                  {closeConference.notSendingCodes.map((code) => (
                    <div key={code} className="flex items-center gap-2 text-xs font-mono">
                      <span className="flex-1">{code}</span>
                      <button
                        className="text-red-500 hover:text-red-700 text-xs"
                        onClick={() => setCloseConference((s) => ({ ...s, notSendingCodes: s.notSendingCodes.filter((c) => c !== code) }))}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {closeConference.notSendingCodes.length > 0 && (
                <textarea
                  className="border rounded-md px-3 py-2 text-sm w-full h-16 resize-none"
                  placeholder="Motivo (ex.: sem etiqueta, avaria, devolução)"
                  value={closeConference.notSendingReason}
                  onChange={(e) => setCloseConference((s) => ({ ...s, notSendingReason: e.target.value }))}
                />
              )}
            </div>

            <p className="text-sm font-medium">EXISTEM PEDIDOS QUE NÃO ESTÃO SENDO ENVIADOS HOJE?</p>
            <div className="flex gap-3">
              <button
                onClick={() => setCloseConference((s) => ({ ...s, isJadlog: true }))}
                className={cn(
                  "flex-1 py-2 rounded-md border text-sm font-medium transition-colors",
                  closeConference.isJadlog === true
                    ? "bg-amber-500 text-white border-amber-500"
                    : "hover:bg-accent"
                )}
              >
                Sim
              </button>
              <button
                onClick={() => setCloseConference((s) => ({ ...s, isJadlog: false, reason: "" }))}
                className={cn(
                  "flex-1 py-2 rounded-md border text-sm font-medium transition-colors",
                  closeConference.isJadlog === false
                    ? "bg-green-500 text-white border-green-500"
                    : "hover:bg-accent"
                )}
              >
                Não
              </button>
            </div>
            {closeConference.isJadlog === true && (
              <textarea
                className="border rounded-md px-3 py-2 text-sm w-full h-20 resize-none"
                placeholder="Motivo obrigatório (ex.: motorista atrasado)"
                value={closeConference.reason}
                onChange={(e) => setCloseConference((s) => ({ ...s, reason: e.target.value }))}
              />
            )}
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCloseConference({ open: false, isJadlog: null, reason: "", notSendingCodes: [], notSendingReason: "", notSendingInput: "" })}
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                disabled={
                  closeConference.isJadlog === null ||
                  (closeConference.isJadlog === true && !closeConference.reason.trim())
                }
                onClick={handleConfirmClose}
              >
                Confirmar e Fechar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between">
        <PageHeader
          title="Pacotes Urgentes"
          description="TikTok Shop · Fluxo completo de expedição"
          icon={<Package className="h-8 w-8 text-primary" />}
        />
        {hasOrders && pageTab === "urgentes" && (
          <Button variant="outline" size="sm" onClick={handleClearAll} className="mt-1">
            <Trash2 className="h-4 w-4 mr-1" /> Limpar sessão
          </Button>
        )}
      </div>

      {/* Tab navigation */}
      <div className="flex gap-2">
        <Button
          variant={pageTab === "urgentes" ? "default" : "outline"}
          onClick={() => setPageTab("urgentes")}
          className={cn(pageTab === "urgentes" ? "bg-green-700 hover:bg-green-800 text-white" : "border-zinc-700 text-zinc-300 hover:bg-zinc-800")}
        >
          <AlertTriangle className="mr-2 h-4 w-4" /> Pacotes Urgentes
        </Button>
        <Button
          variant={pageTab === "expedicao" ? "default" : "outline"}
          onClick={() => setPageTab("expedicao")}
          className={cn(pageTab === "expedicao" ? "bg-blue-600 hover:bg-blue-700 text-white" : "border-zinc-700 text-zinc-300 hover:bg-zinc-800")}
        >
          <Truck className="mr-2 h-4 w-4" /> Expedição Diária
        </Button>
      </div>

      {/* ── EXPEDICAO DIARIA TAB ─────────────────────────────────────────── */}
      {pageTab === "expedicao" && (
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5" /> Upload de Etiquetas (ML + TikTok)
              </CardTitle>
              <CardDescription>Carregue os PDFs de etiquetas misturadas para separar por tipo de kit</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div
                className={cn(
                  "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
                  expIsDragging ? "border-blue-500 bg-blue-500/5" : "border-muted-foreground/30 hover:border-blue-500/50"
                )}
                onDragOver={(e) => { e.preventDefault(); setExpIsDragging(true); }}
                onDragLeave={() => setExpIsDragging(false)}
                onDrop={handleExpPDFDrop}
                onClick={() => expPdfInputRef.current?.click()}
              >
                <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Arraste os PDFs de etiquetas ou clique para selecionar</p>
                <p className="text-xs text-muted-foreground mt-1">Suporta múltiplos PDFs (ML + TikTok misturados)</p>
              </div>
              <input
                ref={expPdfInputRef}
                type="file"
                accept=".pdf"
                multiple
                className="hidden"
                onChange={(e) => e.target.files && handleExpPDFFiles(e.target.files)}
              />
              {expPdfFileNames.length > 0 && (
                <ul className="space-y-1">
                  {expPdfFileNames.map((name, i) => (
                    <li key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <FileText className="h-3 w-3 shrink-0" />
                      <span className="truncate">{name}</span>
                    </li>
                  ))}
                </ul>
              )}
              {expIsPDFProcessing && (
                <div className="space-y-1">
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all duration-300"
                      style={{ width: `${expPdfProgress}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground text-center">{expPdfProgressText}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {expPdfBytes && !expIsPDFProcessing && expFilterGroups.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Filter className="h-5 w-5" /> Fila de Impressão por Kit
                </CardTitle>
                <CardDescription>
                  {expFilterGroups.filter((g) => g.downloaded).length}/{expFilterGroups.length} grupos baixados
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Icon toggles */}
                <div className="flex gap-4 text-sm">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={expAddMoon} onChange={(e) => setExpAddMoon(e.target.checked)} className="accent-blue-500" />
                    Ícone lua (LUA)
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={expAddBasketball} onChange={(e) => setExpAddBasketball(e.target.checked)} className="accent-blue-500" />
                    Ícone bola (NBA)
                  </label>
                </div>

                {/* Group list */}
                <div className="space-y-2">
                  {expFilterGroups.map((g) => (
                    <div
                      key={g.id}
                      className={cn(
                        "flex items-center justify-between p-3 rounded-lg border",
                        g.downloaded ? "border-green-800 bg-green-950/20" : "border-slate-700 bg-slate-900"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={expSelectedGroupIds.has(g.id)}
                          onChange={() => {
                            setExpSelectedGroupIds((prev) => {
                              const next = new Set(prev);
                              next.has(g.id) ? next.delete(g.id) : next.add(g.id);
                              return next;
                            });
                          }}
                          className="accent-blue-500"
                        />
                        <div>
                          <p className="font-semibold text-sm">{g.label}</p>
                          <p className="text-xs text-muted-foreground">{g.pageIndexes.length} página(s)</p>
                        </div>
                      </div>
                      <div className="flex gap-2 items-center">
                        {g.downloaded && (
                          <span className="text-xs text-green-400 font-medium">Baixado</span>
                        )}
                        <Button
                          size="sm"
                          variant={g.downloaded ? "outline" : "default"}
                          className={cn(!g.downloaded && "bg-blue-600 hover:bg-blue-700 text-white")}
                          onClick={() => handleExpDownloadGroup(g)}
                        >
                          <Download className="h-4 w-4 mr-1" /> PDF
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Bulk actions */}
                <div className="flex gap-2 flex-wrap pt-2 border-t border-slate-800">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setExpSelectedGroupIds(new Set(expFilterGroups.map((g) => g.id)))}
                  >
                    Selecionar Todos
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setExpSelectedGroupIds(new Set())}
                  >
                    Limpar Seleção
                  </Button>
                  <Button
                    size="sm"
                    disabled={expSelectedGroupIds.size === 0}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                    onClick={handleExpDownloadSelected}
                  >
                    <Download className="h-4 w-4 mr-1" /> Baixar Selecionados ({expSelectedGroupIds.size})
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ── PACOTES URGENTES TAB ─────────────────────────────────────────── */}
      {pageTab === "urgentes" && (
        <>

      {/* ── PASSO 1: Upload CSVs ─────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <StepBadge n={1} done={hasOrders} />
            Upload dos CSVs do TikTok
          </CardTitle>
          <CardDescription>Até 9 arquivos (3 categorias × 3 contas)</CardDescription>
        </CardHeader>
        <CardContent>
          <div
            className={cn(
              "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
              isDraggingCSV ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:border-primary/50"
            )}
            onDragOver={(e) => { e.preventDefault(); setIsDraggingCSV(true); }}
            onDragLeave={() => setIsDraggingCSV(false)}
            onDrop={handleCSVDrop}
            onClick={() => csvInputRef.current?.click()}
          >
            <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Arraste os CSVs aqui ou clique para selecionar
            </p>
          </div>
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && processCSVFiles(e.target.files)}
          />
          {uploadedFiles.length > 0 && (
            <ul className="mt-3 space-y-1">
              {uploadedFiles.map((f, i) => (
                <li key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <FileText className="h-3 w-3 shrink-0" />
                  <span className="truncate">{f.name}</span>
                  <span className="ml-auto text-green-600 font-medium">+{f.orderCount}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ── Passos 2–6 (só se tiver pedidos) ────────────────────────────── */}
      {hasOrders && (
        <>
          {/* PASSO 2: Pedidos identificados */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <StepBadge n={2} />
                Pedidos identificados
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-center gap-4">
                <span className="text-5xl font-black tabular-nums">{allOrders.size}</span>
                <Button
                  variant={copiedIds ? "default" : "outline"}
                  size="sm"
                  onClick={handleCopyIds}
                  className={cn(copiedIds && "bg-green-500 border-green-500 text-white")}
                >
                  {copiedIds ? <CheckCheck className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
                  Copiar Order IDs
                </Button>
              </div>

              <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Confirme o total na Upseller antes de gerar as etiquetas
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border p-3 bg-blue-50 dark:bg-blue-950/20">
                  <p className="text-xs text-muted-foreground">iMile</p>
                  <p className="text-2xl font-bold text-blue-600">{iMileOrders.length}</p>
                </div>
                <div className="rounded-lg border p-3 bg-purple-50 dark:bg-purple-950/20">
                  <p className="text-xs text-muted-foreground">JadLog</p>
                  <p className="text-2xl font-bold text-purple-600">{jadlogOrders.length}</p>
                </div>
                <div className="rounded-lg border p-3 bg-amber-50 dark:bg-green-950/20">
                  <p className="text-xs text-muted-foreground">J&T Express</p>
                  <p className="text-2xl font-bold text-amber-600">{ordersArr.filter((o) => /j&t|j\s*&\s*t/i.test(o.provider)).length}</p>
                </div>
                <div className="rounded-lg border p-3 bg-gray-50 dark:bg-gray-900/50">
                  <p className="text-xs text-muted-foreground">Sem rastreio</p>
                  <p className="text-2xl font-bold text-gray-500">{semRastreio.length}</p>
                </div>
              </div>

              {skuRows.length > 0 && (
                <div>
                  <button
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setShowSkuTable((v) => !v)}
                  >
                    {showSkuTable ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    Breakdown por SKU
                  </button>
                  {showSkuTable && (
                    <table className="mt-2 w-full text-xs border-collapse">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-1 pr-4">SKU</th>
                          <th className="text-right py-1">Qtd</th>
                        </tr>
                      </thead>
                      <tbody>
                        {skuRows.map(([sku, count]) => (
                          <tr key={sku} className="border-b border-muted">
                            <td className="py-1 pr-4 font-mono">{sku}</td>
                            <td className="py-1 text-right font-bold">{count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* PASSO 3: Etiquetas por transportadora */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <StepBadge n={3} done={!!pdfPages} />
                Etiquetas por transportadora
              </CardTitle>
              <CardDescription>Upload do PDF gerado pela Upseller</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {/* Hint */}
              <div className="rounded-md bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 px-3 py-2 text-xs text-green-700 dark:text-green-300 flex items-center gap-2">
                <Truck className="h-3.5 w-3.5 shrink-0" />
                Baixe iMile primeiro, depois JadLog
              </div>

              {/* Countdown Marcos */}
              <div className="rounded-lg border p-3 flex flex-col gap-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  Coletor Marcos
                </div>
                <div className="flex flex-wrap gap-1">
                  {[30, 60, 90, 120, 180].map((min) => (
                    <button
                      key={min}
                      className="text-xs px-2 py-0.5 rounded border hover:bg-accent"
                      onClick={() => setCollectorTime(addMinutesToNow(min))}
                    >
                      +{min >= 60 ? `${min / 60}h` : `${min}m`}
                    </button>
                  ))}
                </div>
                {collectorTime && (
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="flex items-center gap-1">
                      <button className="text-xs px-1.5 py-0.5 rounded border" onClick={() => adjustCollectorHour(-1)}>▼</button>
                      <span className="font-mono text-sm font-bold">{collectorTime}</span>
                      <button className="text-xs px-1.5 py-0.5 rounded border" onClick={() => adjustCollectorHour(1)}>▲</button>
                    </div>
                    <div className="flex items-center gap-1">
                      <button className="text-xs px-1.5 py-0.5 rounded border" onClick={() => adjustCollectorMinute(-5)}>▼</button>
                      <span className="text-xs text-muted-foreground">±5min</span>
                      <button className="text-xs px-1.5 py-0.5 rounded border" onClick={() => adjustCollectorMinute(5)}>▲</button>
                    </div>
                    {countdown && (
                      <span className={cn("font-mono font-bold text-sm", countdown === "Chegou!" ? "text-green-500" : "text-primary")}>
                        {countdown}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* PDF Upload */}
              {!isPDFProcessing && (
                <div
                  className={cn(
                    "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
                    isDraggingPDF ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:border-primary/50"
                  )}
                  onDragOver={(e) => { e.preventDefault(); setIsDraggingPDF(true); }}
                  onDragLeave={() => setIsDraggingPDF(false)}
                  onDrop={handlePDFDrop}
                  onClick={() => pdfInputRef.current?.click()}
                >
                  <FileDown className="h-7 w-7 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Arraste o(s) PDF(s) ou clique para selecionar</p>
                  {pdfFileNames.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">{pdfFileNames.join(", ")}</p>
                  )}
                </div>
              )}
              <input
                ref={pdfInputRef}
                type="file"
                accept=".pdf"
                multiple
                className="hidden"
                onChange={(e) => e.target.files && handlePDFFiles(e.target.files)}
              />

              {isPDFProcessing && (
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{pdfProgressText}</span>
                    <span>{pdfProgress}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${pdfProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {pdfPages && (
                <div className="flex flex-col gap-3">
                  {/* Validation */}
                  <div className={cn(
                    "rounded-md px-3 py-2 text-xs flex items-center gap-2",
                    pdfValidation.ok
                      ? "bg-green-50 dark:bg-green-950/30 border border-green-200 text-green-700 dark:text-green-300"
                      : "bg-amber-50 dark:bg-amber-950/30 border border-amber-200 text-amber-700 dark:text-amber-300"
                  )}>
                    {pdfValidation.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                    PDF: {pdfValidation.pdfCount} páginas · CSV: {pdfValidation.csvCount} pedidos
                    {!pdfValidation.ok && ` · Diferença: ${pdfValidation.diff}`}
                  </div>

                  {/* Missing from PDF */}
                  {missingFromPDF.length > 0 && (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-green-950/20 p-3 flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-green-700 dark:text-green-400 flex items-center gap-1">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          {missingFromPDF.length} etiqueta(s) faltando no PDF
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-xs"
                          onClick={handleCopyMissingIds}
                        >
                          {copiedMissing ? <CheckCheck className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
                          Copiar IDs
                        </Button>
                      </div>
                      <ul className="text-xs text-amber-600 dark:text-green-500 space-y-0.5 max-h-24 overflow-y-auto">
                        {missingFromPDF.map((o) => (
                          <li key={o.orderId} className="font-mono">{o.orderId}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Carrier tiles */}
                  <div className="grid grid-cols-2 gap-3">
                    {/* iMile */}
                    <div className="rounded-lg border p-3 flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <Truck className="h-4 w-4 text-blue-500" />
                        <span className="text-sm font-medium">iMile</span>
                        <span className="ml-auto text-xl font-bold text-blue-600">{iMilePDFPages.length}</span>
                      </div>
                      <Button size="sm" variant="outline" className="text-xs" onClick={() => openTXTDownload("iMile")}>
                        <FileDown className="h-3 w-3 mr-1" /> Baixar TXT
                      </Button>
                      <Button size="sm" className="text-xs bg-blue-500 hover:bg-blue-600 text-white" onClick={() => downloadCarrierPDF("iMile", iMilePDFPages)}>
                        <Download className="h-3 w-3 mr-1" /> Baixar PDF
                      </Button>
                    </div>
                    {/* JadLog */}
                    <div className="rounded-lg border p-3 flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <Truck className="h-4 w-4 text-purple-500" />
                        <span className="text-sm font-medium">JadLog</span>
                        <span className="ml-auto text-xl font-bold text-purple-600">{jadlogPDFPages.length}</span>
                      </div>
                      <Button size="sm" variant="outline" className="text-xs" onClick={() => openTXTDownload("JadLog")}>
                        <FileDown className="h-3 w-3 mr-1" /> Baixar TXT
                      </Button>
                      <Button size="sm" className="text-xs bg-purple-500 hover:bg-purple-600 text-white" onClick={() => downloadCarrierPDF("JadLog", jadlogPDFPages)}>
                        <Download className="h-3 w-3 mr-1" /> Baixar PDF
                      </Button>
                    </div>
                    {/* J&T Express */}
                    {jtPDFPages.length > 0 && (
                      <div className="rounded-lg border p-3 flex flex-col gap-2 col-span-2 border-amber-200 bg-amber-50/30 dark:bg-green-950/10">
                        <div className="flex items-center gap-2">
                          <Truck className="h-4 w-4 text-amber-500" />
                          <span className="text-sm font-medium">J&T Express</span>
                          <span className="ml-auto text-xl font-bold text-amber-600">{jtPDFPages.length}</span>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" className="text-xs flex-1" onClick={() => openTXTDownload("J&T")}>
                            <FileDown className="h-3 w-3 mr-1" /> Baixar TXT
                          </Button>
                          <Button size="sm" className="text-xs flex-1 bg-green-700 hover:bg-green-800 text-white" onClick={() => downloadCarrierPDF("J&T", jtPDFPages)}>
                            <Download className="h-3 w-3 mr-1" /> Baixar PDF
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* PASSO 4: Filtrar e imprimir por SKU/Kit */}
          {pdfBytes && !isPDFProcessing && filterGroups.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <StepBadge n={4} done={doneGroups.length === filterGroups.length && filterGroups.length > 0} />
                  Filtrar e imprimir por SKU/Kit
                </CardTitle>
                <CardDescription>Selecione os grupos e baixe os PDFs</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 text-amber-700 dark:text-amber-300 px-3 py-2 text-xs flex items-center gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  NÃO bipe os códigos do PDF diretamente — use o scanner no Passo 5
                </div>

                {/* Icon checkboxes */}
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={addMoon} onChange={(e) => setAddMoon(e.target.checked)} />
                    🌙 Ícone Lua
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={addBasketball} onChange={(e) => setAddBasketball(e.target.checked)} />
                    🏀 Ícone Basquete
                  </label>
                </div>

                {/* Group list */}
                <div className="flex flex-col gap-1.5">
                  {filterGroups.map((g) => (
                    <label
                      key={g.id}
                      className={cn(
                        "flex items-center gap-2 p-2 rounded-md border cursor-pointer transition-colors",
                        g.downloaded ? "opacity-50 bg-green-50 dark:bg-green-950/20 border-green-200" : "hover:bg-accent"
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={selectedGroupIds.has(g.id)}
                        onChange={() => toggleGroupSelection(g.id)}
                      />
                      <span className="flex-1 text-sm">{g.label}</span>
                      <span className="text-xs text-muted-foreground">{g.pageIndexes.length} pág.</span>
                      {g.downloaded && (
                        <span className="text-xs bg-green-500 text-white px-1.5 py-0.5 rounded-full font-medium">
                          ✓
                        </span>
                      )}
                    </label>
                  ))}
                </div>

                <div className="flex gap-2 flex-wrap">
                  <button
                    className="text-xs underline text-muted-foreground"
                    onClick={() => setSelectedGroupIds(new Set(filterGroups.map((g) => g.id)))}
                  >
                    Todos
                  </button>
                  <button
                    className="text-xs underline text-muted-foreground"
                    onClick={() => setSelectedGroupIds(new Set())}
                  >
                    Nenhum
                  </button>
                </div>

                <div className="flex gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={selectedGroupIds.size === 0}
                    onClick={() => {
                      const sel = filterGroups.filter((g) => selectedGroupIds.has(g.id));
                      const idx = [...new Set(sel.flatMap((g) => g.pageIndexes))];
                      const prods = [...new Set(sel.flatMap((g) => g.products))];
                      const lbl = sel.length === 1 ? sel[0].label : `${sel.length}_grupos`;
                      previewFilteredPDF(idx, lbl, prods);
                    }}
                  >
                    <Filter className="h-4 w-4 mr-1" />
                    Visualizar ({selectedGroupIds.size})
                  </Button>
                  {(() => {
                    const sel = filterGroups.filter((g) => selectedGroupIds.has(g.id));
                    const allAlreadyDownloaded = sel.length > 0 && sel.every((g) => g.downloaded);
                    if (allAlreadyDownloaded) {
                      return (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={selectedGroupIds.size === 0}
                          onClick={() => openAdminModal("redownload")}
                          className="border-amber-400 text-amber-700 hover:bg-amber-50"
                        >
                          <Download className="h-4 w-4 mr-1" />
                          Baixar novamente ({selectedGroupIds.size})
                        </Button>
                      );
                    }
                    return (
                      <Button
                        size="sm"
                        disabled={selectedGroupIds.size === 0}
                        onClick={handleDownloadFiltered}
                      >
                        <Download className="h-4 w-4 mr-1" />
                        Baixar e marcar ({selectedGroupIds.size})
                      </Button>
                    );
                  })()}
                </div>

                {/* Done groups collapsible */}
                {doneGroups.length > 0 && (
                  <div>
                    <button
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setShowTaskList((v) => !v)}
                    >
                      {showTaskList ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      Fila de impressão ({doneGroups.length} concluídos)
                    </button>
                    {showTaskList && (
                      <ul className="mt-1 space-y-1">
                        {doneGroups.map((g) => (
                          <li key={g.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                            <CheckCircle2 className="h-3 w-3 text-green-500" />
                            {g.label} · {g.pageIndexes.length} pág.
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* PASSO 5: Conferir Pacotes Urgentes */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <StepBadge n={5} done={allConfirmed} />
                Conferir Pacotes Urgentes (Embalados)
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {/* Bipador selector for step 5 */}
              <div className="flex flex-col gap-2">
                <p className="text-xs text-muted-foreground">Realize a bipagem do pacote selecionando o responsável pela embalagem</p>
                <div className="flex gap-3">
                  {(["BEATRIZ", "NICOLI"] as Bipador[]).map((b) => (
                    <button
                      key={b}
                      className={cn(
                        "flex-1 py-2 rounded-lg border-2 font-bold text-sm transition-colors",
                        currentBipador === b
                          ? b === "BEATRIZ"
                            ? "bg-pink-500 border-pink-500 text-white"
                            : "bg-indigo-500 border-indigo-500 text-white"
                          : b === "BEATRIZ"
                            ? "border-muted hover:border-pink-400 hover:text-pink-600"
                            : "border-muted hover:border-indigo-400 hover:text-indigo-600"
                      )}
                      onClick={() => setCurrentBipador(b)}
                    >
                      {b}
                    </button>
                  ))}
                </div>
              </div>

              {/* Progress bar */}
              <div className="flex flex-col gap-1">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Confirmados</span>
                  <span className="font-bold">{confirmedIds.length}/{totalWithTracking}</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-green-500 transition-all"
                    style={{ width: totalWithTracking ? `${(confirmedIds.length / totalWithTracking) * 100}%` : "0%" }}
                  />
                </div>
              </div>

              {allConfirmed ? (
                <div className="rounded-md bg-green-50 dark:bg-green-950/30 border border-green-200 px-3 py-3 text-green-700 dark:text-green-300 flex items-center gap-2">
                  <CheckCheck className="h-4 w-4" />
                  <span className="font-medium">Todos os pacotes urgentes confirmados!</span>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <textarea
                    ref={scanInputRef}
                    className="w-full border rounded-md px-3 py-2 text-sm font-mono resize-none h-16 bg-background"
                    placeholder="Aguardando bipagem do scanner…"
                    value={inputValue}
                    onChange={handleScanInput}
                    onKeyDown={handleScanKeyDown}
                  />
                  <div className="flex gap-3 text-xs">
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" /> Urgente confirmado</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" /> Já bipado</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" /> Fora da lista</span>
                  </div>
                </div>
              )}

              {!allConfirmed && totalWithTracking > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="self-start border-green-400 text-green-700 hover:bg-green-50"
                  onClick={() => openAdminModal("confirmarTodos")}
                >
                  <CheckCheck className="h-4 w-4 mr-1" />
                  Confirmar todos ({totalWithTracking})
                </Button>
              )}

              {scannedIds.length > 0 && (
                <div>
                  <button
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setShowScannedList((v) => !v)}
                  >
                    {showScannedList ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    Bipados ({scannedIds.length})
                  </button>
                  {showScannedList && (
                    <ul className="mt-1 space-y-0.5 max-h-40 overflow-y-auto">
                      {scannedIds.map((id) => (
                        <li key={id} className="flex items-center gap-2 text-xs font-mono">
                          <span className={cn(
                            "w-2 h-2 rounded-full shrink-0",
                            urgentTrackingSet[id] ? "bg-green-500" : "bg-amber-500"
                          )} />
                          {id}
                        </li>
                      ))}
                    </ul>
                  )}
                  <button
                    className="text-xs text-red-500 hover:text-red-700 mt-1 underline"
                    onClick={() => { setScannedIds([]); setInputValue(""); }}
                  >
                    Limpar conferência
                  </button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* CARD Bipagem Jadlog */}
          <Card className="border-purple-300 dark:border-purple-700">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-purple-700 dark:text-purple-300">
                <ScanLine className="h-5 w-5" />
                Bipagem Jadlog
              </CardTitle>
              <CardDescription>Sessões por bipador</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {/* Bipador selector */}
              <div className="flex gap-3">
                <button
                  className={cn(
                    "flex-1 py-2.5 rounded-lg border-2 font-bold text-sm transition-colors",
                    currentBipador === "BEATRIZ"
                      ? "bg-pink-500 border-pink-500 text-white"
                      : "border-muted hover:border-pink-400 hover:text-pink-600"
                  )}
                  onClick={() => setCurrentBipador("BEATRIZ")}
                >
                  BEATRIZ
                </button>
                <button
                  className={cn(
                    "flex-1 py-2.5 rounded-lg border-2 font-bold text-sm transition-colors",
                    currentBipador === "NICOLI"
                      ? "bg-indigo-500 border-indigo-500 text-white"
                      : "border-muted hover:border-indigo-400 hover:text-indigo-600"
                  )}
                  onClick={() => setCurrentBipador("NICOLI")}
                >
                  NICOLI
                </button>
              </div>

              {!currentBipador && (
                <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 px-3 py-2 text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Selecione antes de iniciar
                </div>
              )}

              {!jadlogActive ? (
                <Button
                  className="bg-purple-600 hover:bg-purple-700 text-white"
                  disabled={!currentBipador}
                  onClick={() => setJadlogActive(true)}
                >
                  INICIAR BIPAGEM JADLOG{currentBipador ? ` — ${currentBipador}` : ""}
                </Button>
              ) : (
                <div className="flex flex-col gap-2">
                  <textarea
                    className="w-full border rounded-md px-3 py-2 text-sm font-mono resize-none h-16 bg-background"
                    placeholder="Aguardando QR code Jadlog…"
                    value={jadlogInputValue}
                    onChange={handleJadlogScanInput}
                    autoFocus
                  />
                  {jadlogCurrentCodes.length > 0 && (
                    <ul className="max-h-32 overflow-y-auto space-y-0.5">
                      {jadlogCurrentCodes.map((c) => (
                        <li key={c} className="text-xs font-mono text-purple-700 dark:text-purple-300 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-purple-500 inline-block" />
                          {c}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setJadlogActive(false); setJadlogCurrentCodes([]); setJadlogInputValue(""); }}>
                      Cancelar
                    </Button>
                    <Button
                      size="sm"
                      className="bg-purple-600 hover:bg-purple-700 text-white"
                      disabled={!jadlogCurrentCodes.length}
                      onClick={handleSaveJadlogSession}
                    >
                      Salvar Sessão ({jadlogCurrentCodes.length})
                    </Button>
                  </div>
                </div>
              )}

              {/* Sessions list */}
              {jadlogSessions.length > 0 && (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-muted-foreground">Sessões salvas</p>
                  {jadlogSessions.map((s) => (
                    <div key={s.id} className="flex items-center gap-2 rounded-md border px-3 py-2">
                      <span className="text-xs text-muted-foreground font-mono">
                        {new Date(s.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <span className="text-xs font-bold">{s.codes.length} cód.</span>
                      {s.bipador && (
                        <span className={cn(
                          "text-xs px-1.5 py-0.5 rounded-full font-medium",
                          s.bipador === "BEATRIZ" ? "bg-pink-100 text-pink-700" : "bg-indigo-100 text-indigo-700"
                        )}>
                          {s.bipador}
                        </span>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-auto h-6 text-xs"
                        onClick={() => handleCopyJadlogSession(s)}
                      >
                        {jadlogCopied === s.id ? <CheckCheck className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        {jadlogCopied === s.id ? "Copiado!" : "Copiar"}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* PASSO 6: Conferência final */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <StepBadge n={6} done={flowClosed} />
                Conferência final
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {flowClosed ? (
                <div className="rounded-md bg-green-50 dark:bg-green-950/30 border border-green-200 px-4 py-4 text-green-700 dark:text-green-300 flex flex-col gap-1">
                  <div className="flex items-center gap-2 font-semibold">
                    <CheckCheck className="h-4 w-4" /> Conferência encerrada
                  </div>
                  <p className="text-xs">
                    {allOrders.size} pedidos · {confirmedIds.length}/{totalWithTracking} bipados
                    {currentBipador && ` · Bipador: ${currentBipador}`}
                  </p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="rounded-lg border p-2">
                      <p className="text-xs text-muted-foreground">Pedidos</p>
                      <p className="text-xl font-bold">{allOrders.size}</p>
                    </div>
                    <div className="rounded-lg border p-2">
                      <p className="text-xs text-muted-foreground">Confirmados</p>
                      <p className="text-xl font-bold text-green-600">{confirmedIds.length}</p>
                    </div>
                    <div className="rounded-lg border p-2">
                      <p className="text-xs text-muted-foreground">Impressos</p>
                      <p className="text-xl font-bold">{doneGroups.length}/{filterGroups.length}</p>
                    </div>
                  </div>

                  {pendingGroups.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {pendingGroups.map((g) => (
                        <span key={g.id} className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full">
                          {g.label}
                        </span>
                      ))}
                    </div>
                  )}

                  {pdfPages && scannedIds.length < totalWithTracking && (
                    <Button variant="outline" size="sm" onClick={downloadPendingPDFs}>
                      <FileDown className="h-4 w-4 mr-1" />
                      Baixar PDFs Pendentes ({totalWithTracking - confirmedIds.length} não bipados)
                    </Button>
                  )}

                  <Button
                    className="w-full"
                    onClick={() => setCloseConference({ open: true, isJadlog: null, reason: "", notSendingCodes: [], notSendingReason: "", notSendingInput: "" })}
                  >
                    <ClipboardList className="h-4 w-4 mr-2" />
                    Fechar conferência e salvar auditoria
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}
      </>
      )}
    </div>
  );
}
