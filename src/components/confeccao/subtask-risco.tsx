"use client";

// Conteúdo da subtask OPRIS (Risco) — RITM-09.
//
// Configuração da grade (tamanhos + proporção) + dados técnicos
// (rendimento, comprimento, largura). Largura validada contra a
// largura do rolo da subtask Compra antes de concluir.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Info, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LookupComCadastroInline } from "@/components/confeccao/lookup-com-cadastro-inline";
import { BlocoLalamoveManual } from "@/components/confeccao/bloco-lalamove-manual";
import { UploadAnexo } from "@/components/confeccao/upload-anexo";
import {
  TAMANHOS_GRADE_RISCO,
  type SubtaskRiscoPayload,
  type TamanhoGradeRisco,
} from "@/lib/confeccao/schemas/payloads/risco";
import type { SubtaskCompraPayload } from "@/lib/confeccao/schemas/payloads/compra";
import type { ConfeccaoSubtask } from "@/lib/db/schema";

interface SubtaskRiscoProps {
  subtask: ConfeccaoSubtask;
  opNumero: string;
  contaId: string;
  onAlterado: () => void;
}

interface TamanhoState {
  tamanho: TamanhoGradeRisco;
  ativo: boolean;
  proporcao: string;
}

export function SubtaskRisco({
  subtask,
  opNumero,
  contaId,
  onAlterado,
}: SubtaskRiscoProps) {
  const router = useRouter();
  const payload = (subtask.payload ?? {}) as SubtaskRiscoPayload;

  const podeEditar =
    subtask.status === "em_andamento" || subtask.status === "pendente";
  const readOnly =
    subtask.status === "concluida" || subtask.status === "cancelada";

  const [fornecedorRiscoId, setFornecedorRiscoId] = useState(
    payload.fornecedorRiscoId ?? "",
  );
  const [tamanhos, setTamanhos] = useState<TamanhoState[]>(() => {
    const inicial = payload.tamanhos ?? [];
    return TAMANHOS_GRADE_RISCO.map((t) => {
      const found = inicial.find((x) => x.tamanho === t);
      return {
        tamanho: t,
        ativo: Boolean(found),
        proporcao: found ? String(found.proporcao) : "",
      };
    });
  });
  const [rendimentoPercentual, setRendimentoPercentual] = useState(
    payload.rendimentoPercentual !== undefined
      ? String(payload.rendimentoPercentual)
      : "",
  );
  const [comprimentoM, setComprimentoM] = useState(
    payload.comprimentoM !== undefined ? String(payload.comprimentoM) : "",
  );
  const [larguraCm, setLarguraCm] = useState(
    payload.larguraCm !== undefined ? String(payload.larguraCm) : "",
  );
  const [valorServico, setValorServico] = useState(
    payload.valorServico !== undefined ? String(payload.valorServico) : "",
  );
  const [observacoes, setObservacoes] = useState(payload.observacoes ?? "");

  const [larguraRoloCm, setLarguraRoloCm] = useState<number | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [iniciando, setIniciando] = useState(false);
  const [concluindo, setConcluindo] = useState(false);

  // Busca largura do rolo na subtask Compra (OPBUY) da mesma OP
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
      const compra = data.subtasks.find((s) => s.prefixo === "OPBUY");
      const lc =
        (compra?.payload as SubtaskCompraPayload | undefined)?.pos
          ?.larguraRoloCm ?? null;
      if (!cancelled) setLarguraRoloCm(lc ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [opNumero]);

  function toggleTamanho(t: TamanhoGradeRisco) {
    setTamanhos((prev) =>
      prev.map((x) =>
        x.tamanho === t ? { ...x, ativo: !x.ativo, proporcao: "" } : x,
      ),
    );
  }
  function setProporcao(t: TamanhoGradeRisco, valor: string) {
    setTamanhos((prev) =>
      prev.map((x) => (x.tamanho === t ? { ...x, proporcao: valor } : x)),
    );
  }

  function montarPayload(): SubtaskRiscoPayload {
    const tamanhosArr = tamanhos
      .filter((t) => t.ativo && t.proporcao.trim())
      .map((t) => ({
        tamanho: t.tamanho,
        proporcao: Number(t.proporcao),
      }));
    return {
      fornecedorRiscoId: fornecedorRiscoId || undefined,
      tamanhos: tamanhosArr.length > 0 ? tamanhosArr : undefined,
      rendimentoPercentual: rendimentoPercentual
        ? Number(rendimentoPercentual)
        : undefined,
      comprimentoM: comprimentoM ? Number(comprimentoM) : undefined,
      larguraCm: larguraCm ? Number(larguraCm) : undefined,
      valorServico: valorServico ? Number(valorServico) : undefined,
      observacoes: observacoes.trim() || undefined,
    };
  }

  const salvarPayload = useCallback(async () => {
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
      toast.success("Salvo");
      onAlterado();
      return true;
    } finally {
      setSalvando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    subtask.id,
    fornecedorRiscoId,
    tamanhos,
    rendimentoPercentual,
    comprimentoM,
    larguraCm,
    valorServico,
    observacoes,
    onAlterado,
  ]);

  async function iniciar() {
    if (!fornecedorRiscoId) {
      toast.error("Defina o fornecedor de risco antes de iniciar");
      return;
    }
    setIniciando(true);
    try {
      await salvarPayload();
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
    // Validação client-side rápida da largura (defesa em profundidade)
    const larguraNum = Number(larguraCm);
    if (larguraRoloCm !== null && larguraNum > larguraRoloCm) {
      toast.error(
        `Largura do risco (${larguraNum}cm) excede a largura do rolo (${larguraRoloCm}cm)`,
      );
      return;
    }
    setConcluindo(true);
    try {
      const ok = await salvarPayload();
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

  const larguraExcedeu =
    larguraRoloCm !== null && larguraCm && Number(larguraCm) > larguraRoloCm;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h3 className="font-medium">Risco</h3>
          <p className="text-xs text-muted-foreground">
            Configuração do enfesto: tamanhos por folha, dados técnicos do
            risco e arquivo digital.
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

      {/* Banner com largura do rolo (vindo da Compra) */}
      <div
        className={`flex items-start gap-2 rounded border p-3 text-sm ${
          larguraRoloCm === null
            ? "border-amber-200 bg-amber-50 text-amber-900"
            : "border-blue-200 bg-blue-50 text-blue-900"
        }`}
      >
        <Info className="size-4 shrink-0 mt-0.5" />
        <div className="flex-1">
          {larguraRoloCm === null ? (
            <span>
              Largura do rolo ainda não definida na subtask Compra — preencha
              os dados pós-compra antes de concluir o Risco.
            </span>
          ) : (
            <span>
              Largura máxima permitida do risco:{" "}
              <strong>{larguraRoloCm}cm</strong> (largura do rolo da Compra).
            </span>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Fornecedor + Grade</CardTitle>
          <CardDescription>
            Empresa de risco e tamanhos por folha do enfesto.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Fornecedor de risco</Label>
            <LookupComCadastroInline
              endpoint="/api/confeccao/fornecedores"
              extraQuery={{ categoria: "risco" }}
              value={fornecedorRiscoId}
              onChange={(id) => setFornecedorRiscoId(id)}
              entidadeLabel="fornecedor de risco"
              permiteCadastrar={false}
              disabled={!podeEditar}
              className="w-full"
            />
          </div>

          <div className="space-y-2">
            <Label>Tamanhos por folha</Label>
            <p className="text-xs text-muted-foreground">
              Selecione os tamanhos e informe quantos por folha. Exemplo:
              4 M, 5 G, 3 GG → 12 peças por folha do enfesto.
            </p>
            <div className="grid grid-cols-5 gap-2">
              {tamanhos.map((t) => (
                <div
                  key={t.tamanho}
                  className={`rounded border p-2 space-y-2 ${
                    t.ativo ? "border-primary/40 bg-primary/5" : ""
                  }`}
                >
                  <label className="flex items-center gap-2 cursor-pointer text-sm font-medium">
                    <Checkbox
                      checked={t.ativo}
                      onCheckedChange={() => toggleTamanho(t.tamanho)}
                      disabled={!podeEditar}
                    />
                    {t.tamanho}
                  </label>
                  {t.ativo && (
                    <Input
                      type="number"
                      min="1"
                      max="99"
                      placeholder="qtd"
                      value={t.proporcao}
                      onChange={(e) =>
                        setProporcao(t.tamanho, e.target.value)
                      }
                      disabled={!podeEditar}
                      className="h-8 text-sm"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dados técnicos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>Rendimento (%)</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                max="100"
                value={rendimentoPercentual}
                onChange={(e) => setRendimentoPercentual(e.target.value)}
                disabled={!podeEditar}
              />
            </div>
            <div className="space-y-2">
              <Label>Comprimento (m)</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={comprimentoM}
                onChange={(e) => setComprimentoM(e.target.value)}
                disabled={!podeEditar}
              />
            </div>
            <div className="space-y-2">
              <Label>
                Largura (cm)
                {larguraRoloCm !== null && (
                  <span className="ml-1 text-xs text-muted-foreground font-normal">
                    (máx {larguraRoloCm})
                  </span>
                )}
              </Label>
              <Input
                type="number"
                step="0.5"
                min="0.5"
                value={larguraCm}
                onChange={(e) => setLarguraCm(e.target.value)}
                disabled={!podeEditar}
                className={larguraExcedeu ? "border-red-500" : undefined}
              />
              {larguraExcedeu ? (
                <p className="flex items-center gap-1 text-xs text-red-600">
                  <AlertTriangle className="size-3" />
                  Excede a largura do rolo
                </p>
              ) : null}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Valor total do serviço (R$)</Label>
            <p className="text-xs text-muted-foreground">
              Inclui digitalização + impressão (modelo de cobrança: valor
              fixo único).
            </p>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={valorServico}
              onChange={(e) => setValorServico(e.target.value)}
              disabled={!podeEditar}
              className="max-w-xs"
            />
          </div>

          <div className="space-y-2">
            <Label>Arquivo do risco digital</Label>
            <UploadAnexo
              subtaskId={subtask.id}
              opNumero={opNumero}
              subtaskNumero={subtask.numero}
              categoria="risco_digital"
              contaId={contaId}
              label="Anexar risco (PDF/imagem)"
              disabled={!podeEditar}
            />
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
