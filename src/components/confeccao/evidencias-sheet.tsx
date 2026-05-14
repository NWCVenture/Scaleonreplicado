"use client";

// Aba "Evidências de Pagamento" — RITM-19.
//
// Sheet lateral com 3 seções: resumo financeiro, comprovantes (anexos
// agrupados por categoria) e Lalamoves (principais + outros). Carrega
// /api/confeccao/ops/[numero]/evidencias quando abre.

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, FileText, Truck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

interface Custos {
  tecido: number;
  risco: number;
  corte: number;
  vies: number;
  costura: number;
  lalamovesPrincipais: number;
  lalamovesOutros: number;
  lalamovesTotal: number;
  custoTotal: number;
  pecasProduzidas: number;
  pecasAprovadas: number;
  custoPorPecaProduzida: number | null;
  custoPorPecaAprovada: number | null;
  perdas: number;
}

interface AnexoItem {
  id: string;
  nomeArquivo: string;
  tipoMime: string;
  tamanhoBytes: number;
  blobUrl: string;
  createdAt: string;
  subtaskNumero: string | null;
}

interface LalamoveItem {
  id: string;
  tipo: "principal" | "outros";
  status: string;
  origemSolicitacao: string;
  valor: number | null;
  moeda: string;
  conteudoDescricao: string | null;
  quantidadePecas: number | null;
  origemEndereco: Record<string, string | null>;
  destinoEndereco: Record<string, string | null>;
  dataSolicitacao: string;
  dataColeta: string | null;
  dataEntrega: string | null;
  canceladaEm: string | null;
  subtaskNumero: string | null;
}

interface EvidenciasResponse {
  op: {
    id: string;
    numero: string;
    status: "em_andamento" | "concluida" | "cancelada";
    produtoNome: string;
    temVies: boolean;
  };
  custos: Custos;
  anexos: Array<{ categoria: string; items: AnexoItem[] }>;
  lalamoves: { principais: LalamoveItem[]; outros: LalamoveItem[] };
}

interface EvidenciasSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  opNumero: string;
}

const NOMES_CATEGORIA: Record<string, string> = {
  nf_compra: "Notas Fiscais (Compra)",
  risco_digital: "Risco digital",
  foto_papagaio: "Fotos (papagaio)",
  foto_defeito: "Fotos de defeito",
  comprovante_lalamove: "Comprovantes Lalamove",
  outros: "Outros",
};

function formatCents(v: number, moeda = "BRL"): string {
  return v.toLocaleString("pt-BR", {
    style: "currency",
    currency: moeda,
  });
}

function formatTamanho(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function enderecoCurto(end: Record<string, string | null>): string {
  const partes = [end.rua, end.numero, end.bairro, end.cidade]
    .filter(Boolean)
    .join(", ");
  return partes || "—";
}

export function EvidenciasSheet({
  open,
  onOpenChange,
  opNumero,
}: EvidenciasSheetProps) {
  const [data, setData] = useState<EvidenciasResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchEvidencias = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/confeccao/ops/${encodeURIComponent(opNumero)}/evidencias`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error();
      setData((await res.json()) as EvidenciasResponse);
    } catch {
      toast.error("Erro ao carregar evidências");
    } finally {
      setLoading(false);
    }
  }, [opNumero]);

  useEffect(() => {
    if (open) void fetchEvidencias();
    else setData(null);
  }, [open, fetchEvidencias]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl overflow-y-auto px-6 py-6">
        <SheetHeader className="px-0">
          <SheetTitle className="flex items-center gap-2">
            <FileText className="size-5 text-emerald-500" />
            Evidências — {opNumero}
          </SheetTitle>
        </SheetHeader>

        {loading && (
          <div className="mt-6 text-sm text-muted-foreground">Carregando…</div>
        )}

        {data && (
          <div className="mt-6 space-y-8">
            {data.op.status === "cancelada" && (
              <div className="rounded border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                OP cancelada — custos preservados para contabilidade
                separada.
              </div>
            )}

            <ResumoFinanceiro custos={data.custos} temVies={data.op.temVies} />

            <Anexos blocos={data.anexos} />

            <Lalamoves data={data.lalamoves} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Linha({
  label,
  valor,
  highlight,
}: {
  label: string;
  valor: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`flex justify-between py-1 text-sm ${highlight ? "font-semibold" : ""}`}
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{valor}</span>
    </div>
  );
}

function ResumoFinanceiro({
  custos,
  temVies,
}: {
  custos: Custos;
  temVies: boolean;
}) {
  return (
    <section className="space-y-2">
      <h3 className="font-medium">Resumo financeiro</h3>
      <div className="rounded-md border bg-card p-4 space-y-1">
        <Linha label="Tecido (Compra)" valor={formatCents(custos.tecido)} />
        <Linha label="Risco" valor={formatCents(custos.risco)} />
        <Linha label="Corte" valor={formatCents(custos.corte)} />
        {temVies && <Linha label="Viés" valor={formatCents(custos.vies)} />}
        <Linha label="Costura" valor={formatCents(custos.costura)} />
        <Linha
          label="Lalamoves (principais)"
          valor={formatCents(custos.lalamovesPrincipais)}
        />
        {custos.lalamovesOutros > 0 && (
          <Linha
            label="Lalamoves (outros)"
            valor={formatCents(custos.lalamovesOutros)}
          />
        )}
        <div className="my-2 border-t" />
        <Linha
          label="Custo total"
          valor={formatCents(custos.custoTotal)}
          highlight
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-md border bg-card p-3">
          <div className="text-xs text-muted-foreground">Peças produzidas</div>
          <div className="text-lg font-semibold tabular-nums">
            {custos.pecasProduzidas}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Custo/peça:{" "}
            {custos.custoPorPecaProduzida !== null
              ? formatCents(custos.custoPorPecaProduzida)
              : "—"}
          </div>
        </div>
        <div className="rounded-md border bg-card p-3">
          <div className="text-xs text-muted-foreground">Peças aprovadas</div>
          <div className="text-lg font-semibold tabular-nums">
            {custos.pecasAprovadas}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Custo/peça:{" "}
            {custos.custoPorPecaAprovada !== null
              ? formatCents(custos.custoPorPecaAprovada)
              : "—"}
          </div>
        </div>
      </div>

      {custos.perdas > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          <div className="text-xs font-medium text-amber-700 dark:text-amber-400">
            Perdas (rolos descartados)
          </div>
          <div className="text-lg font-semibold tabular-nums">
            {formatCents(custos.perdas)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Não compõe o custo total — indicador separado.
          </div>
        </div>
      )}
    </section>
  );
}

function Anexos({
  blocos,
}: {
  blocos: Array<{ categoria: string; items: AnexoItem[] }>;
}) {
  return (
    <section className="space-y-3">
      <h3 className="font-medium">Comprovantes anexados</h3>
      {blocos.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nenhum anexo registrado ainda.
        </p>
      )}
      {blocos.map(({ categoria, items }) => (
        <div key={categoria} className="space-y-1.5">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {NOMES_CATEGORIA[categoria] ?? categoria} ({items.length})
          </div>
          <div className="rounded-md border bg-card divide-y">
            {items.map((a) => (
              <a
                key={a.id}
                href={a.blobUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-muted/50"
              >
                <div className="flex flex-col min-w-0">
                  <span className="truncate font-medium">{a.nomeArquivo}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatTamanho(a.tamanhoBytes)} •{" "}
                    {new Date(a.createdAt).toLocaleString("pt-BR")}
                    {a.subtaskNumero ? ` • ${a.subtaskNumero}` : ""}
                  </span>
                </div>
                <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
              </a>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function Lalamoves({
  data,
}: {
  data: { principais: LalamoveItem[]; outros: LalamoveItem[] };
}) {
  const totalItems = data.principais.length + data.outros.length;
  return (
    <section className="space-y-3">
      <h3 className="font-medium flex items-center gap-2">
        <Truck className="size-4 text-blue-500" />
        Lalamoves ({totalItems})
      </h3>
      {totalItems === 0 && (
        <p className="text-sm text-muted-foreground">
          Nenhum Lalamove registrado.
        </p>
      )}
      {data.principais.length > 0 && (
        <ListaLalamove titulo="Principais" items={data.principais} />
      )}
      {data.outros.length > 0 && (
        <ListaLalamove titulo="Outros (etiquetas etc)" items={data.outros} />
      )}
    </section>
  );
}

function ListaLalamove({
  titulo,
  items,
}: {
  titulo: string;
  items: LalamoveItem[];
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {titulo} ({items.length})
      </div>
      <div className="rounded-md border bg-card divide-y">
        {items.map((l) => (
          <div key={l.id} className="px-3 py-2 space-y-1 text-sm">
            <div className="flex items-center justify-between gap-2">
              <Badge variant={l.canceladaEm ? "destructive" : "outline"}>
                {l.canceladaEm ? "Cancelado" : l.status}
              </Badge>
              <span className="tabular-nums font-medium">
                {l.valor !== null
                  ? formatCents(l.valor, l.moeda || "BRL")
                  : "—"}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              {enderecoCurto(l.origemEndereco)} →{" "}
              {enderecoCurto(l.destinoEndereco)}
            </div>
            <div className="text-xs text-muted-foreground">
              {new Date(l.dataSolicitacao).toLocaleString("pt-BR")}
              {l.subtaskNumero ? ` • ${l.subtaskNumero}` : ""}
              {l.conteudoDescricao ? ` • ${l.conteudoDescricao}` : ""}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
