"use client";

// /confeccao/nova — formulário de criar nova OP.
// Admin only. Ao salvar, redireciona pra /confeccao/ops/{numero}.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";
import { usePapelAtivo } from "@/hooks/use-papel-ativo";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LookupComCadastroInline } from "@/components/confeccao/lookup-com-cadastro-inline";
import { LookupUsuarioConta } from "@/components/confeccao/lookup-usuario-conta";

interface FormState {
  produtoId: string;
  temVies: boolean;
  atribuidoAId: string;
  observacoes: string;
}

export default function NovaOPPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const { isAdmin, loading: papelLoading } = usePapelAtivo();

  const [form, setForm] = useState<FormState>({
    produtoId: "",
    temVies: false,
    atribuidoAId: "",
    observacoes: "",
  });
  const [saving, setSaving] = useState(false);
  // Marca quando a auth+papel já foram validados uma vez. Depois disso, a UI
  // não volta a piscar "Carregando…" se as hooks (useSession / usePapelAtivo)
  // momentaneamente re-emitirem estado intermediário (revalidate em foco da
  // janela, StrictMode, troca de papel em outra aba). Sem esse latch, qualquer
  // re-emissão fazia a tela piscar entre o form e "Carregando…".
  const [verified, setVerified] = useState(false);
  // Garante que o toast/redirect de "não-admin" rode no máximo uma vez —
  // independentemente de quantas vezes o useEffect re-execute por mudança de
  // referência de session.
  const redirecionouRef = useRef(false);

  useEffect(() => {
    if (isPending || papelLoading) return;
    if (!session) {
      if (redirecionouRef.current) return;
      redirecionouRef.current = true;
      router.replace("/login");
      return;
    }
    if (!isAdmin) {
      if (redirecionouRef.current) return;
      redirecionouRef.current = true;
      toast.error("Apenas admins podem criar OPs");
      router.replace("/confeccao");
      return;
    }
    setVerified(true);
  }, [isPending, papelLoading, session, isAdmin, router]);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!form.produtoId || !form.atribuidoAId) {
      toast.error("Preencha produto e atribuído");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/confeccao/ops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          produtoId: form.produtoId,
          temVies: form.temVies,
          atribuidoAId: form.atribuidoAId,
          observacoes: form.observacoes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Erro ao criar OP");
        return;
      }
      toast.success(`OP ${data.op.numero} criada`);
      router.push(`/confeccao/ops/${data.op.numero}`);
    } finally {
      setSaving(false);
    }
  }

  if (!verified) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Carregando…</div>
    );
  }

  return (
    <div className="space-y-6 p-6 max-w-2xl">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.push("/confeccao")}
      >
        <ArrowLeft className="size-4" />
        Voltar
      </Button>

      <PageHeader
        title="Nova Ordem de Produção"
        description="Cria a OP + 5 subtasks fixas (Compra → Risco → Corte → Costura → Conferência). Marque &quot;Viés&quot; pra adicionar a 6ª subtask entre Corte e Costura."
        icon={<Plus className="size-8 text-blue-500" />}
      />

      <form onSubmit={salvar} className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Dados da OP</CardTitle>
            <CardDescription>
              Produto, atribuído e flag de Viés. Não é possível alterar &quot;Viés&quot;
              depois de criada.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Produto *</Label>
              <LookupComCadastroInline
                endpoint="/api/confeccao/produtos"
                value={form.produtoId}
                onChange={(id) => setForm({ ...form, produtoId: id })}
                entidadeLabel="produto"
                permiteCadastrar={false}
                className="w-full"
              />
            </div>

            <div className="space-y-2">
              <Label>Atribuído a *</Label>
              <LookupUsuarioConta
                value={form.atribuidoAId}
                onChange={(id) => setForm({ ...form, atribuidoAId: id })}
                className="w-full"
              />
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={form.temVies}
                onCheckedChange={(v) =>
                  setForm({ ...form, temVies: v === true })
                }
              />
              <span className="text-sm">
                Incluir subtask de <strong>Viés</strong> (entre Corte e Costura)
              </span>
            </label>

            <div className="space-y-2">
              <Label htmlFor="obs">Observações gerais</Label>
              <Textarea
                id="obs"
                value={form.observacoes}
                onChange={(e) =>
                  setForm({ ...form, observacoes: e.target.value })
                }
                placeholder="Contexto adicional sobre essa OP…"
                maxLength={2000}
                rows={4}
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/confeccao")}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={saving || !form.produtoId || !form.atribuidoAId}
          >
            {saving ? "Criando…" : "Criar OP"}
          </Button>
        </div>
      </form>
    </div>
  );
}
