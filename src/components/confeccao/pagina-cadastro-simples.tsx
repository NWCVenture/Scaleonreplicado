"use client";

// Página de cadastro genérica pra entidades simples do módulo Confecção
// que só têm o campo `nome` (tipos de tecido, cores). Centraliza:
// busca + paginação, modal create/edit, soft delete, reativar.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Edit2, Pause, Play, Plus } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";
import { usePapelAtivo } from "@/hooks/use-papel-ativo";
import { useCadastroPaginado } from "@/hooks/use-cadastro-paginado";
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
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface EntidadeBase {
  id: string;
  nome: string;
  ativo: boolean;
  createdAt: string;
}

export interface PaginaCadastroSimplesProps {
  endpoint: string;
  titulo: string;
  descricao: string;
  singular: string;
  plural: string;
  icone: React.ReactNode;
  nomeMax?: number;
  nomeMin?: number;
}

export function PaginaCadastroSimples(props: PaginaCadastroSimplesProps) {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const { isAdmin } = usePapelAtivo();
  const lista = useCadastroPaginado<EntidadeBase>({ endpoint: props.endpoint });

  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<EntidadeBase | null>(null);
  const [nome, setNome] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isPending) return;
    if (!session) router.replace("/login");
  }, [isPending, session, router]);

  function abrirNovo() {
    setEditTarget(null);
    setNome("");
    setModalOpen(true);
  }

  function abrirEditar(item: EntidadeBase) {
    setEditTarget(item);
    setNome(item.nome);
    setModalOpen(true);
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const url = editTarget
        ? `${props.endpoint}/${editTarget.id}`
        : props.endpoint;
      const method = editTarget ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: nome.trim() }),
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
          title={props.titulo}
          description={props.descricao}
          icon={props.icone}
        />
        {isAdmin && (
          <Button onClick={abrirNovo}>
            <Plus className="size-4" />
            Novo {props.singular}
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
              <TableHead>Status</TableHead>
              {isAdmin && (
                <TableHead className="w-32 text-right">Ações</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {lista.loading && (
              <TableRow>
                <TableCell
                  colSpan={isAdmin ? 3 : 2}
                  className="text-center text-muted-foreground"
                >
                  Carregando…
                </TableCell>
              </TableRow>
            )}
            {!lista.loading && lista.items.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={isAdmin ? 3 : 2}
                  className="text-center text-muted-foreground"
                >
                  Nenhum {props.singular} encontrado.
                </TableCell>
              </TableRow>
            )}
            {lista.items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-medium">{item.nome}</TableCell>
                <TableCell>
                  {item.ativo ? (
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
                      onClick={() => abrirEditar(item)}
                      aria-label="Editar"
                    >
                      <Edit2 className="size-4" />
                    </Button>
                    {item.ativo ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => void lista.softDelete(item.id)}
                        aria-label="Desativar"
                      >
                        <Pause className="size-4" />
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => void lista.reativar(item.id)}
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
              {editTarget ? `Editar ${props.singular}` : `Novo ${props.singular}`}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={salvar} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="nome">Nome</Label>
              <Input
                id="nome"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                required
                minLength={props.nomeMin ?? 2}
                maxLength={props.nomeMax ?? 60}
                autoFocus
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
              <Button type="submit" disabled={saving || !nome.trim()}>
                {saving ? "Salvando…" : "Salvar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
