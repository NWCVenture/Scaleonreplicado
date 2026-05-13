"use client";

// Conteúdo da subtask OPBUY (Compra de Tecido) — RITM-08.
//
// Renderiza pré-compra (fornecedor, tipo, cores, kgs) e pós-compra
// (rolos, pesos, preço/KG, gramatura, largura). Botão WhatsApp simples
// pra falar com o fornecedor. Bloco Lalamove manual. Anexos.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, MessageCircle, Play, Plus, Trash2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSession } from "@/lib/auth-client";
import { usePapelAtivo } from "@/hooks/use-papel-ativo";
import { LookupComCadastroInline } from "@/components/confeccao/lookup-com-cadastro-inline";
import { BlocoLalamoveManual } from "@/components/confeccao/bloco-lalamove-manual";
import { UploadAnexo } from "@/components/confeccao/upload-anexo";
import type { ConfeccaoSubtask } from "@/lib/db/schema";
import type { SubtaskCompraPayload } from "@/lib/confeccao/schemas/payloads/compra";

interface SubtaskCompraProps {
  subtask: ConfeccaoSubtask;
  opNumero: string;
  contaId: string;
  onAlterado: () => void;
}

interface CorSolicitadaState {
  corId: string;
  corNome: string;
  kgsSolicitados: string;
}

interface RoloRecebidoState {
  corId: string;
  corNome: string;
  pesos: string[];
}

interface FornecedorRef {
  id: string;
  nome: string;
  whatsapp?: string;
}

export function SubtaskCompra({
  subtask,
  opNumero,
  contaId,
  onAlterado,
}: SubtaskCompraProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const { isAdmin } = usePapelAtivo();
  const payload = (subtask.payload ?? {}) as SubtaskCompraPayload;

  const podeEditar =
    subtask.status === "em_andamento" || subtask.status === "pendente";
  const readOnly = subtask.status === "concluida" || subtask.status === "cancelada";

  // Pré-compra
  const [fornecedorId, setFornecedorId] = useState(
    payload.pre?.fornecedorId ?? "",
  );
  const [tipoTecidoId, setTipoTecidoId] = useState(
    payload.pre?.tipoTecidoId ?? "",
  );
  const [destinatarioCorteId, setDestinatarioCorteId] = useState(
    payload.pre?.destinatarioCorteId ?? "",
  );
  const [cores, setCores] = useState<CorSolicitadaState[]>(() =>
    (payload.pre?.cores ?? []).map((c) => ({
      corId: c.corId,
      corNome: "",
      kgsSolicitados: String(c.kgsSolicitados),
    })),
  );
  const [observacoesPedido, setObservacoesPedido] = useState(
    payload.pre?.observacoesPedido ?? "",
  );

  // Pós-compra
  const [rolosRecebidos, setRolosRecebidos] = useState<RoloRecebidoState[]>(() =>
    (payload.pos?.rolosRecebidos ?? []).map((r) => ({
      corId: r.corId,
      corNome: "",
      pesos: r.pesos.map((p) => String(p)),
    })),
  );
  const [precoKgEfetivo, setPrecoKgEfetivo] = useState(
    payload.pos?.precoKgEfetivo !== undefined
      ? String(payload.pos.precoKgEfetivo)
      : "",
  );
  const [gramaturaGM2, setGramaturaGM2] = useState(
    payload.pos?.gramaturaGM2 !== undefined
      ? String(payload.pos.gramaturaGM2)
      : "",
  );
  const [larguraRoloCm, setLarguraRoloCm] = useState(
    payload.pos?.larguraRoloCm !== undefined
      ? String(payload.pos.larguraRoloCm)
      : "",
  );
  const [observacoesPos, setObservacoesPos] = useState(
    payload.pos?.observacoesPos ?? "",
  );

  const [salvandoPayload, setSalvandoPayload] = useState(false);
  const [iniciando, setIniciando] = useState(false);
  const [concluindo, setConcluindo] = useState(false);
  const [fornecedor, setFornecedor] = useState<FornecedorRef | null>(null);

  // Hidrata nomes de cor a partir do API
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ids = new Set([
        ...cores.map((c) => c.corId),
        ...rolosRecebidos.map((r) => r.corId),
      ]);
      if (ids.size === 0) return;
      // Busca lista de cores (cache aceitável; volume baixo)
      const res = await fetch(
        `/api/confeccao/cores?pageSize=100&incluirInativos=true`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        items: Array<{ id: string; nome: string }>;
      };
      if (cancelled) return;
      const mapa = new Map(data.items.map((i) => [i.id, i.nome]));
      setCores((prev) =>
        prev.map((c) => ({
          ...c,
          corNome: c.corNome || (mapa.get(c.corId) ?? "?"),
        })),
      );
      setRolosRecebidos((prev) =>
        prev.map((r) => ({
          ...r,
          corNome: r.corNome || (mapa.get(r.corId) ?? "?"),
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [cores.length, rolosRecebidos.length]); // re-hidrata se add/remove

  // Hidrata WhatsApp do fornecedor pra botão de WhatsApp
  useEffect(() => {
    if (!fornecedorId) {
      setFornecedor(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/confeccao/fornecedores/${fornecedorId}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        item: { id: string; nome: string; whatsapp: string };
      };
      if (!cancelled) setFornecedor(data.item);
    })();
    return () => {
      cancelled = true;
    };
  }, [fornecedorId]);

  function adicionarCor(corId: string, corNome: string) {
    if (cores.some((c) => c.corId === corId)) {
      toast.info("Cor já adicionada");
      return;
    }
    setCores((prev) => [...prev, { corId, corNome, kgsSolicitados: "" }]);
  }

  function removerCor(corId: string) {
    setCores((prev) => prev.filter((c) => c.corId !== corId));
    setRolosRecebidos((prev) => prev.filter((r) => r.corId !== corId));
  }

  function adicionarRoloDaCor(corId: string, corNome: string) {
    setRolosRecebidos((prev) => {
      const existe = prev.find((r) => r.corId === corId);
      if (existe) {
        return prev.map((r) =>
          r.corId === corId ? { ...r, pesos: [...r.pesos, ""] } : r,
        );
      }
      return [...prev, { corId, corNome, pesos: [""] }];
    });
  }

  function atualizarPesoRolo(corId: string, idx: number, valor: string) {
    setRolosRecebidos((prev) =>
      prev.map((r) =>
        r.corId === corId
          ? {
              ...r,
              pesos: r.pesos.map((p, i) => (i === idx ? valor : p)),
            }
          : r,
      ),
    );
  }

  function removerRolo(corId: string, idx: number) {
    setRolosRecebidos((prev) =>
      prev
        .map((r) =>
          r.corId === corId
            ? { ...r, pesos: r.pesos.filter((_, i) => i !== idx) }
            : r,
        )
        .filter((r) => r.pesos.length > 0),
    );
  }

  function montarPayload(): SubtaskCompraPayload {
    const pre = fornecedorId && tipoTecidoId && destinatarioCorteId && cores.length > 0
      ? {
          fornecedorId,
          tipoTecidoId,
          destinatarioCorteId,
          cores: cores
            .filter((c) => c.kgsSolicitados.trim())
            .map((c) => ({
              corId: c.corId,
              kgsSolicitados: Number(c.kgsSolicitados),
            })),
          observacoesPedido: observacoesPedido.trim() || undefined,
        }
      : undefined;

    const posValido =
      rolosRecebidos.length > 0 &&
      rolosRecebidos.every((r) =>
        r.pesos.every((p) => p.trim() && Number(p) > 0),
      ) &&
      precoKgEfetivo.trim() &&
      gramaturaGM2.trim() &&
      larguraRoloCm.trim();

    const pos = posValido
      ? {
          rolosRecebidos: rolosRecebidos.map((r) => ({
            corId: r.corId,
            pesos: r.pesos.map((p) => Number(p)),
          })),
          precoKgEfetivo: Number(precoKgEfetivo),
          gramaturaGM2: Number(gramaturaGM2),
          larguraRoloCm: Number(larguraRoloCm),
          observacoesPos: observacoesPos.trim() || undefined,
        }
      : undefined;

    return { pre, pos };
  }

  async function salvarPayload() {
    setSalvandoPayload(true);
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
        return;
      }
      toast.success("Salvo");
      onAlterado();
    } finally {
      setSalvandoPayload(false);
    }
  }

  async function iniciar() {
    if (!fornecedorId || !tipoTecidoId || !destinatarioCorteId || cores.length === 0) {
      toast.error("Preencha fornecedor, tipo, destinatário e ao menos uma cor antes de iniciar");
      return;
    }
    setIniciando(true);
    try {
      // Salva payload pré primeiro
      await salvarPayload();
      const res = await fetch(`/api/confeccao/subtasks/${subtask.id}/iniciar`, {
        method: "POST",
      });
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
      await salvarPayload();
      const res = await fetch(`/api/confeccao/subtasks/${subtask.id}/concluir`, {
        method: "POST",
      });
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

  function abrirWhatsApp() {
    if (!fornecedor?.whatsapp) {
      toast.error("Fornecedor sem WhatsApp cadastrado");
      return;
    }
    const limpo = fornecedor.whatsapp.replace(/\D/g, "");
    const msg = `Olá, ${fornecedor.nome}. Sobre a OP ${opNumero} (${subtask.numero}):\n\nGostaria de confirmar o pedido de tecido. Aguardo retorno.`;
    const url = `https://wa.me/${limpo}?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank", "noopener");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h3 className="font-medium">Compra de Tecido</h3>
          <p className="text-xs text-muted-foreground">
            Registro do pedido + recebimento do tecido. Largura do rolo
            propaga para as subtasks Risco e Corte.
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
            <Button
              onClick={concluir}
              disabled={concluindo}
              size="sm"
              variant="default"
            >
              <CheckCircle2 className="size-3.5" />
              {concluindo ? "Concluindo…" : "Concluir"}
            </Button>
          )}
        </div>
      </div>

      {/* Pré-compra */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pedido (pré-compra)</CardTitle>
          <CardDescription>
            Define fornecedor, tipo, cores e KGs solicitados. Trava após iniciar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Fornecedor de tecido</Label>
              <LookupComCadastroInline
                endpoint="/api/confeccao/fornecedores"
                extraQuery={{ categoria: "tecido" }}
                value={fornecedorId}
                onChange={(id) => setFornecedorId(id)}
                entidadeLabel="fornecedor"
                permiteCadastrar={false}
                disabled={!podeEditar}
                className="w-full"
              />
              {fornecedor?.whatsapp && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={abrirWhatsApp}
                  className="w-full"
                >
                  <MessageCircle className="size-3.5" />
                  WhatsApp com {fornecedor.nome}
                </Button>
              )}
            </div>
            <div className="space-y-2">
              <Label>Tipo de tecido</Label>
              <LookupComCadastroInline
                endpoint="/api/confeccao/tipos-tecido"
                value={tipoTecidoId}
                onChange={(id) => setTipoTecidoId(id)}
                entidadeLabel="tipo de tecido"
                permiteCadastrar={isAdmin}
                cadastroInlineRender={
                  isAdmin
                    ? ({ onCreated, onCancel }) => (
                        <CriarTipoTecidoForm
                          onCreated={onCreated}
                          onCancel={onCancel}
                        />
                      )
                    : undefined
                }
                disabled={!podeEditar}
                className="w-full"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Destinatário (oficina de corte)</Label>
            <LookupComCadastroInline
              endpoint="/api/confeccao/fornecedores"
              extraQuery={{ categoria: "corte" }}
              value={destinatarioCorteId}
              onChange={(id) => setDestinatarioCorteId(id)}
              entidadeLabel="oficina de corte"
              permiteCadastrar={false}
              disabled={!podeEditar}
              className="w-full"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Cores e KGs solicitados</Label>
              {podeEditar && (
                <LookupComCadastroInline
                  endpoint="/api/confeccao/cores"
                  value=""
                  onChange={(id, item) => adicionarCor(id, item.nome)}
                  entidadeLabel="cor"
                  placeholder="+ Adicionar cor"
                  permiteCadastrar={isAdmin}
                  cadastroInlineRender={
                    isAdmin
                      ? ({ onCreated, onCancel }) => (
                          <CriarCorForm
                            onCreated={onCreated}
                            onCancel={onCancel}
                          />
                        )
                      : undefined
                  }
                  className="w-48 h-8"
                />
              )}
            </div>
            <div className="space-y-2">
              {cores.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Nenhuma cor adicionada ainda.
                </p>
              )}
              {cores.map((c) => (
                <div key={c.corId} className="flex items-center gap-2">
                  <Badge variant="outline" className="min-w-24 justify-center">
                    {c.corNome || "(carregando)"}
                  </Badge>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="kg"
                    value={c.kgsSolicitados}
                    onChange={(e) =>
                      setCores((prev) =>
                        prev.map((x) =>
                          x.corId === c.corId
                            ? { ...x, kgsSolicitados: e.target.value }
                            : x,
                        ),
                      )
                    }
                    disabled={!podeEditar}
                    className="w-32"
                  />
                  <span className="text-xs text-muted-foreground">kg</span>
                  {podeEditar && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removerCor(c.corId)}
                      className="size-7"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Observações do pedido</Label>
            <Textarea
              value={observacoesPedido}
              onChange={(e) => setObservacoesPedido(e.target.value)}
              rows={2}
              disabled={!podeEditar}
              placeholder="Acabamento, prazo, etc."
              maxLength={2000}
            />
          </div>
        </CardContent>
      </Card>

      {/* Pós-compra */}
      <Card className={subtask.status === "pendente" ? "opacity-60" : ""}>
        <CardHeader>
          <CardTitle className="text-base">Recebimento (pós-compra)</CardTitle>
          <CardDescription>
            Preencha após o tecido chegar — peso de cada rolo, preço efetivo,
            gramatura e largura. Largura do rolo é usada pelas subtasks Risco
            e Corte.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            {cores.map((c) => {
              const r = rolosRecebidos.find((x) => x.corId === c.corId);
              return (
                <div
                  key={c.corId}
                  className="rounded border p-3 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <Badge variant="outline">{c.corNome || "?"}</Badge>
                    {podeEditar && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          adicionarRoloDaCor(c.corId, c.corNome)
                        }
                      >
                        <Plus className="size-3.5" />
                        Rolo
                      </Button>
                    )}
                  </div>
                  {!r && (
                    <p className="text-xs text-muted-foreground">
                      Nenhum rolo registrado ainda.
                    </p>
                  )}
                  {r?.pesos.map((p, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-16">
                        Rolo #{idx + 1}
                      </span>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="peso kg"
                        value={p}
                        onChange={(e) =>
                          atualizarPesoRolo(c.corId, idx, e.target.value)
                        }
                        disabled={!podeEditar}
                        className="w-32"
                      />
                      <span className="text-xs text-muted-foreground">kg</span>
                      {podeEditar && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removerRolo(c.corId, idx)}
                          className="size-7"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>Preço/KG efetivo (R$)</Label>
              <Input
                type="number"
                step="0.01"
                value={precoKgEfetivo}
                onChange={(e) => setPrecoKgEfetivo(e.target.value)}
                disabled={!podeEditar}
              />
            </div>
            <div className="space-y-2">
              <Label>Gramatura (g/m²)</Label>
              <Input
                type="number"
                step="1"
                value={gramaturaGM2}
                onChange={(e) => setGramaturaGM2(e.target.value)}
                disabled={!podeEditar}
              />
            </div>
            <div className="space-y-2">
              <Label>Largura do rolo (cm)</Label>
              <Input
                type="number"
                step="0.5"
                value={larguraRoloCm}
                onChange={(e) => setLarguraRoloCm(e.target.value)}
                disabled={!podeEditar}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Observações pós-recebimento</Label>
            <Textarea
              value={observacoesPos}
              onChange={(e) => setObservacoesPos(e.target.value)}
              rows={2}
              disabled={!podeEditar}
              maxLength={2000}
            />
          </div>

          {/* Anexos */}
          <div className="space-y-2">
            <Label>Anexos</Label>
            <div className="space-y-2">
              <UploadAnexo
                subtaskId={subtask.id}
                opNumero={opNumero}
                subtaskNumero={subtask.numero}
                categoria="nf_compra"
                contaId={contaId}
                label="Nota Fiscal"
                disabled={!podeEditar || !session}
              />
            </div>
          </div>

          {podeEditar && (
            <div className="flex justify-end">
              <Button
                variant="outline"
                onClick={salvarPayload}
                disabled={salvandoPayload}
                size="sm"
              >
                {salvandoPayload ? "Salvando…" : "Salvar rascunho"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Lalamove */}
      <BlocoLalamoveManual
        subtaskId={subtask.id}
        contaId={contaId}
        opNumero={opNumero}
        subtaskNumero={subtask.numero}
        readOnly={readOnly}
      />
    </div>
  );
}

function CriarTipoTecidoForm({
  onCreated,
  onCancel,
}: {
  onCreated: (item: { id: string; nome: string }) => void;
  onCancel: () => void;
}) {
  const [nome, setNome] = useState("");
  const [salvando, setSalvando] = useState(false);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setSalvando(true);
        try {
          const res = await fetch(`/api/confeccao/tipos-tecido`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nome: nome.trim() }),
          });
          const data = await res.json();
          if (!res.ok) {
            toast.error(data.error ?? "Erro");
            return;
          }
          onCreated(data.item);
        } finally {
          setSalvando(false);
        }
      }}
    >
      <div className="space-y-2">
        <Label>Nome</Label>
        <Input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          required
          autoFocus
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={salvando || !nome.trim()}>
          {salvando ? "Salvando…" : "Criar"}
        </Button>
      </div>
    </form>
  );
}

function CriarCorForm({
  onCreated,
  onCancel,
}: {
  onCreated: (item: { id: string; nome: string }) => void;
  onCancel: () => void;
}) {
  const [nome, setNome] = useState("");
  const [salvando, setSalvando] = useState(false);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setSalvando(true);
        try {
          const res = await fetch(`/api/confeccao/cores`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nome: nome.trim() }),
          });
          const data = await res.json();
          if (!res.ok) {
            toast.error(data.error ?? "Erro");
            return;
          }
          onCreated(data.item);
        } finally {
          setSalvando(false);
        }
      }}
    >
      <div className="space-y-2">
        <Label>Nome</Label>
        <Input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          required
          autoFocus
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={salvando || !nome.trim()}>
          {salvando ? "Salvando…" : "Criar"}
        </Button>
      </div>
    </form>
  );
}
