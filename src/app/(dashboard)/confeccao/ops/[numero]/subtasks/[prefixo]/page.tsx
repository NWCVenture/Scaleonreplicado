"use client";

// Página single-subtask em layout full — abre em nova aba via
// botão "↗" no SubtaskCard. Mostra mini-header com link voltar + o
// card da subtask expandido em modoFullPage.

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";
import { usePapelAtivo } from "@/hooks/use-papel-ativo";
import { Button } from "@/components/ui/button";
import { SubtaskCard } from "@/components/confeccao/subtask-card";
import type {
  ConfeccaoSubtask,
  ConfeccaoSubtaskPrefixo,
} from "@/lib/db/schema";

interface OPDetalhe {
  op: { numero: string; produtoNome: string };
  subtasks: Array<ConfeccaoSubtask & { atribuidoNome: string | null }>;
}

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
  const { data: session, isPending } = useSession();
  const { me } = usePapelAtivo();
  const contaId = me?.contaAtivaId ?? "";

  const [opData, setOpData] = useState<OPDetalhe | null>(null);
  // Latches pra evitar que oscilações na referência de `session` re-disparem
  // fetchOp ou redirect — o que antes desmontava o formulário in-place e
  // fazia perder o que o usuário tinha digitado. Mesma lógica do Nova OP /
  // OP detail.
  const fetchOnceRef = useRef(false);
  const redirecionouRef = useRef(false);

  const prefixoTyped =
    (PREFIXOS_VALIDOS as readonly string[]).includes(prefixo)
      ? (prefixo as ConfeccaoSubtaskPrefixo)
      : null;

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
      setOpData((await res.json()) as OPDetalhe);
    } catch {
      toast.error("Erro ao carregar");
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
    if (!prefixoTyped) {
      if (redirecionouRef.current) return;
      redirecionouRef.current = true;
      toast.error("Prefixo inválido");
      router.replace(`/confeccao/ops/${numero}`);
      return;
    }
    if (fetchOnceRef.current) return;
    fetchOnceRef.current = true;
    void fetchOp();
  }, [isPending, session, router, prefixoTyped, numero, fetchOp]);

  if (!opData || !prefixoTyped) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Carregando…</div>
    );
  }

  const subtask = opData.subtasks.find((s) => s.prefixo === prefixoTyped);
  if (!subtask) {
    return (
      <div className="p-6 space-y-4">
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
    <div className="p-6 space-y-4 max-w-4xl">
      <div className="flex items-center justify-between gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/confeccao/ops/${numero}`}>
            <ArrowLeft className="size-4" />
            Voltar à OP {opData.op.numero}
          </Link>
        </Button>
        <span className="text-xs text-muted-foreground">
          {opData.op.produtoNome}
        </span>
      </div>

      <SubtaskCard
        subtask={subtask}
        opNumero={opData.op.numero}
        contaId={contaId}
        expandido
        onToggle={() => {
          /* sem efeito em modo full-page */
        }}
        onAlterado={fetchOp}
        modoFullPage
      />
    </div>
  );
}
