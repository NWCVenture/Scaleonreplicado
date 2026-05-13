"use client";

// Landing dos cadastros do módulo Confecção.
// 4 cards com contador de itens ativos linkando para as páginas de cada entidade.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Boxes,
  Building2,
  Palette,
  Scissors,
} from "lucide-react";
import { useSession } from "@/lib/auth-client";
import { PageHeader } from "@/components/layout/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface CardCadastroProps {
  href: string;
  icon: React.ReactNode;
  titulo: string;
  descricao: string;
  endpoint: string;
}

function CardCadastro({
  href,
  icon,
  titulo,
  descricao,
  endpoint,
}: CardCadastroProps) {
  const [total, setTotal] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `${endpoint}?pageSize=1&incluirInativos=false`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error();
        const data = (await res.json()) as { total: number };
        if (!cancelled) setTotal(data.total);
      } catch {
        if (!cancelled) setTotal(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  return (
    <Link href={href}>
      <Card className="hover:bg-accent/40 transition-colors cursor-pointer h-full">
        <CardHeader>
          <div className="flex items-center gap-3">
            {icon}
            <CardTitle>{titulo}</CardTitle>
          </div>
          <CardDescription>{descricao}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {total === null ? "—" : total}
          </div>
          <p className="text-xs text-muted-foreground">
            {total === 1 ? "item ativo" : "itens ativos"}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}

export default function CadastrosLandingPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();

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
      <PageHeader
        title="Cadastros"
        description="Catálogos do módulo Confecção"
        icon={<Boxes className="size-8" />}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <CardCadastro
          href="/confeccao/cadastros/produtos"
          icon={<Boxes className="size-6 text-blue-500" />}
          titulo="Produtos"
          descricao="Produtos produzidos pela confecção"
          endpoint="/api/confeccao/produtos"
        />
        <CardCadastro
          href="/confeccao/cadastros/fornecedores"
          icon={<Building2 className="size-6 text-emerald-500" />}
          titulo="Fornecedores"
          descricao="Prestadores de serviço (risco, tecido, corte, costura, viés)"
          endpoint="/api/confeccao/fornecedores"
        />
        <CardCadastro
          href="/confeccao/cadastros/tipos-tecido"
          icon={<Scissors className="size-6 text-amber-500" />}
          titulo="Tipos de Tecido"
          descricao="Helanca, moletinho, dry-fit, etc."
          endpoint="/api/confeccao/tipos-tecido"
        />
        <CardCadastro
          href="/confeccao/cadastros/cores"
          icon={<Palette className="size-6 text-pink-500" />}
          titulo="Cores"
          descricao="Cores específicas dos tecidos da confecção"
          endpoint="/api/confeccao/cores"
        />
      </div>
    </div>
  );
}
