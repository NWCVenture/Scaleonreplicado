"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, Upload, Search } from "lucide-react";
import { parseImportText, compareSKU } from "@/lib/estante-utils";

interface ModalImportarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (
    items: Array<{ sku: string; qtd: number; lote: string }>,
  ) => Promise<void>;
}

export function ModalImportar({
  open,
  onOpenChange,
  onConfirm,
}: ModalImportarProps) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<
    Array<{ sku: string; qtd: number; lote: string }>
  >([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAnalyze = () => {
    const parsed = parseImportText(text);
    setPreview(parsed.sort((a, b) => compareSKU(a.sku, b.sku)));
  };

  const handleConfirm = async () => {
    if (preview.length === 0) return;
    setIsSubmitting(true);
    try {
      await onConfirm(preview);
      setText("");
      setPreview([]);
    } finally {
      setIsSubmitting(false);
    }
  };

  const grouped = preview.reduce<
    Record<string, { count: number; totalPecas: number }>
  >((acc, item) => {
    if (!acc[item.sku]) acc[item.sku] = { count: 0, totalPecas: 0 };
    acc[item.sku].count++;
    acc[item.sku].totalPecas += item.qtd;
    return acc;
  }, {});

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Importar Balanco</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Cole o texto do relatorio</Label>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              placeholder="Cole o relatorio aqui..."
              className="bg-slate-800 border-slate-600 font-mono text-xs"
            />
          </div>
          <Button
            variant="outline"
            className="w-full"
            onClick={handleAnalyze}
            disabled={!text.trim()}
          >
            <Search className="mr-2 h-4 w-4" /> Analisar Texto
          </Button>

          {preview.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-medium">
                {preview.length} fardos encontrados:
              </p>
              <div className="max-h-60 overflow-auto space-y-1">
                {Object.entries(grouped)
                  .sort(([a], [b]) => compareSKU(a, b))
                  .map(([sku, data]) => (
                    <div
                      key={sku}
                      className="flex justify-between px-3 py-1.5 rounded bg-slate-800 text-sm"
                    >
                      <span className="font-mono">{sku}</span>
                      <span className="text-muted-foreground">
                        {data.count} fardos - {data.totalPecas} pecas
                      </span>
                    </div>
                  ))}
              </div>
              <Button
                className="w-full"
                onClick={handleConfirm}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                {isSubmitting
                  ? "Importando..."
                  : `Importar ${preview.length} Fardos`}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
