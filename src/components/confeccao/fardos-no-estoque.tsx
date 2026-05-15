"use client";

// RITM-24 — Bloco "Fardos no estoque" no header da OP.
// Lista os fardos da Estante Virtual cujo lote == OP.numero OU cujo
// lote_cadastrado.ordem_producao_id == op.id. Visual leve; objetivo é
// só "tem fardos? quais?" sem sair da OP.

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Package, ChevronDown, ChevronRight, Loader2 } from "lucide-react";

type Fardo = {
  id: string;
  qrCode: string;
  sku: string;
  lote: string;
  quantidade: number;
  createdAt: string;
  estanteId: string;
  estanteNome: string;
};

interface Props {
  opNumero: string;
  opStatus: "em_andamento" | "concluida" | "cancelada";
}

export function FardosNoEstoque({ opNumero, opStatus }: Props) {
  // Expandido por default só pra OP concluida — pra OPs em andamento
  // costuma ser zero fardos.
  const [aberto, setAberto] = useState(opStatus === "concluida");
  const [fardos, setFardos] = useState<Fardo[] | null>(null);
  const [totalPecas, setTotalPecas] = useState(0);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto || fardos !== null) return;
    let cancelado = false;
    async function fetchFardos() {
      setLoading(true);
      setErro(null);
      try {
        const res = await fetch(
          `/api/confeccao/ops/${encodeURIComponent(opNumero)}/fardos`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error("Falha ao listar fardos");
        const data = await res.json();
        if (cancelado) return;
        setFardos(data.fardos);
        setTotalPecas(data.totalPecas);
      } catch (e) {
        if (cancelado) return;
        setErro(e instanceof Error ? e.message : "Erro");
        setFardos([]);
      } finally {
        if (!cancelado) setLoading(false);
      }
    }
    void fetchFardos();
    return () => {
      cancelado = true;
    };
  }, [aberto, fardos, opNumero]);

  return (
    <Card>
      <CardHeader className="py-3">
        <Button
          type="button"
          variant="ghost"
          className="h-auto p-0 hover:bg-transparent justify-start w-full"
          onClick={() => setAberto((a) => !a)}
        >
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            {aberto ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            <Package className="h-4 w-4" />
            Fardos no estoque
            {fardos !== null && (
              <Badge variant="secondary" className="ml-2 font-mono">
                {fardos.length} fardo(s) · {totalPecas} peças
              </Badge>
            )}
          </CardTitle>
        </Button>
      </CardHeader>
      {aberto && (
        <CardContent className="pt-0">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando…
            </div>
          )}
          {erro && (
            <div className="text-sm text-destructive py-2">{erro}</div>
          )}
          {!loading && fardos !== null && fardos.length === 0 && (
            <p className="text-sm text-muted-foreground py-2">
              Nenhum fardo encontrado pra esta OP. Os fardos aparecem aqui
              depois de cadastrados na Estante Virtual usando este número
              da OP como lote.
            </p>
          )}
          {!loading && fardos !== null && fardos.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">SKU</th>
                    <th className="py-2 pr-3 font-medium text-right">Qtd</th>
                    <th className="py-2 pr-3 font-medium">Estante</th>
                    <th className="py-2 pr-3 font-medium">Fardo</th>
                    <th className="py-2 font-medium">Criado em</th>
                  </tr>
                </thead>
                <tbody>
                  {fardos.map((f) => (
                    <tr key={f.id} className="border-b last:border-b-0">
                      <td className="py-2 pr-3 font-mono text-xs">{f.sku}</td>
                      <td className="py-2 pr-3 font-mono text-xs text-right">
                        {f.quantidade}
                      </td>
                      <td className="py-2 pr-3 text-xs">{f.estanteNome}</td>
                      <td className="py-2 pr-3 font-mono text-[11px] text-muted-foreground">
                        {f.qrCode.slice(0, 32)}
                        {f.qrCode.length > 32 ? "…" : ""}
                      </td>
                      <td className="py-2 text-xs text-muted-foreground">
                        {new Date(f.createdAt).toLocaleDateString("pt-BR")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
