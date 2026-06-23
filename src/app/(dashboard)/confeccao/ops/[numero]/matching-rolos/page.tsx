"use client";

// Matching de Rolos — RITM-34.
// Read-only. Compara pesos do fornecedor com pesos do cortador por rank
// dentro de cada (cor, oficina). Alerta sai quando |diff%| > tolerância.

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, AlertTriangle, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  calcularMatchingRolos,
  TOLERANCIA_MATCHING_PADRAO,
  type MatchingCorOficina,
} from "@/lib/confeccao/matching-rolos";
import type { SubtaskCompraPayload } from "@/lib/confeccao/schemas/payloads/compra";
import type { SubtaskCortePayload } from "@/lib/confeccao/schemas/payloads/corte";

interface OPDetailMin {
  op: { numero: string };
  subtasks: Array<{ prefixo: string; payload: unknown }>;
}

function formatarKg(v: number): string {
  return v.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatarPct(v: number | null): string {
  if (v === null) return "—";
  const sinal = v > 0 ? "+" : "";
  return `${sinal}${v.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

function formatarDiffKg(v: number | null): string {
  if (v === null) return "—";
  const sinal = v > 0 ? "+" : "";
  return `${sinal}${formatarKg(v)}`;
}

export default function MatchingRolosPage({
  params,
}: {
  params: Promise<{ numero: string }>;
}) {
  const { numero } = use(params);

  const [data, setData] = useState<OPDetailMin | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [coresNomes, setCoresNomes] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [oficinasNomes, setOficinasNomes] = useState<Map<string, string>>(
    () => new Map(),
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/confeccao/ops/${numero}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        if (!cancelled) setErro("OP não encontrada");
        return;
      }
      const json = (await res.json()) as OPDetailMin;
      if (cancelled) return;
      setData(json);

      const compra = json.subtasks.find((s) => s.prefixo === "OPBUY")
        ?.payload as SubtaskCompraPayload | undefined;

      const corIds = new Set<string>();
      for (const f of compra?.fornecedores ?? []) {
        for (const c of f.cores) corIds.add(c.corId);
      }
      const oficinaIds = new Set<string>();
      for (const o of compra?.distribuicaoOficinas ?? []) {
        oficinaIds.add(o.oficinaId);
      }

      if (corIds.size > 0) {
        const r = await fetch(
          "/api/confeccao/cores?pageSize=200&incluirInativos=true",
          { cache: "no-store" },
        );
        if (r.ok && !cancelled) {
          const d = (await r.json()) as {
            items: Array<{ id: string; nome: string }>;
          };
          setCoresNomes(new Map(d.items.map((x) => [x.id, x.nome])));
        }
      }
      if (oficinaIds.size > 0) {
        const r = await fetch(
          "/api/confeccao/fornecedores?pageSize=200&incluirInativos=true",
          { cache: "no-store" },
        );
        if (r.ok && !cancelled) {
          const d = (await r.json()) as {
            items: Array<{ id: string; nome: string }>;
          };
          setOficinasNomes(new Map(d.items.map((x) => [x.id, x.nome])));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [numero]);

  if (erro) {
    return <div className="p-6 text-sm text-destructive">{erro}</div>;
  }
  if (!data) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Carregando…</div>
    );
  }

  const compra = data.subtasks.find((s) => s.prefixo === "OPBUY")
    ?.payload as SubtaskCompraPayload | undefined;
  const corte = data.subtasks.find((s) => s.prefixo === "OPCOR")
    ?.payload as SubtaskCortePayload | undefined;

  const matching = calcularMatchingRolos(compra ?? null, corte ?? null);
  const tolerancia =
    compra?.toleranciaMatchingPct ?? TOLERANCIA_MATCHING_PADRAO;

  // Agrupa por oficina
  const porOficina = new Map<string, MatchingCorOficina[]>();
  for (const m of matching) {
    const arr = porOficina.get(m.oficinaId) ?? [];
    arr.push(m);
    porOficina.set(m.oficinaId, arr);
  }

  return (
    <div className="p-6 pt-0 space-y-4">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/confeccao/ops/${data.op.numero}`}>
            <ArrowLeft className="size-3.5" />
            Voltar à OP
          </Link>
        </Button>
      </div>

      <div className="space-y-1">
        <h1 className="text-xl font-medium">
          Matching de Rolos · {data.op.numero}
        </h1>
        <p className="text-xs text-muted-foreground">
          Aproxima pares fornecedor↔cortador por ranking de peso dentro de
          cada (cor, oficina). Pesos do fornecedor são distribuídos
          ordenadamente — primeiras oficinas pegam os pesos mais leves. A
          planilha original usa a mesma heurística.
        </p>
      </div>

      <div className="flex items-center gap-3 rounded border bg-card p-3 text-sm">
        <div>
          <span className="text-muted-foreground">Tolerância:</span>{" "}
          <span className="font-medium tabular-nums">
            {tolerancia.toLocaleString("pt-BR", {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1,
            })}{" "}
            %
          </span>
        </div>
        <Link
          href={`/confeccao/ops/${data.op.numero}`}
          className="ml-auto text-xs text-primary hover:underline inline-flex items-center gap-1"
        >
          Editar na Compra
          <ExternalLink className="size-3" />
        </Link>
      </div>

      {matching.length === 0 ? (
        <div className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <div>
            Nada pra comparar ainda. Tenha a Compra com plano de
            distribuição definido e o cortador informando peso dos rolos
            recebidos.
          </div>
        </div>
      ) : (
        <Accordion
          type="multiple"
          defaultValue={Array.from(porOficina.keys())}
          className="space-y-2"
        >
          {Array.from(porOficina.entries()).map(([oficinaId, lista]) => {
            const nomeOficina = oficinasNomes.get(oficinaId) ?? oficinaId;
            return (
              <AccordionItem
                key={oficinaId}
                value={oficinaId}
                className="border rounded"
              >
                <AccordionTrigger className="px-4 hover:no-underline">
                  <span className="font-medium">{nomeOficina}</span>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <Accordion
                    type="multiple"
                    defaultValue={lista.map((l) => l.corId)}
                    className="space-y-2"
                  >
                    {lista.map((mat) => (
                      <BlocoCor
                        key={`${oficinaId}-${mat.corId}`}
                        matching={mat}
                        nomeCor={coresNomes.get(mat.corId) ?? mat.corId}
                      />
                    ))}
                  </Accordion>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}
    </div>
  );
}

function BlocoCor({
  matching,
  nomeCor,
}: {
  matching: MatchingCorOficina;
  nomeCor: string;
}) {
  const alertas = matching.pares.filter((p) => p.alerta).length;
  const orfaos = matching.pares.filter(
    (p) => p.forneOrfao || p.cortOrfao,
  ).length;
  const totalPares = matching.pares.length;

  return (
    <AccordionItem
      value={matching.corId}
      className="border rounded bg-muted/20"
    >
      <AccordionTrigger className="px-3 py-2 hover:no-underline">
        <div className="flex items-baseline gap-2 text-sm">
          <span className="font-medium">{nomeCor}</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {totalPares} rolo(s)
          </span>
          {alertas > 0 && (
            <Badge variant="destructive" className="ml-2">
              {alertas} alerta(s)
            </Badge>
          )}
          {orfaos > 0 && (
            <Badge
              variant="outline"
              className="border-amber-400 text-amber-700 bg-amber-50"
            >
              {orfaos} órfão(s)
            </Badge>
          )}
        </div>
      </AccordionTrigger>
      <AccordionContent className="px-3 pb-3">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground border-b">
                <th className="text-right p-1 w-10">#</th>
                <th className="text-right p-1">Forne (kg)</th>
                <th className="text-right p-1">Cort (kg)</th>
                <th className="text-right p-1">Diff kg</th>
                <th className="text-right p-1">Diff %</th>
                <th className="text-center p-1 w-8">⚠</th>
              </tr>
            </thead>
            <tbody>
              {matching.pares.map((p) => {
                let rowClass = "border-b last:border-0 ";
                if (p.alerta) rowClass += "border-l-2 border-l-red-500 ";
                if (p.forneOrfao || p.cortOrfao)
                  rowClass += "bg-amber-50/50 ";
                return (
                  <tr key={p.rank} className={rowClass}>
                    <td className="text-right p-1 text-xs text-muted-foreground tabular-nums">
                      {p.rank}
                    </td>
                    <td className="text-right p-1 tabular-nums">
                      {p.pesoFornecedor === null
                        ? "—"
                        : formatarKg(p.pesoFornecedor)}
                    </td>
                    <td className="text-right p-1 tabular-nums">
                      {p.pesoCortador === null
                        ? "—"
                        : formatarKg(p.pesoCortador)}
                    </td>
                    <td
                      className={`text-right p-1 tabular-nums ${
                        p.diffKg !== null && Math.abs(p.diffKg) > 0
                          ? p.diffKg > 0
                            ? "text-emerald-700"
                            : "text-red-700"
                          : ""
                      }`}
                    >
                      {formatarDiffKg(p.diffKg)}
                    </td>
                    <td
                      className={`text-right p-1 tabular-nums ${
                        p.alerta ? "font-semibold" : ""
                      }`}
                    >
                      {formatarPct(p.diffPct)}
                    </td>
                    <td className="text-center p-1">
                      {p.alerta && (
                        <span className="text-red-600" aria-label="Alerta">
                          ⚠
                        </span>
                      )}
                      {p.forneOrfao && (
                        <span
                          className="text-amber-700"
                          aria-label="Cortador não informou"
                          title="Cortador não informou peso deste rolo"
                        >
                          ?
                        </span>
                      )}
                      {p.cortOrfao && (
                        <span
                          className="text-amber-700"
                          aria-label="Rolo extra do cortador"
                          title="Cortador devolveu rolo extra inesperado"
                        >
                          +
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t-2 font-medium">
                <td className="p-1 text-xs uppercase text-muted-foreground">
                  Σ
                </td>
                <td className="text-right p-1 tabular-nums">
                  {formatarKg(matching.totalForne)}
                </td>
                <td className="text-right p-1 tabular-nums">
                  {formatarKg(matching.totalCort)}
                </td>
                <td
                  className={`text-right p-1 tabular-nums ${
                    matching.diffTotalKg > 0
                      ? "text-emerald-700"
                      : matching.diffTotalKg < 0
                        ? "text-red-700"
                        : ""
                  }`}
                >
                  {formatarDiffKg(matching.diffTotalKg)}
                </td>
                <td className="text-right p-1 tabular-nums">
                  {formatarPct(matching.diffTotalPct)}
                </td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}
