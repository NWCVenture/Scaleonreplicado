"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Boxes,
  Image as ImageIcon,
  Loader2,
  Palette,
  Plus,
  Ruler,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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

type ModeloRow = {
  id: string;
  codigo: string;
  ativo: boolean;
  etiquetaImagemUrl: string | null;
  etiquetaImagemAtualizadaEm: string | null;
  totalCores: number;
  totalTamanhos: number;
};

type VariacaoRow = {
  id: string;
  codigo: string;
  ativo: boolean;
  ordem?: number;
};

type ModeloDetalhe = {
  modelo: {
    id: string;
    codigo: string;
    ativo: boolean;
    etiquetaImagemUrl: string | null;
    etiquetaImagemAtualizadaEm: string | null;
  };
  cores: VariacaoRow[];
  tamanhos: VariacaoRow[];
};

function normalizeUpper(raw: string): string {
  return raw.trim().toUpperCase();
}

export function ModeloPrincipalTab() {
  const [modelos, setModelos] = useState<ModeloRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [createCodigo, setCreateCodigo] = useState("");
  const [createLoading, setCreateLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ModeloRow | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [detalheId, setDetalheId] = useState<string | null>(null);

  const fetchModelos = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/modelo-principal?incluirInativos=1");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { modelos: ModeloRow[] };
      setModelos(data.modelos ?? []);
    } catch (e) {
      toast.error(`Erro ao listar modelos: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchModelos();
  }, [fetchModelos]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const codigo = normalizeUpper(createCodigo);
    if (!codigo) return;
    setCreateLoading(true);
    try {
      const res = await fetch("/api/modelo-principal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      toast.success(`Modelo ${codigo} criado`);
      setCreateCodigo("");
      setCreateOpen(false);
      fetchModelos();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCreateLoading(false);
    }
  }

  async function handleToggleAtivo(m: ModeloRow) {
    const novo = !m.ativo;
    try {
      const res = await fetch(`/api/modelo-principal/${m.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ativo: novo }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { skusAfetados?: number };
      setModelos((prev) =>
        prev.map((row) => (row.id === m.id ? { ...row, ativo: novo } : row)),
      );
      if (!novo) {
        const extras = data.skusAfetados
          ? ` e ${data.skusAfetados} SKU(s) relacionado(s)`
          : "";
        toast.info(
          `Modelo desativado — variações (cores/tamanhos)${extras} também foram desativadas`,
        );
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      const res = await fetch(`/api/modelo-principal/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(`Modelo ${deleteTarget.codigo} excluído`);
      setModelos((prev) => prev.filter((r) => r.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeleteLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            Gerencie os modelos de SKU principal da sua conta. Cada modelo tem
            seus próprios tamanhos, cores e imagem de etiqueta.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Novo modelo
        </Button>
      </div>

      <div className="rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-3 text-left font-medium">Modelo</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-left font-medium">Tamanhos</th>
              <th className="px-4 py-3 text-left font-medium">Cores</th>
              <th className="px-4 py-3 text-left font-medium">Etiqueta</th>
              <th className="px-4 py-3 text-right font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {modelos.map((m) => (
              <tr
                key={m.id}
                className="border-b last:border-0 hover:bg-muted/30 transition-colors"
              >
                <td className="px-4 py-3 font-mono font-bold">{m.codigo}</td>
                <td className="px-4 py-3">
                  <Switch
                    checked={m.ativo}
                    onCheckedChange={() => handleToggleAtivo(m)}
                  />
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {m.totalTamanhos}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {m.totalCores}
                </td>
                <td className="px-4 py-3">
                  {m.etiquetaImagemUrl ? (
                    // Fundo branco fixo: a impressora térmica imprime só
                    // preto sobre etiqueta branca, então previews em fundo
                    // escuro escondem desenhos pretos. Mantém fidelidade.
                    <a
                      href={m.etiquetaImagemUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block"
                      title="Abrir imagem em tamanho real"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={m.etiquetaImagemUrl}
                        alt={`Etiqueta ${m.codigo}`}
                        className="h-12 w-12 rounded border border-slate-300 bg-white object-contain p-0.5"
                      />
                    </a>
                  ) : (
                    <div
                      className="flex h-12 w-12 items-center justify-center rounded border border-dashed border-slate-600 text-muted-foreground"
                      title="Sem imagem cadastrada"
                    >
                      <ImageIcon className="h-5 w-5" />
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDetalheId(m.id)}
                    >
                      Abrir
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                      title="Excluir modelo"
                      onClick={() => setDeleteTarget(m)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {modelos.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  Nenhum modelo cadastrado. Clique em &quot;Novo modelo&quot;
                  para começar.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Boxes className="h-5 w-5" /> Novo modelo principal
            </DialogTitle>
            <DialogDescription>
              Ex: LUA, NBA, BOB. Código fica em caixa alta.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="novo-modelo-codigo">Código</Label>
              <Input
                id="novo-modelo-codigo"
                value={createCodigo}
                onChange={(e) => setCreateCodigo(e.target.value)}
                placeholder="Ex: LUA"
                className="font-mono uppercase"
                autoFocus
                required
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={createLoading}>
                {createLoading && (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                )}
                Criar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir modelo?</AlertDialogTitle>
            <AlertDialogDescription>
              O modelo {deleteTarget?.codigo} e todas as suas cores/tamanhos
              vinculados serão removidos. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteLoading && (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              )}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {detalheId && (
        <ModeloDetalheDialog
          modeloId={detalheId}
          onClose={() => {
            setDetalheId(null);
            fetchModelos();
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// Dialog de detalhe/edição do modelo
// ============================================================

function ModeloDetalheDialog({
  modeloId,
  onClose,
}: {
  modeloId: string;
  onClose: () => void;
}) {
  const [detalhe, setDetalhe] = useState<ModeloDetalhe | null>(null);
  const [loading, setLoading] = useState(true);

  const [novaCor, setNovaCor] = useState("");
  const [corLoading, setCorLoading] = useState(false);
  const [novoTamanho, setNovoTamanho] = useState("");
  const [tamanhoLoading, setTamanhoLoading] = useState(false);

  const fetchDetalhe = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/modelo-principal/${modeloId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ModeloDetalhe;
      setDetalhe(data);
    } catch (e) {
      toast.error(`Erro ao carregar modelo: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [modeloId]);

  useEffect(() => {
    fetchDetalhe();
  }, [fetchDetalhe]);

  async function toggleModelo() {
    if (!detalhe) return;
    const novo = !detalhe.modelo.ativo;
    try {
      const res = await fetch(`/api/modelo-principal/${modeloId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ativo: novo }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { skusAfetados?: number };
      if (!novo) {
        await fetchDetalhe();
        const extras = data.skusAfetados
          ? ` e ${data.skusAfetados} SKU(s) relacionado(s)`
          : "";
        toast.info(
          `Modelo desativado — variações${extras} também foram desativadas`,
        );
      } else {
        setDetalhe({
          ...detalhe,
          modelo: { ...detalhe.modelo, ativo: novo },
        });
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function toggleVariacao(
    tipo: "cor" | "tamanho",
    v: VariacaoRow,
  ) {
    const novo = !v.ativo;
    try {
      const endpoint =
        tipo === "cor"
          ? `/api/modelo-principal/${modeloId}/cor/${v.id}`
          : `/api/modelo-principal/${modeloId}/tamanho/${v.id}`;
      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ativo: novo }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { skusAfetados?: number };
      setDetalhe((prev) => {
        if (!prev) return prev;
        const key = tipo === "cor" ? "cores" : "tamanhos";
        return {
          ...prev,
          [key]: prev[key].map((row) =>
            row.id === v.id ? { ...row, ativo: novo } : row,
          ),
        };
      });
      if (!novo && data.skusAfetados) {
        toast.info(
          `${data.skusAfetados} SKU(s) que usam ${v.codigo} foram desativados`,
        );
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function deleteVariacao(tipo: "cor" | "tamanho", v: VariacaoRow) {
    try {
      const endpoint =
        tipo === "cor"
          ? `/api/modelo-principal/${modeloId}/cor/${v.id}`
          : `/api/modelo-principal/${modeloId}/tamanho/${v.id}`;
      const res = await fetch(endpoint, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDetalhe((prev) => {
        if (!prev) return prev;
        const key = tipo === "cor" ? "cores" : "tamanhos";
        return {
          ...prev,
          [key]: prev[key].filter((row) => row.id !== v.id),
        };
      });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function addCor(e: React.FormEvent) {
    e.preventDefault();
    const codigo = normalizeUpper(novaCor);
    if (!codigo) return;
    setCorLoading(true);
    try {
      const res = await fetch(`/api/modelo-principal/${modeloId}/cor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const created = (await res.json()) as VariacaoRow;
      setDetalhe((prev) => {
        if (!prev) return prev;
        return { ...prev, cores: [...prev.cores, created] };
      });
      setNovaCor("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCorLoading(false);
    }
  }

  async function addTamanho(e: React.FormEvent) {
    e.preventDefault();
    const codigo = normalizeUpper(novoTamanho);
    if (!codigo) return;
    setTamanhoLoading(true);
    try {
      const res = await fetch(`/api/modelo-principal/${modeloId}/tamanho`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const created = (await res.json()) as VariacaoRow;
      setDetalhe((prev) => {
        if (!prev) return prev;
        return { ...prev, tamanhos: [...prev.tamanhos, created] };
      });
      setNovoTamanho("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setTamanhoLoading(false);
    }
  }

  return (
    <Dialog open={true} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Boxes className="h-5 w-5" />
            {detalhe?.modelo.codigo ?? "Carregando…"}
          </DialogTitle>
          <DialogDescription>
            Gerencie as variações deste modelo (tamanhos, cores) e a imagem
            usada na etiqueta.
          </DialogDescription>
        </DialogHeader>

        {loading || !detalhe ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Status */}
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">Modelo ativo</p>
                <p className="text-xs text-muted-foreground">
                  Desativar esconde este modelo das buscas e do processamento
                  de etiquetas.
                </p>
              </div>
              <Switch
                checked={detalhe.modelo.ativo}
                onCheckedChange={toggleModelo}
              />
            </div>

            {/* Tamanhos */}
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Ruler className="h-4 w-4" />
                <h3 className="font-semibold text-sm">Tamanhos</h3>
                <span className="text-xs text-muted-foreground">
                  ({detalhe.tamanhos.length})
                </span>
              </div>
              <div className="space-y-2">
                {detalhe.tamanhos.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Nenhum tamanho cadastrado.
                  </p>
                )}
                {detalhe.tamanhos.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between rounded-md border px-3 py-2"
                  >
                    <div className="flex items-center gap-3">
                      <Switch
                        checked={t.ativo}
                        onCheckedChange={() => toggleVariacao("tamanho", t)}
                      />
                      <span className="font-mono text-sm">{t.codigo}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => deleteVariacao("tamanho", t)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
              <form onSubmit={addTamanho} className="flex gap-2">
                <Input
                  value={novoTamanho}
                  onChange={(e) => setNovoTamanho(e.target.value)}
                  placeholder="Ex: P, M, GG"
                  className="font-mono uppercase"
                />
                <Button type="submit" size="sm" disabled={tamanhoLoading}>
                  {tamanhoLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  Adicionar
                </Button>
              </form>
            </section>

            {/* Cores */}
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Palette className="h-4 w-4" />
                <h3 className="font-semibold text-sm">Cores</h3>
                <span className="text-xs text-muted-foreground">
                  ({detalhe.cores.length})
                </span>
              </div>
              <div className="space-y-2">
                {detalhe.cores.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Nenhuma cor cadastrada.
                  </p>
                )}
                {detalhe.cores.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between rounded-md border px-3 py-2"
                  >
                    <div className="flex items-center gap-3">
                      <Switch
                        checked={c.ativo}
                        onCheckedChange={() => toggleVariacao("cor", c)}
                      />
                      <span className="font-mono text-sm">{c.codigo}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => deleteVariacao("cor", c)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
              <form onSubmit={addCor} className="flex gap-2">
                <Input
                  value={novaCor}
                  onChange={(e) => setNovaCor(e.target.value)}
                  placeholder="Ex: AZ, BR, PT"
                  className="font-mono uppercase"
                />
                <Button type="submit" size="sm" disabled={corLoading}>
                  {corLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  Adicionar
                </Button>
              </form>
            </section>

            {/* Imagem da etiqueta */}
            <EtiquetaImagemSection
              modeloId={modeloId}
              imagemUrl={detalhe.modelo.etiquetaImagemUrl}
              onChange={(url) =>
                setDetalhe((prev) =>
                  prev
                    ? {
                        ...prev,
                        modelo: { ...prev.modelo, etiquetaImagemUrl: url },
                      }
                    : prev,
                )
              }
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Upload de imagem vetorial (PNG/JPEG/WebP) que vai na etiqueta
// ============================================================

function EtiquetaImagemSection({
  modeloId,
  imagemUrl,
  onChange,
}: {
  modeloId: string;
  imagemUrl: string | null;
  onChange: (url: string | null) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(
        `/api/modelo-principal/${modeloId}/imagem`,
        { method: "POST", body: form },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { etiquetaImagemUrl: string | null };
      onChange(data.etiquetaImagemUrl);
      toast.success("Imagem atualizada");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function handleRemove() {
    setRemoving(true);
    try {
      const res = await fetch(
        `/api/modelo-principal/${modeloId}/imagem`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onChange(null);
      toast.success("Imagem removida");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRemoving(false);
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <ImageIcon className="h-4 w-4" />
        <h3 className="font-semibold text-sm">Imagem da etiqueta</h3>
      </div>

      <div className="rounded-md border bg-amber-950/20 border-amber-900/50 p-3 text-xs text-amber-200 space-y-1">
        <p className="font-medium">Como cadastrar</p>
        <ul className="list-disc list-inside text-amber-200/80 space-y-0.5">
          <li>
            <b>Formato:</b> PNG (recomendado, com fundo transparente) ou JPEG
          </li>
          <li>
            <b>Dimensão mínima:</b> 80×80px; ideal 200×200px quadrado
          </li>
          <li>
            <b>Tamanho máximo:</b> 2MB
          </li>
          <li>
            Figura será desenhada com ~20pt de largura no canto inferior direito
            da etiqueta, lado a lado quando o pedido tem mais de um modelo
          </li>
          <li>
            Use preto puro sobre fundo transparente para melhor leitura em
            impressoras térmicas Zebra ZD220
          </li>
        </ul>
      </div>

      {imagemUrl ? (
        <div className="rounded-md border p-3 flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imagemUrl}
            alt="Etiqueta"
            className="h-16 w-16 object-contain bg-white rounded"
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Imagem cadastrada</p>
            <p className="text-xs text-muted-foreground truncate">
              Será usada nas etiquetas geradas para este modelo.
            </p>
          </div>
          <div className="flex gap-2">
            <label className="inline-flex">
              <input
                type="file"
                accept="image/png,image/jpeg"
                className="hidden"
                onChange={handleUpload}
                disabled={uploading}
              />
              <Button
                asChild
                variant="outline"
                size="sm"
                disabled={uploading}
              >
                <span className="cursor-pointer">
                  {uploading && (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  )}
                  Substituir
                </span>
              </Button>
            </label>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRemove}
              disabled={removing}
              className="text-destructive hover:text-destructive"
            >
              {removing && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Remover
            </Button>
          </div>
        </div>
      ) : (
        <label className="rounded-md border border-dashed p-6 flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-muted/30 transition-colors">
          <input
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={handleUpload}
            disabled={uploading}
          />
          <ImageIcon className="h-6 w-6 text-muted-foreground" />
          <p className="text-sm">
            {uploading ? "Enviando…" : "Clique para enviar imagem"}
          </p>
          <p className="text-xs text-muted-foreground">
            PNG ou JPEG até 2MB
          </p>
        </label>
      )}
    </section>
  );
}
