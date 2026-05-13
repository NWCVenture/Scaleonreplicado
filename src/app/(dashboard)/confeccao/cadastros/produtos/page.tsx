"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Boxes, Edit2, Pause, Plus, Play } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";
import { usePapelAtivo } from "@/hooks/use-papel-ativo";
import { useCadastroPaginado } from "@/hooks/use-cadastro-paginado";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

interface Produto {
  id: string;
  nome: string;
  descricao: string | null;
  ativo: boolean;
  createdAt: string;
  updatedAt: string;
}

export default function ProdutosPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const { isAdmin } = usePapelAtivo();

  const lista = useCadastroPaginado<Produto>({
    endpoint: "/api/confeccao/produtos",
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Produto | null>(null);
  const [form, setForm] = useState({ nome: "", descricao: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isPending) return;
    if (!session) router.replace("/login");
  }, [isPending, session, router]);

  function abrirNovo() {
    setEditTarget(null);
    setForm({ nome: "", descricao: "" });
    setModalOpen(true);
  }

  function abrirEditar(p: Produto) {
    setEditTarget(p);
    setForm({ nome: p.nome, descricao: p.descricao ?? "" });
    setModalOpen(true);
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        nome: form.nome.trim(),
        descricao: form.descricao.trim() || undefined,
      };
      const url = editTarget
        ? `/api/confeccao/produtos/${editTarget.id}`
        : `/api/confeccao/produtos`;
      const method = editTarget ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Erro ao salvar");
        return;
      }
      toast.success(editTarget ? "Atualizado" : "Criado");
      setModalOpen(false);
      lista.refresh();
    } finally {
      setSaving(false);
    }
  }

  if (isPending || !session) {
    return <div className="p-6 text-sm text-muted-foreground">Carregando…</div>;
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          title="Produtos"
          description="Produtos produzidos pela confecção (separado de SKU comercial)"
          icon={<Boxes className="size-8 text-blue-500" />}
        />
        {isAdmin && (
          <Button onClick={abrirNovo}>
            <Plus className="size-4" />
            Novo produto
          </Button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
        <Input
          placeholder="Buscar por nome…"
          value={lista.search}
          onChange={(e) => {
            lista.setSearch(e.target.value);
            lista.setPage(1);
          }}
          className="max-w-xs"
        />
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={lista.incluirInativos}
            onCheckedChange={(v) => {
              lista.setIncluirInativos(v);
              lista.setPage(1);
            }}
          />
          Incluir inativos
        </label>
      </div>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead>Status</TableHead>
              {isAdmin && <TableHead className="w-32 text-right">Ações</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {lista.loading && (
              <TableRow>
                <TableCell colSpan={isAdmin ? 4 : 3} className="text-center text-muted-foreground">
                  Carregando…
                </TableCell>
              </TableRow>
            )}
            {!lista.loading && lista.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={isAdmin ? 4 : 3} className="text-center text-muted-foreground">
                  Nenhum produto encontrado.
                </TableCell>
              </TableRow>
            )}
            {lista.items.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.nome}</TableCell>
                <TableCell className="text-muted-foreground">
                  {p.descricao ?? "—"}
                </TableCell>
                <TableCell>
                  {p.ativo ? (
                    <Badge variant="default">Ativo</Badge>
                  ) : (
                    <Badge variant="secondary">Inativo</Badge>
                  )}
                </TableCell>
                {isAdmin && (
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => abrirEditar(p)}
                      aria-label="Editar"
                    >
                      <Edit2 className="size-4" />
                    </Button>
                    {p.ativo ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => void lista.softDelete(p.id)}
                        aria-label="Desativar"
                      >
                        <Pause className="size-4" />
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => void lista.reativar(p.id)}
                        aria-label="Reativar"
                      >
                        <Play className="size-4" />
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {lista.totalPaginas > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Página {lista.page} de {lista.totalPaginas} • {lista.total} totais
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={lista.page === 1}
              onClick={() => lista.setPage(lista.page - 1)}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={lista.page >= lista.totalPaginas}
              onClick={() => lista.setPage(lista.page + 1)}
            >
              Próxima
            </Button>
          </div>
        </div>
      )}

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editTarget ? "Editar produto" : "Novo produto"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={salvar} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="nome">Nome</Label>
              <Input
                id="nome"
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
                required
                minLength={2}
                maxLength={120}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="descricao">Descrição (opcional)</Label>
              <Textarea
                id="descricao"
                value={form.descricao}
                onChange={(e) =>
                  setForm({ ...form, descricao: e.target.value })
                }
                maxLength={500}
                rows={3}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setModalOpen(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={saving || !form.nome.trim()}>
                {saving ? "Salvando…" : "Salvar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
