"use client";

// /confeccao/templates — admin gerencia templates de WhatsApp.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Edit2, MessageSquareText, Pause, Play, Plus } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";
import { usePapelAtivo } from "@/hooks/use-papel-ativo";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { listarPlaceholdersDisponiveis } from "@/lib/confeccao/resolver-placeholders";
import type { ConfeccaoFornecedorCategoria } from "@/lib/db/schema";

interface Template {
  id: string;
  nome: string;
  categoria: ConfeccaoFornecedorCategoria;
  corpo: string;
  ativo: boolean;
  createdAt: string;
}

const CATEGORIAS: { value: ConfeccaoFornecedorCategoria; label: string }[] = [
  { value: "risco", label: "Risco" },
  { value: "tecido", label: "Tecido (Compra)" },
  { value: "corte", label: "Corte" },
  { value: "costura", label: "Costura" },
  { value: "vies", label: "Viés" },
];

export default function TemplatesPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const { isAdmin } = usePapelAtivo();

  const [items, setItems] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [incluirInativos, setIncluirInativos] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Template | null>(null);

  const [nome, setNome] = useState("");
  const [categoria, setCategoria] = useState<ConfeccaoFornecedorCategoria>("tecido");
  const [corpo, setCorpo] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (incluirInativos) sp.set("incluirInativos", "true");
      const res = await fetch(
        `/api/confeccao/templates-whatsapp?${sp.toString()}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error();
      const data = await res.json();
      setItems(data.items);
    } catch {
      toast.error("Erro ao carregar templates");
    } finally {
      setLoading(false);
    }
  }, [incluirInativos]);

  useEffect(() => {
    if (isPending) return;
    if (!session) {
      router.replace("/login");
      return;
    }
    if (!isAdmin) {
      toast.error("Acesso apenas para admins");
      router.replace("/confeccao");
      return;
    }
    void fetchItems();
  }, [isPending, session, router, isAdmin, fetchItems]);

  function abrirNovo() {
    setEditTarget(null);
    setNome("");
    setCategoria("tecido");
    setCorpo("");
    setModalOpen(true);
  }

  function abrirEditar(t: Template) {
    setEditTarget(t);
    setNome(t.nome);
    setCategoria(t.categoria);
    setCorpo(t.corpo);
    setModalOpen(true);
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const url = editTarget
        ? `/api/confeccao/templates-whatsapp/${editTarget.id}`
        : `/api/confeccao/templates-whatsapp`;
      const method = editTarget ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: nome.trim(),
          categoria,
          corpo,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Erro ao salvar");
        return;
      }
      toast.success(editTarget ? "Atualizado" : "Criado");
      setModalOpen(false);
      void fetchItems();
    } finally {
      setSaving(false);
    }
  }

  async function toggleAtivo(t: Template) {
    const method = t.ativo ? "DELETE" : "PATCH";
    const body = t.ativo ? undefined : JSON.stringify({ ativo: true });
    const res = await fetch(`/api/confeccao/templates-whatsapp/${t.id}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? "Erro");
      return;
    }
    void fetchItems();
  }

  if (isPending || !session || !isAdmin) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Carregando…</div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          title="Templates WhatsApp"
          description="Modelos de mensagem por categoria. Placeholders são substituídos automaticamente."
          icon={<MessageSquareText className="size-8 text-emerald-500" />}
        />
        <Button onClick={abrirNovo}>
          <Plus className="size-4" />
          Novo template
        </Button>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <Switch
          checked={incluirInativos}
          onCheckedChange={(v) => setIncluirInativos(v)}
        />
        Incluir inativos
      </label>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Corpo (preview)</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-32 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  Carregando…
                </TableCell>
              </TableRow>
            )}
            {!loading && items.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  Nenhum template ainda. Crie o primeiro.
                </TableCell>
              </TableRow>
            )}
            {items.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">{t.nome}</TableCell>
                <TableCell>
                  <Badge variant="outline">
                    {CATEGORIAS.find((c) => c.value === t.categoria)?.label ??
                      t.categoria}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-md">
                  <div className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-wrap">
                    {t.corpo}
                  </div>
                </TableCell>
                <TableCell>
                  {t.ativo ? (
                    <Badge variant="default">Ativo</Badge>
                  ) : (
                    <Badge variant="secondary">Inativo</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => abrirEditar(t)}>
                    <Edit2 className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => toggleAtivo(t)}>
                    {t.ativo ? (
                      <Pause className="size-4" />
                    ) : (
                      <Play className="size-4" />
                    )}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editTarget ? "Editar template" : "Novo template"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={salvar} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="nome">Nome</Label>
                <Input
                  id="nome"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  required
                  maxLength={120}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label>Categoria</Label>
                <Select
                  value={categoria}
                  onValueChange={(v) =>
                    setCategoria(v as ConfeccaoFornecedorCategoria)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIAS.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="corpo">Corpo da mensagem</Label>
              <Textarea
                id="corpo"
                value={corpo}
                onChange={(e) => setCorpo(e.target.value)}
                rows={8}
                required
                maxLength={5000}
                placeholder={`Olá, {fornecedor_nome}. Sobre a OP {op_numero}:\n\nProduto: {produto}\nTipo: {tipo_tecido}\nCores: {cor}\n\nAguardo retorno.`}
                className="font-mono text-xs"
              />
              <div className="text-xs text-muted-foreground">
                <span className="font-medium">Placeholders disponíveis:</span>{" "}
                {listarPlaceholdersDisponiveis().map((p, i) => (
                  <span key={p.key}>
                    {i > 0 && ", "}
                    <button
                      type="button"
                      onClick={() =>
                        setCorpo((prev) => prev + `{${p.key}}`)
                      }
                      className="font-mono text-primary hover:underline"
                      title={p.descricao}
                    >
                      {`{${p.key}}`}
                    </button>
                  </span>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setModalOpen(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={saving || !nome.trim() || !corpo.trim()}>
                {saving ? "Salvando…" : "Salvar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
