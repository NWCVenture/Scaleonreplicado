"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Building2,
  Edit2,
  MapPin,
  MapPinOff,
  Pause,
  Play,
  Plus,
} from "lucide-react";
import { useSession } from "@/lib/auth-client";
import { usePapelAtivo } from "@/hooks/use-papel-ativo";
import { useCadastroPaginado } from "@/hooks/use-cadastro-paginado";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  FormFornecedor,
  fornecedorParaForm,
} from "@/components/confeccao/form-fornecedor";
import type { ConfeccaoFornecedor } from "@/lib/db/schema";

const CATEGORIAS = ["risco", "tecido", "corte", "costura", "vies"] as const;
const CATEGORIA_COR: Record<(typeof CATEGORIAS)[number], string> = {
  risco: "bg-purple-100 text-purple-700",
  tecido: "bg-blue-100 text-blue-700",
  corte: "bg-amber-100 text-amber-700",
  costura: "bg-emerald-100 text-emerald-700",
  vies: "bg-pink-100 text-pink-700",
};

export default function FornecedoresPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const { isAdmin } = usePapelAtivo();

  const [categoriaFiltro, setCategoriaFiltro] = useState<string>("todas");
  const lista = useCadastroPaginado<ConfeccaoFornecedor>({
    endpoint: `/api/confeccao/fornecedores`,
  });

  // Recarrega lista quando muda filtro de categoria
  // (não é controlado pelo hook; faço aqui via refresh manual com query string)
  // Solução simples: reconstroi a URL no fetch interno; já que o hook não
  // suporta extraQuery, vou fazer paginação manual aqui pra fornecedor.

  // Atalho: refetch ao mudar categoria → muda search forçando refresh.
  // Como o hook está com search separado, vou repensar. Pra fornecedores
  // o filtro categoria precisa ir junto na URL.

  // Workaround: aumentar pageSize do hook e filtrar client-side por categoria.
  // (Não escala — mas pra MVP com poucos fornecedores é suficiente.)
  const itemsFiltrados =
    categoriaFiltro === "todas"
      ? lista.items
      : lista.items.filter((f) =>
          f.categorias.includes(
            categoriaFiltro as (typeof CATEGORIAS)[number],
          ),
        );

  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ConfeccaoFornecedor | null>(
    null,
  );

  useEffect(() => {
    if (isPending) return;
    if (!session) router.replace("/login");
  }, [isPending, session, router]);

  if (isPending || !session) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Carregando…</div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          title="Fornecedores"
          description="Prestadores de serviço da confecção (risco, tecido, corte, costura, viés)"
          icon={<Building2 className="size-8 text-emerald-500" />}
        />
        {isAdmin && (
          <Button
            onClick={() => {
              setEditTarget(null);
              setModalOpen(true);
            }}
          >
            <Plus className="size-4" />
            Novo fornecedor
          </Button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
        <Input
          placeholder="Buscar por nome…"
          value={lista.search}
          onChange={(e) => {
            lista.setSearch(e.target.value);
            lista.setPage(1);
          }}
          className="max-w-xs"
        />
        <Select value={categoriaFiltro} onValueChange={setCategoriaFiltro}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Categoria" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas categorias</SelectItem>
            {CATEGORIAS.map((c) => (
              <SelectItem key={c} value={c}>
                {c.charAt(0).toUpperCase() + c.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={lista.incluirInativos}
            onCheckedChange={(v) => {
              lista.setIncluirInativos(v);
              lista.setPage(1);
            }}
          />
          Incluir inativos
        </label>
      </div>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Categorias</TableHead>
              <TableHead>Cidade/UF</TableHead>
              <TableHead>Coords</TableHead>
              <TableHead>Status</TableHead>
              {isAdmin && (
                <TableHead className="w-32 text-right">Ações</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {lista.loading && (
              <TableRow>
                <TableCell
                  colSpan={isAdmin ? 6 : 5}
                  className="text-center text-muted-foreground"
                >
                  Carregando…
                </TableCell>
              </TableRow>
            )}
            {!lista.loading && itemsFiltrados.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={isAdmin ? 6 : 5}
                  className="text-center text-muted-foreground"
                >
                  Nenhum fornecedor encontrado.
                </TableCell>
              </TableRow>
            )}
            {itemsFiltrados.map((f) => (
              <TableRow key={f.id}>
                <TableCell className="font-medium">
                  <Link
                    href={`/confeccao/cadastros/fornecedores/${f.id}`}
                    className="hover:underline"
                  >
                    {f.nome}
                  </Link>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {f.categorias.map((c) => (
                      <span
                        key={c}
                        className={`px-2 py-0.5 text-xs rounded ${CATEGORIA_COR[c]}`}
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {f.enderecoCidade} / {f.enderecoEstado}
                </TableCell>
                <TableCell>
                  {f.latitude && f.longitude ? (
                    <MapPin
                      className="size-4 text-emerald-500"
                      aria-label="Geocodificado"
                    />
                  ) : (
                    <MapPinOff
                      className="size-4 text-amber-500"
                      aria-label="Sem coordenadas"
                    />
                  )}
                </TableCell>
                <TableCell>
                  {f.ativo ? (
                    <Badge variant="default">Ativo</Badge>
                  ) : (
                    <Badge variant="secondary">Inativo</Badge>
                  )}
                </TableCell>
                {isAdmin && (
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setEditTarget(f);
                        setModalOpen(true);
                      }}
                      aria-label="Editar"
                    >
                      <Edit2 className="size-4" />
                    </Button>
                    {f.ativo ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => void lista.softDelete(f.id)}
                        aria-label="Desativar"
                      >
                        <Pause className="size-4" />
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => void lista.reativar(f.id)}
                        aria-label="Reativar"
                      >
                        <Play className="size-4" />
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {lista.totalPaginas > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Página {lista.page} de {lista.totalPaginas} • {lista.total} totais
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={lista.page === 1}
              onClick={() => lista.setPage(lista.page - 1)}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={lista.page >= lista.totalPaginas}
              onClick={() => lista.setPage(lista.page + 1)}
            >
              Próxima
            </Button>
          </div>
        </div>
      )}

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editTarget ? "Editar fornecedor" : "Novo fornecedor"}
            </DialogTitle>
          </DialogHeader>
          <FormFornecedor
            initial={editTarget ? fornecedorParaForm(editTarget) : undefined}
            fornecedorId={editTarget?.id}
            onSuccess={() => {
              setModalOpen(false);
              lista.refresh();
            }}
            onCancel={() => setModalOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
