"use client";

// Modal de planejamento de distribuição multi-oficina na Compra (RITM-32).
//
// Matriz cor × oficina com saldo bloqueante. O operador define quantos
// rolos de cada cor contratada vão pra cada oficina de corte. Saldo
// zerado em todas as cores é pré-condição pra conclusão da Compra.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { LookupComCadastroInline } from "@/components/confeccao/lookup-com-cadastro-inline";
import { FormFornecedorRapido } from "@/components/confeccao/form-fornecedor-rapido";
import {
  agruparRolosContratadosPorCor,
  type DistribuicaoOficina,
  type SubtaskCompraPayload,
} from "@/lib/confeccao/schemas/payloads/compra";

interface ModalDistribuicaoCompraProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payload: SubtaskCompraPayload;
  /** corId → nome amigável da cor (pra display). */
  coresNomes: Map<string, string>;
  /** Persiste o plano. Pode rejeitar (server) — a UI já valida saldo localmente. */
  onSalvar: (distribuicao: DistribuicaoOficina[]) => void | Promise<void>;
  isAdmin: boolean;
  disabled?: boolean;
}

interface OficinaState {
  /** "" quando ainda não escolhida via lookup. */
  oficinaId: string;
  oficinaNome: string;
  /** Mapa corId → string (input parcial; converte na hora de salvar). */
  rolosPorCor: Record<string, string>;
}

function gerarKeyOficina(): string {
  return `tmp-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizarInt(v: string): number {
  const n = Number(v.replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

export function ModalDistribuicaoCompra({
  open,
  onOpenChange,
  payload,
  coresNomes,
  onSalvar,
  isAdmin,
  disabled = false,
}: ModalDistribuicaoCompraProps) {
  // Linhas de cor = cores com qtdRolosContratados > 0 (cross-fornecedor).
  const coresContratadas = useMemo(() => {
    const mapa = agruparRolosContratadosPorCor(payload);
    return Array.from(mapa.entries())
      .filter(([, qtd]) => qtd > 0)
      .map(([corId, contratado]) => ({
        corId,
        nome: coresNomes.get(corId) ?? "?",
        contratado,
      }));
  }, [payload, coresNomes]);

  // Estado local: lista de oficinas com mapa string-stringified
  const [oficinas, setOficinas] = useState<
    Array<OficinaState & { key: string }>
  >([]);
  // Cada linha do estado tem `key` estável (pra React) que não muda quando
  // oficinaId é selecionado — evita perder foco/inputs quando lookup escolhe.
  const [salvando, setSalvando] = useState(false);

  // Hidrata do payload ao abrir (snapshot — descarte ao cancelar).
  useEffect(() => {
    if (!open) return;
    const fromPayload = payload.distribuicaoOficinas ?? [];
    setOficinas(
      fromPayload.map((o) => ({
        key: gerarKeyOficina(),
        oficinaId: o.oficinaId,
        oficinaNome: "", // hidrata abaixo
        rolosPorCor: Object.fromEntries(
          Object.entries(o.rolosPorCor).map(([cor, n]) => [cor, String(n)]),
        ),
      })),
    );
  }, [open, payload.distribuicaoOficinas]);

  // Busca nomes de oficinas (fornecedores categoria=corte) selecionadas.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const ids = oficinas.map((o) => o.oficinaId).filter(Boolean);
      if (ids.length === 0) return;
      const res = await fetch(
        `/api/confeccao/fornecedores?pageSize=200&incluirInativos=true`,
        { cache: "no-store" },
      );
      if (!res.ok || cancelled) return;
      const data = (await res.json()) as {
        items: Array<{ id: string; nome: string }>;
      };
      const mapa = new Map(data.items.map((i) => [i.id, i.nome]));
      setOficinas((prev) =>
        prev.map((o) => ({
          ...o,
          oficinaNome:
            o.oficinaNome || (o.oficinaId ? (mapa.get(o.oficinaId) ?? "?") : ""),
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
    // re-hidrata se a quantidade de oficinas selecionadas muda
  }, [
    open,
    oficinas.map((o) => o.oficinaId).join(","),
  ]);

  // ── Mutadores ──────────────────────────────────────────────────────
  const adicionarOficina = useCallback(() => {
    setOficinas((prev) => [
      ...prev,
      {
        key: gerarKeyOficina(),
        oficinaId: "",
        oficinaNome: "",
        rolosPorCor: {},
      },
    ]);
  }, []);

  const removerOficina = useCallback((idx: number) => {
    setOficinas((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const escolherOficina = useCallback(
    (idx: number, id: string, nome: string) => {
      setOficinas((prev) =>
        prev.map((o, i) =>
          i === idx ? { ...o, oficinaId: id, oficinaNome: nome } : o,
        ),
      );
    },
    [],
  );

  const atualizarCelula = useCallback(
    (idxOficina: number, corId: string, valor: string) => {
      setOficinas((prev) =>
        prev.map((o, i) =>
          i === idxOficina
            ? {
                ...o,
                rolosPorCor: { ...o.rolosPorCor, [corId]: valor },
              }
            : o,
        ),
      );
    },
    [],
  );

  // ── Cálculos derivados ─────────────────────────────────────────────
  const saldoPorCor = useMemo(() => {
    const out = new Map<string, number>();
    for (const { corId, contratado } of coresContratadas) {
      let atribuido = 0;
      for (const o of oficinas) {
        atribuido += normalizarInt(o.rolosPorCor[corId] ?? "");
      }
      out.set(corId, contratado - atribuido);
    }
    return out;
  }, [coresContratadas, oficinas]);

  const totalContratado = useMemo(
    () => coresContratadas.reduce((s, c) => s + c.contratado, 0),
    [coresContratadas],
  );
  const totalAtribuido = useMemo(() => {
    let s = 0;
    for (const o of oficinas) {
      for (const [corId, v] of Object.entries(o.rolosPorCor)) {
        // Só conta o que está nas cores contratadas (ignora cor "fantasma")
        if (coresContratadas.some((c) => c.corId === corId)) {
          s += normalizarInt(v);
        }
      }
    }
    return s;
  }, [oficinas, coresContratadas]);

  const oficinasDuplicadas = useMemo(() => {
    const idsSeen = new Set<string>();
    const dup = new Set<number>();
    oficinas.forEach((o, i) => {
      if (!o.oficinaId) return;
      if (idsSeen.has(o.oficinaId)) dup.add(i);
      idsSeen.add(o.oficinaId);
    });
    return dup;
  }, [oficinas]);

  const podeSalvar =
    !salvando && !disabled && oficinasDuplicadas.size === 0;

  // ── Navegação por teclado (Enter avança linha; Tab nativo) ───────
  const inputRefs = useRef<Map<string, HTMLInputElement | null>>(new Map());
  const registerRef = useCallback(
    (key: string, el: HTMLInputElement | null) => {
      if (el) inputRefs.current.set(key, el);
      else inputRefs.current.delete(key);
    },
    [],
  );
  const focarLinhaSeguinte = useCallback(
    (idxOficina: number, idxCor: number, direcao: 1 | -1) => {
      const proxIdxCor = idxCor + direcao;
      if (proxIdxCor < 0 || proxIdxCor >= coresContratadas.length) return;
      const proxCorId = coresContratadas[proxIdxCor].corId;
      const el = inputRefs.current.get(`${idxOficina}-${proxCorId}`);
      if (el) {
        el.focus();
        el.select();
      }
    },
    [coresContratadas],
  );

  // ── Salvar ──────────────────────────────────────────────────────────
  const handleSalvar = useCallback(async () => {
    const distribuicao: DistribuicaoOficina[] = oficinas
      .filter((o) => o.oficinaId)
      .map((o) => {
        const rolosPorCor: Record<string, number> = {};
        for (const [corId, v] of Object.entries(o.rolosPorCor)) {
          const n = normalizarInt(v);
          if (n > 0) rolosPorCor[corId] = n;
        }
        return { oficinaId: o.oficinaId, rolosPorCor };
      });

    setSalvando(true);
    try {
      await onSalvar(distribuicao);
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao salvar distribuição",
      );
    } finally {
      setSalvando(false);
    }
  }, [oficinas, onSalvar, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Planejamento de distribuição</DialogTitle>
          <DialogDescription>
            Atribua quantos rolos de cada cor vão pra cada oficina de corte.
            Saldo precisa zerar antes de concluir a Compra.
          </DialogDescription>
        </DialogHeader>

        {coresContratadas.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">
            Nenhuma cor com rolos contratados — preencha as cores e
            quantidades na Compra antes de planejar a distribuição.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="text-sm w-full">
                <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="text-left p-1.5 w-32">Cor</th>
                    <th className="text-right p-1.5 w-24">Contratado</th>
                    {oficinas.map((o, idx) => (
                      <th
                        key={o.key}
                        className={cn(
                          "p-1.5 min-w-[180px]",
                          oficinasDuplicadas.has(idx) && "bg-red-50",
                        )}
                      >
                        <div className="flex items-start justify-between gap-1">
                          <div className="flex-1">
                            {o.oficinaId ? (
                              <div className="text-xs font-normal normal-case text-foreground truncate">
                                {o.oficinaNome || "(carregando)"}
                              </div>
                            ) : (
                              <LookupComCadastroInline
                                endpoint="/api/confeccao/fornecedores"
                                extraQuery={{ categoria: "corte" }}
                                value=""
                                onChange={(id, item) =>
                                  escolherOficina(
                                    idx,
                                    id,
                                    (item as { nome: string }).nome ?? "?",
                                  )
                                }
                                entidadeLabel="oficina de corte"
                                placeholder="Selecione oficina"
                                permiteCadastrar={isAdmin}
                                cadastroInlineRender={
                                  isAdmin
                                    ? ({ onCreated, onCancel }) => (
                                        <FormFornecedorRapido
                                          categoriaInicial="corte"
                                          onCreated={onCreated}
                                          onCancel={onCancel}
                                        />
                                      )
                                    : undefined
                                }
                                className="w-full h-7"
                              />
                            )}
                            {oficinasDuplicadas.has(idx) && (
                              <div className="text-[10px] text-destructive normal-case font-normal mt-0.5">
                                Oficina duplicada
                              </div>
                            )}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removerOficina(idx)}
                            className="h-6 w-6 shrink-0"
                            title="Remover oficina"
                          >
                            <Trash2 className="size-3" />
                          </Button>
                        </div>
                      </th>
                    ))}
                    <th className="text-right p-1.5 w-20">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {coresContratadas.map(({ corId, nome, contratado }, idxCor) => {
                    const saldo = saldoPorCor.get(corId) ?? 0;
                    return (
                      <tr key={corId} className="border-b last:border-0">
                        <td className="p-1.5">
                          <Badge variant="outline" className="font-normal">
                            {nome}
                          </Badge>
                        </td>
                        <td className="p-1.5 text-right tabular-nums text-sm">
                          {contratado}
                        </td>
                        {oficinas.map((o, idxOficina) => (
                          <td key={o.key} className="p-1.5">
                            <Input
                              ref={(el) =>
                                registerRef(`${idxOficina}-${corId}`, el)
                              }
                              type="number"
                              step="1"
                              min="0"
                              inputMode="numeric"
                              value={o.rolosPorCor[corId] ?? ""}
                              onChange={(e) =>
                                atualizarCelula(
                                  idxOficina,
                                  corId,
                                  e.target.value,
                                )
                              }
                              onFocus={(e) => e.currentTarget.select()}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  focarLinhaSeguinte(
                                    idxOficina,
                                    idxCor,
                                    e.shiftKey ? -1 : 1,
                                  );
                                } else if (e.key === "ArrowDown") {
                                  e.preventDefault();
                                  focarLinhaSeguinte(idxOficina, idxCor, 1);
                                } else if (e.key === "ArrowUp") {
                                  e.preventDefault();
                                  focarLinhaSeguinte(idxOficina, idxCor, -1);
                                }
                              }}
                              disabled={disabled || !o.oficinaId}
                              placeholder="0"
                              className="h-7 text-right text-sm tabular-nums"
                            />
                          </td>
                        ))}
                        <td
                          className={cn(
                            "p-1.5 text-right tabular-nums text-sm font-medium",
                            saldo === 0 && "text-emerald-700",
                            saldo > 0 && "text-amber-700",
                            saldo < 0 && "text-destructive",
                          )}
                        >
                          {saldo === 0
                            ? "✓ 0"
                            : saldo > 0
                              ? `⚠ +${saldo}`
                              : `⚠ ${saldo}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/40 text-xs">
                    <td className="p-1.5 font-medium">Total</td>
                    <td className="p-1.5 text-right tabular-nums font-medium">
                      {totalContratado}
                    </td>
                    <td
                      colSpan={oficinas.length}
                      className="p-1.5 text-right tabular-nums"
                    >
                      {totalAtribuido} / {totalContratado} distribuído(s)
                    </td>
                    <td
                      className={cn(
                        "p-1.5 text-right tabular-nums font-medium",
                        totalContratado === totalAtribuido && "text-emerald-700",
                        totalContratado !== totalAtribuido && "text-amber-700",
                      )}
                    >
                      {totalContratado === totalAtribuido
                        ? "✓ 0"
                        : `${totalContratado - totalAtribuido > 0 ? "+" : ""}${totalContratado - totalAtribuido}`}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={adicionarOficina}
                disabled={disabled}
              >
                <Plus className="size-3.5 mr-1.5" />
                Oficina
              </Button>
            </div>
          </>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={salvando}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleSalvar}
            disabled={!podeSalvar}
          >
            {salvando ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
