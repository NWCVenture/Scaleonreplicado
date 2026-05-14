"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { usePapelAtivo, type PapelConta } from "@/hooks/use-papel-ativo";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Trash2,
  Shield,
  ShieldCheck,
  UserCog,
  Truck,
  Briefcase,
  Pencil,
} from "lucide-react";

type UserRow = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  papelNaConta: PapelConta;
  isSystemAdmin: boolean;
};

const PAPEIS_ATRIBUIVEIS: PapelConta[] = [
  "admin",
  "gerente",
  "supervisor",
  "operador",
  "funcionario",
  "expedicao",
  "costureiro",
  "financeiro",
  "fiscal",
];

const PAPEL_LABELS: Record<PapelConta, string> = {
  owner: "Owner",
  admin: "Administrador",
  gerente: "Gerente",
  operador: "Operador",
  costureiro: "Costureiro",
  financeiro: "Financeiro",
  fiscal: "Fiscal",
  supervisor: "Supervisor",
  funcionario: "Funcionário",
  expedicao: "Expedição",
};

const PAPEL_BADGE_CLASS: Record<PapelConta, string> = {
  owner: "bg-amber-600",
  admin: "bg-green-600",
  gerente: "bg-purple-600",
  operador: "bg-blue-600",
  costureiro: "bg-pink-600",
  financeiro: "bg-emerald-600",
  fiscal: "bg-cyan-600",
  supervisor: "bg-purple-600",
  funcionario: "bg-blue-600",
  expedicao: "bg-green-700",
};

function PapelIcon({
  papel,
  className,
}: {
  papel: PapelConta;
  className?: string;
}) {
  if (papel === "owner" || papel === "admin")
    return <ShieldCheck className={className} />;
  if (papel === "gerente" || papel === "supervisor")
    return <Briefcase className={className} />;
  if (papel === "expedicao") return <Truck className={className} />;
  return <Shield className={className} />;
}

export default function GerenciarUsuariosPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const { isAdmin, loading: papelLoading } = usePapelAtivo();

  const [users, setUsers] = useState<UserRow[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    papel: "funcionario" as PapelConta,
  });

  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [editTarget, setEditTarget] = useState<UserRow | null>(null);
  const [editForm, setEditForm] = useState({ name: "", email: "" });
  const [editLoading, setEditLoading] = useState(false);

  const [papelLoadingId, setPapelLoadingId] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      const res = await fetch("/api/users");
      if (!res.ok) throw new Error();
      setUsers(await res.json());
    } catch {
      toast.error("Erro ao carregar usuários");
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  useEffect(() => {
    if (isPending || papelLoading) return;
    if (!session) {
      router.replace("/login");
      return;
    }
    if (!isAdmin) {
      router.replace("/");
      return;
    }
    fetchUsers();
  }, [isPending, session, isAdmin, papelLoading, router, fetchUsers]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateLoading(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Erro ao criar usuário");
        return;
      }
      toast.success("Usuário criado com sucesso!");
      setCreateOpen(false);
      setForm({
        name: "",
        email: "",
        password: "",
        papel: "funcionario" as PapelConta,
      });
      fetchUsers();
    } finally {
      setCreateLoading(false);
    }
  }

  async function handlePapelChange(u: UserRow, novoPapel: PapelConta) {
    if (novoPapel === u.papelNaConta) return;
    setPapelLoadingId(u.id);
    try {
      const res = await fetch(`/api/users/${u.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ papel: novoPapel }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Erro ao alterar papel");
        return;
      }
      toast.success("Papel atualizado!");
      setUsers((prev) =>
        prev.map((x) =>
          x.id === u.id ? { ...x, papelNaConta: novoPapel } : x,
        ),
      );
    } finally {
      setPapelLoadingId(null);
    }
  }

  function openEdit(u: UserRow) {
    setEditTarget(u);
    setEditForm({ name: u.name, email: u.email });
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editTarget) return;
    // Só envia campos que mudaram pra não revalidar/colidir email à toa.
    const payload: { name?: string; email?: string } = {};
    if (editForm.name.trim() && editForm.name.trim() !== editTarget.name)
      payload.name = editForm.name.trim();
    if (
      editForm.email.trim() &&
      editForm.email.trim().toLowerCase() !== editTarget.email.toLowerCase()
    )
      payload.email = editForm.email.trim().toLowerCase();

    if (Object.keys(payload).length === 0) {
      setEditTarget(null);
      return;
    }

    setEditLoading(true);
    try {
      const res = await fetch(`/api/users/${editTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Erro ao atualizar usuário");
        return;
      }
      toast.success("Usuário atualizado!");
      setUsers((prev) =>
        prev.map((x) =>
          x.id === editTarget.id
            ? { ...x, name: data.name ?? x.name, email: data.email ?? x.email }
            : x,
        ),
      );
      setEditTarget(null);
    } finally {
      setEditLoading(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      const res = await fetch(`/api/users/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (res.status === 204) {
        toast.success("Usuário removido da conta!");
        setUsers((prev) => prev.filter((x) => x.id !== deleteTarget.id));
        setDeleteTarget(null);
        return;
      }
      const data = await res.json();
      toast.error(data.error || "Erro ao remover usuário");
    } finally {
      setDeleteLoading(false);
    }
  }

  if (isPending || papelLoading || loadingUsers) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const currentUserId = session?.user?.id;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <UserCog className="h-6 w-6" />
            Gerenciar Usuários
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Cadastre e gerencie os usuários da conta ativa
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Novo Usuário
        </Button>
      </div>

      <div className="rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-3 text-left font-medium">Nome</th>
              <th className="px-4 py-3 text-left font-medium">Email</th>
              <th className="px-4 py-3 text-left font-medium">Papel</th>
              <th className="px-4 py-3 text-left font-medium">Cadastrado em</th>
              <th className="px-4 py-3 text-right font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isSelf = u.id === currentUserId;
              const isOwner = u.papelNaConta === "owner";
              const lockedRow = isOwner || isSelf;
              return (
                <tr
                  key={u.id}
                  className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                >
                  <td className="px-4 py-3 font-medium">
                    <div className="flex items-center gap-2">
                      {u.name}
                      {isOwner && (
                        <Badge
                          variant="outline"
                          className="text-xs border-amber-500 text-amber-600 gap-1"
                        >
                          <ShieldCheck className="h-3 w-3" />
                          Owner
                        </Badge>
                      )}
                      {isSelf && (
                        <Badge variant="outline" className="text-xs">
                          Você
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
                    {u.email}
                  </td>
                  <td className="px-4 py-3">
                    {lockedRow ? (
                      <Badge className={PAPEL_BADGE_CLASS[u.papelNaConta]}>
                        {PAPEL_LABELS[u.papelNaConta]}
                      </Badge>
                    ) : (
                      <Select
                        value={u.papelNaConta}
                        onValueChange={(v) =>
                          handlePapelChange(u, v as PapelConta)
                        }
                        disabled={papelLoadingId === u.id}
                      >
                        <SelectTrigger className="h-7 w-40 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PAPEIS_ATRIBUIVEIS.map((p) => (
                            <SelectItem key={p} value={p}>
                              <div className="flex items-center gap-2">
                                <PapelIcon papel={p} className="h-3 w-3" />
                                {PAPEL_LABELS[p]}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {new Date(u.createdAt).toLocaleDateString("pt-BR")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        title="Editar nome e email"
                        onClick={() => openEdit(u)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                        disabled={isOwner || isSelf}
                        title={
                          isOwner
                            ? "Owner não pode ser removido"
                            : isSelf
                              ? "Você não pode remover sua própria conta"
                              : "Remover usuário desta conta"
                        }
                        onClick={() => setDeleteTarget(u)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {users.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  Nenhum usuário encontrado
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Create user dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" />
              Novo Usuário
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nome</Label>
              <Input
                id="name"
                placeholder="Nome completo"
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
                required
                minLength={2}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="usuario@email.com"
                value={form.email}
                onChange={(e) =>
                  setForm((f) => ({ ...f, email: e.target.value }))
                }
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                placeholder="Mínimo 8 caracteres (apenas se for novo email)"
                value={form.password}
                onChange={(e) =>
                  setForm((f) => ({ ...f, password: e.target.value }))
                }
                minLength={8}
              />
              <p className="text-[11px] text-muted-foreground">
                Se o email já estiver cadastrado em outra conta, a senha existente
                será mantida.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="papel">Papel na conta</Label>
              <Select
                value={form.papel}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, papel: v as PapelConta }))
                }
              >
                <SelectTrigger id="papel">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAPEIS_ATRIBUIVEIS.map((p) => (
                    <SelectItem key={p} value={p}>
                      <div className="flex items-center gap-2">
                        <PapelIcon papel={p} className="h-4 w-4" />
                        {PAPEL_LABELS[p]}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
                disabled={createLoading}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={createLoading}
                className="gap-2"
              >
                {createLoading && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                Criar Usuário
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit user dialog */}
      <Dialog
        open={!!editTarget}
        onOpenChange={(o) => !o && !editLoading && setEditTarget(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5" />
              Editar Usuário
            </DialogTitle>
          </DialogHeader>
          {editTarget && (
            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-name">Nome</Label>
                <Input
                  id="edit-name"
                  placeholder="Nome completo"
                  value={editForm.name}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, name: e.target.value }))
                  }
                  required
                  minLength={2}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-email">Email</Label>
                <Input
                  id="edit-email"
                  type="email"
                  placeholder="usuario@email.com"
                  value={editForm.email}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, email: e.target.value }))
                  }
                  disabled={editTarget.papelNaConta === "owner"}
                  required
                />
                {editTarget.papelNaConta === "owner" && (
                  <p className="text-[11px] text-amber-500">
                    Email do owner é alterado em Gerenciar Conta (requer confirmação por email).
                  </p>
                )}
                {editTarget.papelNaConta !== "owner" &&
                  editForm.email.trim().toLowerCase() !==
                    editTarget.email.toLowerCase() && (
                    <p className="text-[11px] text-amber-500">
                      O usuário precisará verificar o novo email para liberar funcionalidades que dependem disso.
                    </p>
                  )}
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditTarget(null)}
                  disabled={editLoading}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={editLoading} className="gap-2">
                  {editLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                  Salvar
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover usuário desta conta?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.name}</strong> ({deleteTarget?.email}) será
              desvinculado desta conta. O usuário continuará existindo no
              sistema e mantendo acesso a outras contas vinculadas.
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
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
