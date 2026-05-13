"use client";

// Landing do módulo Confecção — lista paginada de OPs com filtros.
// Botão "+ Nova OP" visível só para admins.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Factory, Plus } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";
import { usePapelAtivo } from "@/hooks/use-papel-ativo";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
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

interface OPListItem {
  id: string;
  numero: string;
  status: "em_andamento" | "concluida" | "cancelada";
  temVies: boolean;
  produtoNome: string;
  atribuidoNome: string | null;
  createdAt: string;
  progresso: {
    subtasksConcluidas: number;
    subtasksTotal: number;
    percentual: number;
  };
}

const STATUS_LABEL: Record<OPListItem["status"], string> = {
  em_andamento: "Em andamento",
  concluida: "Concluída",
  cancelada: "Cancelada",
};

const STATUS_VARIANT: Record<
  OPListItem["status"],
  "default" | "secondary" | "destructive"
> = {
  em_andamento: "default",
  concluida: "secondary",
  cancelada: "destructive",
};

export default function ConfeccaoLandingPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const { isAdmin } = usePapelAtivo();

  const [items, setItems] = useState<OPListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [statusFiltro, setStatusFiltro] = useState<string>("em_andamento");
  const [loading, setLoading] = useState(true);

  const fetchOps = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (search.trim()) sp.set("search", search.trim());
      if (statusFiltro !== "todos") sp.append("status", statusFiltro);
      const res = await fetch(`/api/confeccao/ops?${sp.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setItems(data.items);
      setTotal(data.total);
    } catch {
      toast.error("Erro ao carregar OPs");
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, statusFiltro]);

  useEffect(() => {
    if (isPending) return;
    if (!session) {
      router.replace("/login");
      return;
    }
    const handle = setTimeout(() => void fetchOps(), 250);
    return () => clearTimeout(handle);
  }, [isPending, session, router, fetchOps]);

  if (isPending || !session) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Carregando…</div>
    );
  }

  const totalPaginas = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          title="Confecção"
          description="Ordens de Produção (OPs) — produção têxtil interna"
          icon={<Factory className="size-8 text-blue-500" />}
        />
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/confeccao/cadastros">Cadastros</Link>
          </Button>
          {isAdmin && (
            <Button asChild>
              <Link href="/confeccao/nova">
                <Plus className="size-4" />
                Nova OP
              </Link>
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
        <Input
          placeholder="Buscar por número ou produto…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="max-w-xs"
        />
        <Select
          value={statusFiltro}
          onValueChange={(v) => {
            setStatusFiltro(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="em_andamento">Em andamento</SelectItem>
            <SelectItem value="concluida">Concluídas</SelectItem>
            <SelectItem value="cancelada">Canceladas</SelectItem>
            <SelectItem value="todos">Todos status</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Número</TableHead>
              <TableHead>Produto</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-48">Progresso</TableHead>
              <TableHead>Atribuída a</TableHead>
              <TableHead>Criada em</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center text-muted-foreground"
                >
                  Carregando…
                </TableCell>
              </TableRow>
            )}
            {!loading && items.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center text-muted-foreground"
                >
                  Nenhuma OP encontrada.
                </TableCell>
              </TableRow>
            )}
            {items.map((op) => (
              <TableRow key={op.id}>
                <TableCell className="font-mono font-medium">
                  <Link
                    href={`/confeccao/ops/${op.numero}`}
                    className="hover:underline"
                  >
                    {op.numero}
                  </Link>
                </TableCell>
                <TableCell>
                  {op.produtoNome}
                  {op.temVies && (
                    <Badge variant="outline" className="ml-2 text-xs">
                      Viés
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[op.status]}>
                    {STATUS_LABEL[op.status]}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Progress
                      value={op.progresso.percentual}
                      className="h-2 flex-1"
                    />
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {op.progresso.subtasksConcluidas}/
                      {op.progresso.subtasksTotal}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-sm">
                  {op.atribuidoNome ?? "—"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(op.createdAt).toLocaleDateString("pt-BR")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {totalPaginas > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Página {page} de {totalPaginas} • {total} totais
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPaginas}
              onClick={() => setPage(page + 1)}
            >
              Próxima
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
