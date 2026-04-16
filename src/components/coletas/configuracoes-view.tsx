"use client";

import { useState, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import type { SkuLine, SkuKitRule, CarrierPattern } from "@/types/coletas";
import { CARRIER_COLORS, CARRIER_DISPLAY } from "@/types/coletas";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  BookOpen,
  Package,
  Tag,
  Plus,
  Minus,
  X,
  Trash2,
  Upload,
} from "lucide-react";

interface ConfiguracoesViewProps {
  skuCatalog: string[];
  kitRules: SkuKitRule[];
  carrierPatterns: CarrierPattern[];
  onAddSkus: (skus: string[]) => void;
  onRemoveSku: (sku: string) => void;
  onClearSkus: () => void;
  onSaveKitRule: (rule: { kitSku: string; components: SkuLine[] }) => void;
  onDeleteKitRule: (id: string) => void;
  onSaveCarrierPattern: (pattern: {
    transportadora: string;
    prefixos: string[];
  }) => void;
  onDeleteCarrierPattern: (id: string) => void;
}

export function ConfiguracoesView({
  skuCatalog,
  kitRules,
  carrierPatterns,
  onAddSkus,
  onRemoveSku,
  onClearSkus,
  onSaveKitRule,
  onDeleteKitRule,
  onSaveCarrierPattern,
  onDeleteCarrierPattern,
}: ConfiguracoesViewProps) {
  // SKU Manager state
  const [skuManagerText, setSkuManagerText] = useState("");
  const skuTxtInputRef = useRef<HTMLInputElement>(null);

  // Kit Rules state
  const [newKitSku, setNewKitSku] = useState("");
  const [newKitComponents, setNewKitComponents] = useState<SkuLine[]>([
    { sku: "", qtd: 1 },
  ]);

  // Carrier Patterns state
  const [newPrefixInputs, setNewPrefixInputs] = useState<
    Record<string, string>
  >({});
  const [sampleCodeInputs, setSampleCodeInputs] = useState<
    Record<string, string>
  >({});

  const handleAddSkusCatalog = useCallback(
    (text: string) => {
      const newSkus = text
        .split("\n")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      if (!newSkus.length) return;
      onAddSkus(newSkus);
      const added = newSkus.filter((s) => !skuCatalog.includes(s)).length;
      const exists = newSkus.length - added;
      toast.success(
        `${added} SKU(s) adicionado(s)${exists ? `, ${exists} ja existiam` : ""}`,
      );
      setSkuManagerText("");
    },
    [onAddSkus, skuCatalog],
  );

  const handleSkuTxtUpload = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        handleAddSkusCatalog(text);
      };
      reader.readAsText(file, "UTF-8");
    },
    [handleAddSkusCatalog],
  );

  const handleSaveKitRule = useCallback(() => {
    if (!newKitSku.trim()) {
      toast.error("Informe o SKU do Kit");
      return;
    }
    const validComps = newKitComponents.filter(
      (c) => c.sku.trim() && c.qtd > 0,
    );
    if (!validComps.length) {
      toast.error("Adicione pelo menos um componente");
      return;
    }
    onSaveKitRule({
      kitSku: newKitSku.trim().toUpperCase(),
      components: validComps.map((c) => ({
        sku: c.sku.trim().toUpperCase(),
        qtd: c.qtd,
      })),
    });
    setNewKitSku("");
    setNewKitComponents([{ sku: "", qtd: 1 }]);
    toast.success("Regra de Kit salva!");
  }, [newKitSku, newKitComponents, onSaveKitRule]);

  const handleAddCarrierPrefix = useCallback(
    (transportadora: string, prefix: string) => {
      if (!prefix.trim()) return;
      const pattern = carrierPatterns.find(
        (p) => p.transportadora === transportadora,
      );
      if (pattern && !pattern.prefixos.includes(prefix.trim())) {
        onSaveCarrierPattern({
          transportadora,
          prefixos: [...pattern.prefixos, prefix.trim()],
        });
      }
      setNewPrefixInputs((prev) => ({ ...prev, [transportadora]: "" }));
    },
    [carrierPatterns, onSaveCarrierPattern],
  );

  const handleExtractPrefixFromSample = useCallback(
    (transportadora: string) => {
      const sample = (sampleCodeInputs[transportadora] || "").trim();
      if (sample.length < 2) {
        toast.error("Cole um codigo de exemplo completo");
        return;
      }
      const prefix = sample.replace(/\D/g, "").substring(0, 4);
      if (!prefix) {
        toast.error("Codigo invalido");
        return;
      }
      handleAddCarrierPrefix(transportadora, prefix);
      setSampleCodeInputs((prev) => ({ ...prev, [transportadora]: "" }));
      toast.success(`Prefixo "${prefix}" adicionado para ${transportadora}`);
    },
    [sampleCodeInputs, handleAddCarrierPrefix],
  );

  const handleRemoveCarrierPrefix = useCallback(
    (transportadora: string, prefix: string) => {
      const pattern = carrierPatterns.find(
        (p) => p.transportadora === transportadora,
      );
      if (pattern) {
        onSaveCarrierPattern({
          transportadora,
          prefixos: pattern.prefixos.filter((x) => x !== prefix),
        });
      }
    },
    [carrierPatterns, onSaveCarrierPattern],
  );

  return (
    <div className="space-y-4">
      <Accordion type="multiple" className="space-y-4">
        {/* Section 1: SKU Catalog */}
        <AccordionItem
          value="sku-catalog"
          className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-950"
        >
          <AccordionTrigger className="px-6 py-4 hover:bg-zinc-900 transition-colors">
            <div className="flex items-center gap-3">
              <BookOpen className="h-5 w-5 text-indigo-400" />
              <div className="text-left">
                <h3 className="font-bold text-zinc-100">Catalogo de SKUs</h3>
                <p className="text-xs text-zinc-400">
                  {skuCatalog.length} SKU(s) cadastrado(s)
                </p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-6 pb-6 pt-4 space-y-4 border-t border-zinc-800">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="block text-xs font-bold text-zinc-400 mb-2">
                  Adicionar SKUs (um por linha)
                </Label>
                <Textarea
                  value={skuManagerText}
                  onChange={(e) => setSkuManagerText(e.target.value)}
                  className="h-40 font-mono text-sm bg-zinc-900 border-zinc-700 text-zinc-100 resize-none"
                  placeholder={"SKU1\nSKU2\nSKU3"}
                />
                <div className="flex gap-2 mt-2">
                  <Button
                    onClick={() => handleAddSkusCatalog(skuManagerText)}
                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white"
                    size="sm"
                  >
                    <Plus className="h-4 w-4 mr-1" /> Adicionar ao Catalogo
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => skuTxtInputRef.current?.click()}
                    className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                  >
                    <Upload className="h-4 w-4 mr-1" /> TXT
                  </Button>
                  <input
                    ref={skuTxtInputRef}
                    type="file"
                    accept=".txt"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleSkuTxtUpload(f);
                      e.target.value = "";
                    }}
                  />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-xs font-bold text-zinc-400">
                    SKUs Cadastrados ({skuCatalog.length})
                  </Label>
                  {skuCatalog.length > 0 && (
                    <button
                      onClick={onClearSkus}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      Limpar tudo
                    </button>
                  )}
                </div>
                <div className="h-40 overflow-y-auto bg-zinc-900 border border-zinc-800 rounded-xl p-2 space-y-1">
                  {skuCatalog.length === 0 ? (
                    <p className="text-xs text-zinc-500 text-center pt-4">
                      Nenhum SKU cadastrado
                    </p>
                  ) : (
                    skuCatalog.map((sku) => (
                      <div
                        key={sku}
                        className="flex items-center justify-between bg-zinc-800 px-2 py-1 rounded border border-zinc-700 text-xs font-mono text-zinc-200"
                      >
                        <span>{sku}</span>
                        <button
                          onClick={() => onRemoveSku(sku)}
                          className="text-red-400 hover:text-red-300"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Section 2: Kit Rules */}
        <AccordionItem
          value="kit-rules"
          className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-950"
        >
          <AccordionTrigger className="px-6 py-4 hover:bg-zinc-900 transition-colors">
            <div className="flex items-center gap-3">
              <Package className="h-5 w-5 text-amber-400" />
              <div className="text-left">
                <h3 className="font-bold text-zinc-100">
                  Regras de Kits (Explosao de SKUs)
                </h3>
                <p className="text-xs text-zinc-400">
                  {kitRules.length} regra(s) cadastrada(s)
                </p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-6 pb-6 pt-4 space-y-4 border-t border-zinc-800">
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
              <h4 className="font-semibold text-amber-400 mb-3 text-sm">
                Nova Regra de Kit
              </h4>
              <div className="mb-3">
                <Label className="text-xs font-bold text-zinc-400 mb-1 block">
                  SKU do Kit
                </Label>
                <Input
                  value={newKitSku}
                  onChange={(e) => setNewKitSku(e.target.value.toUpperCase())}
                  className="font-mono text-sm bg-zinc-900 border-zinc-700 text-zinc-100"
                  placeholder="ex: KIT 3 LUA 2 AZ 1 PT M"
                />
              </div>
              <div className="space-y-2 mb-3">
                <Label className="text-xs font-bold text-zinc-400 block">
                  Componentes
                </Label>
                {newKitComponents.map((comp, idx) => (
                  <div key={idx} className="flex gap-2">
                    <Input
                      value={comp.sku}
                      onChange={(e) => {
                        const a = [...newKitComponents];
                        a[idx] = {
                          ...a[idx],
                          sku: e.target.value.toUpperCase(),
                        };
                        setNewKitComponents(a);
                      }}
                      placeholder="SKU componente"
                      className="flex-1 font-mono text-sm bg-zinc-900 border-zinc-700 text-zinc-100"
                    />
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          const a = [...newKitComponents];
                          a[idx] = {
                            ...a[idx],
                            qtd: Math.max(1, a[idx].qtd - 1),
                          };
                          setNewKitComponents(a);
                        }}
                        className="w-7 h-7 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 flex items-center justify-center"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="w-8 text-center text-sm font-bold text-zinc-200">
                        {comp.qtd}
                      </span>
                      <button
                        onClick={() => {
                          const a = [...newKitComponents];
                          a[idx] = { ...a[idx], qtd: a[idx].qtd + 1 };
                          setNewKitComponents(a);
                        }}
                        className="w-7 h-7 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 flex items-center justify-center"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                    {newKitComponents.length > 1 && (
                      <button
                        onClick={() =>
                          setNewKitComponents((prev) =>
                            prev.filter((_, i) => i !== idx),
                          )
                        }
                        className="text-red-400 hover:text-red-300"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  onClick={() =>
                    setNewKitComponents((prev) => [
                      ...prev,
                      { sku: "", qtd: 1 },
                    ])
                  }
                  className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1"
                >
                  <Plus className="h-3 w-3" /> Adicionar componente
                </button>
              </div>
              <Button
                onClick={handleSaveKitRule}
                className="w-full bg-amber-600 hover:bg-amber-700 text-white"
                size="sm"
              >
                Salvar Regra de Kit
              </Button>
            </div>

            {kitRules.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs font-bold text-zinc-400">
                  Regras Cadastradas
                </Label>
                {kitRules.map((rule) => (
                  <div
                    key={rule.id}
                    className="bg-zinc-900 border border-zinc-800 rounded-xl p-3"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="font-mono font-bold text-sm text-zinc-100">
                          {rule.kitSku}
                        </span>
                        <div className="text-xs text-zinc-400 mt-1">
                          {rule.components.map((c, i) => (
                            <span key={i} className="mr-2">
                              {c.qtd}x {c.sku}
                            </span>
                          ))}
                        </div>
                      </div>
                      <button
                        onClick={() => onDeleteKitRule(rule.id)}
                        className="text-red-400 hover:text-red-300"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* Section 3: Carrier Patterns */}
        <AccordionItem
          value="carrier-patterns"
          className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-950"
        >
          <AccordionTrigger className="px-6 py-4 hover:bg-zinc-900 transition-colors">
            <div className="flex items-center gap-3">
              <Tag className="h-5 w-5 text-purple-400" />
              <div className="text-left">
                <h3 className="font-bold text-zinc-100">
                  Padroes de Codigo por Transportadora
                </h3>
                <p className="text-xs text-zinc-400">
                  Configure prefixos para reconhecer TTK-JDLOG e TTK-IMILE
                </p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-6 pb-6 pt-4 space-y-4 border-t border-zinc-800">
            <div className="text-xs text-zinc-400 bg-zinc-900 p-3 rounded-lg">
              <strong>Como funciona:</strong> Cole um codigo de exemplo de um
              pacote da transportadora. O sistema extrai o prefixo
              automaticamente, ou voce pode digitar o prefixo manualmente.
            </div>

            {carrierPatterns.map((pattern) => {
              const isJdlog = pattern.transportadora.includes("JDLOG");
              return (
                <div
                  key={pattern.id}
                  className={cn(
                    "border rounded-xl p-4",
                    isJdlog
                      ? "bg-purple-500/5 border-purple-500/30"
                      : "bg-emerald-500/5 border-emerald-500/30",
                  )}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <span
                      className={cn(
                        "text-xs font-bold px-2 py-1 rounded border",
                        isJdlog
                          ? CARRIER_COLORS.TTK_JDLOG
                          : CARRIER_COLORS.TTK_IMILE,
                      )}
                    >
                      {isJdlog
                        ? CARRIER_DISPLAY.TTK_JDLOG
                        : CARRIER_DISPLAY.TTK_IMILE}
                    </span>
                    <span className="text-sm text-zinc-400">
                      {pattern.prefixos.length} prefixo(s)
                    </span>
                  </div>

                  {/* Sample code auto-extract */}
                  <div className="flex gap-2 mb-2">
                    <Input
                      value={sampleCodeInputs[pattern.transportadora] || ""}
                      onChange={(e) =>
                        setSampleCodeInputs((prev) => ({
                          ...prev,
                          [pattern.transportadora]: e.target.value,
                        }))
                      }
                      className="flex-1 font-mono text-sm bg-zinc-900 border-zinc-700 text-zinc-100"
                      placeholder="Cole um codigo de exemplo..."
                    />
                    <Button
                      size="sm"
                      onClick={() =>
                        handleExtractPrefixFromSample(pattern.transportadora)
                      }
                      className="bg-zinc-700 hover:bg-zinc-600 text-zinc-200"
                    >
                      Auto-extrair prefixo
                    </Button>
                  </div>

                  {/* Manual prefix */}
                  <div className="flex gap-2 mb-3">
                    <Input
                      value={newPrefixInputs[pattern.transportadora] || ""}
                      onChange={(e) =>
                        setNewPrefixInputs((prev) => ({
                          ...prev,
                          [pattern.transportadora]: e.target.value,
                        }))
                      }
                      className="flex-1 font-mono text-sm bg-zinc-900 border-zinc-700 text-zinc-100"
                      placeholder="Ou digite o prefixo manualmente (ex: 1390)"
                      maxLength={10}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        handleAddCarrierPrefix(
                          pattern.transportadora,
                          newPrefixInputs[pattern.transportadora] || "",
                        )
                      }
                      className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                    >
                      <Plus className="h-3 w-3 mr-1" /> Adicionar
                    </Button>
                  </div>

                  {pattern.prefixos.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {pattern.prefixos.map((pfx) => (
                        <span
                          key={pfx}
                          className="flex items-center gap-1 bg-zinc-900 px-2 py-1 rounded-lg border border-zinc-700 text-xs font-mono text-zinc-200"
                        >
                          {pfx}
                          <button
                            onClick={() =>
                              handleRemoveCarrierPrefix(
                                pattern.transportadora,
                                pfx,
                              )
                            }
                            className="text-red-400 hover:text-red-300"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <h4 className="text-xs font-bold text-zinc-400 mb-2">
                Legendas dos Badges
              </h4>
              <div className="flex flex-wrap gap-2">
                {(
                  Object.keys(CARRIER_DISPLAY) as Array<
                    keyof typeof CARRIER_DISPLAY
                  >
                ).map((carrier) => (
                  <span
                    key={carrier}
                    className={cn(
                      "text-xs font-bold px-2 py-1 rounded border",
                      CARRIER_COLORS[carrier],
                    )}
                  >
                    {CARRIER_DISPLAY[carrier]}
                  </span>
                ))}
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
