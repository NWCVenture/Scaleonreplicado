"use client";

// Tela da OP com header fixo + stepper vertical das 5/6 subtasks.
// URLs próprias por subtask via /confeccao/ops/[numero]/subtasks/[prefixo].

import { use, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";
import { usePapelAtivo } from "@/hooks/use-papel-ativo";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { OPHeader } from "@/components/confeccao/op-header";
import { OpDashboardStrip } from "@/components/confeccao/op-dashboard-strip";
import { SubtaskCard } from "@/components/confeccao/subtask-card";
import { NotasOP } from "@/components/confeccao/notas-op";
import { FardosNoEstoque } from "@/components/confeccao/fardos-no-estoque";
import { derivarKpisOp } from "@/lib/confeccao/dashboard-kpis";
import type { ConfeccaoSubtask } from "@/lib/db/schema";

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
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set());
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
      // Auto-expande a primeira subtask "pendente" ou "em_andamento"
      // Não muda se o usuário já interagiu (set não-vazio)
      setExpandidas((prev) => {
        if (prev.size > 0) return prev;
        const ativa = json.subtasks.find(
          (s) => s.status === "pendente" || s.status === "em_andamento",
        );
        return ativa ? new Set([ativa.id]) : new Set();
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

  function toggleSubtask(id: string) {
    setExpandidas((prev) => {
      const novo = new Set(prev);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

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
    <div className="p-6 pt-0 space-y-4">
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

      <div className="space-y-2">
        {data.subtasks.map((s) => (
          <SubtaskCard
            key={s.id}
            subtask={s}
            opNumero={data.op.numero}
            contaId={contaId}
            expandido={expandidas.has(s.id)}
            onToggle={() => toggleSubtask(s.id)}
            onAlterado={() => void fetchOp()}
          />
        ))}
      </div>

      <div className="flex justify-end">
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
