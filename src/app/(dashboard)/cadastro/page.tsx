"use client";

import { useState, useRef, useEffect } from "react";
import { useSession } from "@/lib/auth-client";
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
} from "lucide-react";
import { generateId } from "@/lib/utils";

// Types
type PrintQueueItem = {
  id: string;
  sku: string;
  lote: string;
  qtd: number;
};

type LoteCadastrado = {
  id: string;
  nome: string;
  createdAt: string;
};

// Constants
const PRODUCTS = ["LUA", "SOL", "PUFFER", "NBA", "CJ"];
const COLORS: Record<string, string[]> = {
  LUA: ["AZ", "BR", "PT", "CZ"],
  SOL: ["AZ", "BR", "PT", "CZ"],
  NBA: ["AZ", "BR", "PT", "CZ"],
};
const SIZES = ["P", "M", "G", "GG", "EGG"];
const PRODUTOS_SEM_COR = ["PUFFER", "CJ"];

export default function CadastroEstoque() {
  const { data: session } = useSession();

  // Selection state
  const [selectedProduct, setSelectedProduct] = useState("");
  const [selectedColor, setSelectedColor] = useState("");
  const [selectedSize, setSelectedSize] = useState("");

  // Lote state
  const [lote, setLote] = useState("ESTOQUE PADRAO");
  const [customLotes, setCustomLotes] = useState<LoteCadastrado[]>([]);
  const [newLoteName, setNewLoteName] = useState("");
  const [isAddingLote, setIsAddingLote] = useState(false);
  const [isLoadingLotes, setIsLoadingLotes] = useState(false);
  const [isCreatingLote, setIsCreatingLote] = useState(false);

  // Quantity state
  const [qtd, setQtd] = useState("");
  const [quantidadeFardos, setQuantidadeFardos] = useState("1");
  const [isFardoAgrupado, setIsFardoAgrupado] = useState(false);

  // Print queue
  const [printQueue, setPrintQueue] = useState<PrintQueueItem[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // TXT import state
  const [isTxtDialogOpen, setIsTxtDialogOpen] = useState(false);
  const [txtInput, setTxtInput] = useState("");
  const [txtPreview, setTxtPreview] = useState<
    Array<{ sku: string; qtd: number }>
  >([]);
  const [txtErrors, setTxtErrors] = useState<string[]>([]);
  const txtFileRef = useRef<HTMLInputElement>(null);

  // Fetch lotes on mount
  useEffect(() => {
    fetchLotes();
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

  const handleAddToQueue = (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedProduct || !selectedSize) {
      toast.error("Selecione Produto e Tamanho!");
      return;
    }

    if (!PRODUTOS_SEM_COR.includes(selectedProduct) && !selectedColor) {
      toast.error("Selecione a Cor!");
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

    const sku = PRODUTOS_SEM_COR.includes(selectedProduct)
      ? `${selectedProduct} ${selectedSize}`
      : `${selectedProduct} ${selectedColor} ${selectedSize}`;
    const qtdFardos = parseInt(quantidadeFardos);
    const qtdUnidades = parseInt(qtd);

    const newItems: PrintQueueItem[] = [];
    for (let i = 0; i < qtdFardos; i++) {
      newItems.push({
        id: generateId(),
        sku,
        lote,
        qtd: qtdUnidades,
      });
    }

    setPrintQueue([...printQueue, ...newItems]);
    toast.success(`${qtdFardos} fardo(s) adicionado(s) a fila!`, {
      description: `${qtdUnidades} unidades cada - ${sku}`,
    });

    setQtd("");
    setQuantidadeFardos("1");
  };

  const handleRemoveFromQueue = (id: string) => {
    setPrintQueue(printQueue.filter((item) => item.id !== id));
    toast.info("Item removido da fila.");
  };

  // TXT parsing
  const allColors = ["AZ", "BR", "PT", "CZ"];

  const parseTxtLines = (text: string) => {
    const lines = text.split("\n");
    const items: Array<{ sku: string; qtd: number }> = [];
    const errors: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const tokens = line.split(/\s+/);
      if (tokens.length < 3) {
        errors.push(`Linha ${i + 1}: "${line}" -- formato invalido`);
        continue;
      }

      const product = tokens[0].toUpperCase();
      if (!PRODUCTS.includes(product)) {
        errors.push(`Linha ${i + 1}: produto "${product}" nao reconhecido`);
        continue;
      }

      let color = "";
      let sizeIdx = 2;

      if (PRODUTOS_SEM_COR.includes(product)) {
        sizeIdx = 1;
      } else {
        color = tokens[1].toUpperCase();
        if (!allColors.includes(color)) {
          errors.push(`Linha ${i + 1}: cor "${color}" nao reconhecida`);
          continue;
        }
        sizeIdx = 2;
      }

      const size = tokens[sizeIdx]?.toUpperCase();
      if (!size || !SIZES.includes(size)) {
        errors.push(`Linha ${i + 1}: tamanho "${size}" nao reconhecido`);
        continue;
      }

      const sku = PRODUTOS_SEM_COR.includes(product)
        ? `${product} ${size}`
        : `${product} ${color} ${size}`;

      const quantities = tokens.slice(sizeIdx + 1);
      if (quantities.length === 0) {
        errors.push(`Linha ${i + 1}: "${sku}" sem quantidades`);
        continue;
      }

      for (const q of quantities) {
        const qtdNum = parseInt(q);
        if (isNaN(qtdNum) || qtdNum <= 0) {
          errors.push(
            `Linha ${i + 1}: quantidade "${q}" invalida para ${sku}`
          );
          continue;
        }
        items.push({ sku, qtd: qtdNum });
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

  const handleImportTxt = () => {
    if (txtPreview.length === 0) return;
    const newItems: PrintQueueItem[] = txtPreview.map((item) => ({
      id: generateId(),
      sku: item.sku,
      lote,
      qtd: item.qtd,
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

  // QR Code payload
  const getQrPayload = (item: PrintQueueItem) =>
    `${item.sku}|${item.lote}|${item.qtd}`;

  // Pages for print queue
  const itemsPerPage = isFardoAgrupado ? 1 : 4;
  const pages: PrintQueueItem[][] = [];
  for (let i = 0; i < printQueue.length; i += itemsPerPage) {
    pages.push(printQueue.slice(i, i + itemsPerPage));
  }

  // Print handler with window.open
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

    // After print, ask to save
    setTimeout(() => {
      if (confirm("Salvar itens no estoque?")) {
        saveToStock();
      }
    }, 1500);
  };

  const saveToStock = async () => {
    if (printQueue.length === 0) return;
    setIsSaving(true);
    try {
      const res = await fetch("/api/stock-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: printQueue.map((item) => ({
            sku: item.sku,
            lote: item.lote,
            quantidade: item.qtd,
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

  // Available colors for selected product
  const availableColors = selectedProduct
    ? COLORS[selectedProduct] || []
    : [];

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
            {/* Product Selection */}
            <div className="space-y-3">
              <Label>Produto</Label>
              <div className="flex gap-3">
                {PRODUCTS.map((p) => (
                  <Button
                    key={p}
                    type="button"
                    variant={selectedProduct === p ? "default" : "outline"}
                    onClick={() => {
                      setSelectedProduct(p);
                      if (PRODUTOS_SEM_COR.includes(p)) setSelectedColor("");
                    }}
                    className="flex-1 h-12 text-lg font-bold"
                  >
                    {p}
                  </Button>
                ))}
              </div>
            </div>

            {/* Color Selection */}
            {!PRODUTOS_SEM_COR.includes(selectedProduct) &&
              selectedProduct && (
                <div className="space-y-3">
                  <Label>Cor</Label>
                  <div className="flex gap-3">
                    {availableColors.map((c) => (
                      <Button
                        key={c}
                        type="button"
                        variant={selectedColor === c ? "default" : "outline"}
                        onClick={() => setSelectedColor(c)}
                        className="flex-1 h-12 text-lg font-bold"
                      >
                        {c}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

            {/* Size Selection */}
            <div className="space-y-3">
              <Label>Tamanho</Label>
              <div className="flex gap-3">
                {SIZES.map((s) => (
                  <Button
                    key={s}
                    type="button"
                    variant={selectedSize === s ? "default" : "outline"}
                    onClick={() => setSelectedSize(s)}
                    className="flex-1 h-12 text-lg font-bold"
                  >
                    {s}
                  </Button>
                ))}
              </div>
            </div>

            {/* Lote Selection */}
            <div className="space-y-3">
              <Label>Lote</Label>
              <div className="flex gap-2">
                <select
                  className="flex h-12 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  value={lote}
                  onChange={(e) => setLote(e.target.value)}
                  disabled={isLoadingLotes}
                >
                  <option value="ESTOQUE PADRAO">ESTOQUE PADRAO</option>
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
            </div>

            {/* Quantity */}
            <div className="space-y-3">
              <Label>Quantidade de Unidades</Label>
              <Input
                type="number"
                placeholder="Ex: 50"
                value={qtd}
                onChange={(e) => setQtd(e.target.value)}
                className="h-12 text-lg font-mono"
                min="1"
              />
            </div>

            {/* Number of bundles */}
            <div className="space-y-3">
              <Label>Quantidade de Fardos</Label>
              <Input
                type="number"
                placeholder="Ex: 10"
                value={quantidadeFardos}
                onChange={(e) => setQuantidadeFardos(e.target.value)}
                className="h-12 text-lg font-mono"
                min="1"
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
                {selectedProduct || "..."}{" "}
                {!PRODUTOS_SEM_COR.includes(selectedProduct || "") &&
                  (selectedColor || "...")}{" "}
                {selectedSize || "..."}
              </p>
              {selectedProduct && selectedSize && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-2 right-2 h-8 w-8"
                  onClick={() => {
                    const currentSku = PRODUTOS_SEM_COR.includes(
                      selectedProduct
                    )
                      ? `${selectedProduct} ${selectedSize}`
                      : `${selectedProduct} ${selectedColor} ${selectedSize}`;
                    const novoSKU = prompt("Editar SKU:", currentSku);
                    if (novoSKU) {
                      const partes = novoSKU.trim().split(" ");
                      if (partes.length >= 2) {
                        setSelectedProduct(partes[0]);
                        if (
                          partes.length === 3 &&
                          !PRODUTOS_SEM_COR.includes(partes[0])
                        ) {
                          setSelectedColor(partes[1]);
                          setSelectedSize(partes[2]);
                        } else {
                          setSelectedColor("");
                          setSelectedSize(partes[partes.length - 1]);
                        }
                      }
                    }
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
                      <p className="font-mono">
                        PRODUTO COR TAMANHO QTD1 QTD2 QTD3...
                      </p>
                      <p className="font-mono text-xs">
                        Ex: NBA AZ G 80 60 -- 2 fardos (80 e 60 unidades)
                      </p>
                      <p className="font-mono text-xs">
                        Ex: LUA PT M 40 60 40 -- 3 fardos
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
                        </p>
                        <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                          {txtPreview.map((item, idx) => (
                            <div
                              key={idx}
                              className="flex items-center justify-between px-3 py-1.5 bg-secondary/40 rounded text-sm"
                            >
                              <span className="font-mono font-bold">
                                {item.sku}
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
              {/* Queue list */}
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

              {/* Hidden QR Codes for print serialization */}
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

              {/* Action buttons */}
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
    </div>
  );
}
