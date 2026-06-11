"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Save, AlertCircle, History, Settings } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UploadDropzone } from "@/components/central-envios/upload-dropzone";
import { IngestaoStatus } from "@/components/central-envios/ingestao-status";
import { DashboardTab } from "@/components/central-envios/dashboard-tab";
import { CronogramaTab } from "@/components/central-envios/cronograma-tab";
import { SkuDiaTab } from "@/components/central-envios/sku-dia-tab";
import { ExtratorTab } from "@/components/central-envios/extrator-tab";
import { PedidosTab } from "@/components/central-envios/pedidos-tab";
import { AmbiguosTab } from "@/components/central-envios/ambiguos-tab";
import { ArquivarDialog } from "@/components/central-envios/arquivar-dialog";
import { useCentralEnviosPlanejamento } from "@/hooks/use-central-envios-planejamento";

export default function CentralEnviosPage() {
  const {
    status,
    sessao,
    dados,
    estatisticas,
    arquivosIngeridos,
    uploads,
    abaAtiva,
    setAbaAtiva,
    filtrosExtrator,
    setFiltrosExtrator,
    categorias,
    saveState,
    subirArquivos,
    limparConcluidos,
    encerrarSessao,
  } = useCentralEnviosPlanejamento();

  const hojeIso = estatisticas?.hojeIso ?? new Date().toISOString().slice(0, 10);
  const ambiguosCount = dados.filter((p) => p.parsed.kind === "AMBIGUO").length;
  const [arquivarOpen, setArquivarOpen] = useState(false);

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mr-2" /> Carregando sessão…
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive flex items-center gap-2">
        <AlertCircle className="h-4 w-4" />
        Não foi possível carregar a sessão. Recarregue a página.
      </div>
    );
  }

  const houveProcessamento = arquivosIngeridos.length > 0;

  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Central de Envios
          </h1>
          <p className="text-sm text-muted-foreground">
            Planejamento operacional diário a partir das vendas dos canais.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {saveState === "saving" && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Salvando…
            </span>
          )}
          {saveState === "saved" && (
            <span className="flex items-center gap-1 text-xs text-emerald-700">
              <Save className="h-3 w-3" /> Salvo
            </span>
          )}
          {saveState === "error" && (
            <span className="flex items-center gap-1 text-xs text-destructive">
              <AlertCircle className="h-3 w-3" /> Erro ao salvar
            </span>
          )}
          {sessao && houveProcessamento && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => encerrarSessao("forcada")}
              >
                Descartar
              </Button>
              <Button size="sm" onClick={() => setArquivarOpen(true)}>
                Arquivar
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" asChild>
            <Link href="/central-envios/historico" title="Histórico">
              <History className="h-4 w-4" />
            </Link>
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <Link href="/central-envios/configuracoes" title="Configurações">
              <Settings className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </header>

      <Tabs value={abaAtiva} onValueChange={setAbaAtiva}>
        <TabsList>
          <TabsTrigger value="upload">
            Upload
            {uploads.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {uploads.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="dashboard">
            Dashboard
            {estatisticas && estatisticas.totalPedidos > 0 && (
              <Badge variant="secondary" className="ml-2">
                {estatisticas.totalPedidos.toLocaleString("pt-BR")}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="cronograma">Cronograma</TabsTrigger>
          <TabsTrigger value="sku-dia">SKU × Dia</TabsTrigger>
          <TabsTrigger value="extrator">Extrator</TabsTrigger>
          <TabsTrigger value="pedidos">Pedidos</TabsTrigger>
          <TabsTrigger value="ambiguos">
            Ambíguos
            {ambiguosCount > 0 && (
              <Badge
                variant="secondary"
                className="ml-2 bg-amber-100 text-amber-800"
              >
                {ambiguosCount}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="upload" className="space-y-4">
          <UploadDropzone onFiles={(f) => subirArquivos(f)} />
          <IngestaoStatus uploads={uploads} onLimparConcluidos={limparConcluidos} />
          {arquivosIngeridos.length > 0 && (
            <div className="rounded-lg border bg-card">
              <div className="border-b px-4 py-2">
                <h3 className="text-sm font-medium">
                  Arquivos processados ({arquivosIngeridos.length})
                </h3>
              </div>
              <ul className="divide-y">
                {arquivosIngeridos.map((a) => (
                  <li
                    key={a.runId}
                    className="px-4 py-2 flex items-center justify-between text-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-medium truncate">{a.arquivoNome}</p>
                      <p className="text-xs text-muted-foreground">
                        {a.tipo === "tiktok_csv" ? "TikTok CSV" : "ML XLSX"} ·{" "}
                        {a.linhasValidas} pedidos
                        {a.ambiguos > 0 && ` · ${a.ambiguos} ambíguo(s)`}
                        {a.comPrazoSemData > 0 &&
                          ` · ${a.comPrazoSemData} sem data`}
                      </p>
                    </div>
                    <Badge variant="outline" className="border-emerald-300 text-emerald-700">
                      Processado
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </TabsContent>

        <TabsContent value="dashboard">
          <DashboardTab estatisticas={estatisticas} dados={dados} hojeIso={hojeIso} />
        </TabsContent>

        <TabsContent value="cronograma">
          <CronogramaTab dados={dados} />
        </TabsContent>

        <TabsContent value="sku-dia">
          <SkuDiaTab dados={dados} hojeIso={hojeIso} />
        </TabsContent>

        <TabsContent value="extrator">
          <ExtratorTab
            dados={dados}
            hojeIso={hojeIso}
            categorias={categorias}
            filtros={filtrosExtrator}
            setFiltros={setFiltrosExtrator}
          />
        </TabsContent>

        <TabsContent value="pedidos">
          <PedidosTab dados={dados} hojeIso={hojeIso} />
        </TabsContent>

        <TabsContent value="ambiguos">
          <AmbiguosTab dados={dados} />
        </TabsContent>
      </Tabs>

      <ArquivarDialog
        open={arquivarOpen}
        onOpenChange={setArquivarOpen}
        onConfirmar={async (emails) =>
          encerrarSessao("finalizada", {
            enviarEmailPara: emails.length > 0 ? emails : undefined,
          })
        }
      />
    </div>
  );
}
