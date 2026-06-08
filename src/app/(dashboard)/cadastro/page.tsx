"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input, Label } from "@/components/ui/form-elements";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { Switch } from "@/components/ui/switch";
import { QRCodeSVG } from "qrcode.react";
import {
  Package,
  Printer,
  Upload,
  Trash2,
  Plus,
  Loader2,
  ListPlus,
  FileText,
  Pencil,
  AlertCircle,
  Tag,
  Factory,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { generateId } from "@/lib/utils";
import { useSession } from "@/lib/auth-client";

type PrintQueueItem = {
  id: string;
  sku: string;
  lote: string;
  qtd: number;
  codigoFardo: string;
  criadoEm: string; // ISO timestamp (UTC)
  criadoPor: string; // nome ou email do usuário, sanitizado
};

type LoteCadastrado = {
  id: string;
  nome: string;
  createdAt: string;
};

type SkuCatalogo = {
  id: string;
  codigo: string;
  contaId: string;
  createdAt: string;
};

function gerarCodigoFardo(): string {
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let rand = "";
  for (let i = 0; i < 5; i++) rand += chars[Math.floor(Math.random() * chars.length)];
  return `F-${date}-${rand}`;
}

function normalizeSku(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, " ");
}

// Remove caracteres que poderiam conflitar com o separador `}` / `|` do
// payload do QR. Mantém letras (incl. acentuadas), números, espaço, ponto,
// underscore e hífen.
function sanitizarLabelUsuario(raw: string): string {
  return raw.replace(/[}|]/g, "_").trim().slice(0, 80) || "desconhecido";
}

export default function CadastroEstoque() {
  const { data: session } = useSession();
  const userLabel = useMemo(
    () =>
      sanitizarLabelUsuario(
        session?.user?.name ?? session?.user?.email ?? "",
      ),
    [session],
  );

  // SKU input
  const [skuInput, setSkuInput] = useState("");
  const [skuCatalogo, setSkuCatalogo] = useState<SkuCatalogo[]>([]);
  const [isLoadingSkus, setIsLoadingSkus] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // SKU registration dialog
  const [isAddingSku, setIsAddingSku] = useState(false);
  const [newSkuCodigo, setNewSkuCodigo] = useState("");
  const [isCreatingSku, setIsCreatingSku] = useState(false);

  // Lote state
  const [lote, setLote] = useState("ESTOQUE PADRAO");
  const [customLotes, setCustomLotes] = useState<LoteCadastrado[]>([]);
  const [newLoteName, setNewLoteName] = useState("");
  const [isAddingLote, setIsAddingLote] = useState(false);
  const [isLoadingLotes, setIsLoadingLotes] = useState(false);
  const [isCreatingLote, setIsCreatingLote] = useState(false);

  // RITM-24 — modo de seleção de lote (custom + OP de Confecção)
  type LoteMode = "default" | "custom" | "op";
  const [loteMode, setLoteMode] = useState<LoteMode>("default");
  const [opQuery, setOpQuery] = useState("");
  const [opResults, setOpResults] = useState<
    Array<{
      id: string;
      numero: string;
      status: string;
      produtoNome: string;
    }>
  >([]);
  const [isSearchingOps, setIsSearchingOps] = useState(false);
  const [opSelecionada, setOpSelecionada] = useState<{
    id: string;
    numero: string;
    produtoNome: string;
  } | null>(null);

  // Quantity state
  const [qtd, setQtd] = useState("");
  const [quantidadeFardos, setQuantidadeFardos] = useState("1");
  const [isFardoAgrupado, setIsFardoAgrupado] = useState(false);

  // Print queue
  const [printQueue, setPrintQueue] = useState<PrintQueueItem[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [clearQueueDialogOpen, setClearQueueDialogOpen] = useState(false);
  // Ref espelha o printQueue pra ler o estado fresco dentro do setTimeout
  // (que captura o state do render no qual foi agendado).
  const printQueueRef = useRef(printQueue);
  useEffect(() => {
    printQueueRef.current = printQueue;
  }, [printQueue]);

  // TXT import state
  const [isTxtDialogOpen, setIsTxtDialogOpen] = useState(false);
  const [txtInput, setTxtInput] = useState("");
  const [txtPreview, setTxtPreview] = useState<
    Array<{ sku: string; qtd: number; novo: boolean }>
  >([]);
  const [txtErrors, setTxtErrors] = useState<string[]>([]);
  const txtFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchLotes();
    fetchSkus();
  }, []);

  const fetchLotes = async () => {
    setIsLoadingLotes(true);
    try {
      const res = await fetch("/api/lotes");
      if (!res.ok) throw new Error("Falha ao buscar lotes");
      const data = await res.json();
      setCustomLotes(data.lotes);
    } catch {
      toast.error("Erro ao carregar lotes");
    } finally {
      setIsLoadingLotes(false);
    }
  };

  const fetchSkus = async () => {
    setIsLoadingSkus(true);
    try {
      const res = await fetch("/api/sku-catalogo?apenasUnitarios=1");
      if (!res.ok) throw new Error("Falha ao buscar SKUs");
      const data = await res.json();
      setSkuCatalogo(data.skus ?? []);
    } catch {
      toast.error("Erro ao carregar catalogo de SKUs");
    } finally {
      setIsLoadingSkus(false);
    }
  };

  const skuCodigoSet = useMemo(
    () => new Set(skuCatalogo.map((s) => s.codigo.toUpperCase())),
    [skuCatalogo]
  );

  const suggestions = useMemo(() => {
    const q = skuInput.trim().toUpperCase();
    if (!q) return skuCatalogo.slice(0, 8);
    return skuCatalogo
      .filter((s) => s.codigo.toUpperCase().includes(q))
      .slice(0, 8);
  }, [skuInput, skuCatalogo]);

  // Busca debounced de OPs quando em modo "op"
  useEffect(() => {
    if (loteMode !== "op") return;
    const ctrl = new AbortController();
    const handle = setTimeout(async () => {
      setIsSearchingOps(true);
      try {
        const url = new URL("/api/confeccao/ops/lookup", window.location.origin);
        if (opQuery.trim()) url.searchParams.set("q", opQuery.trim());
        const res = await fetch(url.toString(), { signal: ctrl.signal });
        if (!res.ok) throw new Error("Falha ao buscar OPs");
        const data = await res.json();
        setOpResults(data.ops ?? []);
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") {
          setOpResults([]);
        }
      } finally {
        setIsSearchingOps(false);
      }
    }, 250);
    return () => {
      ctrl.abort();
      clearTimeout(handle);
    };
  }, [loteMode, opQuery]);

  const handleSelectOp = async (op: {
    id: string;
    numero: string;
    produtoNome: string;
  }) => {
    setOpSelecionada(op);
    setOpResults([]);
    setOpQuery("");
    try {
      const res = await fetch(
        `/api/confeccao/ops/${encodeURIComponent(op.numero)}/vincular-lote`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error("Falha ao vincular lote");
      const data = await res.json();
      setLote(op.numero);
      // Atualiza o cache local de lotes pro selector tradicional refletir.
      setCustomLotes((prev) => {
        const semNovo = prev.filter((l) => l.id !== data.lote.id);
        return [
          ...semNovo,
          {
            id: data.lote.id,
            nome: data.lote.nome,
            createdAt: new Date().toISOString(),
          },
        ];
      });
      toast.success(`Lote vinculado à OP ${op.numero}`);
    } catch {
      toast.error("Erro ao vincular lote à OP");
      setOpSelecionada(null);
    }
  };

  const handleLoteModeChange = (mode: LoteMode) => {
    setLoteMode(mode);
    setOpSelecionada(null);
    setOpQuery("");
    setOpResults([]);
    if (mode === "default") setLote("ESTOQUE PADRAO");
    // Em "custom" não força lote — usuário escolhe no dropdown.
    // Em "op" começa vazio até selecionar.
    if (mode === "op") setLote("");
  };

  const handleAddLote = async () => {
    if (!newLoteName.trim()) return;
    setIsCreatingLote(true);
    try {
      const res = await fetch("/api/lotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: newLoteName }),
      });
      if (res.status === 409) {
        toast.error("Lote ja existe!");
        return;
      }
      if (!res.ok) throw new Error("Falha ao criar lote");
      const newLote = await res.json();
      setCustomLotes((prev) => [...prev, newLote]);
      setLote(newLote.nome);
      setNewLoteName("");
      setIsAddingLote(false);
      toast.success("Lote adicionado!");
    } catch {
      toast.error("Erro ao criar lote");
    } finally {
      setIsCreatingLote(false);
    }
  };

  const handleCreateSku = async (codigoOverride?: string): Promise<SkuCatalogo | null> => {
    const codigo = normalizeSku(codigoOverride ?? newSkuCodigo);
    if (!codigo) return null;
    setIsCreatingSku(true);
    try {
      const res = await fetch("/api/sku-catalogo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo }),
      });
      if (res.status === 409) {
        toast.error("SKU ja existe no catalogo");
        return null;
      }
      if (!res.ok) {
        const { error: serverError } = await res.json().catch(() => ({}));
        throw new Error(serverError || "Falha ao criar SKU");
      }
      const created = (await res.json()) as SkuCatalogo;
      setSkuCatalogo((prev) =>
        [...prev, created].sort((a, b) => a.codigo.localeCompare(b.codigo))
      );
      toast.success(`SKU "${created.codigo}" cadastrado!`);
      if (!codigoOverride) {
        setNewSkuCodigo("");
        setIsAddingSku(false);
      }
      return created;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao cadastrar SKU";
      toast.error(msg);
      return null;
    } finally {
      setIsCreatingSku(false);
    }
  };

  const handleAddToQueue = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();

    const sku = normalizeSku(skuInput);
    if (!sku) {
      toast.error("Informe o SKU!");
      return;
    }
    if (!qtd) {
      toast.error("Informe a quantidade!");
      return;
    }
    if (!quantidadeFardos || parseInt(quantidadeFardos) < 1) {
      toast.error("Informe a quantidade de fardos!");
      return;
    }

    const qtdFardos = parseInt(quantidadeFardos);
    const qtdUnidades = parseInt(qtd);

    const newItems: PrintQueueItem[] = [];
    const criadoEm = new Date().toISOString();
    for (let i = 0; i < qtdFardos; i++) {
      newItems.push({
        id: generateId(),
        sku,
        lote,
        qtd: qtdUnidades,
        codigoFardo: gerarCodigoFardo(),
        criadoEm,
        criadoPor: userLabel,
      });
    }

    setPrintQueue([...printQueue, ...newItems]);
    const isNew = !skuCodigoSet.has(sku);
    toast.success(`${qtdFardos} fardo(s) adicionado(s) a fila!`, {
      description: `${qtdUnidades} unidades cada - ${sku}${isNew ? " (SKU novo)" : ""}`,
    });

    setQtd("");
    setQuantidadeFardos("1");
  };

  const handleRemoveFromQueue = (id: string) => {
    setPrintQueue(printQueue.filter((item) => item.id !== id));
    toast.info("Item removido da fila.");
  };

  const parseTxtLines = (text: string) => {
    const lines = text.split("\n");
    const items: Array<{ sku: string; qtd: number; novo: boolean }> = [];
    const errors: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const tokens = line.split(/\s+/);
      // Find first token that is a positive integer — everything before is the SKU
      let qtyStartIdx = -1;
      for (let j = 1; j < tokens.length; j++) {
        if (/^\d+$/.test(tokens[j])) {
          qtyStartIdx = j;
          break;
        }
      }
      if (qtyStartIdx === -1) {
        errors.push(`Linha ${i + 1}: "${line}" -- sem quantidades numericas`);
        continue;
      }

      const sku = normalizeSku(tokens.slice(0, qtyStartIdx).join(" "));
      if (!sku) {
        errors.push(`Linha ${i + 1}: "${line}" -- SKU vazio`);
        continue;
      }
      const novo = !skuCodigoSet.has(sku);

      const quantities = tokens.slice(qtyStartIdx);
      for (const q of quantities) {
        const qtdNum = parseInt(q);
        if (isNaN(qtdNum) || qtdNum <= 0) {
          errors.push(
            `Linha ${i + 1}: quantidade "${q}" invalida para ${sku}`
          );
          continue;
        }
        items.push({ sku, qtd: qtdNum, novo });
      }
    }

    return { items, errors };
  };

  const handleTxtChange = (text: string) => {
    setTxtInput(text);
    const { items, errors } = parseTxtLines(text);
    setTxtPreview(items);
    setTxtErrors(errors);
  };

  const handleTxtFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setTxtInput(text);
      handleTxtChange(text);
    };
    reader.readAsText(file, "UTF-8");
    e.target.value = "";
  };

  const handleImportTxt = async () => {
    if (txtPreview.length === 0) return;

    // Auto-cadastra SKUs novos (uma vez por código)
    const novosUnicos = Array.from(
      new Set(txtPreview.filter((i) => i.novo).map((i) => i.sku))
    );
    if (novosUnicos.length > 0) {
      for (const codigo of novosUnicos) {
        await handleCreateSku(codigo);
      }
    }

    const criadoEm = new Date().toISOString();
    const newItems: PrintQueueItem[] = txtPreview.map((item) => ({
      id: generateId(),
      sku: item.sku,
      lote,
      qtd: item.qtd,
      codigoFardo: gerarCodigoFardo(),
      criadoEm,
      criadoPor: userLabel,
    }));
    setPrintQueue((prev) => [...prev, ...newItems]);
    toast.success(`${newItems.length} fardos importados!`, {
      description: `${new Set(txtPreview.map((i) => i.sku)).size} SKUs diferentes`,
    });
    setTxtInput("");
    setTxtPreview([]);
    setTxtErrors([]);
    setIsTxtDialogOpen(false);
  };

  // Payload do QR: SKU}LOTE}QTD}CODIGO_FARDO}ISO_CRIACAO}USUARIO}UUID
  // Mantém compatibilidade com parseQRCode (estante-utils.ts), que só lê os
  // 3 primeiros campos (SKU, LOTE, QTD). Campos adicionais são metadados
  // de rastreamento (quem criou, quando). O UUID final (item.id) garante
  // unicidade absoluta — dois QRs nunca colidem mesmo com mesmos SKU/LOTE.
  const getQrPayload = (item: PrintQueueItem) =>
    `${item.sku}}${item.lote}}${item.qtd}}${item.codigoFardo}}${item.criadoEm}}${item.criadoPor}}${item.id}`;

  const itemsPerPage = isFardoAgrupado ? 1 : 4;
  const pages: PrintQueueItem[][] = [];
  for (let i = 0; i < printQueue.length; i += itemsPerPage) {
    pages.push(printQueue.slice(i, i + itemsPerPage));
  }

  const handlePrint = () => {
    if (printQueue.length === 0) return;

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      toast.error("Popup bloqueado. Permita popups para imprimir.");
      return;
    }

    const pagesHtml = pages
      .map((pageItems) => {
        const itemsHtml = pageItems
          .map((item) => {
            const svgEl = document.querySelector(
              `#qr-print-${item.id}`
            ) as SVGSVGElement;
            const svgData = svgEl
              ? new XMLSerializer().serializeToString(svgEl)
              : "";

            if (isFardoAgrupado) {
              return `<div class="item-agrupado">
                <div class="qr-container">${svgData}</div>
                <div class="info-agrupado">
                  <div class="sku-agrupado">${item.sku}</div>
                  <div class="qtd-agrupado">${item.qtd}</div>
                  <div class="lote-agrupado">${item.lote}</div>
                </div>
              </div>`;
            }

            return `<div class="item-normal">
              <div class="qr-container-small">${svgData}</div>
              <div class="info-normal">
                <div class="qtd-normal">${item.qtd}</div>
                <div class="sku-normal">${item.sku}</div>
                <div class="lote-normal">${item.lote}</div>
              </div>
            </div>`;
          })
          .join("");

        const pageClass = isFardoAgrupado ? "page-agrupado" : "page-normal";
        return `<div class="${pageClass}">${itemsHtml}</div>`;
      })
      .join("");

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @page { size: 10cm 15cm; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; background: white; color: black; }

    .page-normal {
      width: 10cm; height: 15cm; margin: 0 auto;
      display: grid; grid-template-rows: repeat(4, 1fr);
      page-break-after: always;
    }
    .item-normal {
      display: flex; align-items: center; justify-content: space-between;
      border-bottom: 1px dashed #ccc; padding: 4px 8px; height: 100%;
    }
    .item-normal:last-child { border-bottom: none; }
    .qr-container-small { flex-shrink: 0; }
    .qr-container-small svg { width: 90px; height: 90px; }
    .info-normal { flex: 1; text-align: right; padding-left: 12px; display: flex; flex-direction: column; justify-content: center; }
    .qtd-normal { font-size: 32px; font-weight: 900; line-height: 1; margin-bottom: 2px; }
    .sku-normal { font-size: 18px; font-weight: 700; font-family: monospace; }
    .lote-normal { font-size: 8px; color: #888; font-family: monospace; margin-top: 2px; }

    .page-agrupado {
      width: 10cm; height: 15cm; margin: 0 auto;
      display: flex; align-items: center; justify-content: center;
      page-break-after: always;
    }
    .item-agrupado {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      width: 100%; height: 100%; padding: 20px;
    }
    .qr-container { margin-bottom: 16px; }
    .qr-container svg { width: 280px; height: 280px; }
    .info-agrupado { text-align: center; }
    .sku-agrupado { font-size: 28px; font-weight: 700; font-family: monospace; margin-bottom: 8px; }
    .qtd-agrupado { font-size: 72px; font-weight: 900; line-height: 1; margin-bottom: 4px; }
    .lote-agrupado { font-size: 14px; color: #888; font-family: monospace; margin-top: 8px; }

    @media print {
      body { -webkit-print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  ${pagesHtml}
  <script>
    window.onload = function() { setTimeout(function() { window.print(); }, 500); };
  </script>
</body>
</html>`;

    printWindow.document.write(html);
    printWindow.document.close();

    setTimeout(() => {
      void (async () => {
        if (confirm("Salvar itens no estoque?")) {
          await saveToStock();
        }
        // Após o fluxo de salvamento, oferece limpar a fila. Só abre o popup
        // se ainda houver itens — quem salvou já teve a fila zerada por
        // saveToStock e não precisa do prompt.
        if (printQueueRef.current.length > 0) {
          setClearQueueDialogOpen(true);
        }
      })();
    }, 1500);
  };

  const saveToStock = async () => {
    if (printQueue.length === 0) return;
    setIsSaving(true);
    try {
      // Garante que todos os SKUs novos estão no catálogo antes de salvar estoque
      const novosUnicos = Array.from(
        new Set(printQueue.map((i) => i.sku).filter((s) => !skuCodigoSet.has(s)))
      );
      for (const codigo of novosUnicos) {
        await handleCreateSku(codigo);
      }

      const res = await fetch("/api/stock-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: printQueue.map((item) => ({
            sku: item.sku,
            lote: item.lote,
            quantidade: item.qtd,
            codigoFardo: item.codigoFardo,
          })),
        }),
      });
      if (!res.ok) throw new Error("Falha ao salvar");
      const data = await res.json();
      toast.success(`${data.count} itens salvos no estoque!`);
      setPrintQueue([]);
    } catch {
      toast.error("Erro ao salvar itens no estoque");
    } finally {
      setIsSaving(false);
    }
  };

  const skuJaCadastrado = skuInput && skuCodigoSet.has(normalizeSku(skuInput));

  return (
    <div className="space-y-8">
      <PageHeader
        title="Cadastro de Fardos"
        description="Adicione fardos a fila. Cada folha impressa contera ate 4 etiquetas diferentes."
        icon={<Package className="h-8 w-8" />}
      />

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Selection Panel */}
        <Card className="h-fit">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Novo Fardo</CardTitle>
              <div className="flex items-center gap-3">
                <Package className="h-5 w-5 text-muted-foreground" />
                <div className="flex items-center gap-2">
                  <Label
                    htmlFor="fardo-agrupado"
                    className="text-sm font-normal cursor-pointer"
                  >
                    Fardo Agrupado
                  </Label>
                  <Switch
                    id="fardo-agrupado"
                    checked={isFardoAgrupado}
                    onCheckedChange={setIsFardoAgrupado}
                  />
                </div>
              </div>
            </div>
            {isFardoAgrupado && (
              <CardDescription className="text-amber-600 dark:text-amber-400">
                Modo Fardo Agrupado: 1 QR Code grande por pagina
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-6">
            {/* SKU input + autocomplete */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>SKU</Label>
                <Dialog open={isAddingSku} onOpenChange={setIsAddingSku}>
                  <DialogTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1"
                    >
                      <Tag className="h-3.5 w-3.5" />
                      Cadastrar SKU
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Cadastrar Novo SKU</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label>Código do SKU</Label>
                        <Input
                          value={newSkuCodigo}
                          onChange={(e) => setNewSkuCodigo(e.target.value)}
                          placeholder="Ex: CAMISA AZ G"
                          className="uppercase font-mono"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleCreateSku();
                          }}
                        />
                        <p className="text-xs text-muted-foreground">
                          Use espaços para separar produto, cor, tamanho, etc.
                          O código será normalizado em maiúsculas.
                        </p>
                      </div>
                      <Button
                        onClick={() => handleCreateSku()}
                        className="w-full"
                        disabled={isCreatingSku || !newSkuCodigo.trim()}
                      >
                        {isCreatingSku && (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        )}
                        Salvar SKU
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
              <div className="relative">
                <Input
                  value={skuInput}
                  onChange={(e) => setSkuInput(e.target.value.toUpperCase())}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  placeholder={
                    isLoadingSkus
                      ? "Carregando catálogo..."
                      : skuCatalogo.length === 0
                        ? "Cadastre seu primeiro SKU →"
                        : "Digite ou selecione um SKU"
                  }
                  className="h-12 text-lg font-mono uppercase"
                  disabled={isLoadingSkus}
                />
                {showSuggestions && suggestions.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-popover border rounded-md shadow-lg max-h-60 overflow-y-auto">
                    {suggestions.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className="w-full text-left px-3 py-2 hover:bg-accent text-sm font-mono"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setSkuInput(s.codigo);
                          setShowSuggestions(false);
                        }}
                      >
                        {s.codigo}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {skuInput && !skuJaCadastrado && (
                <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  SKU não está no catálogo — será cadastrado automaticamente ao
                  salvar.
                </p>
              )}
            </div>

            {/* Lote Selection */}
            <div className="space-y-3">
              <Label>Lote</Label>
              {/* Seletor de modo (RITM-24) */}
              <div className="flex flex-wrap gap-2 text-xs">
                <Button
                  type="button"
                  size="sm"
                  variant={loteMode === "default" ? "default" : "outline"}
                  onClick={() => handleLoteModeChange("default")}
                >
                  Estoque padrão
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={loteMode === "custom" ? "default" : "outline"}
                  onClick={() => handleLoteModeChange("custom")}
                >
                  Lote customizado
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={loteMode === "op" ? "default" : "outline"}
                  onClick={() => handleLoteModeChange("op")}
                >
                  <Factory className="mr-1 h-3 w-3" />
                  OP de Confecção
                </Button>
              </div>

              {loteMode === "default" && (
                <div className="rounded-md border border-input bg-muted/50 px-3 py-2 text-sm">
                  ESTOQUE PADRAO
                </div>
              )}

              {loteMode === "custom" && (
                <div className="flex gap-2">
                  <select
                    className="flex h-12 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    value={lote}
                    onChange={(e) => setLote(e.target.value)}
                    disabled={isLoadingLotes}
                  >
                    <option value="">— escolher —</option>
                    {customLotes.map((l) => (
                      <option key={l.id} value={l.nome}>
                        {l.nome}
                      </option>
                    ))}
                  </select>

                  <Dialog open={isAddingLote} onOpenChange={setIsAddingLote}>
                    <DialogTrigger asChild>
                      <Button variant="outline" className="h-12 w-12 p-0">
                        <Plus className="h-5 w-5" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Adicionar Novo Lote</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <Label>Nome do Lote</Label>
                          <Input
                            value={newLoteName}
                            onChange={(e) => setNewLoteName(e.target.value)}
                            placeholder="Ex: LOTE-2026-ABR"
                            className="uppercase"
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleAddLote();
                            }}
                          />
                        </div>
                        <Button
                          onClick={handleAddLote}
                          className="w-full"
                          disabled={isCreatingLote || !newLoteName.trim()}
                        >
                          {isCreatingLote && (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          )}
                          Salvar Lote
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              )}

              {loteMode === "op" && (
                <div className="space-y-2">
                  {opSelecionada ? (
                    <div className="flex items-center justify-between rounded-md border border-input bg-muted/50 px-3 py-2 text-sm">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="font-mono">
                          {opSelecionada.numero}
                        </Badge>
                        <span className="text-muted-foreground">
                          {opSelecionada.produtoNome}
                        </span>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setOpSelecionada(null);
                          setLote("");
                        }}
                      >
                        Trocar
                      </Button>
                    </div>
                  ) : (
                    <div className="relative">
                      <Input
                        value={opQuery}
                        onChange={(e) => setOpQuery(e.target.value)}
                        placeholder="Buscar OP (ex: OP05260001 ou produto)"
                        className="h-12 font-mono"
                      />
                      {isSearchingOps && (
                        <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                      )}
                      {opResults.length > 0 && (
                        <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-lg max-h-72 overflow-y-auto">
                          {opResults.map((op) => (
                            <button
                              key={op.id}
                              type="button"
                              className="w-full text-left px-3 py-2 hover:bg-accent text-sm border-b last:border-b-0"
                              onClick={() => handleSelectOp(op)}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono font-semibold">
                                  {op.numero}
                                </span>
                                <Badge
                                  variant={
                                    op.status === "concluida"
                                      ? "default"
                                      : "secondary"
                                  }
                                  className="text-[10px]"
                                >
                                  {op.status}
                                </Badge>
                              </div>
                              <div className="text-xs text-muted-foreground truncate">
                                {op.produtoNome}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                      {!isSearchingOps &&
                        opQuery.length > 0 &&
                        opResults.length === 0 && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Nenhuma OP encontrada.
                          </p>
                        )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Quantity */}
            <div className="space-y-3">
              <Label>Quantidade de Unidades</Label>
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="Ex: 50"
                value={qtd}
                onChange={(e) => setQtd(e.target.value.replace(/[^0-9]/g, ""))}
                className="h-12 text-lg font-mono"
              />
            </div>

            {/* Number of bundles */}
            <div className="space-y-3">
              <Label>Quantidade de Fardos</Label>
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="Ex: 10"
                value={quantidadeFardos}
                onChange={(e) =>
                  setQuantidadeFardos(e.target.value.replace(/[^0-9]/g, ""))
                }
                className="h-12 text-lg font-mono"
              />
              <p className="text-xs text-muted-foreground">
                {quantidadeFardos &&
                qtd &&
                parseInt(quantidadeFardos) > 1 &&
                parseInt(qtd) > 0
                  ? `Serao gerados ${quantidadeFardos} QR codes iguais de ${qtd} unidades cada`
                  : "Quantidade de fardos iguais a gerar"}
              </p>
            </div>

            {/* SKU Preview */}
            <div className="p-4 bg-secondary/50 rounded-lg border border-border text-center relative">
              <p className="text-sm text-muted-foreground mb-1">SKU Gerado</p>
              <p className="text-2xl font-mono font-bold tracking-wider">
                {normalizeSku(skuInput) || "..."}
              </p>
              {skuInput && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-2 right-2 h-8 w-8"
                  onClick={() => {
                    const novoSKU = prompt("Editar SKU:", normalizeSku(skuInput));
                    if (novoSKU) setSkuInput(normalizeSku(novoSKU));
                  }}
                  title="Editar SKU"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
            </div>

            <div className="flex gap-3">
              <Button
                onClick={handleAddToQueue}
                className="flex-1 h-14 text-xl font-bold shadow-lg hover:shadow-xl transition-all"
              >
                <ListPlus className="mr-2 h-6 w-6" /> ADICIONAR A FILA
              </Button>

              {/* TXT Import */}
              <Dialog
                open={isTxtDialogOpen}
                onOpenChange={setIsTxtDialogOpen}
              >
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    className="h-14 px-4"
                    title="Importar lista TXT"
                  >
                    <Upload className="h-5 w-5" />
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Importar Fardos por TXT</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 py-2">
                    <div className="p-3 bg-secondary/50 rounded-md text-sm text-muted-foreground space-y-1">
                      <p className="font-semibold text-foreground">
                        Formato esperado:
                      </p>
                      <p className="font-mono">SKU QTD1 QTD2 QTD3...</p>
                      <p className="font-mono text-xs">
                        Ex: NBA AZ G 80 60 -- 2 fardos (80 e 60 unidades)
                      </p>
                      <p className="font-mono text-xs">
                        Ex: CAMISA PT M 40 60 40 -- 3 fardos
                      </p>
                      <p className="text-xs mt-2">
                        SKUs novos serão cadastrados automaticamente no
                        catálogo.
                      </p>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        className="h-10 gap-2"
                        onClick={() => txtFileRef.current?.click()}
                      >
                        <FileText className="h-4 w-4" /> Carregar arquivo .txt
                      </Button>
                      <input
                        ref={txtFileRef}
                        type="file"
                        accept=".txt"
                        className="hidden"
                        onChange={handleTxtFileUpload}
                      />
                    </div>

                    <textarea
                      className="w-full h-48 p-3 text-sm font-mono rounded-md border border-input bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder={
                        "NBA AZ G 80 60\nNBA PT M 100 120 80\nLUA AZ M 40 60 40 60"
                      }
                      value={txtInput}
                      onChange={(e) => handleTxtChange(e.target.value)}
                    />

                    {txtErrors.length > 0 && (
                      <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-md space-y-1">
                        <p className="text-sm font-semibold text-destructive flex items-center gap-1">
                          <AlertCircle className="h-4 w-4" />{" "}
                          {txtErrors.length} erro(s) encontrado(s):
                        </p>
                        {txtErrors.map((err, i) => (
                          <p
                            key={i}
                            className="text-xs text-destructive font-mono"
                          >
                            {err}
                          </p>
                        ))}
                      </div>
                    )}

                    {txtPreview.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-sm font-semibold">
                          Preview:{" "}
                          <span className="text-primary">
                            {txtPreview.length} fardos
                          </span>{" "}
                          de{" "}
                          <span className="text-primary">
                            {new Set(txtPreview.map((i) => i.sku)).size} SKUs
                          </span>
                          {txtPreview.some((i) => i.novo) && (
                            <span className="text-amber-600 dark:text-amber-400 ml-2">
                              ({Array.from(new Set(txtPreview.filter((i) => i.novo).map((i) => i.sku))).length} novos)
                            </span>
                          )}
                        </p>
                        <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                          {txtPreview.map((item, idx) => (
                            <div
                              key={idx}
                              className="flex items-center justify-between px-3 py-1.5 bg-secondary/40 rounded text-sm"
                            >
                              <span className="font-mono font-bold flex items-center gap-2">
                                {item.sku}
                                {item.novo && (
                                  <span className="text-[10px] uppercase font-semibold text-amber-600 dark:text-amber-400 border border-amber-500/40 rounded px-1">
                                    novo
                                  </span>
                                )}
                              </span>
                              <span className="text-muted-foreground">
                                {item.qtd} unidades
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <p className="text-xs text-muted-foreground">
                      Lote aplicado:{" "}
                      <span className="font-semibold text-foreground">
                        {lote}
                      </span>
                    </p>

                    <Button
                      onClick={handleImportTxt}
                      disabled={txtPreview.length === 0}
                      className="w-full h-12 text-base font-bold"
                    >
                      <ListPlus className="mr-2 h-5 w-5" />
                      ADICIONAR {txtPreview.length} FARDOS A FILA
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </CardContent>
        </Card>

        {/* Print Queue Panel */}
        <div className="space-y-4 flex flex-col h-full">
          <Card className="flex-1 flex flex-col bg-secondary/30 border-dashed">
            <CardHeader className="pb-2">
              <CardTitle className="flex justify-between items-center">
                Fila de Impressao
                <span className="text-sm font-normal bg-primary/10 text-primary px-2 py-1 rounded-md">
                  {printQueue.length} fardos ({pages.length} folhas)
                </span>
              </CardTitle>
              <CardDescription>
                {isFardoAgrupado
                  ? "Modo Fardo Agrupado: 1 QR Code grande por pagina"
                  : "Cada folha contera ate 4 etiquetas diferentes."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden flex flex-col">
              <div className="flex-1 overflow-auto space-y-2 pr-2 mb-4 max-h-[400px]">
                {printQueue.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-50 py-12">
                    <FileText className="h-16 w-16 mb-4" />
                    <p className="text-lg text-center">
                      A fila esta vazia.
                      <br />
                      Adicione fardos para imprimir.
                    </p>
                  </div>
                ) : (
                  printQueue.map((item, idx) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-3 bg-background rounded-md border shadow-sm"
                    >
                      <div className="flex items-center gap-3">
                        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-secondary text-xs font-bold">
                          {idx + 1}
                        </span>
                        <div>
                          <p className="font-bold font-mono">{item.sku}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.qtd} unidades - {item.lote}
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveFromQueue(item.id)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))
                )}
              </div>

              <div className="hidden">
                {printQueue.map((item) => (
                  <QRCodeSVG
                    key={item.id}
                    id={`qr-print-${item.id}`}
                    value={getQrPayload(item)}
                    size={isFardoAgrupado ? 360 : 90}
                    level="H"
                    imageSettings={{
                      src: "/logo.svg",
                      x: undefined,
                      y: undefined,
                      height: isFardoAgrupado ? 54 : 20,
                      width: isFardoAgrupado ? 54 : 20,
                      excavate: true,
                    }}
                  />
                ))}
              </div>

              <div className="flex gap-4 mt-auto pt-4 border-t">
                <Button
                  onClick={handlePrint}
                  className="flex-1 h-12 text-lg"
                  variant="default"
                  disabled={printQueue.length === 0 || isSaving}
                >
                  {isSaving ? (
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  ) : (
                    <Printer className="mr-2 h-5 w-5" />
                  )}
                  Imprimir Fila ({pages.length} folhas)
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (confirm("Limpar toda a fila?")) setPrintQueue([]);
                  }}
                  className="h-12 w-12 p-0"
                  disabled={printQueue.length === 0}
                >
                  <Trash2 className="h-5 w-5 text-destructive" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <AlertDialog
        open={clearQueueDialogOpen}
        onOpenChange={setClearQueueDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Etiquetas impressas!</AlertDialogTitle>
            <AlertDialogDescription>
              Deseja excluir a fila atual?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setPrintQueue([]);
                setClearQueueDialogOpen(false);
              }}
              className="bg-destructive hover:bg-destructive/90"
            >
              Excluir Fila
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
