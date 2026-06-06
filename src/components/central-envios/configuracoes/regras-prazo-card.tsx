"use client";

// CRUD de regras de prazo por canal/plataforma.
// O form muda os campos visíveis conforme a estratégia escolhida —
// DIAS_UTEIS_POS_VENDA mostra diasUteis; CAMPO_EXPLICITO mostra
// campoPrazo + regexPrazo; HIBRIDO mostra os três.

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  CanalEstrategiaPrazoClient,
  CanalVendaResumo,
  PlataformaCanalClient,
  RegraPrazoClient,
} from "@/types/central-envios";

const PLATAFORMAS: { value: PlataformaCanalClient; label: string }[] = [
  { value: "tiktok_shop", label: "TikTok Shop" },
  { value: "mercado_livre", label: "Mercado Livre" },
  { value: "shopee", label: "Shopee" },
];

const ESTRATEGIAS: { value: CanalEstrategiaPrazoClient; label: string }[] = [
  { value: "DIAS_UTEIS_POS_VENDA", label: "Dias úteis pós-venda" },
  { value: "CAMPO_EXPLICITO", label: "Campo explícito (regex)" },
  { value: "HIBRIDO", label: "Híbrido (campo + fallback dias úteis)" },
];

const SCOPE_DEFAULT = "__default__";

interface Props {
  regras: RegraPrazoClient[];
  canaisDisponiveis: CanalVendaResumo[];
  loading: boolean;
  erro: string | null;
  podeEditar: boolean;
  onSalvar: (payload: {
    id?: string;
    canalVendaId: string | null;
    plataforma: PlataformaCanalClient;
    estrategia: CanalEstrategiaPrazoClient;
    diasUteis: number | null;
    campoPrazo: string | null;
    regexPrazo: string | null;
    fallbackHoje: boolean;
    ativo: boolean;
  }) => Promise<boolean>;
  onExcluir: (id: string) => Promise<boolean>;
}

type FormState = {
  canalVendaId: string;
  plataforma: PlataformaCanalClient;
  estrategia: CanalEstrategiaPrazoClient;
  diasUteis: string;
  campoPrazo: string;
  regexPrazo: string;
  fallbackHoje: boolean;
  ativo: boolean;
};

const FORM_DEFAULT: FormState = {
  canalVendaId: SCOPE_DEFAULT,
  plataforma: "tiktok_shop",
  estrategia: "DIAS_UTEIS_POS_VENDA",
  diasUteis: "2",
  campoPrazo: "",
  regexPrazo: "",
  fallbackHoje: false,
  ativo: true,
};

export function RegrasPrazoCard({
  regras,
  canaisDisponiveis,
  loading,
  erro,
  podeEditar,
  onSalvar,
  onExcluir,
}: Props) {
  const [editando, setEditando] = useState<RegraPrazoClient | "novo" | null>(null);
  const [excluindo, setExcluindo] = useState<RegraPrazoClient | null>(null);
  const [form, setForm] = useState<FormState>(FORM_DEFAULT);
  const [salvando, setSalvando] = useState(false);

  function abrirNovo() {
    setEditando("novo");
    setForm(FORM_DEFAULT);
  }

  function abrirEdicao(r: RegraPrazoClient) {
    setEditando(r);
    setForm({
      canalVendaId: r.canalVendaId ?? SCOPE_DEFAULT,
      plataforma: r.plataforma,
      estrategia: r.estrategia,
      diasUteis: r.diasUteis !== null ? String(r.diasUteis) : "",
      campoPrazo: r.campoPrazo ?? "",
      regexPrazo: r.regexPrazo ?? "",
      fallbackHoje: r.fallbackHoje,
      ativo: r.ativo,
    });
  }

  function fechar() {
    if (salvando) return;
    setEditando(null);
  }

  const usaDias =
    form.estrategia === "DIAS_UTEIS_POS_VENDA" || form.estrategia === "HIBRIDO";
  const usaCampo =
    form.estrategia === "CAMPO_EXPLICITO" || form.estrategia === "HIBRIDO";

  const podeSubmeter =
    !salvando &&
    (!usaDias || (form.diasUteis !== "" && !Number.isNaN(Number(form.diasUteis)))) &&
    (!usaCampo || form.campoPrazo.trim().length > 0);

  async function submeter() {
    setSalvando(true);
    const payload = {
      id: editando !== "novo" && editando ? editando.id : undefined,
      canalVendaId:
        form.canalVendaId === SCOPE_DEFAULT ? null : form.canalVendaId,
      plataforma: form.plataforma,
      estrategia: form.estrategia,
      diasUteis: usaDias ? Number(form.diasUteis) : null,
      campoPrazo: usaCampo ? form.campoPrazo.trim() : null,
      regexPrazo: form.regexPrazo.trim() ? form.regexPrazo.trim() : null,
      fallbackHoje: form.fallbackHoje,
      ativo: form.ativo,
    };
    const ok = await onSalvar(payload);
    setSalvando(false);
    if (ok) setEditando(null);
  }

  async function confirmarExclusao() {
    if (!excluindo) return;
    await onExcluir(excluindo.id);
    setExcluindo(null);
  }

  function rotuloPlataforma(p: PlataformaCanalClient): string {
    return PLATAFORMAS.find((x) => x.value === p)?.label ?? p;
  }

  function rotuloEstrategia(e: CanalEstrategiaPrazoClient): string {
    return ESTRATEGIAS.find((x) => x.value === e)?.label ?? e;
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Regras de prazo por canal</CardTitle>
          <CardDescription>
            Define o cálculo do prazo de envio por plataforma ou canal
            específico. Default da plataforma vale pra todos os canais
            daquela plataforma sem regra própria.
          </CardDescription>
        </div>
        {podeEditar && (
          <Button size="sm" onClick={abrirNovo}>
            <Plus className="h-4 w-4 mr-1" /> Nova regra
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : erro ? (
          <p className="text-sm text-destructive">{erro}</p>
        ) : regras.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma regra cadastrada — pedidos sem regra ficam sem data.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plataforma</TableHead>
                <TableHead>Canal</TableHead>
                <TableHead>Estratégia</TableHead>
                <TableHead>Detalhes</TableHead>
                <TableHead>Fallback hoje</TableHead>
                <TableHead>Ativo</TableHead>
                {podeEditar && <TableHead className="text-right">Ações</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {regras.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{rotuloPlataforma(r.plataforma)}</TableCell>
                  <TableCell>
                    {r.canalVendaId ? (
                      <span>{r.canalNomeExibicao ?? r.canalVendaId}</span>
                    ) : (
                      <Badge variant="secondary">default da plataforma</Badge>
                    )}
                  </TableCell>
                  <TableCell>{rotuloEstrategia(r.estrategia)}</TableCell>
                  <TableCell className="text-xs">
                    {r.diasUteis !== null && (
                      <div>
                        {r.diasUteis} dia(s) úteis
                      </div>
                    )}
                    {r.campoPrazo && (
                      <div>
                        campo: <code>{r.campoPrazo}</code>
                      </div>
                    )}
                    {r.regexPrazo && (
                      <div className="truncate max-w-[300px]">
                        regex: <code>{r.regexPrazo}</code>
                      </div>
                    )}
                  </TableCell>
                  <TableCell>{r.fallbackHoje ? "Sim" : "Não"}</TableCell>
                  <TableCell>
                    {r.ativo ? (
                      <Badge variant="outline" className="border-emerald-300 text-emerald-700">
                        Ativo
                      </Badge>
                    ) : (
                      <Badge variant="outline">Inativo</Badge>
                    )}
                  </TableCell>
                  {podeEditar && (
                    <TableCell className="text-right">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => abrirEdicao(r)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setExcluindo(r)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={editando !== null} onOpenChange={(v) => !v && fechar()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editando === "novo" ? "Nova regra de prazo" : "Editar regra de prazo"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Plataforma</Label>
                <Select
                  value={form.plataforma}
                  onValueChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      plataforma: v as PlataformaCanalClient,
                      canalVendaId: SCOPE_DEFAULT,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PLATAFORMAS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Escopo</Label>
                <Select
                  value={form.canalVendaId}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, canalVendaId: v }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SCOPE_DEFAULT}>
                      Default da plataforma
                    </SelectItem>
                    {canaisDisponiveis
                      .filter((c) => c.plataforma === form.plataforma)
                      .map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.nomeExibicao}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Estratégia</Label>
              <Select
                value={form.estrategia}
                onValueChange={(v) =>
                  setForm((f) => ({
                    ...f,
                    estrategia: v as CanalEstrategiaPrazoClient,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ESTRATEGIAS.map((e) => (
                    <SelectItem key={e.value} value={e.value}>
                      {e.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {usaDias && (
              <div className="space-y-2">
                <Label>Dias úteis</Label>
                <Input
                  type="number"
                  min={0}
                  max={60}
                  value={form.diasUteis}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, diasUteis: e.target.value }))
                  }
                />
              </div>
            )}
            {usaCampo && (
              <>
                <div className="space-y-2">
                  <Label>Campo do payload</Label>
                  <Input
                    value={form.campoPrazo}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, campoPrazo: e.target.value }))
                    }
                    placeholder="Estado"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Regex (opcional)</Label>
                  <Input
                    value={form.regexPrazo}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, regexPrazo: e.target.value }))
                    }
                    placeholder="coleta do dia (\d+) de (\w+)"
                    className="font-mono"
                  />
                </div>
              </>
            )}
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.fallbackHoje}
                onCheckedChange={(v) =>
                  setForm((f) => ({ ...f, fallbackHoje: v === true }))
                }
              />
              <span>Quando não conseguir calcular, assume HOJE</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.ativo}
                onCheckedChange={(v) =>
                  setForm((f) => ({ ...f, ativo: v === true }))
                }
              />
              <span>Regra ativa</span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={fechar} disabled={salvando}>
              Cancelar
            </Button>
            <Button onClick={submeter} disabled={!podeSubmeter}>
              {salvando ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={excluindo !== null}
        onOpenChange={(v) => !v && setExcluindo(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir regra de prazo</AlertDialogTitle>
            <AlertDialogDescription>
              Excluir regra de{" "}
              <strong>{excluindo?.plataforma}</strong>?{" "}
              {excluindo?.canalVendaId
                ? "Canal específico — pedidos passam a usar a default da plataforma."
                : "Default da plataforma — pedidos sem outra regra ficam sem data."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmarExclusao}>
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
