"use client";

import { useState, useEffect } from "react";
import { useSession } from "@/lib/auth-client";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Trash2, Loader2, FileText } from "lucide-react";
import { formatDate } from "@/lib/utils";

type ProdutoAvariado = {
  id: string;
  sku: string;
  avaria: string;
  localizacao: string;
  codigoFardo?: string | null;
  usuarioId?: string | null;
  createdAt: string;
};

const LOCALIZACAO_LABELS: Record<string, string> = {
  DEVOLUCAO: "Devolucao",
  ESTANTE: "Estante",
  LOTE_DE_COSTURA: "Lote de Costura",
};

export default function ProdutosAvariadosPage() {
  const { data: session } = useSession();

  const [sku, setSku] = useState("");
  const [avaria, setAvaria] = useState("");
  const [localizacao, setLocalizacao] = useState("");
  const [codigoFardo, setCodigoFardo] = useState("");
  const [historico, setHistorico] = useState<ProdutoAvariado[]>([]);
  const [showHistorico, setShowHistorico] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const fetchHistorico = async () => {
    try {
      const res = await fetch("/api/produtos-avariados");
      if (!res.ok) throw new Error("Erro ao buscar historico");
      const data = await res.json();
      setHistorico(data.registros);
    } catch (error) {
      console.error("Erro ao carregar historico:", error);
      toast.error("Erro ao carregar historico");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (session) {
      fetchHistorico();
    }
  }, [session]);

  useEffect(() => {
    if (sku.length < 1) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/sku-catalogo?search=${encodeURIComponent(sku)}`
        );
        if (!res.ok) return;
        const data = await res.json();
        const codigos = data.skus.map(
          (s: { codigo: string }) => s.codigo
        );
        setSuggestions(codigos.slice(0, 10));
        setShowSuggestions(codigos.length > 0);
      } catch {
        setSuggestions([]);
        setShowSuggestions(false);
      }
    }, 300);

    return () => clearTimeout(timeout);
  }, [sku]);

  const handleRegistrar = async () => {
    if (!sku.trim()) {
      toast.error("Informe o SKU!");
      return;
    }
    if (!avaria.trim()) {
      toast.error("Descreva a avaria encontrada!");
      return;
    }
    if (!localizacao) {
      toast.error("Selecione onde foi encontrada a avaria!");
      return;
    }
    if (localizacao === "LOTE_DE_COSTURA" && !codigoFardo.trim()) {
      toast.error("Informe o codigo do fardo!");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/produtos-avariados", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku: sku.trim().toUpperCase(),
          avaria: avaria.trim(),
          localizacao,
          codigoFardo:
            localizacao === "LOTE_DE_COSTURA"
              ? codigoFardo.trim()
              : undefined,
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Erro ao registrar");
      }

      toast.success("Produto avariado registrado com sucesso!");
      setSku("");
      setAvaria("");
      setLocalizacao("");
      setCodigoFardo("");
      fetchHistorico();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Erro ao registrar produto"
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeletar = async (id: string) => {
    if (!confirm("Deseja realmente remover este registro?")) return;

    try {
      const res = await fetch(`/api/produtos-avariados/${id}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("Erro ao remover");

      toast.success("Registro removido!");
      fetchHistorico();
    } catch {
      toast.error("Erro ao remover registro");
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <PageHeader
          title="Produtos com Avarias"
          description="Registre produtos com avarias, descartes e prejuizos"
        />
        <Button
          variant="outline"
          onClick={() => setShowHistorico(!showHistorico)}
        >
          <FileText className="mr-2 h-4 w-4" />
          {showHistorico ? "Ocultar" : "Ver"} Historico ({historico.length})
        </Button>
      </div>

      {showHistorico && (
        <Card className="bg-slate-900 border-slate-700">
          <CardHeader>
            <CardTitle>Historico de Produtos Avariados</CardTitle>
            <CardDescription>
              {historico.length} registro(s) encontrado(s)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 max-h-[500px] overflow-auto">
              {isLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : historico.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  Nenhum registro encontrado.
                </p>
              ) : (
                historico.map((item) => (
                  <div
                    key={item.id}
                    className="p-4 border border-slate-700 rounded-lg bg-red-950/20"
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <AlertTriangle className="h-5 w-5 text-red-500" />
                          <span className="font-mono font-bold text-lg">
                            {item.sku}
                          </span>
                        </div>
                        <p className="text-sm mb-2">
                          <span className="font-medium">Avaria:</span>{" "}
                          {item.avaria}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          <span className="font-medium">Localizacao:</span>{" "}
                          {LOCALIZACAO_LABELS[item.localizacao] ||
                            item.localizacao}
                          {item.codigoFardo && (
                            <span className="ml-2 font-mono">
                              - Fardo: {item.codigoFardo}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground mt-2">
                          {formatDate(item.createdAt)}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeletar(item.id)}
                        className="text-red-500 hover:text-red-400"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="bg-slate-900 border-slate-700">
        <CardHeader>
          <CardTitle>Registrar Produto Avariado</CardTitle>
          <CardDescription>
            Informe o SKU, descreva a avaria e onde foi encontrada
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* SKU com Autocomplete */}
          <div className="space-y-2 relative">
            <Label>SKU</Label>
            <div className="relative">
              <Input
                type="text"
                placeholder="Digite o SKU (ex: LUA AZ G)"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                onFocus={() => {
                  if (sku.length > 0 && suggestions.length > 0) {
                    setShowSuggestions(true);
                  }
                }}
                onBlur={() => {
                  setTimeout(() => setShowSuggestions(false), 200);
                }}
                className="bg-slate-800 border-slate-600"
              />

              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-slate-800 border border-slate-600 rounded-md shadow-lg max-h-60 overflow-auto">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="w-full text-left px-4 py-2 hover:bg-slate-700 cursor-pointer text-sm"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setSku(s);
                        setShowSuggestions(false);
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Descricao da Avaria */}
          <div className="space-y-2">
            <Label>Descricao da Avaria</Label>
            <Textarea
              placeholder="Descreva o problema encontrado no produto (ex: Mancha, rasgo, defeito de fabricacao, etc.)"
              value={avaria}
              onChange={(e) => setAvaria(e.target.value)}
              rows={4}
              className="resize-none bg-slate-800 border-slate-600"
            />
          </div>

          {/* Localizacao */}
          <div className="space-y-2">
            <Label>Onde foi encontrada a avaria?</Label>
            <select
              className="flex h-12 w-full items-center justify-between rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              value={localizacao}
              onChange={(e) => {
                setLocalizacao(e.target.value);
                if (e.target.value !== "LOTE_DE_COSTURA") {
                  setCodigoFardo("");
                }
              }}
            >
              <option value="">Selecione...</option>
              <option value="DEVOLUCAO">Devolucao</option>
              <option value="ESTANTE">Estante</option>
              <option value="LOTE_DE_COSTURA">Lote de Costura</option>
            </select>
          </div>

          {/* Codigo do Fardo (condicional) */}
          {localizacao === "LOTE_DE_COSTURA" && (
            <div className="space-y-2">
              <Label>Codigo do Fardo</Label>
              <Input
                type="text"
                placeholder="Digite ou bipe o codigo do fardo"
                value={codigoFardo}
                onChange={(e) => setCodigoFardo(e.target.value)}
                className="h-12 text-lg font-mono bg-slate-800 border-slate-600"
              />
              <p className="text-xs text-muted-foreground">
                Este codigo sera usado para identificar o lote
              </p>
            </div>
          )}

          {/* Botao Registrar */}
          <Button
            onClick={handleRegistrar}
            className="w-full h-12 text-lg"
            disabled={
              isSubmitting || !sku.trim() || !avaria.trim() || !localizacao
            }
          >
            {isSubmitting ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : (
              <AlertTriangle className="mr-2 h-5 w-5" />
            )}
            {isSubmitting ? "Registrando..." : "Registrar Produto Avariado"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
