"use client";

// CRUD de aliases de cor. Espelho 1:1 de AliasTamanhoCard — não consolidamos
// em componente genérico porque os dois cards podem divergir (cor pode
// ganhar swatch RGB, tamanho pode ganhar ordem visual, etc.).

import { useMemo, useState } from "react";
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
import type { AliasClient, ModeloResumo } from "@/types/central-envios";

interface Props {
  aliases: AliasClient[];
  modelosDisponiveis: ModeloResumo[];
  loading: boolean;
  erro: string | null;
  podeEditar: boolean;
  onSalvar: (
    payload:
      | { id?: undefined; modeloId: string | null; codigoAlias: string; codigoReal: string }
      | { id: string; modeloId?: string | null; codigoAlias?: string; codigoReal?: string },
  ) => Promise<boolean>;
  onExcluir: (id: string) => Promise<boolean>;
}

const SCOPE_GLOBAL = "__global__";

export function AliasCorCard({
  aliases,
  modelosDisponiveis,
  loading,
  erro,
  podeEditar,
  onSalvar,
  onExcluir,
}: Props) {
  const [editando, setEditando] = useState<AliasClient | "novo" | null>(null);
  const [excluindo, setExcluindo] = useState<AliasClient | null>(null);
  const [modeloId, setModeloId] = useState<string>(SCOPE_GLOBAL);
  const [codigoAlias, setCodigoAlias] = useState("");
  const [codigoReal, setCodigoReal] = useState("");
  const [salvando, setSalvando] = useState(false);

  const modelosPorId = useMemo(
    () => new Map(modelosDisponiveis.map((m) => [m.id, m.codigo])),
    [modelosDisponiveis],
  );

  function abrirNovo() {
    setEditando("novo");
    setModeloId(SCOPE_GLOBAL);
    setCodigoAlias("");
    setCodigoReal("");
  }

  function abrirEdicao(a: AliasClient) {
    setEditando(a);
    setModeloId(a.modeloId ?? SCOPE_GLOBAL);
    setCodigoAlias(a.codigoAlias);
    setCodigoReal(a.codigoReal);
  }

  function fechar() {
    if (salvando) return;
    setEditando(null);
  }

  async function submeter() {
    if (!codigoAlias.trim() || !codigoReal.trim()) return;
    setSalvando(true);
    const scopeModelo = modeloId === SCOPE_GLOBAL ? null : modeloId;
    let ok = false;
    if (editando === "novo") {
      ok = await onSalvar({
        modeloId: scopeModelo,
        codigoAlias: codigoAlias.trim().toUpperCase(),
        codigoReal: codigoReal.trim().toUpperCase(),
      });
    } else if (editando) {
      ok = await onSalvar({
        id: editando.id,
        modeloId: scopeModelo,
        codigoAlias: codigoAlias.trim().toUpperCase(),
        codigoReal: codigoReal.trim().toUpperCase(),
      });
    }
    setSalvando(false);
    if (ok) setEditando(null);
  }

  async function confirmarExclusao() {
    if (!excluindo) return;
    await onExcluir(excluindo.id);
    setExcluindo(null);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Aliases de cor</CardTitle>
          <CardDescription>
            Traduz códigos alternativos de cor (ex.: PRETO → PT). Escopo
            global ou por modelo.
          </CardDescription>
        </div>
        {podeEditar && (
          <Button size="sm" onClick={abrirNovo}>
            <Plus className="h-4 w-4 mr-1" /> Novo alias
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : erro ? (
          <p className="text-sm text-destructive">{erro}</p>
        ) : aliases.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum alias cadastrado.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Escopo</TableHead>
                <TableHead>Alias</TableHead>
                <TableHead>→ Real</TableHead>
                {podeEditar && <TableHead className="text-right">Ações</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {aliases.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    {a.modeloId ? (
                      <Badge variant="outline">
                        {a.modeloCodigo ?? modelosPorId.get(a.modeloId) ?? a.modeloId}
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Global</Badge>
                    )}
                  </TableCell>
                  <TableCell className="font-mono">{a.codigoAlias}</TableCell>
                  <TableCell className="font-mono">{a.codigoReal}</TableCell>
                  {podeEditar && (
                    <TableCell className="text-right">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => abrirEdicao(a)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setExcluindo(a)}
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editando === "novo" ? "Novo alias de cor" : "Editar alias"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Escopo</Label>
              <Select value={modeloId} onValueChange={setModeloId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SCOPE_GLOBAL}>Global (toda a conta)</SelectItem>
                  {modelosDisponiveis.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.codigo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Alias</Label>
                <Input
                  value={codigoAlias}
                  onChange={(e) =>
                    setCodigoAlias(e.target.value.toUpperCase())
                  }
                  placeholder="PRETO"
                  maxLength={40}
                />
              </div>
              <div className="space-y-2">
                <Label>→ Real</Label>
                <Input
                  value={codigoReal}
                  onChange={(e) => setCodigoReal(e.target.value.toUpperCase())}
                  placeholder="PT"
                  maxLength={40}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={fechar} disabled={salvando}>
              Cancelar
            </Button>
            <Button
              onClick={submeter}
              disabled={
                salvando ||
                !codigoAlias.trim() ||
                !codigoReal.trim() ||
                codigoAlias.trim() === codigoReal.trim()
              }
            >
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
            <AlertDialogTitle>Excluir alias</AlertDialogTitle>
            <AlertDialogDescription>
              Excluir <strong>{excluindo?.codigoAlias}</strong> →{" "}
              <strong>{excluindo?.codigoReal}</strong>? Esta ação não pode ser desfeita.
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
