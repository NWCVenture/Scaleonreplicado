"use client";

// Tela "Visão geral" da OP: header + KPIs + fardos + histórico. Cada
// subtask tem sua PRÓPRIA página em /confeccao/ops/[numero]/subtasks/
// [prefixo]; a navegação entre elas é pela barra de abas, renderizada
// pelo OpContextoProvider no layout da rota (que também busca a OP e
// compartilha via contexto — sem refetch a cada troca de aba).

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Scale } from "lucide-react";
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
import { useOpContexto } from "@/components/confeccao/op-contexto";
import { NotasOP } from "@/components/confeccao/notas-op";
import { FardosNoEstoque } from "@/components/confeccao/fardos-no-estoque";
import { derivarKpisOp } from "@/lib/confeccao/dashboard-kpis";
import { totalRolosRecebidos } from "@/lib/confeccao/matching-rolos";
import type { SubtaskCortePayload } from "@/lib/confeccao/schemas/payloads/corte";

export default function OPDetailPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const { isAdmin } = usePapelAtivo();
  const { data, refetch } = useOpContexto();

  const [historicoOpen, setHistoricoOpen] = useState(false);

  if (!data || !session) {
    return (
      <div className="text-sm text-muted-foreground">Carregando…</div>
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
        onAtualizado={() => void refetch()}
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
