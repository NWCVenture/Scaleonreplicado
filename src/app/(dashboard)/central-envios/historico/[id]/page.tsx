"use client";

// Detalhe read-only de um planejamento arquivado (RITM-11).
// Reaproveita os tabs Dashboard/Cronograma/SkuDia/Pedidos/Ambíguos do
// fluxo de sessão ativa. Sem Extrator (extrator é ferramenta de ação,
// não faz sentido no snapshot imutável).

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Mail } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AmbiguosTab } from "@/components/central-envios/ambiguos-tab";
import { CronogramaTab } from "@/components/central-envios/cronograma-tab";
import { DashboardTab } from "@/components/central-envios/dashboard-tab";
import { PedidosTab } from "@/components/central-envios/pedidos-tab";
import { SkuDiaTab } from "@/components/central-envios/sku-dia-tab";
import type {
  PedidoEnriquecido,
  PlanejamentoSnapshotCliente,
} from "@/types/central-envios";

function formatarData(iso: string): string {
  if (!iso) return "—";
  const d = iso.slice(0, 10).split("-");
  if (d.length === 3) return `${d[2]}/${d[1]}/${d[0]}`;
  return iso;
}

function formatarDataHora(iso: string): string {
  if (!iso) return "—";
  const [data, hora] = iso.slice(0, 16).split("T");
  if (!data || !hora) return iso;
  const d = data.split("-");
  if (d.length !== 3) return iso;
  return `${d[2]}/${d[1]}/${d[0]} ${hora}`;
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function HistoricoDetalhePage({ params }: PageProps) {
  const { id } = use(params);
  const [planejamento, setPlanejamento] =
    useState<PlanejamentoSnapshotCliente | null>(null);
  const [dados, setDados] = useState<PedidoEnriquecido[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const r = await fetch(`/api/central-envios/${id}`, {
        cache: "no-store",
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${r.status}`);
      }
      const json = (await r.json()) as {
        planejamento: PlanejamentoSnapshotCliente;
      };
      setPlanejamento(json.planejamento);

      if (json.planejamento.dados) {
        setDados(json.planejamento.dados);
      } else if (json.planejamento.dadosBlobUrl) {
        try {
          const blob = await fetch(json.planejamento.dadosBlobUrl, {
            cache: "no-store",
          });
          if (blob.ok) {
            const lista = (await blob.json()) as PedidoEnriquecido[];
            setDados(lista);
          } else {
            setDados([]);
          }
        } catch {
          setDados([]);
        }
      } else {
        setDados([]);
      }
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mr-2" /> Carregando snapshot…
      </div>
    );
  }

  if (erro || !planejamento) {
    return (
      <div className="space-y-4">
        <Button variant="outline" size="sm" asChild>
          <Link href="/central-envios/historico">
            <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
          </Link>
        </Button>
        <Alert>
          <AlertDescription>
            {erro ?? "Planejamento não encontrado"}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const hojeIso = planejamento.estatisticas?.hojeIso ?? planejamento.dataReferencia;

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Link
            href="/central-envios"
            className="inline-flex items-center gap-1 hover:text-foreground"
          >
            Central de Envios
          </Link>
          <span>/</span>
          <Link
            href="/central-envios/historico"
            className="hover:text-foreground"
          >
            Histórico
          </Link>
          <span>/</span>
          <span>{formatarData(planejamento.dataReferencia)}</span>
        </div>
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Planejamento {formatarData(planejamento.dataReferencia)}
            </h1>
            <p className="text-sm text-muted-foreground">
              Arquivado em {formatarDataHora(planejamento.geradoEm)} por{" "}
              {planejamento.usuarioNome ?? planejamento.usuarioId}.
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/central-envios/historico">
              <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
            </Link>
          </Button>
        </div>
      </header>

      <Alert>
        <AlertDescription className="flex items-center gap-2">
          <span>Snapshot imutável.</span>
          {planejamento.emailEnviadoPara &&
            planejamento.emailEnviadoPara.length > 0 && (
              <Badge
                variant="outline"
                className="border-emerald-300 text-emerald-700"
                title={planejamento.emailEnviadoPara.join(", ")}
              >
                <Mail className="h-3 w-3 mr-1" /> Email enviado para{" "}
                {planejamento.emailEnviadoPara.length} destinatário(s)
              </Badge>
            )}
        </AlertDescription>
      </Alert>

      <Tabs defaultValue="dashboard">
        <TabsList>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="cronograma">Cronograma</TabsTrigger>
          <TabsTrigger value="sku-dia">SKU × Dia</TabsTrigger>
          <TabsTrigger value="pedidos">Pedidos</TabsTrigger>
          <TabsTrigger value="ambiguos">
            Ambíguos
            {planejamento.totalAmbiguos > 0 && (
              <Badge variant="secondary" className="ml-2">
                {planejamento.totalAmbiguos}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard">
          <DashboardTab
            estatisticas={planejamento.estatisticas}
            dados={dados}
            hojeIso={hojeIso}
          />
        </TabsContent>

        <TabsContent value="cronograma">
          <CronogramaTab dados={dados} />
        </TabsContent>

        <TabsContent value="sku-dia">
          <SkuDiaTab dados={dados} hojeIso={hojeIso} />
        </TabsContent>

        <TabsContent value="pedidos">
          <PedidosTab dados={dados} hojeIso={hojeIso} />
        </TabsContent>

        <TabsContent value="ambiguos">
          <AmbiguosTab dados={dados} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
