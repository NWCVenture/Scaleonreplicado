"use client";

// Página individual da subtask — cada subtask da OP tem a sua, e a
// navegação entre elas é pela barra de abas do layout da rota (estilo
// abas de planilha). Os dados da OP vêm do OpContextoProvider, que
// persiste entre as navegações — trocar de aba é instantâneo, sem
// refetch. Conteúdo direto na tela, sem card.

import { use, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { usePapelAtivo } from "@/hooks/use-papel-ativo";
import { Button } from "@/components/ui/button";
import { useOpContexto } from "@/components/confeccao/op-contexto";
import { SubtaskPagina } from "@/components/confeccao/subtask-pagina";
import type { ConfeccaoSubtaskPrefixo } from "@/lib/db/schema";

const PREFIXOS_VALIDOS: ConfeccaoSubtaskPrefixo[] = [
  "OPBUY",
  "OPRIS",
  "OPCOR",
  "OPVIE",
  "OPSEW",
  "OPCONF",
];

export default function SubtaskFullPage({
  params,
}: {
  params: Promise<{ numero: string; prefixo: string }>;
}) {
  const { numero, prefixo } = use(params);
  const router = useRouter();
  const { me } = usePapelAtivo();
  const contaId = me?.contaAtivaId ?? "";
  const { data: opData, refetch } = useOpContexto();
  const redirecionouRef = useRef(false);

  const prefixoTyped =
    (PREFIXOS_VALIDOS as readonly string[]).includes(prefixo)
      ? (prefixo as ConfeccaoSubtaskPrefixo)
      : null;

  useEffect(() => {
    if (prefixoTyped) return;
    if (redirecionouRef.current) return;
    redirecionouRef.current = true;
    toast.error("Prefixo inválido");
    router.replace(`/confeccao/ops/${numero}`);
  }, [prefixoTyped, numero, router]);

  if (!opData || !prefixoTyped) {
    return (
      <div className="text-sm text-muted-foreground">Carregando…</div>
    );
  }

  const subtask = opData.subtasks.find((s) => s.prefixo === prefixoTyped);
  if (!subtask) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/confeccao/ops/${numero}`}>
            <ArrowLeft className="size-4" />
            Voltar à OP
          </Link>
        </Button>
        <div className="text-sm text-muted-foreground">
          Subtask &quot;{prefixoTyped}&quot; não existe nesta OP
          {prefixoTyped === "OPVIE"
            ? " (essa OP foi criada sem a flag Viés)."
            : "."}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
        <span className="font-mono">OP {opData.op.numero}</span>
        <span>{opData.op.produtoNome}</span>
      </div>

      <SubtaskPagina
        subtask={subtask}
        opNumero={opData.op.numero}
        contaId={contaId}
        onAlterado={refetch}
      />
    </div>
  );
}
