"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";
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
import { Loader2, Plus, Trash2, Shield, ShieldCheck, UserCog, Truck, Briefcase } from "lucide-react";

type UserRole = "admin" | "supervisor" | "funcionario" | "expedicao";

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  createdAt: string;
  isSystemAdmin: boolean;
};

const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Administrador",
  supervisor: "Supervisor",
  funcionario: "Funcionário",
  expedicao: "Expedição",
};

const ROLE_BADGE_CLASS: Record<UserRole, string> = {
  admin: "bg-green-600",
  supervisor: "bg-purple-600",
  funcionario: "bg-blue-600",
  expedicao: "bg-green-700",
};

function RoleIcon({ role, className }: { role: UserRole; className?: string }) {
  if (role === "admin") return <ShieldCheck className={className} />;
  if (role === "supervisor") return <Briefcase className={className} />;
  if (role === "expedicao") return <Truck className={className} />;
  return <Shield className={className} />;
}

export default function GerenciarUsuariosPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();

  const [users, setUsers] = useState<UserRow[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "funcionario" as UserRole });

  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [roleLoading, setRoleLoading] = useState<string | null>(null);

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
    if (!isPending && session) {
      const role = (session.user as Record<string, unknown>).role;
      if (role !== "admin") {
        router.replace("/");
        return;
      }
      fetchUsers();
    }
    if (!isPending && !session) {
      router.replace("/login");
    }
  }, [isPending, session, router, fetchUsers]);

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
      setForm({ name: "", email: "", password: "", role: "funcionario" as UserRole });
      fetchUsers();
    } finally {
      setCreateLoading(false);
    }
  }

  async function handleRoleChange(u: UserRow, newRole: UserRole) {
    if (newRole === u.role) return;
    setRoleLoading(u.id);
    try {
      const res = await fetch(`/api/users/${u.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Erro ao alterar perfil");
        return;
      }
      toast.success("Perfil atualizado!");
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, role: newRole } : x)));
    } finally {
      setRoleLoading(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      const res = await fetch(`/api/users/${deleteTarget.id}`, { method: "DELETE" });
      if (res.status === 204) {
        toast.success("Usuário excluído!");
        setUsers((prev) => prev.filter((x) => x.id !== deleteTarget.id));
        setDeleteTarget(null);
        return;
      }
      const data = await res.json();
      toast.error(data.error || "Erro ao excluir usuário");
    } finally {
      setDeleteLoading(false);
    }
  }

  if (isPending || loadingUsers) {
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
            Cadastre e gerencie os usuários do sistema
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
              <th className="px-4 py-3 text-left font-medium">Perfil</th>
              <th className="px-4 py-3 text-left font-medium">Cadastrado em</th>
              <th className="px-4 py-3 text-right font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isSelf = u.id === currentUserId;
              const isSystemAdmin = u.isSystemAdmin;
              return (
                <tr key={u.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium">
                    <div className="flex items-center gap-2">
                      {u.name}
                      {isSystemAdmin && (
                        <Badge variant="outline" className="text-xs border-amber-500 text-amber-600 gap-1">
                          <ShieldCheck className="h-3 w-3" />
                          Sistema
                        </Badge>
                      )}
                      {isSelf && (
                        <Badge variant="outline" className="text-xs">Você</Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{u.email}</td>
                  <td className="px-4 py-3">
                    {isSystemAdmin || isSelf ? (
                      <Badge className={ROLE_BADGE_CLASS[u.role]}>
                        {ROLE_LABELS[u.role]}
                      </Badge>
                    ) : (
                      <Select
                        value={u.role}
                        onValueChange={(v) => handleRoleChange(u, v as UserRole)}
                        disabled={roleLoading === u.id}
                      >
                        <SelectTrigger className="h-7 w-36 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(["admin", "supervisor", "funcionario", "expedicao"] as UserRole[]).map((r) => (
                            <SelectItem key={r} value={r}>
                              <div className="flex items-center gap-2">
                                <RoleIcon role={r} className="h-3 w-3" />
                                {ROLE_LABELS[r]}
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
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                      disabled={isSystemAdmin || isSelf}
                      title={isSystemAdmin ? "Usuário do sistema não pode ser excluído" : isSelf ? "Você não pode excluir sua própria conta" : "Excluir usuário"}
                      onClick={() => setDeleteTarget(u)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              );
            })}
            {users.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
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
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
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
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                placeholder="Mínimo 8 caracteres"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                required
                minLength={8}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">Perfil</Label>
              <Select
                value={form.role}
                onValueChange={(v) => setForm((f) => ({ ...f, role: v as UserRole }))}
              >
                <SelectTrigger id="role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["funcionario", "supervisor", "expedicao", "admin"] as UserRole[]).map((r) => (
                    <SelectItem key={r} value={r}>
                      <div className="flex items-center gap-2">
                        <RoleIcon role={r} className="h-4 w-4" />
                        {ROLE_LABELS[r]}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={createLoading}>
                Cancelar
              </Button>
              <Button type="submit" disabled={createLoading} className="gap-2">
                {createLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                Criar Usuário
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir usuário?</AlertDialogTitle>
            <AlertDialogDescription>
              O usuário <strong>{deleteTarget?.name}</strong> ({deleteTarget?.email}) será removido permanentemente do sistema. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteLoading}
              className="bg-destructive hover:bg-destructive/90 gap-2"
            >
              {deleteLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
