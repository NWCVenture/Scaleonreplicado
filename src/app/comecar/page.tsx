import Link from "next/link";
import {
  Boxes,
  Truck,
  Warehouse,
  ScanBarcode,
  ShieldCheck,
  Building2,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "SCALEON ERP — Gestão de estoque para vendedores online",
  description:
    "ERP completo para sellers de Mercado Livre, Estante Virtual e marketplaces. Coletas, estoque, etiquetas e expedição — tudo em um lugar.",
};

const features = [
  {
    icon: Truck,
    title: "Coletas e expedição",
    desc: "Bipagem por SKU, conferência de pacotes e devoluções rastreadas.",
  },
  {
    icon: Warehouse,
    title: "Estante virtual",
    desc: "Localize fardos por etiqueta. Movimentações com histórico completo.",
  },
  {
    icon: ScanBarcode,
    title: "Etiquetas e QR",
    desc: "Geração, associação e verificação de etiquetas em massa.",
  },
  {
    icon: Boxes,
    title: "Múltiplos canais",
    desc: "Edite estoque do Mercado Livre direto do ERP em planilhas.",
  },
  {
    icon: ShieldCheck,
    title: "Multi-tenant seguro",
    desc: "Cada conta tem isolamento total via Row Level Security do Postgres.",
  },
  {
    icon: Building2,
    title: "Multi-empresa",
    desc: "Gerencie várias empresas (CNPJs) sob uma única conta.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted">
      {/* Top nav */}
      <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-10">
        <div className="container max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/comecar" className="flex items-center gap-2">
            <img
              src="/logo-full.png?v=3"
              alt="SCALEON ERP"
              className="h-10 w-auto object-contain"
            />
          </Link>
          <nav className="flex items-center gap-3">
            <Link
              href="/login"
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Entrar
            </Link>
            <Link href="/signup">
              <Button size="sm">
                Cadastre-se grátis
                <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="container max-w-6xl mx-auto px-4 py-16 md:py-24 text-center">
        <h1 className="text-4xl md:text-6xl font-bold tracking-tight">
          O ERP que <span className="text-primary">acompanha</span> seu galpão.
        </h1>
        <p className="mt-6 text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
          Gestão de estoque, coletas, expedição e etiquetas para sellers de
          Mercado Livre, Estante Virtual e marketplaces — tudo em um único
          sistema desenhado para o seu fluxo real.
        </p>
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link href="/signup">
            <Button size="lg" className="text-base h-12 px-8">
              Começar trial de 14 dias
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
          <Link href="/login">
            <Button size="lg" variant="outline" className="text-base h-12 px-8">
              Já tenho conta
            </Button>
          </Link>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Sem cartão de crédito. Sem instalação.
        </p>
      </section>

      {/* Features grid */}
      <section className="container max-w-6xl mx-auto px-4 py-12 md:py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f) => (
            <div
              key={f.title}
              className="bg-card border border-border rounded-lg p-6 hover:border-primary/50 transition-colors"
            >
              <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center mb-4">
                <f.icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-semibold text-lg">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="container max-w-3xl mx-auto px-4 py-16 md:py-24 text-center">
        <h2 className="text-3xl md:text-4xl font-bold">
          Pronto para parar de perder pedidos?
        </h2>
        <p className="mt-4 text-muted-foreground">
          Crie sua conta em menos de 1 minuto. Trial de 14 dias com todas as
          funcionalidades.
        </p>
        <div className="mt-8">
          <Link href="/signup">
            <Button size="lg" className="text-base h-12 px-8">
              Criar conta agora
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border mt-12 py-8">
        <div className="container max-w-6xl mx-auto px-4 text-center text-xs text-muted-foreground">
          <p>SCALEON ERP · v1.1 · Sistema multi-tenant</p>
        </div>
      </footer>
    </div>
  );
}
