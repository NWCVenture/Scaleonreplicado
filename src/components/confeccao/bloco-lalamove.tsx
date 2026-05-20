"use client";

// Bloco Lalamove reutilizável (subtasks Compra, Risco, Corte, Viés, Costura).
//
// Modo manual: operador cria registro à mão, atualiza status (rascunho →
// coletado → entregue), faz upload de comprovante.
//
// Modo API (RITM-25): quando feature flag está ligada e o lalamove tem
// lat/lng nos dois endpoints, aparece botão "Cotar via API" que chama
// POST /api/confeccao/lalamoves/[id]/cotar e mostra valor + countdown.
// Criação de pedido via API é RITM-26 (botão "Confirmar pedido" fica
// desabilitado com tooltip apontando pra próxima fase).

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  Plus,
  Sparkles,
  Truck,
  XCircle,
} from "lucide-react";
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

interface BlocoLalamoveProps {
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

// Status onde re-cotar/cotar ainda faz sentido (espelha o service).
const STATUS_PODE_COTAR = new Set([
  "rascunho",
  "cotado",
  "expirado",
  "rejeitado",
]);

export function BlocoLalamove(props: BlocoLalamoveProps) {
  const [items, setItems] = useState<ConfeccaoLalamove[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [apiHabilitada, setApiHabilitada] = useState(false);

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

  // Consulta feature flag da API Lalamove (RITM-25). Sem cache pra UI
  // refletir mudança de env após restart sem rebuild.
  useEffect(() => {
    fetch("/api/confeccao/lalamoves/config", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setApiHabilitada(Boolean(data?.flagHabilitada)))
      .catch(() => setApiHabilitada(false));
  }, []);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Truck className="size-4" />
            Lalamove
            {apiHabilitada && (
              <Badge variant="outline" className="text-[10px]">
                API on
              </Badge>
            )}
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
            apiHabilitada={apiHabilitada}
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
  apiHabilitada,
}: {
  item: ConfeccaoLalamove;
  readOnly?: boolean;
  onAlterado: () => void;
  contaId: string;
  opNumero: string;
  subtaskNumero?: string;
  apiHabilitada: boolean;
}) {
  const [cotarOpen, setCotarOpen] = useState(false);
  const [cancelarApiOpen, setCancelarApiOpen] = useState(false);

  const podeCotar =
    apiHabilitada &&
    !readOnly &&
    STATUS_PODE_COTAR.has(item.status) &&
    Boolean(item.origemLat && item.origemLng) &&
    Boolean(item.destinoLat && item.destinoLng);

  const STATUS_CANCELAVEL_API = new Set([
    "procurando_motorista",
    "motorista_designado",
    "a_caminho_coleta",
  ]);
  const podeCancelarApi =
    apiHabilitada &&
    !readOnly &&
    item.origemSolicitacao === "api" &&
    Boolean(item.orderIdApi) &&
    STATUS_CANCELAVEL_API.has(item.status);
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
          {item.origemSolicitacao === "api" && (
            <Badge variant="outline" className="text-[10px]">
              via API
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {podeCotar && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => setCotarOpen(true)}
            >
              <Sparkles className="size-3" />
              Cotar via API
            </Button>
          )}
          {podeCancelarApi && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => setCancelarApiOpen(true)}
            >
              <XCircle className="size-3" />
              Cancelar via API
            </Button>
          )}
          {item.valor !== null && (
            <span className="font-mono text-sm">
              R${" "}
              {Number(item.valor).toLocaleString("pt-BR", {
                minimumFractionDigits: 2,
              })}
            </span>
          )}
        </div>
      </div>

      {item.orderIdApi && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">
            #{item.orderIdApi.slice(0, 8)}…{item.orderIdApi.slice(-6)}
          </span>
          {item.shareLink && (
            <>
              <a
                href={item.shareLink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline flex items-center gap-1"
              >
                <ExternalLink className="size-3" />
                Rastrear
              </a>
              <Button
                size="sm"
                variant="ghost"
                className="h-5 px-1.5 text-[10px]"
                onClick={() => {
                  void navigator.clipboard.writeText(item.shareLink!);
                  toast.success("Link copiado");
                }}
              >
                <Copy className="size-3" />
              </Button>
            </>
          )}
        </div>
      )}

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

      <CotarApiDialog
        open={cotarOpen}
        onOpenChange={setCotarOpen}
        lalamoveId={item.id}
        onCotado={onAlterado}
      />

      <CancelarApiDialog
        open={cancelarApiOpen}
        onOpenChange={setCancelarApiOpen}
        lalamoveId={item.id}
        onCancelado={onAlterado}
      />
    </div>
  );
}

function CancelarApiDialog({
  open,
  onOpenChange,
  lalamoveId,
  onCancelado,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  lalamoveId: string;
  onCancelado: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) setMotivo("");
  }, [open]);

  async function confirmar() {
    if (!motivo.trim()) {
      toast.error("Informe um motivo");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/confeccao/lalamoves/${lalamoveId}/cancelar-api`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ motivo }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Erro ao cancelar");
        return;
      }
      if (data.motivo === "api_ok") {
        toast.success("Pedido cancelado na Lalamove");
      } else if (data.motivo === "api_falhou") {
        toast.warning(
          "Cancelado internamente, mas API falhou — admin foi avisado nas notas",
        );
      } else if (data.motivo === "status_nao_cancelavel") {
        toast.info("Status atual não permite cancelamento via API");
      } else {
        toast.info("Lalamove sem orderId — nada a cancelar na API");
      }
      onCancelado();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <XCircle className="size-4 text-destructive" />
            Cancelar pedido via API
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            A Lalamove permite cancelamento até o motorista coletar a carga
            (status `coletado` na API). Após isso, contate o suporte da
            Lalamove diretamente.
          </p>
          <div className="space-y-2">
            <Label className="text-xs">Motivo (obrigatório)</Label>
            <Input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex: pedido feito em duplicidade"
              maxLength={500}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Voltar
          </Button>
          <Button
            variant="destructive"
            onClick={confirmar}
            disabled={submitting || !motivo.trim()}
          >
            {submitting && <Loader2 className="size-3 animate-spin" />}
            {submitting ? "Cancelando…" : "Cancelar pedido"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CotarApiDialog({
  open,
  onOpenChange,
  lalamoveId,
  onCotado,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  lalamoveId: string;
  onCotado: () => void;
}) {
  const [serviceTypes, setServiceTypes] = useState<
    Array<{ key: string; description: string }>
  >([]);
  const [serviceType, setServiceType] = useState("MOTORCYCLE");
  const [carregandoTypes, setCarregandoTypes] = useState(false);
  const [cotando, setCotando] = useState(false);
  const [resultado, setResultado] = useState<{
    valorCotado: number;
    moeda: string;
    expiraEm: string;
    distanciaMetros: number | null;
  } | null>(null);

  // Carrega serviceTypes ao abrir o dialog
  useEffect(() => {
    if (!open) return;
    setCarregandoTypes(true);
    fetch("/api/confeccao/lalamoves/service-types", { cache: "no-store" })
      .then(async (r) => (r.ok ? r.json() : Promise.reject(await r.text())))
      .then((data) => {
        setServiceTypes(data.serviceTypes ?? []);
      })
      .catch(() => {
        setServiceTypes([
          { key: "MOTORCYCLE", description: "Motorcycle" },
          { key: "CAR", description: "Car" },
          { key: "VAN", description: "Van" },
        ]);
      })
      .finally(() => setCarregandoTypes(false));
  }, [open]);

  // Reseta resultado ao fechar
  useEffect(() => {
    if (!open) setResultado(null);
  }, [open]);

  async function cotar() {
    setCotando(true);
    try {
      const res = await fetch(
        `/api/confeccao/lalamoves/${lalamoveId}/cotar`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serviceType }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Erro ao cotar");
        return;
      }
      setResultado({
        valorCotado: data.valorCotado,
        moeda: data.moeda,
        expiraEm: data.expiraEm,
        distanciaMetros: data.distanciaMetros,
      });
      toast.success("Cotação criada");
      onCotado();
    } finally {
      setCotando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4" />
            Cotar via API Lalamove
          </DialogTitle>
        </DialogHeader>
        {!resultado ? (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Tipo de serviço</Label>
              <Select
                value={serviceType}
                onValueChange={setServiceType}
                disabled={carregandoTypes}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {serviceTypes.map((st) => (
                    <SelectItem key={st.key} value={st.key}>
                      {st.description || st.key}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancelar
              </Button>
              <Button onClick={cotar} disabled={cotando || carregandoTypes}>
                {cotando && <Loader2 className="size-3 animate-spin" />}
                {cotando ? "Cotando…" : "Cotar"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <ResultadoCotacao
            resultado={resultado}
            lalamoveId={lalamoveId}
            onRecotar={() => setResultado(null)}
            onFechar={() => onOpenChange(false)}
            onPedidoCriado={() => {
              onCotado();
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ResultadoCotacao({
  resultado,
  lalamoveId,
  onRecotar,
  onFechar,
  onPedidoCriado,
}: {
  resultado: {
    valorCotado: number;
    moeda: string;
    expiraEm: string;
    distanciaMetros: number | null;
  };
  lalamoveId: string;
  onRecotar: () => void;
  onFechar: () => void;
  onPedidoCriado: () => void;
}) {
  const [restanteSegundos, setRestanteSegundos] = useState(() => {
    return Math.max(
      0,
      Math.floor((new Date(resultado.expiraEm).getTime() - Date.now()) / 1000),
    );
  });
  useEffect(() => {
    if (restanteSegundos <= 0) return;
    const t = setInterval(() => {
      setRestanteSegundos((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [restanteSegundos]);
  const expirou = restanteSegundos === 0;
  const mm = Math.floor(restanteSegundos / 60);
  const ss = restanteSegundos % 60;
  const [confirmarOpen, setConfirmarOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-muted/50 p-4 text-center">
        <div className="text-3xl font-mono font-bold">
          {resultado.moeda} {resultado.valorCotado.toFixed(2)}
        </div>
        {resultado.distanciaMetros !== null && (
          <div className="text-xs text-muted-foreground mt-1">
            Distância: {(resultado.distanciaMetros / 1000).toFixed(1)} km
          </div>
        )}
        <div
          className={`text-xs mt-2 ${expirou ? "text-destructive" : "text-muted-foreground"}`}
        >
          {expirou
            ? "Cotação expirada — cote novamente"
            : `Expira em ${mm}:${String(ss).padStart(2, "0")}`}
        </div>
      </div>
      <DialogFooter className="flex-col gap-2 sm:flex-col">
        <Button
          variant="default"
          onClick={() => setConfirmarOpen(true)}
          className="w-full"
          title={
            expirou
              ? "Cotação anterior expirou — o backend re-cota silenciosamente"
              : undefined
          }
        >
          Confirmar pedido
        </Button>
        <div className="flex w-full gap-2">
          <Button variant="outline" onClick={onRecotar} className="flex-1">
            Re-cotar
          </Button>
          <Button variant="ghost" onClick={onFechar} className="flex-1">
            Fechar
          </Button>
        </div>
      </DialogFooter>

      <ConfirmarPedidoDialog
        open={confirmarOpen}
        onOpenChange={setConfirmarOpen}
        lalamoveId={lalamoveId}
        onPedidoCriado={onPedidoCriado}
      />
    </div>
  );
}

function ConfirmarPedidoDialog({
  open,
  onOpenChange,
  lalamoveId,
  onPedidoCriado,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  lalamoveId: string;
  onPedidoCriado: () => void;
}) {
  // Prefill com dados do lalamove existente
  const [origemNome, setOrigemNome] = useState("");
  const [origemTel, setOrigemTel] = useState("");
  const [destinoNome, setDestinoNome] = useState("");
  const [destinoTel, setDestinoTel] = useState("");
  const [remarks, setRemarks] = useState("");
  const [carregandoPrefill, setCarregandoPrefill] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [resultado, setResultado] = useState<{
    orderIdApi: string;
    shareLink: string | null;
    novaCotacao: { quotationIdApi: string; valorCotado: number } | null;
  } | null>(null);

  // Carrega prefill dos contatos a partir do lalamove
  useEffect(() => {
    if (!open) return;
    setCarregandoPrefill(true);
    fetch(`/api/confeccao/lalamoves/${lalamoveId}`, { cache: "no-store" })
      .then(async (r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.item) {
          setOrigemNome(data.item.contatoOrigemNome ?? "");
          setOrigemTel(data.item.contatoOrigemTelefone ?? "");
          setDestinoNome(data.item.contatoDestinoNome ?? "");
          setDestinoTel(data.item.contatoDestinoTelefone ?? "");
          setRemarks(data.item.remarksDestino ?? "");
        }
      })
      .finally(() => setCarregandoPrefill(false));
  }, [open, lalamoveId]);

  useEffect(() => {
    if (!open) setResultado(null);
  }, [open]);

  async function confirmar() {
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/confeccao/lalamoves/${lalamoveId}/criar-pedido`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contatoOrigem: { nome: origemNome, telefoneE164: origemTel },
            contatoDestino: { nome: destinoNome, telefoneE164: destinoTel },
            remarksDestino: remarks || undefined,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Erro ao criar pedido");
        return;
      }
      setResultado({
        orderIdApi: data.orderIdApi,
        shareLink: data.shareLink,
        novaCotacao: data.novaCotacao ?? null,
      });
      if (data.novaCotacao) {
        toast.success(
          `Pedido criado (cotação re-emitida por R$ ${data.novaCotacao.valorCotado.toFixed(2)})`,
        );
      } else {
        toast.success("Pedido criado");
      }
      onPedidoCriado();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4" />
            Confirmar pedido via API
          </DialogTitle>
        </DialogHeader>

        {resultado ? (
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/50 p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="size-4 text-green-600" />
                <span className="font-medium">Pedido criado com sucesso</span>
              </div>
              <div className="text-xs space-y-1">
                <div>
                  <span className="text-muted-foreground">Order ID: </span>
                  <span className="font-mono">{resultado.orderIdApi}</span>
                </div>
                {resultado.shareLink && (
                  <div className="flex items-center gap-2 mt-2">
                    <a
                      href={resultado.shareLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary text-xs underline flex items-center gap-1"
                    >
                      <ExternalLink className="size-3" />
                      Abrir tracking
                    </a>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-xs"
                      onClick={() => {
                        void navigator.clipboard.writeText(resultado.shareLink!);
                        toast.success("Link copiado");
                      }}
                    >
                      <Copy className="size-3" />
                      Copiar
                    </Button>
                  </div>
                )}
                {resultado.novaCotacao && (
                  <div className="text-amber-600 dark:text-amber-400 mt-2">
                    ⚠ A cotação anterior havia expirado. Re-cotada
                    automaticamente por{" "}
                    <span className="font-mono">
                      R$ {resultado.novaCotacao.valorCotado.toFixed(2)}
                    </span>
                    .
                  </div>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)} className="w-full">
                Fechar
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              Confira os contatos antes de criar. Eles serão enviados pra
              Lalamove e o destinatário recebe SMS com o tracking.
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Origem — nome</Label>
              <Input
                value={origemNome}
                onChange={(e) => setOrigemNome(e.target.value)}
                placeholder="Ex: Fornecedor ABC"
                disabled={carregandoPrefill}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Origem — telefone (E.164)</Label>
              <Input
                value={origemTel}
                onChange={(e) => setOrigemTel(e.target.value)}
                placeholder="+5511999999999"
                disabled={carregandoPrefill}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Destino — nome</Label>
              <Input
                value={destinoNome}
                onChange={(e) => setDestinoNome(e.target.value)}
                placeholder="Ex: Oficina X"
                disabled={carregandoPrefill}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Destino — telefone (E.164)</Label>
              <Input
                value={destinoTel}
                onChange={(e) => setDestinoTel(e.target.value)}
                placeholder="+5511988887777"
                disabled={carregandoPrefill}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">
                Instruções pro motorista (opcional)
              </Label>
              <Input
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Ex: Falar com João, sala 3"
                maxLength={250}
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
              <Button
                onClick={confirmar}
                disabled={submitting || carregandoPrefill}
              >
                {submitting && <Loader2 className="size-3 animate-spin" />}
                {submitting ? "Enviando…" : "Criar pedido"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
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

