"use client";

import { useState, useEffect } from "react";
import { copyToClipboard } from "@/lib/utils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Download, RefreshCw, FileText, Package, Info } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";

interface ContagemItem {
  sku: string;
  lote: string;
  qtd: number;
}

const exportFile = (content: string, filename: string) => {
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

export default function RecuperarDados() {
  const [coletasIds, setColetasIds] = useState<string[]>([]);
  const [contagemItems, setContagemItems] = useState<ContagemItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = () => {
    try {
      // Carregar dados de Coletas
      const savedIds = localStorage.getItem("coletas_ids");
      if (savedIds) {
        const ids = JSON.parse(savedIds);
        setColetasIds(ids);
      }

      // Carregar dados de Contagem
      const savedItems = localStorage.getItem("stockflow_scanned_items");
      if (savedItems) {
        const items = JSON.parse(savedItems);
        setContagemItems(items);
      }

      setLoaded(true);
    } catch (error) {
      console.error("Erro ao carregar dados:", error);
      toast.error("Erro ao carregar dados do localStorage");
    }
  };

  const exportColetasIds = () => {
    if (coletasIds.length === 0) {
      toast.error("Nenhum ID encontrado para exportar");
      return;
    }

    exportFile(
      coletasIds.join("\n"),
      `ids_coletas_recuperados_${new Date().toISOString().split("T")[0]}.txt`
    );
    toast.success("IDs exportados com sucesso!");
  };

  const exportContagemItems = () => {
    if (contagemItems.length === 0) {
      toast.error("Nenhum item encontrado para exportar");
      return;
    }

    let report = "RELATORIO DE ITENS RECUPERADOS\n";
    report += "================================\n\n";

    contagemItems.forEach((item, index) => {
      report += `${index + 1}. SKU: ${item.sku} | Lote: ${item.lote} | Qtd: ${item.qtd}\n`;
    });

    exportFile(
      report,
      `contagem_recuperada_${new Date().toISOString().split("T")[0]}.txt`
    );
    toast.success("Itens exportados com sucesso!");
  };

  const copyColetasIds = () => {
    if (coletasIds.length === 0) {
      toast.error("Nenhum ID encontrado");
      return;
    }

    copyToClipboard(coletasIds.join("\n"));
    toast.success(
      `${coletasIds.length} IDs copiados para a area de transferencia!`
    );
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Recuperar Dados"
        description="Verifique e recupere dados salvos automaticamente no navegador. Ferramenta de transicao — dados futuros estarao no banco de dados."
        icon={<Package className="h-8 w-8 text-primary" />}
      />

      <div className="flex gap-4 mb-6">
        <Button onClick={loadData} variant="outline">
          <RefreshCw className="mr-2 h-4 w-4" />
          Recarregar Dados
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Dados de Coletas */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Bipagem de Coletas
            </CardTitle>
            <CardDescription>
              IDs bipados na pagina de Coletas
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!loaded ? (
              <p className="text-muted-foreground">Carregando...</p>
            ) : coletasIds.length > 0 ? (
              <>
                <div className="bg-muted p-4 rounded-lg">
                  <p className="text-2xl font-bold text-primary">
                    {coletasIds.length}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    IDs encontrados
                  </p>
                </div>

                <div className="space-y-2">
                  <Button
                    onClick={copyColetasIds}
                    className="w-full"
                    variant="default"
                  >
                    <FileText className="mr-2 h-4 w-4" />
                    Copiar IDs ({coletasIds.length})
                  </Button>
                  <Button
                    onClick={exportColetasIds}
                    className="w-full"
                    variant="outline"
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Exportar como TXT
                  </Button>
                </div>

                <div className="max-h-60 overflow-y-auto bg-muted/50 p-3 rounded-lg">
                  <p className="text-xs font-mono text-muted-foreground mb-2">
                    Primeiros 10 IDs:
                  </p>
                  {coletasIds.slice(0, 10).map((id, i) => (
                    <p key={i} className="text-xs font-mono">
                      {id}
                    </p>
                  ))}
                  {coletasIds.length > 10 && (
                    <p className="text-xs text-muted-foreground mt-2">
                      ... e mais {coletasIds.length - 10} IDs
                    </p>
                  )}
                </div>
              </>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Nenhum dado de coletas encontrado</p>
                <p className="text-sm mt-2">
                  Dados sao salvos automaticamente ao bipar na pagina de Coletas
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Dados de Contagem */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Bipagem & Contagem
            </CardTitle>
            <CardDescription>
              Itens bipados na pagina de Contagem
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!loaded ? (
              <p className="text-muted-foreground">Carregando...</p>
            ) : contagemItems.length > 0 ? (
              <>
                <div className="bg-muted p-4 rounded-lg">
                  <p className="text-2xl font-bold text-primary">
                    {contagemItems.length}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Itens encontrados
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Total:{" "}
                    {contagemItems.reduce(
                      (acc, item) => acc + (item.qtd || 0),
                      0
                    )}{" "}
                    pecas
                  </p>
                </div>

                <Button
                  onClick={exportContagemItems}
                  className="w-full"
                  variant="outline"
                >
                  <Download className="mr-2 h-4 w-4" />
                  Exportar Relatorio
                </Button>

                <div className="max-h-60 overflow-y-auto bg-muted/50 p-3 rounded-lg space-y-1">
                  <p className="text-xs font-mono text-muted-foreground mb-2">
                    Primeiros 5 itens:
                  </p>
                  {contagemItems.slice(0, 5).map((item, i) => (
                    <div key={i} className="text-xs">
                      <span className="font-mono font-bold">{item.sku}</span>
                      <span className="text-muted-foreground ml-2">
                        {item.qtd}x | {item.lote}
                      </span>
                    </div>
                  ))}
                  {contagemItems.length > 5 && (
                    <p className="text-xs text-muted-foreground mt-2">
                      ... e mais {contagemItems.length - 5} itens
                    </p>
                  )}
                </div>
              </>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Nenhum dado encontrado</p>
                <p className="text-sm mt-2">
                  Os dados sao salvos automaticamente quando voce bipe na pagina
                  de Contagem
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Informacoes Adicionais */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="h-5 w-5" />
            Informacoes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              Esta e uma ferramenta de transicao para recuperar dados salvos
              localmente. Dados futuros serao armazenados no banco de dados.
            </p>
            <p>
              Os dados sao salvos automaticamente no localStorage do navegador e
              persistem mesmo apos fechar o navegador.
            </p>
            <p>
              Se voce limpou o cache ou usou modo anonimo, os dados podem ter
              sido perdidos.
            </p>
            <p>
              Verifique tambem a pasta de Downloads por arquivos exportados
              anteriormente.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
