"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { usePapelAtivo } from "@/hooks/use-papel-ativo";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Building2,
  Loader2,
  Mail,
  CheckCircle2,
  Clock,
  XCircle,
  ShieldCheck,
} from "lucide-react";

type Pendente = {
  id: string;
  emailAtual: string;
  emailNovo: string;
  confirmadoAtual: boolean;
  confirmadoNovo: boolean;
  expiraEm: string;
  createdAt: string;
};

export default function GerenciarContaPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, isPending } = useSession();
  const { me, papelAtivo, isAdmin, loading: papelLoading, refresh } = usePapelAtivo();

  const [emailNovo, setEmailNovo] = useState("");
  const [pendente, setPendente] = useState<Pendente | null>(null);
  const [loadingPendente, setLoadingPendente] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [cancelando, setCancelando] = useState(false);

  const isOwner = papelAtivo === "owner";
  const contaAtiva = me?.contas?.find((c) => c.id === me?.contaAtivaId);

  const fetchPendente = useCallback(async () => {
    if (!isOwner) {
      setLoadingPendente(false);
      return;
    }
    setLoadingPendente(true);
    try {
      const res = await fetch("/api/conta/email-change");
      if (!res.ok) {
        setPendente(null);
        return;
      }
      const data = (await res.json()) as { pendente: Pendente | null };
      setPendente(data.pendente);
    } finally {
      setLoadingPendente(false);
    }
  }, [isOwner]);

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
    fetchPendente();
  }, [isPending, session, isAdmin, papelLoading, router, fetchPendente]);

  useEffect(() => {
    const status = searchParams.get("email");
    if (!status) return;
    if (status === "ok") {
      toast.success("Email atualizado com sucesso!");
      refresh();
    } else if (status === "pending") {
      toast.info("Confirmação registrada. Falta o outro email confirmar.");
    } else if (status === "expired") {
      toast.error("Link expirado. Solicite uma nova troca.");
    } else if (status === "invalid") {
      toast.error("Link inválido ou já utilizado.");
    }
    fetchPendente();
    router.replace("/gerenciar-conta");
  }, [searchParams, router, fetchPendente, refresh]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/conta/email-change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailNovo }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Falha ao iniciar troca de email");
        return;
      }
      toast.success(
        "Confirmações enviadas. Verifique ambos os emails para finalizar.",
      );
      setEmailNovo("");
      fetchPendente();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancelar() {
    setCancelando(true);
    try {
      const res = await fetch("/api/conta/email-change", { method: "DELETE" });
      if (!res.ok) {
        toast.error("Falha ao cancelar.");
        return;
      }
      toast.success("Solicitação cancelada.");
      fetchPendente();
    } finally {
      setCancelando(false);
    }
  }

  if (isPending || papelLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Building2 className="h-6 w-6" />
          Gerenciar Conta
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Informações e configurações da conta ativa
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            {contaAtiva?.nome ?? "Conta"}
          </CardTitle>
          <CardDescription>
            <span className="capitalize">{contaAtiva?.plano ?? "—"}</span>
            {" · "}
            <span className="capitalize">{contaAtiva?.status ?? "—"}</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            <span>Seu papel:</span>
            <Badge variant="outline" className="capitalize">
              {papelAtivo}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-muted-foreground" />
            <span>Email do owner:</span>
            <span className="font-mono text-xs">{me?.user.email ?? "—"}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Trocar email do owner
          </CardTitle>
          <CardDescription>
            A troca exige confirmação tanto do email atual quanto do novo. O
            link expira em 2 horas.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isOwner && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              Apenas o owner da conta pode trocar o email. Você está como{" "}
              <strong className="capitalize">{papelAtivo}</strong>.
            </div>
          )}

          {isOwner && loadingPendente && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Verificando solicitações pendentes…
            </div>
          )}

          {isOwner && !loadingPendente && pendente && (
            <div className="rounded-md border bg-muted/30 p-4 space-y-3 text-sm">
              <div className="flex items-center gap-2 font-semibold">
                <Clock className="h-4 w-4" />
                Solicitação em andamento
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="flex items-center gap-2">
                  {pendente.confirmadoAtual ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                  ) : (
                    <Clock className="h-4 w-4 text-amber-600" />
                  )}
                  <div>
                    <p className="text-muted-foreground">Email atual</p>
                    <p className="font-mono">{pendente.emailAtual}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {pendente.confirmadoNovo ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                  ) : (
                    <Clock className="h-4 w-4 text-amber-600" />
                  )}
                  <div>
                    <p className="text-muted-foreground">Email novo</p>
                    <p className="font-mono">{pendente.emailNovo}</p>
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Expira em{" "}
                {new Date(pendente.expiraEm).toLocaleString("pt-BR")}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancelar}
                disabled={cancelando}
                className="gap-2"
              >
                {cancelando ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
                Cancelar solicitação
              </Button>
            </div>
          )}

          {isOwner && !loadingPendente && !pendente && (
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="emailNovo">Novo email do owner</Label>
                <Input
                  id="emailNovo"
                  type="email"
                  placeholder="novo-email@empresa.com"
                  value={emailNovo}
                  onChange={(e) => setEmailNovo(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" disabled={submitting} className="gap-2">
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Iniciar troca de email
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
