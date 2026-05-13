"use client";

// Stub — implementação completa do stepper vertical da OP vem na RITM-07.
// Por ora, apenas mostra header básico com número da OP e link voltar.

import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Factory } from "lucide-react";
import { useSession } from "@/lib/auth-client";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface OPDetalhe {
  id: string;
  numero: string;
  status: "em_andamento" | "concluida" | "cancelada";
  temVies: boolean;
  produtoId: string;
  produtoNome: string;
  atribuidoNome: string | null;
  createdAt: string;
}

export default function OpDetailPage({
  params,
}: {
  params: Promise<{ numero: string }>;
}) {
  const { numero } = use(params);
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [op, setOp] = useState<OPDetalhe | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchOp = useCallback(async () => {
    setLoading(true);
    try {
      // GET de detalhe ainda não existe — usa GET list com filtro por numero
      // (implementação completa será feita na RITM-07).
      const res = await fetch(
        `/api/confeccao/ops?search=${encodeURIComponent(numero)}&pageSize=1`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        setOp(null);
        return;
      }
      const data = await res.json();
      const match = (data.items as OPDetalhe[]).find((o) => o.numero === numero);
      setOp(match ?? null);
    } finally {
      setLoading(false);
    }
  }, [numero]);

  useEffect(() => {
    if (isPending) return;
    if (!session) {
      router.replace("/login");
      return;
    }
    void fetchOp();
  }, [isPending, session, router, fetchOp]);

  if (isPending || !session || loading) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Carregando…</div>
    );
  }

  if (!op) {
    return (
      <div className="space-y-4 p-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/confeccao")}
        >
          <ArrowLeft className="size-4" />
          Voltar
        </Button>
        <div className="text-sm text-muted-foreground">OP não encontrada.</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.push("/confeccao")}
      >
        <ArrowLeft className="size-4" />
        Voltar
      </Button>

      <PageHeader
        title={op.numero}
        description={`${op.produtoNome} • Atribuída a ${op.atribuidoNome ?? "—"}`}
        icon={<Factory className="size-8 text-blue-500" />}
      />

      <div className="flex gap-2">
        <Badge variant={op.status === "concluida" ? "secondary" : "default"}>
          {op.status === "em_andamento"
            ? "Em andamento"
            : op.status === "concluida"
              ? "Concluída"
              : "Cancelada"}
        </Badge>
        {op.temVies && <Badge variant="outline">Com Viés</Badge>}
      </div>

      <div className="rounded-md border bg-muted/30 p-6 text-sm text-muted-foreground">
        <p className="font-medium text-foreground mb-2">
          Stepper de subtasks em construção
        </p>
        <p>
          O stepper vertical com header fixo + cards expansíveis vem na
          próxima entrega (RITM-07). Por ora, a OP foi criada com as subtasks
          corretas no banco — você pode confirmar via Drizzle Studio.
        </p>
      </div>
    </div>
  );
}
