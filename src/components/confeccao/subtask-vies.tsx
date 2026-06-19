"use client";

// Conteúdo da subtask OPVIE (Viés) — RITM-11.
//
// Subtask condicional (só existe quando OP.temVies=true).
// Inclui DOIS blocos Lalamove (corte→fábrica, fábrica→costura).

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Play } from "lucide-react";
import { toast } from "sonner";
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
import { usePapelAtivo } from "@/hooks/use-papel-ativo";
import { LookupComCadastroInline } from "@/components/confeccao/lookup-com-cadastro-inline";
import { FormFornecedorRapido } from "@/components/confeccao/form-fornecedor-rapido";
import { BlocoLalamove } from "@/components/confeccao/bloco-lalamove";
import { WhatsappTemplatePicker } from "@/components/confeccao/whatsapp-template-picker";
import {
  calcularCustoVies,
  type SubtaskViesPayload,
} from "@/lib/confeccao/schemas/payloads/vies";
import type { SubtaskCompraPayload } from "@/lib/confeccao/schemas/payloads/compra";
import type { ConfeccaoSubtask } from "@/lib/db/schema";

interface SubtaskViesProps {
  subtask: ConfeccaoSubtask;
  opNumero: string;
  contaId: string;
  onAlterado: () => void;
}

interface FornecedorRef {
  id: string;
  nome: string;
  whatsapp?: string;
}

export function SubtaskVies({
  subtask,
  opNumero,
  contaId,
  onAlterado,
}: SubtaskViesProps) {
  const router = useRouter();
  const { isAdmin } = usePapelAtivo();
  const payload = (subtask.payload ?? {}) as SubtaskViesPayload;

  const podeEditar =
    subtask.status === "em_andamento" || subtask.status === "pendente";
  const readOnly =
    subtask.status === "concluida" || subtask.status === "cancelada";

  const [fornecedorViesId, setFornecedorViesId] = useState(
    payload.fornecedorViesId ?? "",
  );
  const [tamanhoBandeiraCm, setTamanhoBandeiraCm] = useState(
    payload.tamanhoBandeiraCm !== undefined
      ? String(payload.tamanhoBandeiraCm)
      : "",
  );
  const [tipoTecidoId, setTipoTecidoId] = useState(payload.tipoTecidoId ?? "");
  const [corId, setCorId] = useState(payload.corId ?? "");
  const [metragemProduzidaM, setMetragemProduzidaM] = useState(
    payload.metragemProduzidaM !== undefined
      ? String(payload.metragemProduzidaM)
      : "",
  );
  const [precoPorMetro, setPrecoPorMetro] = useState(
    payload.precoPorMetro !== undefined ? String(payload.precoPorMetro) : "",
  );
  const [observacoes, setObservacoes] = useState(payload.observacoes ?? "");

  const [fornecedor, setFornecedor] = useState<FornecedorRef | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [iniciando, setIniciando] = useState(false);
  const [concluindo, setConcluindo] = useState(false);

  // Pré-preenche tipo de tecido e cor da Compra na primeira carga
  useEffect(() => {
    if (tipoTecidoId && corId) return; // já preenchido
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/confeccao/ops/${opNumero}`, {
        cache: "no-store",
      });
      if (!res.ok || cancelled) return;
      const data = (await res.json()) as {
        subtasks: Array<{ prefixo: string; payload: unknown }>;
      };
      const compra = data.subtasks.find((s) => s.prefixo === "OPBUY")
        ?.payload as SubtaskCompraPayload | undefined;
      if (!cancelled) {
        if (!tipoTecidoId && compra?.tipoTecidoId) {
          setTipoTecidoId(compra.tipoTecidoId);
        }
        // Primeira cor disponível na Compra como default (cross-fornecedor)
        const primeiraCor = compra?.fornecedores?.flatMap((f) => f.cores)?.[0]
          ?.corId;
        if (!corId && primeiraCor) {
          setCorId(primeiraCor);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opNumero]);

  // Carrega WhatsApp do fornecedor
  useEffect(() => {
    if (!fornecedorViesId) {
      setFornecedor(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const res = await fetch(
        `/api/confeccao/fornecedores/${fornecedorViesId}`,
        { cache: "no-store" },
      );
      if (!res.ok || cancelled) return;
      const data = (await res.json()) as {
        item: { id: string; nome: string; whatsapp: string };
      };
      if (!cancelled) setFornecedor(data.item);
    })();
    return () => {
      cancelled = true;
    };
  }, [fornecedorViesId]);

  function montarPayload(): SubtaskViesPayload {
    return {
      fornecedorViesId: fornecedorViesId || undefined,
      tamanhoBandeiraCm: tamanhoBandeiraCm
        ? Number(tamanhoBandeiraCm)
        : undefined,
      tipoTecidoId: tipoTecidoId || undefined,
      corId: corId || undefined,
      metragemProduzidaM: metragemProduzidaM
        ? Number(metragemProduzidaM)
        : undefined,
      precoPorMetro: precoPorMetro ? Number(precoPorMetro) : undefined,
      observacoes: observacoes.trim() || undefined,
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
    [
      subtask.id,
      fornecedorViesId,
      tamanhoBandeiraCm,
      tipoTecidoId,
      corId,
      metragemProduzidaM,
      precoPorMetro,
      observacoes,
      onAlterado,
    ],
  );

  async function iniciar() {
    if (!fornecedorViesId) {
      toast.error("Defina a fábrica de viés antes de iniciar");
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

  const custoTotal =
    metragemProduzidaM && precoPorMetro
      ? calcularCustoVies({
          metragemProduzidaM: Number(metragemProduzidaM),
          precoPorMetro: Number(precoPorMetro),
        })
      : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h3 className="font-medium">Viés</h3>
          <p className="text-xs text-muted-foreground">
            Subtask condicional. Envia bandeira do Corte pra fábrica de viés
            e retorna pra Costura. Inclui 2 Lalamoves: ida (Corte→Fábrica) e
            volta (Fábrica→Costura).
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pedido à fábrica de viés</CardTitle>
          <CardDescription>
            Tipo e cor pré-preenchidos da Compra. Metragem produzida é
            preenchida após retorno da fábrica.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Fábrica de viés</Label>
            <LookupComCadastroInline
              endpoint="/api/confeccao/fornecedores"
              extraQuery={{ categoria: "vies" }}
              value={fornecedorViesId}
              onChange={(id) => setFornecedorViesId(id)}
              entidadeLabel="fábrica de viés"
              permiteCadastrar={isAdmin}
              cadastroInlineRender={
                isAdmin
                  ? ({ onCreated, onCancel }) => (
                      <FormFornecedorRapido
                        categoriaInicial="vies"
                        onCreated={onCreated}
                        onCancel={onCancel}
                      />
                    )
                  : undefined
              }
              disabled={!podeEditar}
              className="w-full"
            />
            {fornecedor?.whatsapp && (
              <WhatsappTemplatePicker
                categoria="vies"
                opNumero={opNumero}
                subtaskId={subtask.id}
                telefone={fornecedor.whatsapp}
                destinatarioNome={fornecedor.nome}
                fornecedorId={fornecedor.id}
                mensagemFallback={`Olá, {fornecedor_nome}. Sobre a OP {op_numero} (${subtask.numero}):\n\nGostaríamos de solicitar viés. Bandeira: {tamanho_bandeira}. Aguardo retorno.`}
                contexto={`Viés — OP ${opNumero}`}
                label="Solicitar viés via WhatsApp"
                className="w-full"
              />
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Tipo de tecido</Label>
              <LookupComCadastroInline
                endpoint="/api/confeccao/tipos-tecido"
                value={tipoTecidoId}
                onChange={(id) => setTipoTecidoId(id)}
                entidadeLabel="tipo de tecido"
                permiteCadastrar={false}
                disabled={!podeEditar}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground">
                Pré-preenchido da Compra
              </p>
            </div>
            <div className="space-y-2">
              <Label>Cor</Label>
              <LookupComCadastroInline
                endpoint="/api/confeccao/cores"
                value={corId}
                onChange={(id) => setCorId(id)}
                entidadeLabel="cor"
                permiteCadastrar={false}
                disabled={!podeEditar}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground">
                Default: primeira cor da Compra. Ajuste se for outra.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Tamanho da bandeira (cm)</Label>
            <p className="text-xs text-muted-foreground">
              Dimensão da sobra de mesa cortada pra confecção do viés.
            </p>
            <Input
              type="number"
              step="0.5"
              min="1"
              value={tamanhoBandeiraCm}
              onChange={(e) => setTamanhoBandeiraCm(e.target.value)}
              disabled={!podeEditar}
              className="max-w-xs"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Retorno + Valor</CardTitle>
          <CardDescription>
            Preencha após o viés chegar da fábrica.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>Metragem produzida (m)</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={metragemProduzidaM}
                onChange={(e) => setMetragemProduzidaM(e.target.value)}
                disabled={!podeEditar}
              />
            </div>
            <div className="space-y-2">
              <Label>Preço por metro (R$)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={precoPorMetro}
                onChange={(e) => setPrecoPorMetro(e.target.value)}
                disabled={!podeEditar}
              />
            </div>
            <div className="space-y-2">
              <Label>Custo total</Label>
              <Input
                value={
                  custoTotal !== null
                    ? `R$ ${custoTotal.toLocaleString("pt-BR", {
                        minimumFractionDigits: 2,
                      })}`
                    : "—"
                }
                disabled
                className="bg-muted/40 font-mono"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Observações</Label>
            <Textarea
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              rows={2}
              disabled={!podeEditar}
              maxLength={2000}
            />
          </div>

          {podeEditar && (
            <div className="flex justify-end">
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
        </CardContent>
      </Card>

      <div className="space-y-2">
        <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider px-1">
          Lalamove 1 — Ida (Corte → Fábrica)
        </div>
        <BlocoLalamove
          subtaskId={subtask.id}
          contaId={contaId}
          opNumero={opNumero}
          subtaskNumero={subtask.numero}
          readOnly={readOnly}
        />
      </div>

      <div className="space-y-2">
        <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider px-1">
          Lalamove 2 — Volta (Fábrica → Costura)
        </div>
        <p className="text-xs text-muted-foreground px-1">
          Adicione um segundo registro de Lalamove no bloco acima para a
          viagem de volta. Os dois Lalamoves compõem o custo logístico do Viés.
        </p>
      </div>
    </div>
  );
}
