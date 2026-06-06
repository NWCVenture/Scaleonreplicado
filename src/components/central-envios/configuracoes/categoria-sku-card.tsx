"use client";

// CRUD de categorias do extrator. Cada categoria tem N regras avaliadas
// como OR. Tipos: regex / composição / tag (V2). Regex validada inline
// via try/catch new RegExp na UI; server também valida no upsert.

import { useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
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
  CategoriaRegra,
  CategoriaSkuClient,
  ModeloResumo,
} from "@/types/central-envios";

interface Props {
  categorias: CategoriaSkuClient[];
  modelosDisponiveis: ModeloResumo[];
  loading: boolean;
  erro: string | null;
  podeEditar: boolean;
  onSalvar: (payload: {
    id?: string;
    nome: string;
    ordem: number;
    ativo: boolean;
    regras: CategoriaRegra[];
  }) => Promise<boolean>;
  onExcluir: (id: string) => Promise<boolean>;
}

function resumirRegras(regras: CategoriaRegra[]): string {
  const contagem: Record<string, number> = {};
  for (const r of regras) contagem[r.tipo] = (contagem[r.tipo] ?? 0) + 1;
  return (
    Object.entries(contagem)
      .map(([k, v]) => `${v}× ${k}`)
      .join(", ") || "sem regras"
  );
}

function regraValida(r: CategoriaRegra): { ok: true } | { ok: false; motivo: string } {
  if (r.tipo === "regex") {
    if (!r.pattern.trim()) return { ok: false, motivo: "pattern vazio" };
    try {
      new RegExp(r.pattern, r.flags ?? "i");
      return { ok: true };
    } catch (e) {
      return { ok: false, motivo: (e as Error).message };
    }
  }
  if (r.tipo === "composicao") {
    if (!r.modeloCodigo) return { ok: false, motivo: "modelo obrigatório" };
    if (
      r.qtdMin !== undefined &&
      r.qtdMax !== undefined &&
      r.qtdMin > r.qtdMax
    ) {
      return { ok: false, motivo: "qtdMin > qtdMax" };
    }
    return { ok: true };
  }
  if (r.tipo === "tag") {
    if (r.tags.length === 0) return { ok: false, motivo: "sem tags" };
    return { ok: true };
  }
  return { ok: false, motivo: "tipo desconhecido" };
}

export function CategoriaSkuCard({
  categorias,
  modelosDisponiveis,
  loading,
  erro,
  podeEditar,
  onSalvar,
  onExcluir,
}: Props) {
  const [editando, setEditando] = useState<CategoriaSkuClient | "novo" | null>(null);
  const [excluindo, setExcluindo] = useState<CategoriaSkuClient | null>(null);
  const [nome, setNome] = useState("");
  const [ordem, setOrdem] = useState("0");
  const [ativo, setAtivo] = useState(true);
  const [regras, setRegras] = useState<CategoriaRegra[]>([]);
  const [salvando, setSalvando] = useState(false);

  function abrirNovo() {
    setEditando("novo");
    setNome("");
    setOrdem("0");
    setAtivo(true);
    setRegras([]);
  }

  function abrirEdicao(c: CategoriaSkuClient) {
    setEditando(c);
    setNome(c.nome);
    setOrdem(String(c.ordem));
    setAtivo(c.ativo);
    setRegras(c.regras);
  }

  function fechar() {
    if (salvando) return;
    setEditando(null);
  }

  function adicionarRegra(tipo: CategoriaRegra["tipo"]) {
    let nova: CategoriaRegra;
    if (tipo === "regex") nova = { tipo: "regex", pattern: "", flags: "i" };
    else if (tipo === "composicao")
      nova = {
        tipo: "composicao",
        modeloCodigo: modelosDisponiveis[0]?.codigo ?? "",
      };
    else nova = { tipo: "tag", tags: [] };
    setRegras((r) => [...r, nova]);
  }

  function atualizarRegra(i: number, patch: Partial<CategoriaRegra>) {
    setRegras((r) =>
      r.map((reg, idx) =>
        idx === i ? ({ ...reg, ...patch } as CategoriaRegra) : reg,
      ),
    );
  }

  function removerRegra(i: number) {
    setRegras((r) => r.filter((_, idx) => idx !== i));
  }

  const validacoes = regras.map(regraValida);
  const todasOk =
    regras.length > 0 && validacoes.every((v) => v.ok) && nome.trim().length > 0;

  async function submeter() {
    if (!todasOk) return;
    setSalvando(true);
    const payload = {
      id: editando !== "novo" && editando ? editando.id : undefined,
      nome: nome.trim(),
      ordem: Number.isNaN(Number(ordem)) ? 0 : Number(ordem),
      ativo,
      regras,
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

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Categorias do extrator</CardTitle>
          <CardDescription>
            Classificação usada na aba Extrator. Regras avaliadas como OR
            sobre o SKU original (antes da explosão).
          </CardDescription>
        </div>
        {podeEditar && (
          <Button size="sm" onClick={abrirNovo}>
            <Plus className="h-4 w-4 mr-1" /> Nova categoria
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : erro ? (
          <p className="text-sm text-destructive">{erro}</p>
        ) : categorias.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma categoria cadastrada — o extrator funciona sem categorias,
            mas o filtro fica vazio.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Ordem</TableHead>
                <TableHead>Regras</TableHead>
                <TableHead>Ativo</TableHead>
                {podeEditar && <TableHead className="text-right">Ações</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {categorias.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{c.nome}</TableCell>
                  <TableCell>{c.ordem}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {resumirRegras(c.regras)}
                  </TableCell>
                  <TableCell>
                    {c.ativo ? (
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
                        onClick={() => abrirEdicao(c)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setExcluindo(c)}
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
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editando === "novo" ? "Nova categoria" : "Editar categoria"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2 col-span-2">
                <Label>Nome</Label>
                <Input
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="LUA unitário"
                  maxLength={80}
                />
              </div>
              <div className="space-y-2">
                <Label>Ordem</Label>
                <Input
                  type="number"
                  value={ordem}
                  onChange={(e) => setOrdem(e.target.value)}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={ativo}
                onCheckedChange={(v) => setAtivo(v === true)}
              />
              <span>Categoria ativa</span>
            </label>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Regras (avaliadas como OR)</Label>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => adicionarRegra("regex")}
                  >
                    + Regex
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => adicionarRegra("composicao")}
                    disabled={modelosDisponiveis.length === 0}
                  >
                    + Composição
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => adicionarRegra("tag")}
                  >
                    + Tag
                  </Button>
                </div>
              </div>
              {regras.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Adicione pelo menos uma regra para salvar.
                </p>
              ) : (
                <div className="space-y-2">
                  {regras.map((r, i) => {
                    const v = validacoes[i];
                    return (
                      <div
                        key={i}
                        className="rounded-md border bg-muted/30 p-3 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <Badge variant="secondary">{r.tipo}</Badge>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => removerRegra(i)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                        {r.tipo === "regex" && (
                          <div className="grid grid-cols-[1fr_80px] gap-2">
                            <Input
                              value={r.pattern}
                              onChange={(e) =>
                                atualizarRegra(i, { pattern: e.target.value })
                              }
                              placeholder="^LUA \w+ \w+$"
                              className="font-mono text-xs"
                            />
                            <Input
                              value={r.flags ?? ""}
                              onChange={(e) =>
                                atualizarRegra(i, { flags: e.target.value })
                              }
                              placeholder="i"
                              maxLength={8}
                              className="font-mono text-xs"
                            />
                          </div>
                        )}
                        {r.tipo === "composicao" && (
                          <div className="grid grid-cols-3 gap-2">
                            <Select
                              value={r.modeloCodigo}
                              onValueChange={(val) =>
                                atualizarRegra(i, { modeloCodigo: val })
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Modelo" />
                              </SelectTrigger>
                              <SelectContent>
                                {modelosDisponiveis.map((m) => (
                                  <SelectItem key={m.id} value={m.codigo}>
                                    {m.codigo}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Input
                              type="number"
                              value={r.qtdMin ?? ""}
                              onChange={(e) =>
                                atualizarRegra(i, {
                                  qtdMin: e.target.value
                                    ? Number(e.target.value)
                                    : undefined,
                                })
                              }
                              placeholder="qtdMin"
                            />
                            <Input
                              type="number"
                              value={r.qtdMax ?? ""}
                              onChange={(e) =>
                                atualizarRegra(i, {
                                  qtdMax: e.target.value
                                    ? Number(e.target.value)
                                    : undefined,
                                })
                              }
                              placeholder="qtdMax"
                            />
                          </div>
                        )}
                        {r.tipo === "tag" && (
                          <div className="space-y-1">
                            <Input
                              value={r.tags.join(", ")}
                              onChange={(e) =>
                                atualizarRegra(i, {
                                  tags: e.target.value
                                    .split(",")
                                    .map((t) => t.trim())
                                    .filter(Boolean),
                                })
                              }
                              placeholder="tag1, tag2"
                            />
                            <p className="text-xs text-amber-700">
                              Tags ainda não são avaliadas em runtime — V2.
                            </p>
                          </div>
                        )}
                        {!v.ok && (
                          <p className="text-xs text-destructive">{v.motivo}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={fechar} disabled={salvando}>
              Cancelar
            </Button>
            <Button onClick={submeter} disabled={!todasOk || salvando}>
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
            <AlertDialogTitle>Excluir categoria</AlertDialogTitle>
            <AlertDialogDescription>
              Excluir <strong>{excluindo?.nome}</strong>? O extrator perde
              esta opção de filtro nas próximas sessões.
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
