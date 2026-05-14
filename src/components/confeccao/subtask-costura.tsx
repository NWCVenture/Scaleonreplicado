"use client";

// Conteúdo da subtask OPSEW (Costura) — RITM-12.
//
// Subtask mais complexa: múltiplas oficinas em paralelo, cada uma com seu
// próprio fluxo (envio → produção → retiradas parciais → retirada final).
// Retiradas criam subconferências automaticamente na subtask Conferência.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { LookupComCadastroInline } from "@/components/confeccao/lookup-com-cadastro-inline";
import { BlocoLalamoveManual } from "@/components/confeccao/bloco-lalamove-manual";
import { WhatsappTemplatePicker } from "@/components/confeccao/whatsapp-template-picker";
import type {
  EtiquetagemLinha,
  OficinaCostura,
  StatusInternoOficina,
  SubtaskCosturaPayload,
} from "@/lib/confeccao/schemas/payloads/costura";
import type { TamanhoGradeRisco } from "@/lib/confeccao/schemas/payloads/risco";
import type {
  ConfeccaoRetiradaTipo,
  ConfeccaoSubtask,
} from "@/lib/db/schema";

interface SubtaskCosturaProps {
  subtask: ConfeccaoSubtask;
  opNumero: string;
  contaId: string;
  onAlterado: () => void;
}

interface CorRef {
  id: string;
  nome: string;
}

interface RetiradaItem {
  id: string;
  numero: string;
  oficinaId: string;
  tipo: ConfeccaoRetiradaTipo;
  pecasPorTamanhoCor: Record<string, Record<string, number>>;
  dataRetirada: string;
  canceladaEm: string | null;
  subconferenciaStatus: string | null;
}

interface OficinaState {
  id: string; // chave React local
  oficinaId: string;
  oficinaNome: string;
  oficinaWhatsapp: string;
  prazoProducao: string; // ISO ou ""
  pecasMatriz: Record<string, Record<TamanhoGradeRisco, string>>; // [corId][tamanho] = "qtd"
  etiquetagem: Array<{
    tamanhoEtiqueta: TamanhoGradeRisco;
    quantidade: string;
    fonteGradeCorte: TamanhoGradeRisco;
  }>;
  precoPorPeca: string;
  statusInterno: StatusInternoOficina;
  observacoes: string;
}

const STATUS_LABEL: Record<StatusInternoOficina, string> = {
  enviado: "Enviado",
  em_producao: "Em produção",
  retirada_parcial: "Retirada parcial",
  retirada_final: "Retirada final",
  finalizada: "Finalizada",
};

const STATUS_VARIANT: Record<
  StatusInternoOficina,
  "default" | "secondary" | "destructive" | "outline"
> = {
  enviado: "outline",
  em_producao: "default",
  retirada_parcial: "default",
  retirada_final: "secondary",
  finalizada: "secondary",
};

function novaOficinaState(): OficinaState {
  return {
    id: Math.random().toString(36).slice(2),
    oficinaId: "",
    oficinaNome: "",
    oficinaWhatsapp: "",
    prazoProducao: "",
    pecasMatriz: {},
    etiquetagem: [],
    precoPorPeca: "",
    statusInterno: "enviado",
    observacoes: "",
  };
}

function payloadParaState(o: OficinaCostura): OficinaState {
  const matriz: OficinaState["pecasMatriz"] = {};
  for (const p of o.pecasEnviadasPorTamanhoCor ?? []) {
    matriz[p.corId] = matriz[p.corId] ?? ({} as Record<TamanhoGradeRisco, string>);
    matriz[p.corId][p.tamanho] = String(p.quantidade);
  }
  return {
    id: Math.random().toString(36).slice(2),
    oficinaId: o.oficinaId,
    oficinaNome: "",
    oficinaWhatsapp: "",
    prazoProducao: o.prazoProducao ?? "",
    pecasMatriz: matriz,
    etiquetagem: (o.etiquetagem ?? []).map((e) => ({
      tamanhoEtiqueta: e.tamanhoEtiqueta,
      quantidade: String(e.quantidade),
      fonteGradeCorte: e.fonteGradeCorte,
    })),
    precoPorPeca: o.precoPorPeca !== undefined ? String(o.precoPorPeca) : "",
    statusInterno: o.statusInterno ?? "enviado",
    observacoes: o.observacoes ?? "",
  };
}

const TAMANHOS_COMERCIAIS: TamanhoGradeRisco[] = ["P", "M", "G", "GG", "EGG"];

export function SubtaskCostura({
  subtask,
  opNumero,
  contaId,
  onAlterado,
}: SubtaskCosturaProps) {
  const router = useRouter();
  const payload = (subtask.payload ?? {}) as SubtaskCosturaPayload;

  const podeEditar =
    subtask.status === "em_andamento" || subtask.status === "pendente";
  const readOnly =
    subtask.status === "concluida" || subtask.status === "cancelada";

  // Contexto do Corte (peças disponíveis) e Risco (tamanhos)
  const [cores, setCores] = useState<CorRef[]>([]);
  const [tamanhosDoRisco, setTamanhosDoRisco] = useState<TamanhoGradeRisco[]>(
    [],
  );
  const [pecasCortadas, setPecasCortadas] = useState<Map<string, number>>(
    new Map(),
  );

  const [oficinas, setOficinas] = useState<OficinaState[]>(() => {
    const inicial = payload.oficinas ?? [];
    return inicial.length > 0
      ? inicial.map(payloadParaState)
      : [novaOficinaState()];
  });

  const [retiradas, setRetiradas] = useState<RetiradaItem[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [iniciando, setIniciando] = useState(false);
  const [concluindo, setConcluindo] = useState(false);

  // Modal de etiquetagem
  const [etiquetagemModalIdx, setEtiquetagemModalIdx] = useState<number | null>(
    null,
  );
  // Modal de retirada
  const [retiradaModal, setRetiradaModal] = useState<{
    idxOficina: number;
    tipo: ConfeccaoRetiradaTipo;
  } | null>(null);

  // Hidratação inicial — contexto Corte + Risco + cores
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/confeccao/ops/${opNumero}`, {
        cache: "no-store",
      });
      if (!res.ok || cancelled) return;
      const data = (await res.json()) as {
        subtasks: Array<{ prefixo: string; payload: unknown }>;
      };
      const corte = data.subtasks.find((s) => s.prefixo === "OPCOR")
        ?.payload as
        | {
            oficinas?: Array<{
              rendimentoPorTamanhoCor?: Array<{
                tamanho: TamanhoGradeRisco;
                corId: string;
                quantidade: number;
              }>;
            }>;
          }
        | undefined;
      const risco = data.subtasks.find((s) => s.prefixo === "OPRIS")
        ?.payload as
        | { tamanhos?: Array<{ tamanho: TamanhoGradeRisco }> }
        | undefined;

      const mapaPecas = new Map<string, number>();
      const corIds = new Set<string>();
      for (const o of corte?.oficinas ?? []) {
        for (const r of o.rendimentoPorTamanhoCor ?? []) {
          const k = `${r.tamanho}|${r.corId}`;
          mapaPecas.set(k, (mapaPecas.get(k) ?? 0) + r.quantidade);
          corIds.add(r.corId);
        }
      }

      const ids = Array.from(corIds);
      const nomes = new Map<string, string>();
      if (ids.length > 0) {
        const resCor = await fetch(
          `/api/confeccao/cores?pageSize=100&incluirInativos=true`,
          { cache: "no-store" },
        );
        if (resCor.ok && !cancelled) {
          const dataCor = (await resCor.json()) as {
            items: Array<{ id: string; nome: string }>;
          };
          for (const c of dataCor.items) nomes.set(c.id, c.nome);
        }
      }

      if (!cancelled) {
        setCores(
          ids.map((id) => ({ id, nome: nomes.get(id) ?? "?" })),
        );
        setTamanhosDoRisco((risco?.tamanhos ?? []).map((t) => t.tamanho));
        setPecasCortadas(mapaPecas);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [opNumero]);

  // Carrega retiradas
  const fetchRetiradas = useCallback(async () => {
    const res = await fetch(
      `/api/confeccao/subtasks/${subtask.id}/retiradas`,
      { cache: "no-store" },
    );
    if (!res.ok) return;
    const data = (await res.json()) as { items: RetiradaItem[] };
    setRetiradas(data.items);
  }, [subtask.id]);

  useEffect(() => {
    void fetchRetiradas();
  }, [fetchRetiradas]);

  // Soma de peças enviadas (todas oficinas) por (tamanho, cor)
  function totalEnviado(tam: TamanhoGradeRisco, corId: string): number {
    return oficinas.reduce((sum, o) => {
      const v = Number(o.pecasMatriz[corId]?.[tam] ?? 0);
      return sum + (isNaN(v) ? 0 : v);
    }, 0);
  }

  function disponivel(tam: TamanhoGradeRisco, corId: string): number {
    return pecasCortadas.get(`${tam}|${corId}`) ?? 0;
  }

  function setOficinaCampo<K extends keyof OficinaState>(
    idx: number,
    campo: K,
    valor: OficinaState[K],
  ) {
    setOficinas((prev) =>
      prev.map((o, i) => (i === idx ? { ...o, [campo]: valor } : o)),
    );
  }

  function setPecaMatriz(
    idx: number,
    corId: string,
    tam: TamanhoGradeRisco,
    valor: string,
  ) {
    setOficinas((prev) =>
      prev.map((o, i) =>
        i === idx
          ? {
              ...o,
              pecasMatriz: {
                ...o.pecasMatriz,
                [corId]: {
                  ...(o.pecasMatriz[corId] ?? {}),
                  [tam]: valor,
                } as Record<TamanhoGradeRisco, string>,
              },
            }
          : o,
      ),
    );
  }

  function montarPayload(): SubtaskCosturaPayload {
    return {
      oficinas: oficinas
        .filter((o) => o.oficinaId)
        .map((o) => {
          const pecasArr: Array<{
            tamanho: TamanhoGradeRisco;
            corId: string;
            quantidade: number;
          }> = [];
          for (const [corId, mapa] of Object.entries(o.pecasMatriz)) {
            for (const [t, v] of Object.entries(mapa)) {
              const n = Number(v);
              if (v.trim() && n > 0) {
                pecasArr.push({
                  tamanho: t as TamanhoGradeRisco,
                  corId,
                  quantidade: n,
                });
              }
            }
          }
          const etiqArr: EtiquetagemLinha[] = o.etiquetagem
            .filter((e) => Number(e.quantidade) > 0)
            .map((e) => ({
              tamanhoEtiqueta: e.tamanhoEtiqueta,
              quantidade: Number(e.quantidade),
              fonteGradeCorte: e.fonteGradeCorte,
            }));
          return {
            oficinaId: o.oficinaId,
            prazoProducao: o.prazoProducao || undefined,
            pecasEnviadasPorTamanhoCor:
              pecasArr.length > 0 ? pecasArr : undefined,
            etiquetagem: etiqArr.length > 0 ? etiqArr : undefined,
            precoPorPeca: o.precoPorPeca ? Number(o.precoPorPeca) : undefined,
            statusInterno: o.statusInterno,
            observacoes: o.observacoes.trim() || undefined,
          };
        }),
    };
  }

  const salvarPayload = useCallback(
    async (silent = false) => {
      setSalvando(true);
      try {
        const res = await fetch(
          `/api/confeccao/subtasks/${subtask.id}/payload`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ payload: montarPayload() }),
          },
        );
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error ?? "Erro ao salvar");
          return false;
        }
        if (!silent) toast.success("Salvo");
        onAlterado();
        return true;
      } finally {
        setSalvando(false);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [subtask.id, oficinas, onAlterado],
  );

  async function iniciar() {
    if (oficinas.length === 0 || !oficinas[0].oficinaId) {
      toast.error("Adicione ao menos uma oficina antes de iniciar");
      return;
    }
    setIniciando(true);
    try {
      const ok = await salvarPayload(true);
      if (!ok) return;
      const res = await fetch(
        `/api/confeccao/subtasks/${subtask.id}/iniciar`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Erro ao iniciar");
        return;
      }
      toast.success("Subtask iniciada");
      onAlterado();
    } finally {
      setIniciando(false);
    }
  }

  async function concluir() {
    setConcluindo(true);
    try {
      const ok = await salvarPayload(true);
      if (!ok) return;
      const res = await fetch(
        `/api/confeccao/subtasks/${subtask.id}/concluir`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Erro ao concluir");
        return;
      }
      toast.success(
        data.subtask?.proximaDesbloqueada
          ? `Concluída. Próxima desbloqueada: ${data.subtask.proximaDesbloqueada.numero}`
          : "Subtask concluída",
      );
      onAlterado();
      router.refresh();
    } finally {
      setConcluindo(false);
    }
  }

  function abrirRetiradaModal(
    idxOficina: number,
    tipo: ConfeccaoRetiradaTipo,
  ) {
    setRetiradaModal({ idxOficina, tipo });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h3 className="font-medium">Costura</h3>
          <p className="text-xs text-muted-foreground">
            Múltiplas oficinas em paralelo, etiquetagem cruzada e retiradas
            parciais. Retiradas criam subconferências automaticamente na
            subtask Conferência.
          </p>
        </div>
        <div className="flex gap-2">
          {subtask.status === "pendente" && (
            <Button onClick={iniciar} disabled={iniciando} size="sm">
              <Play className="size-3.5" />
              {iniciando ? "Iniciando…" : "Iniciar"}
            </Button>
          )}
          {subtask.status === "em_andamento" && (
            <Button onClick={concluir} disabled={concluindo} size="sm">
              <CheckCircle2 className="size-3.5" />
              {concluindo ? "Concluindo…" : "Concluir"}
            </Button>
          )}
        </div>
      </div>

      {/* Saldo do Corte */}
      {pecasCortadas.size === 0 ? (
        <div className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <div>
            Subtask Corte ainda não definiu rendimento — conclua-a primeiro
            pra ter saldo de peças disponível aqui.
          </div>
        </div>
      ) : (
        <div className="rounded border bg-card p-3">
          <div className="flex items-center gap-2 text-sm font-medium mb-2">
            <Info className="size-4" />
            Saldo de peças (do Corte)
          </div>
          <div className="overflow-x-auto">
            <table className="text-xs w-full">
              <thead>
                <tr>
                  <th className="text-left p-1">Cor / Tam</th>
                  {tamanhosDoRisco.map((t) => (
                    <th key={t} className="p-1 text-center">
                      {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cores.map((c) => (
                  <tr key={c.id}>
                    <td className="p-1 font-medium">{c.nome}</td>
                    {tamanhosDoRisco.map((t) => {
                      const disp = disponivel(t, c.id);
                      const env = totalEnviado(t, c.id);
                      const excede = env > disp;
                      return (
                        <td
                          key={t}
                          className={`p-1 text-center tabular-nums ${excede ? "text-red-600 font-medium" : "text-muted-foreground"}`}
                        >
                          {env}/{disp}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {oficinas.map((o, idx) => (
        <Card key={o.id}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">
                  Oficina {idx + 1}
                  {o.oficinaNome ? ` — ${o.oficinaNome}` : ""}
                </CardTitle>
                <Badge variant={STATUS_VARIANT[o.statusInterno]} className="mt-1">
                  {STATUS_LABEL[o.statusInterno]}
                </Badge>
              </div>
              <div className="flex gap-1">
                {podeEditar && oficinas.length > 1 && (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() =>
                      setOficinas((prev) => prev.filter((_, i) => i !== idx))
                    }
                    className="size-7"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Oficina de costura</Label>
                <LookupComCadastroInline
                  endpoint="/api/confeccao/fornecedores"
                  extraQuery={{ categoria: "costura" }}
                  value={o.oficinaId}
                  onChange={async (id, item) => {
                    setOficinaCampo(idx, "oficinaId", id);
                    setOficinaCampo(idx, "oficinaNome", item.nome);
                    // Pega whatsapp do fornecedor
                    const r = await fetch(
                      `/api/confeccao/fornecedores/${id}`,
                      { cache: "no-store" },
                    );
                    if (r.ok) {
                      const d = (await r.json()) as {
                        item: { whatsapp: string };
                      };
                      setOficinaCampo(idx, "oficinaWhatsapp", d.item.whatsapp);
                    }
                  }}
                  entidadeLabel="oficina de costura"
                  permiteCadastrar={false}
                  disabled={!podeEditar || o.statusInterno !== "enviado"}
                  className="w-full"
                />
                {o.oficinaWhatsapp && podeEditar && (() => {
                  const totalPecas = Object.values(o.pecasMatriz).reduce(
                    (s, m) =>
                      s +
                      Object.values(m).reduce(
                        (sum, v) => sum + (Number(v) || 0),
                        0,
                      ),
                    0,
                  );
                  const prazoFmt = o.prazoProducao
                    ? new Date(o.prazoProducao).toLocaleString("pt-BR")
                    : "a combinar";
                  return (
                    <WhatsappTemplatePicker
                      categoria="costura"
                      opNumero={opNumero}
                      subtaskId={subtask.id}
                      telefone={o.oficinaWhatsapp}
                      destinatarioNome={o.oficinaNome}
                      fornecedorId={o.oficinaId}
                      mensagemFallback={`Olá, {fornecedor_nome}. OP {op_numero} (${subtask.numero}):\n\nTotal: ${totalPecas} peças\nPrazo: ${prazoFmt}\n\nAguardo confirmação.`}
                      contexto={`Costura — OP ${opNumero} — Oficina ${o.oficinaNome}`}
                      label="Instruções via WhatsApp"
                      className="w-full"
                    />
                  );
                })()}
              </div>
              <div className="space-y-2">
                <Label>Prazo de produção</Label>
                <Input
                  type="datetime-local"
                  value={
                    o.prazoProducao
                      ? new Date(o.prazoProducao).toISOString().slice(0, 16)
                      : ""
                  }
                  onChange={(e) =>
                    setOficinaCampo(
                      idx,
                      "prazoProducao",
                      e.target.value
                        ? new Date(e.target.value).toISOString()
                        : "",
                    )
                  }
                  disabled={!podeEditar}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Preço por peça (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={o.precoPorPeca}
                  onChange={(e) =>
                    setOficinaCampo(idx, "precoPorPeca", e.target.value)
                  }
                  disabled={!podeEditar}
                />
              </div>
              <div className="space-y-2">
                <Label>Status interno</Label>
                <Select
                  value={o.statusInterno}
                  onValueChange={(v) =>
                    setOficinaCampo(
                      idx,
                      "statusInterno",
                      v as StatusInternoOficina,
                    )
                  }
                  disabled={!podeEditar}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(STATUS_LABEL) as StatusInternoOficina[]).map(
                      (s) => (
                        <SelectItem key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Matriz de peças enviadas */}
            {tamanhosDoRisco.length > 0 && cores.length > 0 && (
              <div className="space-y-2">
                <Label>Peças enviadas (tamanho × cor)</Label>
                <div className="overflow-x-auto">
                  <table className="text-sm w-full">
                    <thead>
                      <tr>
                        <th className="text-left p-1 text-xs text-muted-foreground">
                          Cor / Tam
                        </th>
                        {tamanhosDoRisco.map((t) => (
                          <th
                            key={t}
                            className="p-1 text-xs text-muted-foreground text-center"
                          >
                            {t}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {cores.map((c) => (
                        <tr key={c.id}>
                          <td className="p-1 text-xs font-medium">{c.nome}</td>
                          {tamanhosDoRisco.map((t) => (
                            <td key={t} className="p-1">
                              <Input
                                type="number"
                                min="0"
                                max={disponivel(t, c.id)}
                                value={o.pecasMatriz[c.id]?.[t] ?? ""}
                                onChange={(e) =>
                                  setPecaMatriz(idx, c.id, t, e.target.value)
                                }
                                disabled={
                                  !podeEditar ||
                                  o.statusInterno !== "enviado"
                                }
                                className="h-7 text-xs w-16 text-center px-1"
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Etiquetagem */}
            <div className="flex items-center justify-between">
              <div>
                <Label>Etiquetagem cruzada</Label>
                <p className="text-xs text-muted-foreground">
                  {o.etiquetagem.length === 0
                    ? "Nenhuma regra de etiquetagem"
                    : `${o.etiquetagem.length} regras`}
                </p>
              </div>
              {podeEditar && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEtiquetagemModalIdx(idx)}
                >
                  Editar etiquetagem
                </Button>
              )}
            </div>

            {/* Retiradas */}
            <div className="space-y-2 border-t pt-3">
              <div className="flex items-center justify-between">
                <Label>Retiradas</Label>
                {podeEditar && o.oficinaId && o.statusInterno !== "finalizada" && (
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => abrirRetiradaModal(idx, "parcial")}
                    >
                      <Plus className="size-3.5" />
                      Parcial
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => abrirRetiradaModal(idx, "final")}
                    >
                      <Plus className="size-3.5" />
                      Final
                    </Button>
                  </div>
                )}
              </div>
              <RetiradasLista
                retiradas={retiradas.filter((r) => r.oficinaId === o.oficinaId)}
                onCancelado={fetchRetiradas}
                canEdit={podeEditar}
              />
            </div>

            <div className="space-y-2">
              <Label>Observações</Label>
              <Textarea
                value={o.observacoes}
                onChange={(e) =>
                  setOficinaCampo(idx, "observacoes", e.target.value)
                }
                rows={2}
                disabled={!podeEditar}
                maxLength={2000}
              />
            </div>
          </CardContent>
        </Card>
      ))}

      {podeEditar && (
        <div className="flex justify-between items-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOficinas((prev) => [...prev, novaOficinaState()])}
          >
            <Plus className="size-3.5" />
            Adicionar oficina
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void salvarPayload()}
            disabled={salvando}
          >
            {salvando ? "Salvando…" : "Salvar rascunho"}
          </Button>
        </div>
      )}

      <BlocoLalamoveManual
        subtaskId={subtask.id}
        contaId={contaId}
        opNumero={opNumero}
        subtaskNumero={subtask.numero}
        readOnly={readOnly}
      />

      {/* Modal Etiquetagem */}
      {etiquetagemModalIdx !== null && (
        <EtiquetagemDialog
          oficina={oficinas[etiquetagemModalIdx]}
          tamanhosGradeCorte={tamanhosDoRisco}
          onSave={(novasLinhas) => {
            setOficinas((prev) =>
              prev.map((o, i) =>
                i === etiquetagemModalIdx
                  ? { ...o, etiquetagem: novasLinhas }
                  : o,
              ),
            );
            setEtiquetagemModalIdx(null);
          }}
          onCancel={() => setEtiquetagemModalIdx(null)}
        />
      )}

      {/* Modal Retirada */}
      {retiradaModal && (
        <RetiradaDialog
          oficina={oficinas[retiradaModal.idxOficina]}
          subtaskId={subtask.id}
          tipo={retiradaModal.tipo}
          cores={cores}
          tamanhos={tamanhosDoRisco}
          onCriada={async () => {
            setRetiradaModal(null);
            await fetchRetiradas();
            onAlterado();
          }}
          onCancel={() => setRetiradaModal(null)}
        />
      )}
    </div>
  );
}

// ============================================================
// Sub-componentes
// ============================================================

function RetiradasLista({
  retiradas,
  onCancelado,
  canEdit,
}: {
  retiradas: RetiradaItem[];
  onCancelado: () => void;
  canEdit: boolean;
}) {
  async function cancelar(id: string) {
    if (!confirm("Cancelar esta retirada? A subconferência também será removida.")) {
      return;
    }
    const res = await fetch(`/api/confeccao/retiradas/${id}`, {
      method: "DELETE",
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Erro ao cancelar");
      return;
    }
    toast.success("Retirada cancelada");
    onCancelado();
  }

  if (retiradas.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Nenhuma retirada nesta oficina.
      </p>
    );
  }
  return (
    <div className="space-y-1">
      {retiradas.map((r) => {
        const cancelada = !!r.canceladaEm;
        const podeCancelar =
          !cancelada &&
          canEdit &&
          (r.subconferenciaStatus === "em_andamento" ||
            r.subconferenciaStatus === null);
        return (
          <div
            key={r.id}
            className={`flex items-center justify-between rounded border p-2 text-sm ${cancelada ? "opacity-60 line-through" : ""}`}
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Badge variant={r.tipo === "final" ? "secondary" : "outline"}>
                {r.tipo === "final" ? "Final" : "Parcial"}
              </Badge>
              <span className="font-mono text-xs">{r.numero}</span>
              <span className="text-xs text-muted-foreground">
                {new Date(r.dataRetirada).toLocaleDateString("pt-BR")}
              </span>
            </div>
            {podeCancelar && (
              <Button
                size="icon"
                variant="ghost"
                onClick={() => void cancelar(r.id)}
                className="size-6"
              >
                <Trash2 className="size-3" />
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function EtiquetagemDialog({
  oficina,
  tamanhosGradeCorte,
  onSave,
  onCancel,
}: {
  oficina: OficinaState;
  tamanhosGradeCorte: TamanhoGradeRisco[];
  onSave: (linhas: OficinaState["etiquetagem"]) => void;
  onCancel: () => void;
}) {
  const [linhas, setLinhas] = useState(oficina.etiquetagem);

  function addLinha() {
    setLinhas((prev) => [
      ...prev,
      {
        tamanhoEtiqueta: "M" as TamanhoGradeRisco,
        quantidade: "",
        fonteGradeCorte:
          (tamanhosGradeCorte[0] as TamanhoGradeRisco | undefined) ?? "M",
      },
    ]);
  }

  function removeLinha(idx: number) {
    setLinhas((prev) => prev.filter((_, i) => i !== idx));
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Etiquetagem cruzada</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Define como peças cortadas em um tamanho da grade serão etiquetadas
          com o tamanho comercial. Exemplo: peças cortadas como M podem ser
          etiquetadas como P (100) e M (100).
        </p>
        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
          {linhas.map((l, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-3 space-y-1">
                <Label className="text-xs">Tamanho etiqueta</Label>
                <Select
                  value={l.tamanhoEtiqueta}
                  onValueChange={(v) =>
                    setLinhas((prev) =>
                      prev.map((x, i) =>
                        i === idx
                          ? { ...x, tamanhoEtiqueta: v as TamanhoGradeRisco }
                          : x,
                      ),
                    )
                  }
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TAMANHOS_COMERCIAIS.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-3 space-y-1">
                <Label className="text-xs">Quantidade</Label>
                <Input
                  type="number"
                  min="1"
                  value={l.quantidade}
                  onChange={(e) =>
                    setLinhas((prev) =>
                      prev.map((x, i) =>
                        i === idx ? { ...x, quantidade: e.target.value } : x,
                      ),
                    )
                  }
                  className="h-8 text-xs"
                />
              </div>
              <div className="col-span-4 space-y-1">
                <Label className="text-xs">Fonte (grade de corte)</Label>
                <Select
                  value={l.fonteGradeCorte}
                  onValueChange={(v) =>
                    setLinhas((prev) =>
                      prev.map((x, i) =>
                        i === idx
                          ? { ...x, fonteGradeCorte: v as TamanhoGradeRisco }
                          : x,
                      ),
                    )
                  }
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {tamanhosGradeCorte.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => removeLinha(idx)}
                  className="size-8"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
          {linhas.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">
              Nenhuma regra. Adicione abaixo.
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={addLinha}>
          <Plus className="size-3.5" />
          Adicionar regra
        </Button>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button onClick={() => onSave(linhas)}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RetiradaDialog({
  oficina,
  subtaskId,
  tipo,
  cores,
  tamanhos,
  onCriada,
  onCancel,
}: {
  oficina: OficinaState;
  subtaskId: string;
  tipo: ConfeccaoRetiradaTipo;
  cores: CorRef[];
  tamanhos: TamanhoGradeRisco[];
  onCriada: () => void;
  onCancel: () => void;
}) {
  const [matriz, setMatriz] = useState<
    Record<string, Record<TamanhoGradeRisco, string>>
  >({});
  const [data, setData] = useState(new Date().toISOString().slice(0, 16));
  const [criando, setCriando] = useState(false);

  function setCelula(corId: string, tam: TamanhoGradeRisco, v: string) {
    setMatriz((prev) => ({
      ...prev,
      [corId]: {
        ...(prev[corId] ?? ({} as Record<TamanhoGradeRisco, string>)),
        [tam]: v,
      },
    }));
  }

  async function submit() {
    setCriando(true);
    try {
      // Converte string → number; pula zeros
      const pecasNum: Record<string, Record<string, number>> = {};
      for (const [corId, m] of Object.entries(matriz)) {
        for (const [t, v] of Object.entries(m)) {
          const n = Number(v);
          if (n > 0) {
            pecasNum[t] = pecasNum[t] ?? {};
            pecasNum[t][corId] = n;
          }
        }
      }
      if (Object.keys(pecasNum).length === 0) {
        toast.error("Informe ao menos uma peça");
        return;
      }
      const res = await fetch(
        `/api/confeccao/subtasks/${subtaskId}/retiradas`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            oficinaId: oficina.oficinaId,
            tipo,
            pecasPorTamanhoCor: pecasNum,
            dataRetirada: new Date(data).toISOString(),
          }),
        },
      );
      const dados = await res.json();
      if (!res.ok) {
        toast.error(dados.error ?? "Erro ao criar retirada");
        return;
      }
      toast.success(
        dados.opConfDesbloqueada
          ? `Retirada ${dados.retirada.numero} criada. Conferência desbloqueada.`
          : `Retirada ${dados.retirada.numero} criada.`,
      );
      onCriada();
    } finally {
      setCriando(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Nova retirada {tipo === "final" ? "FINAL" : "parcial"}
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Informe a quantidade retirada por tamanho × cor. Uma subconferência
          será criada automaticamente.
        </p>

        <div className="space-y-2">
          <Label>Data da retirada</Label>
          <Input
            type="datetime-local"
            value={data}
            onChange={(e) => setData(e.target.value)}
            className="max-w-xs"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="text-sm w-full">
            <thead>
              <tr>
                <th className="text-left p-1 text-xs text-muted-foreground">
                  Cor / Tam
                </th>
                {tamanhos.map((t) => (
                  <th
                    key={t}
                    className="p-1 text-xs text-muted-foreground text-center"
                  >
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cores.map((c) => (
                <tr key={c.id}>
                  <td className="p-1 text-xs font-medium">{c.nome}</td>
                  {tamanhos.map((t) => (
                    <td key={t} className="p-1">
                      <Input
                        type="number"
                        min="0"
                        value={matriz[c.id]?.[t] ?? ""}
                        onChange={(e) =>
                          setCelula(c.id, t, e.target.value)
                        }
                        className="h-7 text-xs w-16 text-center px-1"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={criando}>
            {criando ? "Criando…" : "Criar retirada"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
