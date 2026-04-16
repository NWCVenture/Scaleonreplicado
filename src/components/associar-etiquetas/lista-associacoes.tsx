"use client";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  Printer,
  Copy,
  Download,
  Trash2,
  Barcode,
} from "lucide-react";
import type { FormatoPlanilha } from "@/lib/etiquetas-utils";

interface AssociacaoItem {
  id: string;
  etiqueta: string;
  sku: string;
  quantidade: number;
  createdAt: string;
}

interface ListaAssociacoesProps {
  associacoes: AssociacaoItem[];
  formato: FormatoPlanilha;
  hasZpl: boolean;
  isGerandoPdf: boolean;
  onRemover: (id: string) => void;
  onLimparTudo: () => void;
  onExportar: () => void;
  onCopiar: () => void;
  onGerarPdfs: () => void;
}

export function ListaAssociacoes({
  associacoes,
  formato,
  hasZpl,
  isGerandoPdf,
  onRemover,
  onLimparTudo,
  onExportar,
  onCopiar,
  onGerarPdfs,
}: ListaAssociacoesProps) {
  const count = associacoes.length;
  const hasAssociacoes = count > 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <CardTitle>Associacoes Realizadas</CardTitle>
            <Badge variant="secondary">{count}</Badge>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={onGerarPdfs}
              disabled={!hasAssociacoes || !hasZpl || isGerandoPdf}
            >
              {isGerandoPdf ? (
                <>
                  <Spinner className="mr-2" />
                  Gerando...
                </>
              ) : (
                <>
                  <Printer className="mr-2 h-4 w-4" />
                  Gerar PDFs
                </>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onCopiar}
              disabled={!hasAssociacoes}
            >
              <Copy className="mr-2 h-4 w-4" />
              Copiar
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onExportar}
              disabled={!hasAssociacoes}
            >
              <Download className="mr-2 h-4 w-4" />
              Exportar CSV
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!hasAssociacoes ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground">
            <Barcode className="mb-4 h-12 w-12 opacity-20" />
            <p className="text-lg font-medium">Nenhuma associacao</p>
            <p className="mt-2 text-sm">Bipe etiquetas para comecar</p>
          </div>
        ) : (
          <>
            <div className="max-h-[500px] space-y-2 overflow-y-auto">
              {associacoes.map((item) => (
                <div
                  key={item.id}
                  className="group flex items-center justify-between rounded-lg border border-slate-700 bg-slate-800/50 p-3 transition-colors hover:bg-slate-800"
                >
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      {formato === "lista_empacotamento" ? (
                        <>
                          <span className="rounded bg-blue-950 px-2 py-0.5 font-semibold text-blue-300">
                            SKU: {item.sku}
                          </span>
                          <span className="text-muted-foreground">&rarr;</span>
                          <span className="rounded bg-slate-700 px-2 py-0.5 font-mono text-sm font-semibold">
                            Pedido: {item.etiqueta}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="rounded bg-slate-700 px-2 py-0.5 font-mono text-sm font-semibold">
                            {item.etiqueta}
                          </span>
                          <span className="text-muted-foreground">&rarr;</span>
                          <span className="rounded bg-blue-950 px-2 py-0.5 font-semibold text-blue-300">
                            SKU: {item.sku}
                          </span>
                        </>
                      )}
                      {item.quantidade > 0 && (
                        <>
                          <span className="text-muted-foreground">&bull;</span>
                          <span className="rounded bg-green-950 px-2 py-0.5 text-sm font-medium text-green-300">
                            Qtd: {item.quantidade}
                          </span>
                        </>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {new Date(item.createdAt).toLocaleString("pt-BR")}
                    </p>
                  </div>
                  <button
                    onClick={() => onRemover(item.id)}
                    className="ml-2 rounded p-1.5 text-red-500 opacity-0 transition-opacity hover:bg-red-950 hover:text-red-400 group-hover:opacity-100"
                    title="Remover associacao"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-4 border-t border-slate-700 pt-4">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full text-red-500 hover:bg-red-950 hover:text-red-400"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Limpar Todas as Associacoes
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Limpar todas as associacoes?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Esta acao ira remover todas as {count} associacoes. Esta
                      acao nao pode ser desfeita.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={onLimparTudo}
                      className="bg-destructive text-white hover:bg-destructive/90"
                    >
                      Limpar Todas
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
