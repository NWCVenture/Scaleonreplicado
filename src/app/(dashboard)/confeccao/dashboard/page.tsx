"use client";

// Dashboard Geral do módulo Confecção — RITM-20.
//
// Acesso: admin/owner ativo na conta. KPIs + gráfico de etapas +
// mapa de Lalamoves ativos + lista resumida + alertas.

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity,
  AlertOctagon,
  CheckCircle2,
  Factory,
  LayoutDashboard,
} from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";
import { usePapelAtivo } from "@/hooks/use-papel-ativo";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { AlertasPanel } from "@/components/confeccao/dashboard/alertas-panel";
import { KpiCard } from "@/components/confeccao/dashboard/kpi-card";
import { OpsPorEtapaChart } from "@/components/confeccao/dashboard/ops-por-etapa-chart";
import { LookupComCadastroInline } from "@/components/confeccao/lookup-com-cadastro-inline";

// Leaflet acessa window — só client.
const LalamovesMapa = dynamic(
  () => import("@/components/confeccao/dashboard/lalamoves-mapa"),
  { ssr: false, loading: () => <div className="h-80 rounded-md border bg-card" /> },
);

interface DashboardPayload {
  kpis: {
    opsAbertas: number;
    opsEmAtraso: number;
    opsConcluidasMes: number;
  };
  opsPorEtapa: Array<{ prefixo: string; label: string; total: number }>;
  lalamovesAtivos: Array<{
    id: string;
    status: string;
    ordemProducaoNumero: string;
    conteudoDescricao: string | null;
    lat: number;
    lng: number;
    fonte: "driver" | "origem" | "destino";
  }>;
  opsAtivas: Array<{
    id: string;
    numero: string;
    produtoNome: string;
    atribuidoNome: string | null;
    percentual: number;
    updatedAt: string;
  }>;
  alertas: {
    lalamoveTempoAlto: Array<{
      id: string;
      ordemProducaoNumero: string;
      conteudoDescricao: string | null;
      minutosAguardando: number;
    }>;
    oficinasEmAtraso: Array<{
      opNumero: string;
      prefixo: string;
      oficinaId: string;
      prazoProducao: string;
      diasAtraso: number;
    }>;
    conferenciasDivergentes: Array<{
      id: string;
      numero: string;
      opNumero: string;
      oficinaResponsavelNome: string | null;
    }>;
  };
}

export default function DashboardGeralPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const { isAdmin } = usePapelAtivo();

  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const [de, setDe] = useState<string>("");
  const [ate, setAte] = useState<string>("");
  const [produtoId, setProdutoId] = useState<string>("");
  const [fornecedorId, setFornecedorId] = useState<string>("");

  const queryString = useMemo(() => {
    const sp = new URLSearchParams();
    if (de) sp.set("de", new Date(de).toISOString());
    if (ate) sp.set("ate", new Date(ate).toISOString());
    if (produtoId) sp.set("produtoId", produtoId);
    if (fornecedorId) sp.set("fornecedorId", fornecedorId);
    return sp.toString();
  }, [de, ate, produtoId, fornecedorId]);

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/confeccao/dashboard${queryString ? `?${queryString}` : ""}`,
        { cache: "no-store" },
      );
      if (res.status === 403) {
        toast.error("Acesso negado");
        router.replace("/confeccao");
        return;
      }
      if (!res.ok) throw new Error();
      setData((await res.json()) as DashboardPayload);
    } catch {
      toast.error("Erro ao carregar dashboard");
    } finally {
      setLoading(false);
    }
  }, [queryString, router]);

  useEffect(() => {
    if (isPending) return;
    if (!session) {
      router.replace("/login");
      return;
    }
    if (!isAdmin) {
      toast.error("Dashboard restrito a administradores");
      router.replace("/confeccao");
      return;
    }
    void fetchDashboard();
  }, [isPending, session, isAdmin, router, fetchDashboard]);

  if (isPending || !session || !isAdmin) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Carregando…</div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Dashboard Geral"
        description="Visão consolidada do módulo Confecção — atualizado em tempo real."
        icon={<LayoutDashboard className="size-8 text-emerald-500" />}
      />

      {/* Filtros */}
      <div className="rounded-md border bg-card p-3 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Período (de)</Label>
          <Input
            type="date"
            value={de}
            onChange={(e) => setDe(e.target.value)}
            className="w-44"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Período (até)</Label>
          <Input
            type="date"
            value={ate}
            onChange={(e) => setAte(e.target.value)}
            className="w-44"
          />
        </div>
        <div className="space-y-1 min-w-56">
          <Label className="text-xs">Produto</Label>
          <LookupComCadastroInline
            endpoint="/api/confeccao/produtos"
            value={produtoId}
            onChange={(id) => setProdutoId(id)}
            entidadeLabel="produto"
            placeholder="Todos os produtos"
            permiteCadastrar={false}
          />
        </div>
        <div className="space-y-1 min-w-56">
          <Label className="text-xs">Fornecedor</Label>
          <LookupComCadastroInline
            endpoint="/api/confeccao/fornecedores"
            value={fornecedorId}
            onChange={(id) => setFornecedorId(id)}
            entidadeLabel="fornecedor"
            placeholder="Todos os fornecedores"
            permiteCadastrar={false}
          />
        </div>
        {(de || ate || produtoId || fornecedorId) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDe("");
              setAte("");
              setProdutoId("");
              setFornecedorId("");
            }}
          >
            Limpar
          </Button>
        )}
      </div>

      {loading && !data && (
        <div className="text-sm text-muted-foreground">Carregando…</div>
      )}

      {data && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <KpiCard
              label="OPs abertas"
              valor={data.kpis.opsAbertas}
              icon={Activity}
            />
            <KpiCard
              label="OPs em atraso"
              valor={data.kpis.opsEmAtraso}
              icon={AlertOctagon}
              variant={data.kpis.opsEmAtraso > 0 ? "warning" : "default"}
            />
            <KpiCard
              label="OPs concluídas no período"
              valor={data.kpis.opsConcluidasMes}
              icon={CheckCircle2}
              variant="success"
              hint={
                de || ate
                  ? "Respeita filtro de período"
                  : "Mês corrente"
              }
            />
          </div>

          {/* Chart + lista resumida */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 rounded-md border bg-card p-4">
              <div className="mb-2 text-sm font-medium">
                OPs por etapa atual
              </div>
              <OpsPorEtapaChart data={data.opsPorEtapa} />
            </div>
            <div className="rounded-md border bg-card p-4 space-y-2">
              <div className="text-sm font-medium flex items-center gap-2">
                <Factory className="size-4 text-blue-500" />
                OPs ativas (top 10)
              </div>
              <div className="space-y-1">
                {data.opsAtivas.length === 0 && (
                  <div className="text-xs text-muted-foreground">
                    Sem OPs em andamento.
                  </div>
                )}
                {data.opsAtivas.map((o) => (
                  <Link
                    key={o.id}
                    href={`/confeccao/ops/${encodeURIComponent(o.numero)}`}
                    className="block rounded px-2 py-1.5 hover:bg-muted/50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium font-mono">
                        {o.numero}
                      </span>
                      <Badge variant="outline" className="text-xs tabular-nums">
                        {o.percentual}%
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {o.produtoNome}
                      {o.atribuidoNome ? ` • ${o.atribuidoNome}` : ""}
                    </div>
                    <Progress value={o.percentual} className="mt-1 h-1" />
                  </Link>
                ))}
              </div>
            </div>
          </div>

          {/* Mapa */}
          <div className="space-y-2">
            <h2 className="text-base font-medium">Lalamoves ativos</h2>
            <LalamovesMapa items={data.lalamovesAtivos} />
          </div>

          {/* Alertas */}
          <AlertasPanel
            lalamoveTempoAlto={data.alertas.lalamoveTempoAlto}
            oficinasEmAtraso={data.alertas.oficinasEmAtraso}
            conferenciasDivergentes={data.alertas.conferenciasDivergentes}
          />
        </>
      )}
    </div>
  );
}
