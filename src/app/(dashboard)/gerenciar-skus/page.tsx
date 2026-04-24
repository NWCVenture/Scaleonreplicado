"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
import {
  Loader2,
  Plus,
  Tag,
  Trash2,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { generateAll, type SkuGenOptions } from "@/lib/sku-generator";
import { ModeloPrincipalTab } from "./_components/modelo-principal-tab";

type SkuRow = {
  id: string;
  codigo: string;
  contaId: string;
  ativo: boolean;
  createdAt: string;
};

type CorRow = {
  id: string;
  codigo: string;
  ativo: boolean;
};

type TamanhoRow = {
  id: string;
  codigo: string;
  ativo: boolean;
  ordem: number;
};

function normalizeUpper(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, " ");
}

export default function GerenciarSkusPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();

  const [skus, setSkus] = useState<SkuRow[]>([]);
  const [loadingSkus, setLoadingSkus] = useState(true);
  const [busca, setBusca] = useState("");
  const [mostrarInativos, setMostrarInativos] = useState(false);

  const [cores, setCores] = useState<CorRow[]>([]);
  const [tamanhos, setTamanhos] = useState<TamanhoRow[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [createModelo, setCreateModelo] = useState("");
  const [coresSelecionadas, setCoresSelecionadas] = useState<Set<string>>(
    new Set(),
  );
  const [tamanhosSelecionados, setTamanhosSelecionados] = useState<Set<string>>(
    new Set(),
  );
  const [tipos, setTipos] = useState<SkuGenOptions>({
    simple: true,
    kit2: false,
    kit3: false,
    mix3: false,
  });
  const [novaCor, setNovaCor] = useState("");
  const [novoTamanho, setNovoTamanho] = useState("");
  const [addingCor, setAddingCor] = useState(false);
  const [addingTamanho, setAddingTamanho] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<SkuRow | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [toggleLoading, setToggleLoading] = useState<string | null>(null);

  const fetchSkus = useCallback(async () => {
    setLoadingSkus(true);
    try {
      const res = await fetch(
        `/api/sku-catalogo${mostrarInativos ? "?incluirInativos=1" : ""}`,
      );
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSkus(data.skus ?? []);
    } catch {
      toast.error("Erro ao carregar SKUs");
    } finally {
      setLoadingSkus(false);
    }
  }, [mostrarInativos]);

  const fetchCoresTamanhos = useCallback(async () => {
    try {
      const [coresRes, tamRes] = await Promise.all([
        fetch("/api/cor-catalogo"),
        fetch("/api/tamanho-catalogo"),
      ]);
      if (coresRes.ok) {
        const data = await coresRes.json();
        setCores(data.cores ?? []);
      }
      if (tamRes.ok) {
        const data = await tamRes.json();
        setTamanhos(data.tamanhos ?? []);
      }
    } catch {
      toast.error("Erro ao carregar cores/tamanhos");
    }
  }, []);

  useEffect(() => {
    if (!isPending && session) {
      fetchSkus();
      fetchCoresTamanhos();
    }
    if (!isPending && !session) {
      router.replace("/login");
    }
  }, [isPending, session, router, fetchSkus, fetchCoresTamanhos]);

  const skusFiltrados = useMemo(() => {
    const q = busca.trim().toUpperCase();
    if (!q) return skus;
    return skus.filter((s) => s.codigo.toUpperCase().includes(q));
  }, [skus, busca]);

  const totalAtivos = useMemo(() => skus.filter((s) => s.ativo).length, [skus]);
  const totalInativos = skus.length - totalAtivos;

  const coresAtivas = useMemo(
    () => cores.filter((c) => c.ativo).sort((a, b) => a.codigo.localeCompare(b.codigo)),
    [cores],
  );
  const tamanhosAtivos = useMemo(
    () =>
      tamanhos
        .filter((t) => t.ativo)
        .sort((a, b) => a.ordem - b.ordem || a.codigo.localeCompare(b.codigo)),
    [tamanhos],
  );

  const coresArr = useMemo(
    () =>
      coresAtivas.filter((c) => coresSelecionadas.has(c.id)).map((c) => c.codigo),
    [coresAtivas, coresSelecionadas],
  );
  const tamanhosArr = useMemo(
    () =>
      tamanhosAtivos
        .filter((t) => tamanhosSelecionados.has(t.id))
        .map((t) => t.codigo),
    [tamanhosAtivos, tamanhosSelecionados],
  );

  const mix3Disabled = coresArr.length !== 3;

  const preview = useMemo(() => {
    if (!createModelo.trim() || tamanhosArr.length === 0) return [];
    const tiposEffective: SkuGenOptions = {
      ...tipos,
      mix3: tipos.mix3 && !mix3Disabled,
    };
    if (
      !tiposEffective.simple &&
      !tiposEffective.kit2 &&
      !tiposEffective.kit3 &&
      !tiposEffective.mix3
    )
      return [];
    return generateAll(
      { modelo: createModelo, cores: coresArr, tamanhos: tamanhosArr },
      tiposEffective,
    );
  }, [createModelo, coresArr, tamanhosArr, tipos, mix3Disabled]);

  function resetCreateForm() {
    setCreateModelo("");
    setCoresSelecionadas(new Set());
    setTamanhosSelecionados(new Set());
    setTipos({ simple: true, kit2: false, kit3: false, mix3: false });
    setNovaCor("");
    setNovoTamanho("");
  }

  async function handleAddCor() {
    const codigo = normalizeUpper(novaCor);
    if (!codigo) return;
    setAddingCor(true);
    try {
      const res = await fetch("/api/cor-catalogo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409) {
          const existing = cores.find((c) => c.codigo === codigo);
          if (existing) {
            setCoresSelecionadas((prev) => new Set(prev).add(existing.id));
            setNovaCor("");
            return;
          }
        }
        toast.error(data.error || "Erro ao adicionar cor");
        return;
      }
      setCores((prev) => [...prev, data]);
      setCoresSelecionadas((prev) => new Set(prev).add(data.id));
      setNovaCor("");
    } finally {
      setAddingCor(false);
    }
  }

  async function handleAddTamanho() {
    const codigo = normalizeUpper(novoTamanho);
    if (!codigo) return;
    setAddingTamanho(true);
    try {
      const res = await fetch("/api/tamanho-catalogo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo, ordem: tamanhos.length }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409) {
          const existing = tamanhos.find((t) => t.codigo === codigo);
          if (existing) {
            setTamanhosSelecionados((prev) => new Set(prev).add(existing.id));
            setNovoTamanho("");
            return;
          }
        }
        toast.error(data.error || "Erro ao adicionar tamanho");
        return;
      }
      setTamanhos((prev) => [...prev, data]);
      setTamanhosSelecionados((prev) => new Set(prev).add(data.id));
      setNovoTamanho("");
    } finally {
      setAddingTamanho(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (preview.length === 0) {
      toast.error("Nenhum SKU para gerar. Verifique modelo, tamanhos e tipos.");
      return;
    }
    setCreateLoading(true);
    try {
      const res = await fetch("/api/sku-catalogo/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigos: preview }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Erro ao cadastrar SKUs");
        return;
      }
      const msg = data.skipped
        ? `${data.created} SKU(s) criados, ${data.skipped} ja existiam`
        : `${data.created} SKU(s) cadastrados!`;
      toast.success(msg);
      resetCreateForm();
      setCreateOpen(false);
      fetchSkus();
    } finally {
      setCreateLoading(false);
    }
  }

  async function handleToggleAtivo(sku: SkuRow) {
    setToggleLoading(sku.id);
    try {
      const res = await fetch(`/api/sku-catalogo/${sku.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ativo: !sku.ativo }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Erro ao atualizar SKU");
        return;
      }
      toast.success(sku.ativo ? "SKU desativado" : "SKU reativado");
      setSkus((prev) =>
        prev.map((s) => (s.id === sku.id ? { ...s, ativo: !sku.ativo } : s)),
      );
    } finally {
      setToggleLoading(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      const res = await fetch(`/api/sku-catalogo/${deleteTarget.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Erro ao desativar SKU");
        return;
      }
      const aviso =
        data.stockItemsAffected > 0
          ? ` (${data.stockItemsAffected} itens em estoque ainda referenciam este SKU)`
          : "";
      toast.success(`SKU desativado${aviso}`);
      if (mostrarInativos) {
        setSkus((prev) =>
          prev.map((s) =>
            s.id === deleteTarget.id ? { ...s, ativo: false } : s,
          ),
        );
      } else {
        setSkus((prev) => prev.filter((s) => s.id !== deleteTarget.id));
      }
      setDeleteTarget(null);
    } finally {
      setDeleteLoading(false);
    }
  }

  if (isPending || loadingSkus) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Tag className="h-6 w-6" />
          Gerenciar SKUs
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Catálogo de produtos da sua conta. {totalAtivos} ativos
          {totalInativos > 0 && `, ${totalInativos} inativos`}.
        </p>
      </div>

      <Tabs defaultValue="skus" className="space-y-4">
        <TabsList>
          <TabsTrigger value="skus">SKUs</TabsTrigger>
          <TabsTrigger value="modelos">SKU Principal</TabsTrigger>
        </TabsList>

        <TabsContent value="skus" className="space-y-4">
          <div className="flex items-center justify-end">
            <Button onClick={() => setCreateOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Novo SKU
            </Button>
          </div>
          <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar SKU..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="pl-9 uppercase font-mono"
          />
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="mostrar-inativos"
            checked={mostrarInativos}
            onCheckedChange={setMostrarInativos}
          />
          <Label htmlFor="mostrar-inativos" className="text-sm cursor-pointer">
            Mostrar inativos
          </Label>
        </div>
      </div>

      <div className="rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-3 text-left font-medium">SKU</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-left font-medium">Cadastrado em</th>
              <th className="px-4 py-3 text-right font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {skusFiltrados.map((sku) => (
              <tr
                key={sku.id}
                className="border-b last:border-0 hover:bg-muted/30 transition-colors"
              >
                <td className="px-4 py-3 font-mono font-bold">{sku.codigo}</td>
                <td className="px-4 py-3">
                  {sku.ativo ? (
                    <Badge className="bg-green-600">Ativo</Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">
                      Inativo
                    </Badge>
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground text-xs">
                  {new Date(sku.createdAt).toLocaleDateString("pt-BR")}
                </td>
                <td className="px-4 py-3 text-right">
                  {sku.ativo ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                      title="Desativar SKU"
                      disabled={toggleLoading === sku.id}
                      onClick={() => setDeleteTarget(sku)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-green-600 hover:text-green-700 hover:bg-green-50"
                      title="Reativar SKU"
                      disabled={toggleLoading === sku.id}
                      onClick={() => handleToggleAtivo(sku)}
                    >
                      {toggleLoading === sku.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {skusFiltrados.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  {busca
                    ? `Nenhum SKU encontrado para "${busca}"`
                    : "Nenhum SKU cadastrado ainda. Clique em \"Novo SKU\" para começar."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
        </TabsContent>

        <TabsContent value="modelos">
          <ModeloPrincipalTab />
        </TabsContent>
      </Tabs>

      {/* Create SKU dialog */}
      <Dialog
        open={createOpen}
        onOpenChange={(o) => {
          setCreateOpen(o);
          if (!o) resetCreateForm();
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" />
              Novo SKU
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-5">
            {/* Modelo */}
            <div className="space-y-2">
              <Label htmlFor="modelo">SKU principal (modelo)</Label>
              <Input
                id="modelo"
                placeholder="Ex: SOL"
                value={createModelo}
                onChange={(e) => setCreateModelo(e.target.value)}
                className="uppercase font-mono"
                autoFocus
                required
              />
            </div>

            {/* Cores */}
            <div className="space-y-2">
              <Label>Cores</Label>
              <div className="flex flex-wrap gap-2 rounded-md border p-3 min-h-[60px]">
                {coresAtivas.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Nenhuma cor cadastrada. Adicione abaixo.
                  </p>
                )}
                {coresAtivas.map((c) => {
                  const checked = coresSelecionadas.has(c.id);
                  return (
                    <label
                      key={c.id}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border cursor-pointer text-sm font-mono transition-colors ${
                        checked
                          ? "bg-primary text-primary-foreground border-primary"
                          : "hover:bg-muted"
                      }`}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => {
                          setCoresSelecionadas((prev) => {
                            const next = new Set(prev);
                            if (v) next.add(c.id);
                            else next.delete(c.id);
                            return next;
                          });
                        }}
                        className="h-3.5 w-3.5"
                      />
                      {c.codigo}
                    </label>
                  );
                })}
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="Adicionar cor (ex: AZ)"
                  value={novaCor}
                  onChange={(e) => setNovaCor(e.target.value)}
                  className="uppercase font-mono h-8 text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddCor();
                    }
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleAddCor}
                  disabled={addingCor || !novaCor.trim()}
                  className="gap-1 h-8"
                >
                  {addingCor ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Plus className="h-3 w-3" />
                  )}
                  Add
                </Button>
              </div>
            </div>

            {/* Tamanhos */}
            <div className="space-y-2">
              <Label>Tamanhos</Label>
              <div className="flex flex-wrap gap-2 rounded-md border p-3 min-h-[60px]">
                {tamanhosAtivos.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Nenhum tamanho cadastrado. Adicione abaixo.
                  </p>
                )}
                {tamanhosAtivos.map((t) => {
                  const checked = tamanhosSelecionados.has(t.id);
                  return (
                    <label
                      key={t.id}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border cursor-pointer text-sm font-mono transition-colors ${
                        checked
                          ? "bg-primary text-primary-foreground border-primary"
                          : "hover:bg-muted"
                      }`}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => {
                          setTamanhosSelecionados((prev) => {
                            const next = new Set(prev);
                            if (v) next.add(t.id);
                            else next.delete(t.id);
                            return next;
                          });
                        }}
                        className="h-3.5 w-3.5"
                      />
                      {t.codigo}
                    </label>
                  );
                })}
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="Adicionar tamanho (ex: G)"
                  value={novoTamanho}
                  onChange={(e) => setNovoTamanho(e.target.value)}
                  className="uppercase font-mono h-8 text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddTamanho();
                    }
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleAddTamanho}
                  disabled={addingTamanho || !novoTamanho.trim()}
                  className="gap-1 h-8"
                >
                  {addingTamanho ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Plus className="h-3 w-3" />
                  )}
                  Add
                </Button>
              </div>
            </div>

            {/* Tipos */}
            <div className="space-y-2">
              <Label>Tipos de SKU a gerar</Label>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex items-center gap-2 px-3 py-2 rounded-md border cursor-pointer hover:bg-muted">
                  <Checkbox
                    checked={tipos.simple}
                    onCheckedChange={(v) =>
                      setTipos((p) => ({ ...p, simple: !!v }))
                    }
                  />
                  <span className="text-sm">SKU simples</span>
                </label>
                <label className="flex items-center gap-2 px-3 py-2 rounded-md border cursor-pointer hover:bg-muted">
                  <Checkbox
                    checked={tipos.kit2}
                    onCheckedChange={(v) =>
                      setTipos((p) => ({ ...p, kit2: !!v }))
                    }
                  />
                  <span className="text-sm">KIT 2 (pares de peças)</span>
                </label>
                <label className="flex items-center gap-2 px-3 py-2 rounded-md border cursor-pointer hover:bg-muted">
                  <Checkbox
                    checked={tipos.kit3}
                    onCheckedChange={(v) =>
                      setTipos((p) => ({ ...p, kit3: !!v }))
                    }
                  />
                  <span className="text-sm">KIT 3 (trios de peças)</span>
                </label>
                <label
                  className={`flex items-center gap-2 px-3 py-2 rounded-md border ${
                    mix3Disabled
                      ? "opacity-50 cursor-not-allowed"
                      : "cursor-pointer hover:bg-muted"
                  }`}
                  title={
                    mix3Disabled
                      ? "Selecione exatamente 3 cores para usar MIX 3"
                      : ""
                  }
                >
                  <Checkbox
                    checked={tipos.mix3 && !mix3Disabled}
                    disabled={mix3Disabled}
                    onCheckedChange={(v) =>
                      setTipos((p) => ({ ...p, mix3: !!v }))
                    }
                  />
                  <span className="text-sm">
                    MIX 3 {mix3Disabled && "(requer 3 cores)"}
                  </span>
                </label>
              </div>
            </div>

            {/* Preview */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Preview ({preview.length} SKUs)</Label>
                {preview.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setCoresSelecionadas(new Set());
                      setTamanhosSelecionados(new Set());
                    }}
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                  >
                    <X className="h-3 w-3" />
                    Limpar seleção
                  </button>
                )}
              </div>
              <div className="rounded-md border bg-muted/30 max-h-48 overflow-y-auto p-2 font-mono text-xs space-y-0.5">
                {preview.length === 0 ? (
                  <p className="text-muted-foreground p-2">
                    Configure modelo, tamanhos e ao menos um tipo para gerar
                    SKUs.
                  </p>
                ) : (
                  preview.map((sku, i) => (
                    <div key={i} className="px-2 py-0.5 hover:bg-muted">
                      {sku}
                    </div>
                  ))
                )}
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setCreateOpen(false);
                  resetCreateForm();
                }}
                disabled={createLoading}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={createLoading || preview.length === 0}
                className="gap-2"
              >
                {createLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                Cadastrar {preview.length > 0 && `${preview.length} SKU(s)`}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Deactivate confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desativar SKU?</AlertDialogTitle>
            <AlertDialogDescription>
              O SKU{" "}
              <strong className="font-mono">{deleteTarget?.codigo}</strong> será
              desativado e deixará de aparecer no autocomplete de cadastro de
              fardos. Itens já existentes em estoque continuam intocados — você
              pode reativar o SKU a qualquer momento.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteLoading}
              className="bg-destructive hover:bg-destructive/90 gap-2"
            >
              {deleteLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              Desativar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
