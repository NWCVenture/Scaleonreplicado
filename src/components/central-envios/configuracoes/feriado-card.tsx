"use client";

// CRUD manual de feriados + botão "Sincronizar nacionais" que reusa o
// endpoint do RITM-06. PATCH só edita descrição — data muda via
// delete+recriação (ver spec RITM-10).

import { useState } from "react";
import { CloudDownload, Pencil, Plus, Trash2 } from "lucide-react";
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
import type { FeriadoClient } from "@/types/central-envios";

interface Props {
  feriados: FeriadoClient[];
  loading: boolean;
  erro: string | null;
  podeEditar: boolean;
  anoAtual: number;
  onAnoChange: (ano: number) => void;
  onSalvar: (
    payload:
      | { id?: undefined; data: string; descricao: string }
      | { id: string; descricao: string },
  ) => Promise<boolean>;
  onExcluir: (id: string) => Promise<boolean>;
  onSyncNacionais: () => Promise<boolean>;
}

export function FeriadoCard({
  feriados,
  loading,
  erro,
  podeEditar,
  anoAtual,
  onAnoChange,
  onSalvar,
  onExcluir,
  onSyncNacionais,
}: Props) {
  const [editando, setEditando] = useState<FeriadoClient | "novo" | null>(null);
  const [excluindo, setExcluindo] = useState<FeriadoClient | null>(null);
  const [data, setData] = useState("");
  const [descricao, setDescricao] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);

  const anos: number[] = [];
  for (let a = anoAtual - 1; a <= anoAtual + 2; a++) anos.push(a);

  function abrirNovo() {
    setEditando("novo");
    setData(`${anoAtual}-01-01`);
    setDescricao("");
  }

  function abrirEdicao(f: FeriadoClient) {
    setEditando(f);
    setData(f.data);
    setDescricao(f.descricao);
  }

  function fechar() {
    if (salvando) return;
    setEditando(null);
  }

  async function submeter() {
    setSalvando(true);
    let ok = false;
    if (editando === "novo") {
      if (!data || !descricao.trim()) {
        setSalvando(false);
        return;
      }
      ok = await onSalvar({ data, descricao: descricao.trim() });
    } else if (editando) {
      if (!descricao.trim()) {
        setSalvando(false);
        return;
      }
      ok = await onSalvar({ id: editando.id, descricao: descricao.trim() });
    }
    setSalvando(false);
    if (ok) setEditando(null);
  }

  async function confirmarExclusao() {
    if (!excluindo) return;
    await onExcluir(excluindo.id);
    setExcluindo(null);
  }

  async function sincronizar() {
    setSincronizando(true);
    await onSyncNacionais();
    setSincronizando(false);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Feriados</CardTitle>
          <CardDescription>
            Calendário usado no cálculo de dias úteis. Sincronização nacional
            via BrasilAPI preserva entries manuais.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={String(anoAtual)}
            onValueChange={(v) => onAnoChange(Number(v))}
          >
            <SelectTrigger className="h-9 w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {anos.map((a) => (
                <SelectItem key={a} value={String(a)}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {podeEditar && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={sincronizar}
                disabled={sincronizando}
              >
                <CloudDownload className="h-4 w-4 mr-1" />
                {sincronizando ? "Sincronizando…" : "Sincronizar nacionais"}
              </Button>
              <Button size="sm" onClick={abrirNovo}>
                <Plus className="h-4 w-4 mr-1" /> Novo feriado
              </Button>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : erro ? (
          <p className="text-sm text-destructive">{erro}</p>
        ) : feriados.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum feriado cadastrado para {anoAtual}.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Fonte</TableHead>
                {podeEditar && <TableHead className="text-right">Ações</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {feriados.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="font-mono">{f.data}</TableCell>
                  <TableCell>{f.descricao}</TableCell>
                  <TableCell>
                    {f.fonte === "nacional_api" ? (
                      <Badge variant="outline" className="border-sky-300 text-sky-700">
                        BR
                      </Badge>
                    ) : (
                      <Badge variant="secondary">{f.fonte}</Badge>
                    )}
                  </TableCell>
                  {podeEditar && (
                    <TableCell className="text-right">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => abrirEdicao(f)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setExcluindo(f)}
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
              {editando === "novo" ? "Novo feriado" : "Editar feriado"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Data</Label>
              <Input
                type="date"
                value={data}
                onChange={(e) => setData(e.target.value)}
                disabled={editando !== "novo"}
              />
              {editando !== "novo" && editando && (
                <p className="text-xs text-muted-foreground">
                  Para mudar a data, exclua e recrie o feriado.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Descrição</Label>
              <Input
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                placeholder="Independência do Brasil"
                maxLength={200}
              />
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
                !descricao.trim() ||
                (editando === "novo" && !data)
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
            <AlertDialogTitle>Excluir feriado</AlertDialogTitle>
            <AlertDialogDescription>
              Excluir <strong>{excluindo?.data}</strong> —{" "}
              <strong>{excluindo?.descricao}</strong>? Esta ação não pode ser
              desfeita. Próximo sync nacional pode reinjetar feriados
              oficiais.
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
