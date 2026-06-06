"use client";

import { useMemo, useState } from "react";
import { Copy, Filter, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type {
  CategoriaSkuClient,
  FiltrosExtrator,
  PedidoEnriquecido,
  StatusPrazoUi,
} from "@/types/central-envios";
import {
  avaliarCategoria,
  deriveStatusPrazo,
} from "@/lib/central-envios/ui/avaliar-categoria";
import { cn } from "@/lib/utils";

type Props = {
  dados: PedidoEnriquecido[];
  hojeIso: string;
  categorias: CategoriaSkuClient[];
  filtros: Record<string, unknown>;
  setFiltros: (f: Record<string, unknown>) => void;
};

const PLATAFORMAS: Array<{ id: string; label: string }> = [
  { id: "tiktok_shop", label: "TikTok" },
  { id: "mercado_livre", label: "Mercado Livre" },
  { id: "shopee", label: "Shopee" },
];

const STATUS_OPCOES: Array<{ id: StatusPrazoUi; label: string; tom: string }> = [
  { id: "ATRASADO", label: "Atrasado", tom: "border-red-300 text-red-700" },
  { id: "HOJE", label: "Hoje", tom: "border-orange-300 text-orange-700" },
  { id: "NO_PRAZO", label: "No prazo", tom: "border-emerald-300 text-emerald-700" },
  { id: "SEM_DATA", label: "Sem data", tom: "border-zinc-300 text-zinc-700" },
];

function lerFiltros(raw: Record<string, unknown>): FiltrosExtrator {
  return raw as FiltrosExtrator;
}

function tem<T>(arr: T[] | undefined, v: T): boolean {
  return Array.isArray(arr) && arr.includes(v);
}

function toggle<T>(arr: T[] | undefined, v: T): T[] {
  const atual = Array.isArray(arr) ? arr : [];
  return atual.includes(v) ? atual.filter((x) => x !== v) : [...atual, v];
}

function valoresUnicos(
  dados: PedidoEnriquecido[],
  picker: (p: PedidoEnriquecido) => string | string[] | undefined,
): string[] {
  const set = new Set<string>();
  for (const p of dados) {
    const v = picker(p);
    if (!v) continue;
    if (Array.isArray(v)) v.forEach((x) => x && set.add(x));
    else set.add(v);
  }
  return [...set].sort();
}

async function copiarTexto(texto: string, msg: string): Promise<void> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(texto);
    } else {
      // Fallback raro (sem clipboard API)
      const ta = document.createElement("textarea");
      ta.value = texto;
      ta.style.position = "fixed";
      ta.style.left = "-10000px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    toast.success(msg);
  } catch (err) {
    console.error("copy err:", err);
    toast.error("Falha ao copiar");
  }
}

function PillToggle({
  ativo,
  label,
  className,
  onClick,
}: {
  ativo: boolean;
  label: string;
  className?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      type="button"
      className={cn(
        "px-2.5 py-1 rounded-full text-xs border transition-colors",
        ativo
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-background hover:bg-accent",
        className,
      )}
    >
      {label}
    </button>
  );
}

export function ExtratorTab({
  dados,
  hojeIso,
  categorias,
  filtros: filtrosRaw,
  setFiltros: setFiltrosRaw,
}: Props) {
  const filtros = useMemo(() => lerFiltros(filtrosRaw), [filtrosRaw]);
  const updateFiltros = (patch: Partial<FiltrosExtrator>) => {
    setFiltrosRaw({ ...filtrosRaw, ...patch });
  };

  const opcoesModelo = useMemo(
    () =>
      valoresUnicos(dados, (p) =>
        p.parsed.kind === "OK" ? p.parsed.modeloCodigo : undefined,
      ),
    [dados],
  );
  const opcoesCor = useMemo(
    () =>
      valoresUnicos(dados, (p) =>
        p.parsed.kind === "OK" ? p.parsed.cores.map((c) => c.cor) : undefined,
      ),
    [dados],
  );
  const opcoesTamanho = useMemo(
    () =>
      valoresUnicos(dados, (p) =>
        p.parsed.kind === "OK" ? p.parsed.tamanho : undefined,
      ),
    [dados],
  );

  const [buscaLocal, setBuscaLocal] = useState((filtros.busca as string) ?? "");

  const filtrados = useMemo(() => {
    const buscaAtiva = buscaLocal.trim().toLowerCase();
    return dados.filter((p) => {
      if (filtros.plataformas && filtros.plataformas.length > 0) {
        if (!filtros.plataformas.includes(p.canal)) return false;
      }
      const status = deriveStatusPrazo(p.prazo.prazoIso, hojeIso);
      if (filtros.statusPrazo && filtros.statusPrazo.length > 0) {
        if (!filtros.statusPrazo.includes(status)) return false;
      }
      if (filtros.soAmbiguos && p.parsed.kind !== "AMBIGUO") return false;
      if (p.parsed.kind === "OK") {
        if (filtros.modelos && filtros.modelos.length > 0) {
          if (!filtros.modelos.includes(p.parsed.modeloCodigo)) return false;
        }
        if (filtros.cores && filtros.cores.length > 0) {
          if (!p.parsed.cores.some((c) => filtros.cores!.includes(c.cor)))
            return false;
        }
        if (filtros.tamanhos && filtros.tamanhos.length > 0) {
          if (!filtros.tamanhos.includes(p.parsed.tamanho)) return false;
        }
      }
      if (filtros.categoriaIds && filtros.categoriaIds.length > 0) {
        const matchCat = categorias.some(
          (c) =>
            filtros.categoriaIds!.includes(c.id) && avaliarCategoria(p, c),
        );
        if (!matchCat) return false;
      }
      if (buscaAtiva) {
        const hay = [p.skuRaw, p.orderId, p.trackingId ?? "", p.comprador ?? ""]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(buscaAtiva)) return false;
      }
      return true;
    });
  }, [dados, hojeIso, categorias, filtros, buscaLocal]);

  const handleResetar = () => {
    setFiltrosRaw({});
    setBuscaLocal("");
  };

  const copiarOrderIds = () =>
    copiarTexto(
      filtrados.map((p) => p.orderId).join(","),
      `${filtrados.length} Order IDs copiados`,
    );
  const copiarTrackingIds = () => {
    const ids = filtrados.map((p) => p.trackingId).filter(Boolean) as string[];
    copiarTexto(ids.join(","), `${ids.length} Tracking IDs copiados`);
  };
  const copiarTxt = () =>
    copiarTexto(
      filtrados.map((p) => p.orderId).join("\n"),
      `${filtrados.length} IDs copiados (TXT)`,
    );

  const hasCategorias = categorias.length > 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="py-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Filtros</span>
              <Badge variant="secondary">
                {filtrados.length.toLocaleString("pt-BR")} /{" "}
                {dados.length.toLocaleString("pt-BR")}
              </Badge>
            </div>
            <Button variant="ghost" size="sm" onClick={handleResetar}>
              <RotateCcw className="h-3 w-3 mr-1" /> Limpar
            </Button>
          </div>

          {/* Plataforma + status prazo */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Plataforma
              </Label>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {PLATAFORMAS.map((p) => (
                  <PillToggle
                    key={p.id}
                    ativo={tem(filtros.plataformas, p.id)}
                    label={p.label}
                    onClick={() =>
                      updateFiltros({
                        plataformas: toggle(filtros.plataformas, p.id),
                      })
                    }
                  />
                ))}
              </div>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Status do prazo
              </Label>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {STATUS_OPCOES.map((s) => (
                  <PillToggle
                    key={s.id}
                    ativo={tem(filtros.statusPrazo, s.id)}
                    label={s.label}
                    className={!tem(filtros.statusPrazo, s.id) ? s.tom : ""}
                    onClick={() =>
                      updateFiltros({
                        statusPrazo: toggle(filtros.statusPrazo, s.id),
                      })
                    }
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Categoria */}
          {hasCategorias && (
            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Categoria
              </Label>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {categorias.map((c) => (
                  <PillToggle
                    key={c.id}
                    ativo={tem(filtros.categoriaIds, c.id)}
                    label={c.nome}
                    onClick={() =>
                      updateFiltros({
                        categoriaIds: toggle(filtros.categoriaIds, c.id),
                      })
                    }
                  />
                ))}
              </div>
            </div>
          )}

          {/* Modelo / Cor / Tamanho */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Modelo
              </Label>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {opcoesModelo.map((m) => (
                  <PillToggle
                    key={m}
                    ativo={tem(filtros.modelos, m)}
                    label={m}
                    onClick={() =>
                      updateFiltros({ modelos: toggle(filtros.modelos, m) })
                    }
                  />
                ))}
                {opcoesModelo.length === 0 && (
                  <span className="text-xs text-muted-foreground italic">
                    sem opções
                  </span>
                )}
              </div>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Cor
              </Label>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {opcoesCor.map((c) => (
                  <PillToggle
                    key={c}
                    ativo={tem(filtros.cores, c)}
                    label={c}
                    onClick={() =>
                      updateFiltros({ cores: toggle(filtros.cores, c) })
                    }
                  />
                ))}
                {opcoesCor.length === 0 && (
                  <span className="text-xs text-muted-foreground italic">
                    sem opções
                  </span>
                )}
              </div>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Tamanho
              </Label>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {opcoesTamanho.map((t) => (
                  <PillToggle
                    key={t}
                    ativo={tem(filtros.tamanhos, t)}
                    label={t}
                    onClick={() =>
                      updateFiltros({ tamanhos: toggle(filtros.tamanhos, t) })
                    }
                  />
                ))}
                {opcoesTamanho.length === 0 && (
                  <span className="text-xs text-muted-foreground italic">
                    sem opções
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Busca + só ambíguos */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <Label
                htmlFor="busca"
                className="text-xs uppercase tracking-wide text-muted-foreground"
              >
                Busca livre
              </Label>
              <Input
                id="busca"
                placeholder="SKU, Order ID, tracking, comprador…"
                value={buscaLocal}
                onChange={(e) => {
                  setBuscaLocal(e.target.value);
                  updateFiltros({ busca: e.target.value });
                }}
                className="mt-1.5"
              />
            </div>
            <div className="flex items-center gap-2 pt-5">
              <Switch
                id="so-ambiguos"
                checked={!!filtros.soAmbiguos}
                onCheckedChange={(v) => updateFiltros({ soAmbiguos: v })}
              />
              <Label htmlFor="so-ambiguos" className="text-sm">
                Só ambíguos
              </Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <Button onClick={copiarOrderIds} disabled={filtrados.length === 0}>
          <Copy className="h-3.5 w-3.5 mr-1" /> Order IDs (vírgula)
        </Button>
        <Button
          variant="secondary"
          onClick={copiarTrackingIds}
          disabled={filtrados.length === 0}
        >
          <Copy className="h-3.5 w-3.5 mr-1" /> Tracking IDs (vírgula)
        </Button>
        <Button
          variant="outline"
          onClick={copiarTxt}
          disabled={filtrados.length === 0}
        >
          <Copy className="h-3.5 w-3.5 mr-1" /> Order IDs (TXT)
        </Button>
      </div>
    </div>
  );
}
