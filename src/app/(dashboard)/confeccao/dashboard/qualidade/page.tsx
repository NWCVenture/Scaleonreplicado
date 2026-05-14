"use client";

// Dashboard de Qualidade por Oficina — RITM-21.
// Acesso: admin/owner ativo na conta. Métricas por oficina + top defeitos
// + drill-down em sheet lateral.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Award, BadgeCheck, CalendarClock, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";
import { usePapelAtivo } from "@/hooks/use-papel-ativo";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KpiCard } from "@/components/confeccao/dashboard/kpi-card";
import {
  RankingOficinasTable,
  type RankingOficinaItem,
} from "@/components/confeccao/dashboard/qualidade/ranking-oficinas-table";
import { TopDefeitosChart } from "@/components/confeccao/dashboard/qualidade/top-defeitos-chart";
import {
  DetalheOficinaSheet,
  type DetalheSubconferenciaItem,
} from "@/components/confeccao/dashboard/qualidade/detalhe-oficina-sheet";
import { LookupComCadastroInline } from "@/components/confeccao/lookup-com-cadastro-inline";

interface QualidadePayload {
  kpis: {
    oficinasAvaliadas: number;
    aprovacaoMedia: number;
    pontualidadeMedia: number;
  };
  ranking: RankingOficinaItem[];
  topDefeitos: Array<{
    tipo: string;
    contagem: number;
    percentual: number;
  }>;
  detalhePorOficina: Record<string, DetalheSubconferenciaItem[]>;
  periodo: { de: string; ate: string };
}

function percent(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

export default function DashboardQualidadePage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const { isAdmin } = usePapelAtivo();

  const [data, setData] = useState<QualidadePayload | null>(null);
  const [loading, setLoading] = useState(true);

  const [de, setDe] = useState<string>("");
  const [ate, setAte] = useState<string>("");
  const [produtoId, setProdutoId] = useState<string>("");
  const [oficinaId, setOficinaId] = useState<string>("");

  const [oficinaSelecionada, setOficinaSelecionada] = useState<string | null>(
    null,
  );

  const queryString = useMemo(() => {
    const sp = new URLSearchParams();
    if (de) sp.set("de", new Date(de).toISOString());
    if (ate) sp.set("ate", new Date(ate).toISOString());
    if (produtoId) sp.set("produtoId", produtoId);
    if (oficinaId) sp.set("oficinaId", oficinaId);
    return sp.toString();
  }, [de, ate, produtoId, oficinaId]);

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/confeccao/dashboard/qualidade${
          queryString ? `?${queryString}` : ""
        }`,
        { cache: "no-store" },
      );
      if (res.status === 403) {
        toast.error("Acesso negado");
        router.replace("/confeccao");
        return;
      }
      if (!res.ok) throw new Error();
      setData((await res.json()) as QualidadePayload);
    } catch {
      toast.error("Erro ao carregar dashboard de qualidade");
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

  const oficinaItems = oficinaSelecionada
    ? data?.detalhePorOficina[oficinaSelecionada] ?? []
    : [];
  const oficinaNome = oficinaSelecionada
    ? data?.ranking.find((r) => r.oficinaId === oficinaSelecionada)
        ?.oficinaNome ?? null
    : null;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Dashboard de Qualidade"
        description="Métricas por oficina: aprovação, tempo médio, pontualidade e divergências."
        icon={<ShieldCheck className="size-8 text-emerald-500" />}
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
          <Label className="text-xs">Oficina</Label>
          <LookupComCadastroInline
            endpoint="/api/confeccao/fornecedores"
            value={oficinaId}
            onChange={(id) => setOficinaId(id)}
            entidadeLabel="fornecedor"
            placeholder="Todas as oficinas"
            permiteCadastrar={false}
          />
        </div>
        {(de || ate || produtoId || oficinaId) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDe("");
              setAte("");
              setProdutoId("");
              setOficinaId("");
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
              label="Oficinas avaliadas"
              valor={data.kpis.oficinasAvaliadas}
              icon={Award}
            />
            <KpiCard
              label="% aprovação médio"
              valor={percent(data.kpis.aprovacaoMedia)}
              icon={BadgeCheck}
              variant={
                data.kpis.aprovacaoMedia >= 0.95
                  ? "success"
                  : data.kpis.aprovacaoMedia < 0.85
                    ? "warning"
                    : "default"
              }
            />
            <KpiCard
              label="% pontualidade médio"
              valor={percent(data.kpis.pontualidadeMedia)}
              icon={CalendarClock}
              variant={
                data.kpis.pontualidadeMedia < 0.85 ? "warning" : "default"
              }
              hint="Retiradas finais com prazo cadastrado"
            />
          </div>

          {/* Ranking */}
          <div className="space-y-2">
            <h2 className="text-base font-medium">Ranking de oficinas</h2>
            <p className="text-xs text-muted-foreground">
              Clique numa linha para ver as subconferências.
            </p>
            <RankingOficinasTable
              data={data.ranking}
              onSelect={(id) => setOficinaSelecionada(id)}
            />
          </div>

          {/* Top defeitos */}
          <div className="space-y-2">
            <h2 className="text-base font-medium">Top defeitos</h2>
            <div className="rounded-md border bg-card p-4">
              <TopDefeitosChart data={data.topDefeitos} />
            </div>
          </div>
        </>
      )}

      <DetalheOficinaSheet
        open={oficinaSelecionada !== null}
        onOpenChange={(o) => !o && setOficinaSelecionada(null)}
        oficinaNome={oficinaNome}
        items={oficinaItems}
      />
    </div>
  );
}
