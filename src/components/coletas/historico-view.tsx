"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils";
import type {
  TipoColeta,
  ContaOperacao,
  BipagemRecord,
} from "@/types/coletas";
import {
  FUNCTION_TYPES,
  OPERATIONS,
  FUNCTION_DISPLAY,
  OPERATION_DISPLAY,
} from "@/types/coletas";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle2,
  Copy,
  Download,
  Barcode,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

interface HistoricoViewProps {
  onReview: (id: string) => void;
  onExportGeral: (bipagens: BipagemRecord[]) => void;
  onExportResumido: (bipagens: BipagemRecord[]) => void;
  onCopyCodes: (bipagemId: string) => void;
  onResumeBipagem: (bipagemId: string) => void;
}

const PAGE_SIZE = 20;

export function HistoricoView({
  onReview,
  onExportGeral,
  onExportResumido,
  onCopyCodes,
  onResumeBipagem,
}: HistoricoViewProps) {
  const [bipagens, setBipagens] = useState<BipagemRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [offset, setOffset] = useState(0);

  // Filters
  const [filtroDataInicio, setFiltroDataInicio] = useState("");
  const [filtroDataFim, setFiltroDataFim] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<TipoColeta | "todos">("todos");
  const [filtroConta, setFiltroConta] = useState<ContaOperacao | "todos">(
    "todos",
  );
  const [filtroRevisado, setFiltroRevisado] = useState<
    "todos" | "revisados" | "pendentes"
  >("todos");

  const fetchBipagens = useCallback(
    async (newOffset: number, append = false) => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("limit", String(PAGE_SIZE));
        params.set("offset", String(newOffset));
        if (filtroDataInicio) params.set("dataInicio", filtroDataInicio);
        if (filtroDataFim) params.set("dataFim", filtroDataFim);
        if (filtroTipo !== "todos") params.set("tipo", filtroTipo);
        if (filtroConta !== "todos") params.set("conta", filtroConta);
        if (filtroRevisado === "revisados") params.set("revisado", "true");
        else if (filtroRevisado === "pendentes")
          params.set("revisado", "false");

        const res = await fetch(`/api/coletas?${params.toString()}`);
        if (!res.ok) throw new Error("Erro ao carregar historico");
        const data = await res.json();

        if (append) {
          setBipagens((prev) => [...prev, ...data.bipagens]);
        } else {
          setBipagens(data.bipagens);
        }
        setTotal(data.total);
        setOffset(newOffset);
      } catch {
        toast.error("Erro ao carregar historico");
      } finally {
        setIsLoading(false);
      }
    },
    [filtroDataInicio, filtroDataFim, filtroTipo, filtroConta, filtroRevisado],
  );

  // Fetch on filter change (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchBipagens(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [fetchBipagens]);

  const handleLoadMore = useCallback(() => {
    fetchBipagens(offset + PAGE_SIZE, true);
  }, [fetchBipagens, offset]);

  const hasMore = bipagens.length < total;

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <Card className="bg-zinc-950 border-zinc-800">
        <CardContent className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div>
              <Label className="text-xs font-bold text-zinc-400 mb-1 block">
                Data Inicio
              </Label>
              <Input
                type="date"
                value={filtroDataInicio}
                onChange={(e) => setFiltroDataInicio(e.target.value)}
                className="bg-zinc-900 border-zinc-700 text-zinc-100 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs font-bold text-zinc-400 mb-1 block">
                Data Fim
              </Label>
              <Input
                type="date"
                value={filtroDataFim}
                onChange={(e) => setFiltroDataFim(e.target.value)}
                className="bg-zinc-900 border-zinc-700 text-zinc-100 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs font-bold text-zinc-400 mb-1 block">
                Tipo
              </Label>
              <Select
                value={filtroTipo}
                onValueChange={(v) =>
                  setFiltroTipo(v as TipoColeta | "todos")
                }
              >
                <SelectTrigger className="bg-zinc-900 border-zinc-700 text-zinc-100 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-700">
                  <SelectItem value="todos">Todos</SelectItem>
                  {FUNCTION_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {FUNCTION_DISPLAY[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-bold text-zinc-400 mb-1 block">
                Conta
              </Label>
              <Select
                value={filtroConta}
                onValueChange={(v) =>
                  setFiltroConta(v as ContaOperacao | "todos")
                }
              >
                <SelectTrigger className="bg-zinc-900 border-zinc-700 text-zinc-100 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-700">
                  <SelectItem value="todos">Todas</SelectItem>
                  {OPERATIONS.map((op) => (
                    <SelectItem key={op} value={op}>
                      {OPERATION_DISPLAY[op]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-bold text-zinc-400 mb-1 block">
                Status
              </Label>
              <Select
                value={filtroRevisado}
                onValueChange={(v) =>
                  setFiltroRevisado(
                    v as "todos" | "revisados" | "pendentes",
                  )
                }
              >
                <SelectTrigger className="bg-zinc-900 border-zinc-700 text-zinc-100 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-700">
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="revisados">Revisados</SelectItem>
                  <SelectItem value="pendentes">Pendentes</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary + export buttons */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-400">
          {bipagens.length} de {total} registro(s)
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onExportGeral(bipagens)}
            disabled={!bipagens.length}
            className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
          >
            <Download className="mr-1 h-4 w-4" /> Export Geral
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onExportResumido(bipagens)}
            disabled={!bipagens.length}
            className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
          >
            <Download className="mr-1 h-4 w-4" /> Export Resumido
          </Button>
        </div>
      </div>

      {/* Loading state */}
      {isLoading && bipagens.length === 0 && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && bipagens.length === 0 && (
        <Card className="bg-zinc-950 border-zinc-800">
          <CardContent className="py-12 text-center">
            <p className="text-zinc-400">
              Nenhum registro encontrado com os filtros selecionados
            </p>
          </CardContent>
        </Card>
      )}

      {/* Bipagem cards */}
      <div className="space-y-3">
        {bipagens.map((item) => (
          <Card key={item.id} className="bg-zinc-950 border-zinc-800">
            <CardContent className="p-4">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    {item.revisado && (
                      <CheckCircle2 className="h-4 w-4 text-green-400" />
                    )}
                    <Badge
                      variant="outline"
                      className={cn(
                        item.tipo === "FLEX"
                          ? "bg-orange-500/20 text-orange-400 border-orange-500/30"
                          : item.tipo === "COLETA"
                            ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
                            : item.tipo === "DEVOLUCAO"
                              ? "bg-green-500/20 text-green-400 border-green-500/30"
                              : "bg-amber-500/20 text-amber-400 border-amber-500/30",
                      )}
                    >
                      {FUNCTION_DISPLAY[item.tipo]}
                    </Badge>
                    {item.tipo !== "FLEX" && (
                      <span className="text-sm font-medium text-zinc-300">
                        {OPERATION_DISPLAY[item.conta]}
                      </span>
                    )}
                    <span className="text-sm font-bold text-zinc-100">
                      {item.total} pacote(s)
                    </span>
                  </div>
                  <div className="text-xs text-zinc-500 space-y-0.5">
                    {item.usuarioNome && (
                      <p className="text-zinc-400">
                        Bipado por {item.usuarioNome} em{" "}
                        {formatDate(item.createdAt)}
                      </p>
                    )}
                    {item.revisado && item.revisadoPorNome && (
                      <p className="text-green-400">
                        Revisado por {item.revisadoPorNome}
                        {item.revisadoEm &&
                          ` em ${formatDate(item.revisadoEm)}`}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 ml-4 flex-shrink-0">
                  <Button
                    size="sm"
                    onClick={() => onResumeBipagem(item.id)}
                    className="bg-orange-500 hover:bg-orange-600 text-white"
                  >
                    <Barcode className="mr-1 h-4 w-4" /> Bipar Mais
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onCopyCodes(item.id)}
                    className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                  >
                    <Copy className="mr-1 h-4 w-4" /> Copiar
                  </Button>
                  {!item.revisado && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onReview(item.id)}
                      className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                    >
                      <CheckCircle2 className="mr-1 h-4 w-4" /> Revisar
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Load more */}
      {hasMore && (
        <div className="text-center pt-2">
          <Button
            variant="outline"
            onClick={handleLoadMore}
            disabled={isLoading}
            className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
          >
            {isLoading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Carregar mais
          </Button>
        </div>
      )}
    </div>
  );
}
