"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  Edit2,
  Loader2,
  MapPin,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";
import { usePapelAtivo } from "@/hooks/use-papel-ativo";
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FormFornecedor,
  fornecedorParaForm,
} from "@/components/confeccao/form-fornecedor";
import type {
  ConfeccaoFornecedor,
  ConfeccaoTipoTecido,
} from "@/lib/db/schema";

interface PrecoLinha {
  id: string;
  fornecedorId: string;
  tipoTecidoId: string;
  tipoTecidoNome: string;
  precoKgSugerido: number;
  createdAt: string;
  updatedAt: string;
}

export default function FornecedorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const { isAdmin } = usePapelAtivo();

  const [fornecedor, setFornecedor] = useState<ConfeccaoFornecedor | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [geocoding, setGeocoding] = useState(false);

  const fetchFornecedor = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/confeccao/fornecedores/${id}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        toast.error("Fornecedor não encontrado");
        router.replace("/confeccao/cadastros/fornecedores");
        return;
      }
      const data = await res.json();
      setFornecedor(data.item);
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    if (isPending) return;
    if (!session) {
      router.replace("/login");
      return;
    }
    void fetchFornecedor();
  }, [isPending, session, router, fetchFornecedor]);

  async function reGeocode() {
    if (!fornecedor) return;
    setGeocoding(true);
    try {
      const res = await fetch(
        `/api/confeccao/fornecedores/${fornecedor.id}/geocode`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Geocoding falhou");
        return;
      }
      toast.success(`Coordenadas atualizadas (${data.precisao})`);
      setFornecedor(data.item);
    } finally {
      setGeocoding(false);
    }
  }

  if (isPending || !session || loading || !fornecedor) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Carregando…</div>
    );
  }

  const trabalhaComTecido = fornecedor.categorias.includes("tecido");

  return (
    <div className="space-y-6 p-6">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.push("/confeccao/cadastros/fornecedores")}
      >
        <ArrowLeft className="size-4" />
        Voltar
      </Button>

      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <Building2 className="size-7 text-emerald-500" />
            <h1 className="text-2xl font-bold tracking-tight">
              {fornecedor.nome}
            </h1>
            {!fornecedor.ativo && (
              <Badge variant="secondary">Inativo</Badge>
            )}
          </div>
          <div className="flex flex-wrap gap-1 mt-2">
            {fornecedor.categorias.map((c) => (
              <Badge key={c} variant="outline">
                {c}
              </Badge>
            ))}
          </div>
        </div>
        {isAdmin && (
          <Button onClick={() => setEditOpen(true)}>
            <Edit2 className="size-4" />
            Editar
          </Button>
        )}
      </div>

      <Tabs defaultValue="dados">
        <TabsList>
          <TabsTrigger value="dados">Dados</TabsTrigger>
          {trabalhaComTecido && (
            <TabsTrigger value="precos">Preços de tecido</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="dados" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle>Contato</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-muted-foreground">WhatsApp</div>
                <div>{fornecedor.whatsapp}</div>
              </div>
              {fornecedor.telefoneE164 && (
                <div>
                  <div className="text-muted-foreground">Telefone E.164</div>
                  <div>{fornecedor.telefoneE164}</div>
                </div>
              )}
              {fornecedor.contatoNome && (
                <div>
                  <div className="text-muted-foreground">Pessoa de contato</div>
                  <div>{fornecedor.contatoNome}</div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Endereço</CardTitle>
                {isAdmin && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={reGeocode}
                    disabled={geocoding}
                  >
                    {geocoding ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <RefreshCw className="size-3" />
                    )}
                    Atualizar coords
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div>
                {fornecedor.enderecoRua}, {fornecedor.enderecoNumero}
                {fornecedor.enderecoComplemento
                  ? ` — ${fornecedor.enderecoComplemento}`
                  : ""}
              </div>
              <div className="text-muted-foreground">
                {fornecedor.enderecoBairro} • {fornecedor.enderecoCep}
              </div>
              <div className="text-muted-foreground">
                {fornecedor.enderecoCidade}/{fornecedor.enderecoEstado}
              </div>
              <div className="pt-2 flex items-center gap-1 text-xs">
                {fornecedor.latitude && fornecedor.longitude ? (
                  <>
                    <MapPin className="size-3 text-emerald-500" />
                    <span className="text-muted-foreground">
                      {Number(fornecedor.latitude).toFixed(4)},{" "}
                      {Number(fornecedor.longitude).toFixed(4)}
                    </span>
                  </>
                ) : (
                  <span className="text-amber-600">
                    Coordenadas não definidas — clique em &quot;Atualizar
                    coords&quot;
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          {fornecedor.observacoes && (
            <Card>
              <CardHeader>
                <CardTitle>Observações</CardTitle>
              </CardHeader>
              <CardContent className="text-sm whitespace-pre-wrap">
                {fornecedor.observacoes}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {trabalhaComTecido && (
          <TabsContent value="precos" className="pt-4">
            <PrecosTab fornecedorId={id} isAdmin={isAdmin} />
          </TabsContent>
        )}
      </Tabs>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Editar fornecedor</DialogTitle>
          </DialogHeader>
          <FormFornecedor
            initial={fornecedorParaForm(fornecedor)}
            fornecedorId={fornecedor.id}
            onSuccess={(atualizado) => {
              setFornecedor(atualizado);
              setEditOpen(false);
            }}
            onCancel={() => setEditOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ----------------------------------------------------------------
// Tab "Preços de tecido"
// ----------------------------------------------------------------

function PrecosTab({
  fornecedorId,
  isAdmin,
}: {
  fornecedorId: string;
  isAdmin: boolean;
}) {
  const [precos, setPrecos] = useState<PrecoLinha[]>([]);
  const [tipos, setTipos] = useState<ConfeccaoTipoTecido[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [novoTipoId, setNovoTipoId] = useState("");
  const [novoPreco, setNovoPreco] = useState("");
  const [salvando, setSalvando] = useState(false);

  const fetchPrecos = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/confeccao/fornecedores/${fornecedorId}/precos`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        toast.error("Erro ao carregar preços");
        return;
      }
      const data = await res.json();
      setPrecos(data.items);
    } finally {
      setLoading(false);
    }
  }, [fornecedorId]);

  const fetchTipos = useCallback(async () => {
    const res = await fetch(`/api/confeccao/tipos-tecido?pageSize=100`, {
      cache: "no-store",
    });
    if (!res.ok) return;
    const data = await res.json();
    setTipos(data.items);
  }, []);

  useEffect(() => {
    void fetchPrecos();
    void fetchTipos();
  }, [fetchPrecos, fetchTipos]);

  async function adicionar(e: React.FormEvent) {
    e.preventDefault();
    if (!novoTipoId || !novoPreco) return;
    setSalvando(true);
    try {
      const res = await fetch(
        `/api/confeccao/fornecedores/${fornecedorId}/precos`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tipoTecidoId: novoTipoId,
            precoKgSugerido: Number(novoPreco),
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Erro ao adicionar");
        return;
      }
      toast.success("Preço adicionado");
      setAddOpen(false);
      setNovoTipoId("");
      setNovoPreco("");
      await fetchPrecos();
    } finally {
      setSalvando(false);
    }
  }

  async function remover(id: string) {
    const res = await fetch(
      `/api/confeccao/fornecedores/${fornecedorId}/precos/${id}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? "Erro ao remover");
      return;
    }
    toast.success("Removido");
    await fetchPrecos();
  }

  const tiposDisponiveis = tipos.filter(
    (t) => !precos.some((p) => p.tipoTecidoId === t.id),
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Preços sugeridos por tipo de tecido</CardTitle>
            <CardDescription>
              Usado no campo &quot;preço sugerido&quot; da subtask de Compra
            </CardDescription>
          </div>
          {isAdmin && tiposDisponiveis.length > 0 && (
            <Button size="sm" onClick={() => setAddOpen(true)}>
              Adicionar
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tipo de tecido</TableHead>
              <TableHead className="text-right">Preço/KG sugerido</TableHead>
              {isAdmin && <TableHead className="w-20"></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell
                  colSpan={isAdmin ? 3 : 2}
                  className="text-center text-muted-foreground"
                >
                  Carregando…
                </TableCell>
              </TableRow>
            )}
            {!loading && precos.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={isAdmin ? 3 : 2}
                  className="text-center text-muted-foreground"
                >
                  Nenhum preço cadastrado.
                </TableCell>
              </TableRow>
            )}
            {precos.map((p) => (
              <TableRow key={p.id}>
                <TableCell>{p.tipoTecidoNome}</TableCell>
                <TableCell className="text-right font-mono">
                  R${" "}
                  {Number(p.precoKgSugerido).toLocaleString("pt-BR", {
                    minimumFractionDigits: 2,
                  })}
                </TableCell>
                {isAdmin && (
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => void remover(p.id)}
                      aria-label="Remover"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Novo preço de tecido</DialogTitle>
          </DialogHeader>
          <form onSubmit={adicionar} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tipo">Tipo de tecido</Label>
              <Select value={novoTipoId} onValueChange={setNovoTipoId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecionar tipo…" />
                </SelectTrigger>
                <SelectContent>
                  {tiposDisponiveis.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="preco">Preço/KG (R$)</Label>
              <Input
                id="preco"
                type="number"
                step="0.01"
                min="0.01"
                value={novoPreco}
                onChange={(e) => setNovoPreco(e.target.value)}
                required
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAddOpen(false)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={salvando || !novoTipoId || !novoPreco}
              >
                {salvando ? "Salvando…" : "Adicionar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
