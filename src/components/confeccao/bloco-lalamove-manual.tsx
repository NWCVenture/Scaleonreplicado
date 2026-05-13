"use client";

// Bloco Lalamove manual reutilizável (subtasks Compra, Risco, Corte, Viés,
// Costura). Cria registro com origemSolicitacao=manual; operador atualiza
// status à mão (rascunho → coletado → entregue) e faz upload de comprovante.

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Truck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
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
import { UploadAnexo } from "@/components/confeccao/upload-anexo";
import type { ConfeccaoLalamove } from "@/lib/db/schema";

interface BlocoLalamoveManualProps {
  subtaskId?: string;
  retiradaId?: string;
  contaId: string;
  opNumero: string;
  subtaskNumero?: string;
  readOnly?: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  rascunho: "Rascunho",
  cotado: "Cotado",
  procurando_motorista: "Procurando motorista",
  motorista_designado: "Motorista designado",
  a_caminho_coleta: "A caminho da coleta",
  coletado: "Coletado",
  entregue: "Entregue",
  cancelado: "Cancelado",
  rejeitado: "Rejeitado",
  expirado: "Expirado",
};

export function BlocoLalamoveManual(props: BlocoLalamoveManualProps) {
  const [items, setItems] = useState<ConfeccaoLalamove[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (props.subtaskId) sp.set("subtaskId", props.subtaskId);
      if (props.retiradaId) sp.set("retiradaId", props.retiradaId);
      const res = await fetch(`/api/confeccao/lalamoves?${sp.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setItems(data.items);
    } catch {
      toast.error("Erro ao carregar Lalamoves");
    } finally {
      setLoading(false);
    }
  }, [props.subtaskId, props.retiradaId]);

  useEffect(() => {
    void fetchItems();
  }, [fetchItems]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Truck className="size-4" />
            Lalamove (manual)
          </CardTitle>
          {!props.readOnly && (
            <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
              <Plus className="size-3.5" />
              Adicionar
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && (
          <div className="text-xs text-muted-foreground">Carregando…</div>
        )}
        {!loading && items.length === 0 && (
          <div className="text-xs text-muted-foreground">
            Nenhum Lalamove cadastrado ainda.
          </div>
        )}
        {items.map((ll) => (
          <LalamoveLinha
            key={ll.id}
            item={ll}
            readOnly={props.readOnly}
            onAlterado={fetchItems}
            contaId={props.contaId}
            opNumero={props.opNumero}
            subtaskNumero={props.subtaskNumero}
          />
        ))}
      </CardContent>

      <NovoLalamoveDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        subtaskId={props.subtaskId}
        retiradaId={props.retiradaId}
        onCriado={() => {
          setAddOpen(false);
          void fetchItems();
        }}
      />
    </Card>
  );
}

function LalamoveLinha({
  item,
  readOnly,
  onAlterado,
  contaId,
  opNumero,
  subtaskNumero,
}: {
  item: ConfeccaoLalamove;
  readOnly?: boolean;
  onAlterado: () => void;
  contaId: string;
  opNumero: string;
  subtaskNumero?: string;
}) {
  const [novoStatus, setNovoStatus] = useState(item.status);
  const [valor, setValor] = useState(
    item.valor !== null ? String(item.valor) : "",
  );
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setSalvando(true);
    try {
      const payload: Record<string, unknown> = {};
      if (novoStatus !== item.status) {
        payload.status = novoStatus;
        if (novoStatus === "coletado" && !item.dataColeta) {
          payload.dataColeta = new Date().toISOString();
        }
        if (novoStatus === "entregue" && !item.dataEntrega) {
          payload.dataEntrega = new Date().toISOString();
        }
      }
      if (valor && Number(valor) !== item.valor) {
        payload.valor = Number(valor);
      }
      if (Object.keys(payload).length === 0) {
        toast.info("Nada para atualizar");
        return;
      }
      const res = await fetch(`/api/confeccao/lalamoves/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Erro ao atualizar");
        return;
      }
      toast.success("Atualizado");
      onAlterado();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="rounded border p-3 space-y-3 bg-card">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <Badge
            variant={
              item.status === "entregue"
                ? "default"
                : item.status === "cancelado"
                  ? "destructive"
                  : "secondary"
            }
          >
            {STATUS_LABEL[item.status] ?? item.status}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {item.tipo === "outros" ? "Outros" : "Principal"}
          </span>
        </div>
        {item.valor !== null && (
          <span className="font-mono text-sm">
            R${" "}
            {Number(item.valor).toLocaleString("pt-BR", {
              minimumFractionDigits: 2,
            })}
          </span>
        )}
      </div>

      {item.conteudoDescricao && (
        <div className="text-xs text-muted-foreground">
          {item.conteudoDescricao}
          {item.quantidadePecas ? ` • ${item.quantidadePecas} peças` : ""}
        </div>
      )}

      {!readOnly && (
        <div className="grid grid-cols-3 gap-2 items-end">
          <div className="space-y-1">
            <Label className="text-xs">Status</Label>
            <Select value={novoStatus} onValueChange={(v) => setNovoStatus(v as typeof novoStatus)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="rascunho">Rascunho</SelectItem>
                <SelectItem value="coletado">Coletado</SelectItem>
                <SelectItem value="entregue">Entregue</SelectItem>
                <SelectItem value="cancelado">Cancelado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Valor (R$)</Label>
            <Input
              type="number"
              step="0.01"
              className="h-8 text-xs"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            onClick={salvar}
            disabled={salvando}
          >
            {salvando ? "Salvando…" : "Atualizar"}
          </Button>
        </div>
      )}

      <UploadAnexo
        lalamoveId={item.id}
        opNumero={opNumero}
        subtaskNumero={subtaskNumero}
        categoria="comprovante_lalamove"
        contaId={contaId}
        label="Comprovante"
        disabled={readOnly}
      />
    </div>
  );
}

function NovoLalamoveDialog({
  open,
  onOpenChange,
  subtaskId,
  retiradaId,
  onCriado,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  subtaskId?: string;
  retiradaId?: string;
  onCriado: () => void;
}) {
  const [tipo, setTipo] = useState<"principal" | "outros">("principal");
  const [conteudo, setConteudo] = useState("");
  const [qtd, setQtd] = useState("");
  const [valor, setValor] = useState("");
  const [origem, setOrigem] = useState("");
  const [destino, setDestino] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true);
    try {
      const res = await fetch("/api/confeccao/lalamoves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subtaskId,
          retiradaId,
          tipo,
          origemEndereco: { rua: origem || undefined },
          destinoEndereco: { rua: destino || undefined },
          conteudoDescricao: conteudo || undefined,
          quantidadePecas: qtd ? Number(qtd) : undefined,
          valor: valor ? Number(valor) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Erro ao criar");
        return;
      }
      toast.success("Lalamove adicionado");
      // Reset
      setConteudo("");
      setQtd("");
      setValor("");
      setOrigem("");
      setDestino("");
      setTipo("principal");
      onCriado();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo Lalamove (manual)</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-2">
            <Label>Tipo</Label>
            <Select
              value={tipo}
              onValueChange={(v) => setTipo(v as typeof tipo)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="principal">
                  Principal (compõe custo)
                </SelectItem>
                <SelectItem value="outros">
                  Outros (ex: etiquetas — fora do custo principal)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Conteúdo</Label>
            <Textarea
              value={conteudo}
              onChange={(e) => setConteudo(e.target.value)}
              placeholder="Ex: 5 rolos de helanca preta"
              rows={2}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <Label>Qtd peças</Label>
              <Input
                type="number"
                value={qtd}
                onChange={(e) => setQtd(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Valor (R$)</Label>
              <Input
                type="number"
                step="0.01"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Origem (resumo)</Label>
            <Input
              value={origem}
              onChange={(e) => setOrigem(e.target.value)}
              placeholder="Ex: Fornecedor Tecidos ABC"
            />
          </div>
          <div className="space-y-2">
            <Label>Destino (resumo)</Label>
            <Input
              value={destino}
              onChange={(e) => setDestino(e.target.value)}
              placeholder="Ex: Oficina Corte X"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={salvando}>
              {salvando ? "Salvando…" : "Adicionar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Componente vazio reservado pra futuras refatorações
void Trash2;
