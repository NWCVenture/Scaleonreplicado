"use client";

// Lista paginada de planejamentos arquivados (RITM-11).

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Mail,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PlanejamentoListItem } from "@/types/central-envios";

const LIMIT = 20;

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

export default function HistoricoPage() {
  const [planejamentos, setPlanejamentos] = useState<PlanejamentoListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async (off: number) => {
    setLoading(true);
    setErro(null);
    try {
      const r = await fetch(
        `/api/central-envios?limit=${LIMIT}&offset=${off}`,
        { cache: "no-store" },
      );
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${r.status}`);
      }
      const json = (await r.json()) as {
        planejamentos: PlanejamentoListItem[];
        total: number;
      };
      setPlanejamentos(json.planejamentos);
      setTotal(json.total);
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    carregar(offset);
  }, [carregar, offset]);

  const temAnterior = offset > 0;
  const temProximo = offset + LIMIT < total;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Link
            href="/central-envios"
            className="inline-flex items-center gap-1 hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> Central de Envios
          </Link>
          <span>/</span>
          <span>Histórico</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Histórico de planejamentos
        </h1>
        <p className="text-sm text-muted-foreground">
          Snapshots imutáveis dos planejamentos arquivados.{" "}
          {total > 0 && (
            <span>
              {total} planejamento{total === 1 ? "" : "s"} no total.
            </span>
          )}
        </p>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mr-2" /> Carregando…
        </div>
      ) : erro ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {erro}
        </div>
      ) : planejamentos.length === 0 ? (
        <div className="rounded-lg border bg-muted/30 px-6 py-12 text-center text-sm text-muted-foreground">
          Nenhum planejamento arquivado ainda. Quando você arquivar uma
          sessão na Central de Envios, ela aparece aqui.
        </div>
      ) : (
        <>
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data ref.</TableHead>
                  <TableHead>Arquivado em</TableHead>
                  <TableHead>Por</TableHead>
                  <TableHead className="text-right">Pedidos</TableHead>
                  <TableHead className="text-right">Atrasados</TableHead>
                  <TableHead className="text-right">HOJE</TableHead>
                  <TableHead className="text-right">Ambíguos</TableHead>
                  <TableHead className="text-right">Arquivos</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {planejamentos.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono">
                      {formatarData(p.dataReferencia)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {formatarDataHora(p.geradoEm)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {p.usuarioNome ?? p.usuarioId}
                    </TableCell>
                    <TableCell className="text-right">
                      {p.totalPedidos}
                    </TableCell>
                    <TableCell className="text-right">
                      {p.totalAtrasados > 0 ? (
                        <span className="text-red-600 font-medium">
                          {p.totalAtrasados}
                        </span>
                      ) : (
                        p.totalAtrasados
                      )}
                    </TableCell>
                    <TableCell className="text-right">{p.totalHoje}</TableCell>
                    <TableCell className="text-right">
                      {p.totalAmbiguos}
                    </TableCell>
                    <TableCell className="text-right">
                      {p.totalArquivos}
                    </TableCell>
                    <TableCell>
                      {p.emailEnviadoPara && p.emailEnviadoPara.length > 0 ? (
                        <Badge
                          variant="outline"
                          className="border-emerald-300 text-emerald-700"
                          title={p.emailEnviadoPara.join(", ")}
                        >
                          <Mail className="h-3 w-3 mr-1" />
                          {p.emailEnviadoPara.length}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" asChild>
                        <Link href={`/central-envios/historico/${p.id}`}>
                          Ver
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {offset + 1}–{Math.min(offset + LIMIT, total)} de {total}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!temAnterior}
                onClick={() => setOffset(Math.max(0, offset - LIMIT))}
              >
                <ChevronLeft className="h-4 w-4 mr-1" /> Anterior
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!temProximo}
                onClick={() => setOffset(offset + LIMIT)}
              >
                Próximo <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
