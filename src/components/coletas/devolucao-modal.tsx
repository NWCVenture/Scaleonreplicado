"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import type {
  ContaOperacao,
  SkuLine,
  SkuKitRule,
  DevolucaoFormData,
} from "@/types/coletas";
import {
  OPERATIONS,
  OPERATION_DISPLAY,
  EMPTY_SKU_LINE,
} from "@/types/coletas";
import { explodeSkuLines, sumSkuLines, fileToBase64 } from "@/lib/coletas-utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Plus, Minus, X, Camera, ImageIcon } from "lucide-react";

interface DevolucaoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pacoteId: string;
  currentAccount: ContaOperacao;
  skuCatalog: string[];
  kitRules: SkuKitRule[];
  existingData?: DevolucaoFormData;
  onSave: (data: DevolucaoFormData) => void;
}

export function DevolucaoModal({
  open,
  onOpenChange,
  pacoteId,
  currentAccount,
  skuCatalog,
  kitRules,
  existingData,
  onSave,
}: DevolucaoModalProps) {
  const [skuLines, setSkuLines] = useState<SkuLine[]>([{ ...EMPTY_SKU_LINE }]);
  const [operacao, setOperacao] = useState<ContaOperacao>(currentAccount);
  const [avaria, setAvaria] = useState(false);
  const [obs, setObs] = useState("");
  const [fotoPacotePreview, setFotoPacotePreview] = useState("");
  const [fotoPacoteBase64, setFotoPacoteBase64] = useState("");
  const [fotoAvariaPreview, setFotoAvariaPreview] = useState("");
  const [fotoAvariaBase64, setFotoAvariaBase64] = useState("");
  const [skuDropdownOpen, setSkuDropdownOpen] = useState<number | null>(null);

  const fotoPacoteRef = useRef<HTMLInputElement>(null);
  const fotoAvariaRef = useRef<HTMLInputElement>(null);

  // Reset form when opening
  useEffect(() => {
    if (open) {
      if (existingData) {
        setSkuLines(
          existingData.skuLines.length > 0
            ? existingData.skuLines
            : [{ ...EMPTY_SKU_LINE }],
        );
        setOperacao(existingData.operacao);
        setAvaria(existingData.avaria);
        setObs(existingData.obs);
        setFotoPacoteBase64(existingData.fotoPacoteBase64 || "");
        setFotoPacotePreview(existingData.fotoPacoteBase64 || "");
        setFotoAvariaBase64(existingData.fotoAvariaBase64 || "");
        setFotoAvariaPreview(existingData.fotoAvariaBase64 || "");
      } else {
        setSkuLines([{ ...EMPTY_SKU_LINE }]);
        setOperacao(currentAccount);
        setAvaria(false);
        setObs("");
        setFotoPacoteBase64("");
        setFotoPacotePreview("");
        setFotoAvariaBase64("");
        setFotoAvariaPreview("");
      }
    }
  }, [open, existingData, currentAccount]);

  const updateSkuLine = useCallback(
    (idx: number, field: "sku" | "qtd", value: string | number) => {
      setSkuLines((prev) => {
        const lines = [...prev];
        lines[idx] = {
          ...lines[idx],
          [field]:
            field === "qtd"
              ? Number(value)
              : String(value).toUpperCase(),
        };
        return lines;
      });
    },
    [],
  );

  const addSkuLine = useCallback(() => {
    setSkuLines((prev) => [...prev, { ...EMPTY_SKU_LINE }]);
  }, []);

  const removeSkuLine = useCallback((idx: number) => {
    setSkuLines((prev) =>
      prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev,
    );
  }, []);

  const getFilteredCatalog = useCallback(
    (search: string) => {
      const kitSkus = kitRules.map((r) => r.kitSku);
      const all = Array.from(new Set([...skuCatalog, ...kitSkus]));
      if (!search.trim()) return all.slice(0, 8);
      return all
        .filter((s) => s.toLowerCase().includes(search.toLowerCase()))
        .slice(0, 10);
    },
    [skuCatalog, kitRules],
  );

  const handlePhotoPacote = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (f) {
        const b64 = await fileToBase64(f);
        setFotoPacoteBase64(b64);
        setFotoPacotePreview(b64);
      }
      e.target.value = "";
    },
    [],
  );

  const handlePhotoAvaria = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (f) {
        const b64 = await fileToBase64(f);
        setFotoAvariaBase64(b64);
        setFotoAvariaPreview(b64);
      }
      e.target.value = "";
    },
    [],
  );

  const handleSave = useCallback(() => {
    onSave({
      skuLines: skuLines.filter((l) => l.sku.trim()),
      operacao,
      avaria,
      obs,
      tipo: "DEVOLUCAO",
      fotoPacoteBase64: fotoPacoteBase64 || undefined,
      fotoAvariaBase64: fotoAvariaBase64 || undefined,
    });
    onOpenChange(false);
  }, [
    skuLines,
    operacao,
    avaria,
    obs,
    fotoPacoteBase64,
    fotoAvariaBase64,
    onSave,
    onOpenChange,
  ]);

  // Kit preview
  const validLines = skuLines.filter((l) => l.sku.trim());
  const exploded =
    validLines.length > 0 && kitRules.length > 0
      ? explodeSkuLines(validLines, kitRules)
      : [];
  const hasKitExplosion =
    exploded.length > 0 &&
    JSON.stringify(validLines) !== JSON.stringify(exploded);
  const summed = hasKitExplosion ? sumSkuLines(exploded) : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto bg-zinc-950 border-zinc-800">
        <DialogHeader>
          <DialogTitle className="text-zinc-100">
            Registrar Devolucao
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Pacote ID */}
          <div className="bg-zinc-900 p-3 rounded-lg text-center border border-zinc-800">
            <div className="font-mono font-bold text-zinc-200 tracking-wider">
              {pacoteId}
            </div>
          </div>

          {/* SKU Lines */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs font-bold text-zinc-400">
                SKUs da Devolucao
              </Label>
              <button
                onClick={addSkuLine}
                className="text-xs text-orange-400 hover:text-orange-300 flex items-center gap-1 font-semibold"
              >
                <Plus className="h-3 w-3" /> Adicionar linha
              </button>
            </div>
            <div className="space-y-2">
              {skuLines.map((line, idx) => (
                <div key={idx} className="flex gap-2 items-start">
                  {/* SKU autocomplete */}
                  <div className="flex-1 relative">
                    <Input
                      autoComplete="off"
                      value={line.sku}
                      onChange={(e) => {
                        updateSkuLine(idx, "sku", e.target.value);
                        setSkuDropdownOpen(idx);
                      }}
                      onFocus={() => setSkuDropdownOpen(idx)}
                      onBlur={() =>
                        setTimeout(() => setSkuDropdownOpen(null), 200)
                      }
                      className="font-mono text-sm bg-zinc-900 border-zinc-700 text-zinc-100"
                      placeholder={
                        idx === 0 ? "SKU..." : `SKU linha ${idx + 1}...`
                      }
                    />
                    {skuDropdownOpen === idx &&
                      getFilteredCatalog(line.sku).length > 0 && (
                        <div className="absolute z-20 w-full bg-zinc-900 border border-zinc-700 rounded-lg shadow-lg max-h-40 overflow-y-auto top-full mt-1">
                          {getFilteredCatalog(line.sku).map((sku) => (
                            <div
                              key={sku}
                              onMouseDown={() => {
                                updateSkuLine(idx, "sku", sku);
                                setSkuDropdownOpen(null);
                              }}
                              className="px-3 py-2 text-sm font-mono text-zinc-200 hover:bg-zinc-800 cursor-pointer border-b border-zinc-800 last:border-0"
                            >
                              {sku}
                            </div>
                          ))}
                        </div>
                      )}
                  </div>
                  {/* Qty buttons */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() =>
                        updateSkuLine(idx, "qtd", Math.max(1, line.qtd - 1))
                      }
                      className="w-7 h-9 rounded-l-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 flex items-center justify-center border border-r-0 border-zinc-700"
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                    <input
                      type="number"
                      value={line.qtd}
                      onChange={(e) =>
                        updateSkuLine(
                          idx,
                          "qtd",
                          Math.max(1, parseInt(e.target.value) || 1),
                        )
                      }
                      className="w-12 h-9 text-center border border-zinc-700 bg-zinc-900 text-zinc-100 font-bold text-sm focus:outline-none focus:border-orange-500"
                    />
                    <button
                      onClick={() => updateSkuLine(idx, "qtd", line.qtd + 1)}
                      className="w-7 h-9 rounded-r-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 flex items-center justify-center border border-l-0 border-zinc-700"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                  {skuLines.length > 1 && (
                    <button
                      onClick={() => removeSkuLine(idx)}
                      className="text-red-400 hover:text-red-300 h-9 flex items-center"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Kit explosion preview */}
            {hasKitExplosion && (
              <div className="mt-2 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2 text-xs">
                <p className="font-semibold text-amber-400 mb-1">
                  Unidades (explodido):
                </p>
                {summed.map((s, i) => (
                  <div key={i} className="font-mono text-amber-300">
                    {s.qtd}x {s.sku}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Operacao */}
          <div>
            <Label className="block text-xs font-bold text-zinc-400 mb-2">
              Operacao
            </Label>
            <div className="flex gap-2 flex-wrap">
              {OPERATIONS.map((op) => (
                <button
                  key={op}
                  onClick={() => setOperacao(op)}
                  className={cn(
                    "flex-1 py-1.5 rounded-md text-xs font-semibold border transition-colors",
                    operacao === op
                      ? "bg-zinc-100 text-zinc-900 border-zinc-100"
                      : "bg-zinc-900 text-zinc-400 border-zinc-700 hover:bg-zinc-800",
                  )}
                >
                  {OPERATION_DISPLAY[op]}
                </button>
              ))}
            </div>
          </div>

          {/* Avaria */}
          <div>
            <Label className="block text-xs font-bold text-zinc-400 mb-2">
              Avaria?
            </Label>
            <div className="flex gap-2">
              <button
                onClick={() => setAvaria(true)}
                className={cn(
                  "flex-1 py-2 rounded-lg text-sm font-bold border transition-colors",
                  avaria
                    ? "bg-red-500 text-white border-red-500"
                    : "bg-zinc-900 text-zinc-400 border-zinc-700 hover:bg-red-500/10 hover:text-red-400",
                )}
              >
                SIM
              </button>
              <button
                onClick={() => setAvaria(false)}
                className={cn(
                  "flex-1 py-2 rounded-lg text-sm font-bold border transition-colors",
                  !avaria
                    ? "bg-green-500 text-white border-green-500"
                    : "bg-zinc-900 text-zinc-400 border-zinc-700 hover:bg-green-500/10 hover:text-green-400",
                )}
              >
                NAO
              </button>
            </div>
          </div>

          {/* Obs (shown when avaria=true) */}
          {avaria && (
            <div>
              <Label className="block text-xs font-bold text-zinc-400 mb-1">
                Observacao da Avaria
              </Label>
              <Textarea
                value={obs}
                onChange={(e) => setObs(e.target.value)}
                className="bg-zinc-900 border-zinc-700 text-zinc-100 h-20 resize-none"
                placeholder="Descreva o defeito..."
              />
            </div>
          )}

          {/* Photos */}
          <div className="grid grid-cols-2 gap-3">
            {/* Foto do Pacote */}
            <div>
              <Label className="block text-xs font-bold text-zinc-400 mb-1 flex items-center gap-1">
                <Camera className="h-3 w-3" /> Foto do Pacote
              </Label>
              <input
                ref={fotoPacoteRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handlePhotoPacote}
              />
              <div
                onClick={() => fotoPacoteRef.current?.click()}
                className="cursor-pointer border-2 border-dashed border-zinc-700 rounded-lg h-20 flex items-center justify-center hover:border-orange-500 overflow-hidden"
              >
                {fotoPacotePreview ? (
                  <img
                    src={fotoPacotePreview}
                    className="h-full w-full object-cover"
                    alt="Foto pacote"
                  />
                ) : (
                  <div className="text-center text-zinc-500">
                    <ImageIcon className="h-6 w-6 mx-auto mb-1" />
                    <span className="text-xs">Tirar/Upload</span>
                  </div>
                )}
              </div>
              {fotoPacotePreview && (
                <button
                  onClick={() => {
                    setFotoPacoteBase64("");
                    setFotoPacotePreview("");
                  }}
                  className="text-xs text-red-400 hover:text-red-300 mt-1"
                >
                  Remover
                </button>
              )}
            </div>

            {/* Foto da Avaria */}
            <div>
              <Label className="block text-xs font-bold text-zinc-400 mb-1 flex items-center gap-1">
                <Camera className="h-3 w-3" /> Foto da Avaria
              </Label>
              <input
                ref={fotoAvariaRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handlePhotoAvaria}
              />
              <div
                onClick={() => fotoAvariaRef.current?.click()}
                className={cn(
                  "cursor-pointer border-2 border-dashed rounded-lg h-20 flex items-center justify-center overflow-hidden",
                  avaria
                    ? "border-red-500/50 hover:border-red-500"
                    : "border-zinc-700 hover:border-zinc-600",
                )}
              >
                {fotoAvariaPreview ? (
                  <img
                    src={fotoAvariaPreview}
                    className="h-full w-full object-cover"
                    alt="Foto avaria"
                  />
                ) : (
                  <div className="text-center text-zinc-500">
                    <ImageIcon className="h-6 w-6 mx-auto mb-1" />
                    <span className="text-xs">Tirar/Upload</span>
                  </div>
                )}
              </div>
              {fotoAvariaPreview && (
                <button
                  onClick={() => {
                    setFotoAvariaBase64("");
                    setFotoAvariaPreview("");
                  }}
                  className="text-xs text-red-400 hover:text-red-300 mt-1"
                >
                  Remover
                </button>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSave}
            className="bg-orange-500 hover:bg-orange-600 text-white"
          >
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
