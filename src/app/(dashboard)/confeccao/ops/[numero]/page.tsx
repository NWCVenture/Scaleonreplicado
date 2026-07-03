"use client";

// Tela da OP com header fixo + abas horizontais das 5/6 subtasks (estilo
// abas de planilha, na parte de cima). A subtask ativa ocupa a página,
// sem card. URLs próprias por subtask via
// /confeccao/ops/[numero]/subtasks/[prefixo].

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Scale } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";
import { usePapelAtivo } from "@/hooks/use-papel-ativo";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { OPHeader } from "@/components/confeccao/op-header";
import { OpDashboardStrip } from "@/components/confeccao/op-dashboard-strip";
import { SubtaskPagina } from "@/components/confeccao/subtask-pagina";
import { SUBTASK_PREFIXO_LABEL } from "@/components/confeccao/subtask-status-badge";
import { NotasOP } from "@/components/confeccao/notas-op";
import { FardosNoEstoque } from "@/components/confeccao/fardos-no-estoque";
import { derivarKpisOp } from "@/lib/confeccao/dashboard-kpis";
import { totalRolosRecebidos } from "@/lib/confeccao/matching-rolos";
import type { SubtaskCortePayload } from "@/lib/confeccao/schemas/payloads/corte";
import type {
  ConfeccaoSubtask,
  ConfeccaoSubtaskStatus,
} from "@/lib/db/schema";

const STATUS_DOT: Record<ConfeccaoSubtaskStatus, string> = {
  bloqueada: "bg-slate-300",
  pendente: "bg-amber-400",
  em_andamento: "bg-blue-500",
  concluida: "bg-emerald-500",
  cancelada: "bg-red-500",
};

interface OPDetalhe {
  op: {
    id: string;
    numero: string;
    status: "em_andamento" | "concluida" | "cancelada";
    temVies: boolean;
    observacoes: string | null;
    produtoId: string;
    produtoNome: string;
    produtoDescricao: string | null;
    createdAt: string;
    atribuidoAId: string;
    canceladaEm: string | null;
    cancelamentoJustificativa: string | null;
    criadaPor: { id: string; name: string; email: string } | null;
    atribuidoA: { id: string; name: string; email: string } | null;
    canceladaPor: { id: string; name: string } | null;
    autorizadoPor: { id: string; name: string } | null;
  };
  subtasks: Array<
    ConfeccaoSubtask & {
      atribuidoNome: string | null;
    }
  >;
  progresso: {
    subtasksConcluidas: number;
    subtasksTotal: number;
    percentual: number;
  };
}

export default function OPDetailPage({
  params,
}: {
  params: Promise<{ numero: string }>;
}) {
  const { numero } = use(params);
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const { isAdmin, me } = usePapelAtivo();
  const contaId = me?.contaAtivaId ?? "";

  const [data, setData] = useState<OPDetalhe | null>(null);
  const [abaAtiva, setAbaAtiva] = useState<string | null>(null); // prefixo
  const [historicoOpen, setHistoricoOpen] = useState(false);
  // Garante que o fetch inicial e o redirect-de-login rodem no máximo uma
  // vez por vida do componente. Sem esse latch, qualquer oscilação na
  // referência de `session` vinda do useSession (revalidação em foco da
  // janela, StrictMode, etc) re-disparava fetchOp(), que setava o flag de
  // loading e re-renderizava "Carregando…" full-page — desmontando os
  // formulários das subtasks e perdendo o que o usuário tinha digitado.
  const fetchOnceRef = useRef(false);
  const redirecionouRef = useRef(false);

  const fetchOp = useCallback(async () => {
    try {
      const res = await fetch(`/api/confeccao/ops/${numero}`, {
        cache: "no-store",
      });
      if (res.status === 404) {
        toast.error("OP não encontrada");
        router.replace("/confeccao");
        return;
      }
      if (!res.ok) throw new Error();
      const json = (await res.json()) as OPDetalhe;
      setData(json);
      // Seleciona a primeira subtask "pendente" ou "em_andamento".
      // Não muda se o usuário já escolheu uma aba.
      setAbaAtiva((prev) => {
        if (prev) return prev;
        const ativa = json.subtasks.find(
          (s) => s.status === "pendente" || s.status === "em_andamento",
        );
        return (ativa ?? json.subtasks[0])?.prefixo ?? null;
      });
    } catch {
      toast.error("Erro ao carregar OP");
    }
  }, [numero, router]);

  useEffect(() => {
    if (isPending) return;
    if (!session) {
      if (redirecionouRef.current) return;
      redirecionouRef.current = true;
      router.replace("/login");
      return;
    }
    if (fetchOnceRef.current) return;
    fetchOnceRef.current = true;
    void fetchOp();
  }, [isPending, session, router, fetchOp]);

  // Mostra "Carregando…" só enquanto ainda não temos dados pra renderizar.
  // Refetches posteriores (via onAlterado) atualizam o estado in-place sem
  // desmontar os formulários das subtasks. Também guarda contra `session`
  // virar null por algum motivo (sign-out em outra aba) — nesse caso o
  // useEffect já agendou o redirect pra /login.
  if (!data || !session) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Carregando…</div>
    );
  }

  const kpis = derivarKpisOp(
    data.subtasks.map((s) => ({
      prefixo: s.prefixo,
      status: s.status,
      payload: s.payload,
    })),
  );

  return (
    <div className="space-y-4">
      <OPHeader
        numero={data.op.numero}
        status={data.op.status}
        temVies={data.op.temVies}
        produtoNome={data.op.produtoNome}
        criadaPorNome={data.op.criadaPor?.name ?? null}
        atribuidoAId={data.op.atribuidoAId}
        atribuidoNome={data.op.atribuidoA?.name ?? null}
        progresso={data.progresso}
        isAdmin={isAdmin}
        usuarioAtualId={session.user.id}
        onAtualizado={() => void fetchOp()}
        onAbrirHistorico={() => setHistoricoOpen(true)}
      />

      <OpDashboardStrip kpis={kpis} temVies={data.op.temVies} />

      {data.op.status === "cancelada" && (
        <div className="rounded border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <div className="font-medium text-destructive">OP cancelada</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {data.op.canceladaEm
              ? new Date(data.op.canceladaEm).toLocaleString("pt-BR")
              : ""}
            {" • "}
            cancelada por {data.op.canceladaPor?.name ?? "—"}
            {data.op.autorizadoPor
              ? `, com autorização de ${data.op.autorizadoPor.name}`
              : ""}
          </div>
          {data.op.cancelamentoJustificativa && (
            <div className="mt-2 whitespace-pre-wrap text-sm">
              <span className="font-medium">Justificativa: </span>
              {data.op.cancelamentoJustificativa}
            </div>
          )}
        </div>
      )}

      {data.op.observacoes && (
        <div className="rounded border bg-muted/40 p-3 text-sm text-muted-foreground whitespace-pre-wrap">
          <span className="font-medium text-foreground">Observações: </span>
          {data.op.observacoes}
        </div>
      )}

      <FardosNoEstoque
        opNumero={data.op.numero}
        opStatus={data.op.status}
      />

      {/* Abas horizontais das subtasks (estilo abas de planilha) */}
      <div>
        <div className="flex items-end gap-1 overflow-x-auto border-b">
          {data.subtasks.map((s) => {
            const bloqueada = s.status === "bloqueada";
            const ativa = abaAtiva === s.prefixo;
            return (
              <button
                key={s.id}
                type="button"
                disabled={bloqueada}
                onClick={() => setAbaAtiva(s.prefixo)}
                title={
                  bloqueada
                    ? "Aguardando conclusão da subtask anterior"
                    : undefined
                }
                className={cn(
                  "flex items-center gap-2 rounded-t-md border border-b-0 px-4 py-2 text-sm whitespace-nowrap transition-colors",
                  ativa
                    ? "-mb-px border-border bg-background font-medium"
                    : "border-transparent bg-muted/50 text-muted-foreground hover:bg-accent/50",
                  bloqueada && "cursor-not-allowed opacity-50",
                )}
              >
                <span className="text-xs text-muted-foreground tabular-nums">
                  {s.ordemSequencial}
                </span>
                {SUBTASK_PREFIXO_LABEL[s.prefixo] ?? s.prefixo}
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    STATUS_DOT[s.status],
                  )}
                />
              </button>
            );
          })}
        </div>

        {(() => {
          const ativa = data.subtasks.find((s) => s.prefixo === abaAtiva);
          if (!ativa) return null;
          return (
            <div className="pt-4">
              <SubtaskPagina
                subtask={ativa}
                opNumero={data.op.numero}
                contaId={contaId}
                onAlterado={() => void fetchOp()}
                mostrarAbrirEmNovaAba
              />
            </div>
          );
        })()}
      </div>

      <div className="flex items-center justify-between">
        {(() => {
          const cortePayload = data.subtasks.find(
            (s) => s.prefixo === "OPCOR",
          )?.payload as SubtaskCortePayload | undefined;
          const nRolos = totalRolosRecebidos(cortePayload ?? null);
          return nRolos > 0 ? (
            <Button asChild variant="outline" size="sm">
              <Link
                href={`/confeccao/ops/${data.op.numero}/matching-rolos`}
              >
                <Scale className="size-3.5" />
                Matching de Rolos ({nRolos} informado{nRolos === 1 ? "" : "s"})
              </Link>
            </Button>
          ) : (
            <span />
          );
        })()}
        <Button variant="ghost" size="sm" onClick={() => router.push("/confeccao")}>
          ← Voltar à lista
        </Button>
      </div>

      <Sheet open={historicoOpen} onOpenChange={setHistoricoOpen}>
        <SheetContent className="sm:max-w-md overflow-y-auto px-6 py-6">
          <SheetHeader className="px-0">
            <SheetTitle>Histórico — {data.op.numero}</SheetTitle>
          </SheetHeader>
          <div className="mt-4">
            <NotasOP opNumero={data.op.numero} incluirSubtasks />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
