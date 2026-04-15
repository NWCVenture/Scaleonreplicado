"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession, signOut } from "@/lib/auth-client";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { MobileHeader } from "@/components/layout/header";
import {
  ClipboardList,
  Truck,
  Barcode,
  Package,
  Warehouse,
  ArrowLeftRight,
  AlertTriangle,
  Tag,
  Search,
  Calculator,
  QrCode,
  Boxes,
  FileSpreadsheet,
  FileText,
  LogOut,
  Lock,
  MousePointerClick,
  ChevronDown,
  ChevronRight,
  Loader2,
} from "lucide-react";

const expedicaoHrefs = [
  "/coletas",
  "/contagem",
  "/cadastro",
  "/estante-virtual",
  "/alteracao-estoque",
  "/produtos-avariados",
];

const outrosHrefs = [
  "/associar-etiquetas",
  "/verificador-etiquetas",
  "/gestao-custos-textil",
  "/criar-qr-code",
  "/kit-organizer",
  "/processador-anuncios",
  "/recuperar-dados",
];

const restrictedPages = [
  "/criar-qr-code",
  "/kit-organizer",
  "/processador-anuncios",
];

const expedicaoItems = [
  { href: "/coletas", label: "Coletas", icon: Truck },
  { href: "/contagem", label: "Contagem de Estoque", icon: Barcode },
  { href: "/cadastro", label: "Cadastrar QR", icon: Package },
  { href: "/estante-virtual", label: "Estante Virtual", icon: Warehouse },
  {
    href: "/alteracao-estoque",
    label: "Alteracao de Estoque",
    icon: ArrowLeftRight,
  },
  {
    href: "/produtos-avariados",
    label: "Produtos com Avarias",
    icon: AlertTriangle,
  },
];

const outrosItems = [
  { href: "/associar-etiquetas", label: "Associar Etiquetas", icon: Tag },
  {
    href: "/verificador-etiquetas",
    label: "Verificador de Etiquetas",
    icon: Search,
  },
  {
    href: "/gestao-custos-textil",
    label: "Gestao de Custos Texteis",
    icon: Calculator,
  },
  { href: "/criar-qr-code", label: "QR Code Personalizado", icon: QrCode },
  {
    href: "/kit-organizer",
    label: "Organizador de Etiquetas",
    icon: Boxes,
  },
  {
    href: "/processador-anuncios",
    label: "Editar Estoque ML",
    icon: FileSpreadsheet,
  },
  {
    href: "/recuperar-dados",
    label: "Recuperar Dados",
    icon: FileText,
  },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session, isPending } = useSession();

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [modoLivre, setModoLivre] = useState(false);
  const [expedicaoAberta, setExpedicaoAberta] = useState(() =>
    expedicaoHrefs.includes(pathname)
  );
  const [outrosAberta, setOutrosAberta] = useState(() =>
    outrosHrefs.includes(pathname)
  );

  // Init modoLivre from sessionStorage (client-only)
  useEffect(() => {
    setModoLivre(sessionStorage.getItem("stockflow_modo_livre") === "1");
  }, []);

  // Block Tab key when modoLivre is false (scanner mode)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!modoLivre && e.key === "Tab") {
        e.preventDefault();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [modoLivre]);

  const toggleModoLivre = () => {
    const next = !modoLivre;
    setModoLivre(next);
    sessionStorage.setItem("stockflow_modo_livre", next ? "1" : "0");
    toast(
      next
        ? "Modo Livre ativado — Tab navega livremente"
        : "Scanner protegido — Tab bloqueado",
      { duration: 2000 }
    );
  };

  const handleLogout = async () => {
    await signOut();
    toast.success("Logout realizado com sucesso!");
    router.push("/login");
  };

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isBeatriz = session.user.email === "beatriz@nwc.com";

  const filteredExpedicao = expedicaoItems.filter(
    (item) => !(isBeatriz && restrictedPages.includes(item.href))
  );
  const filteredOutros = outrosItems.filter(
    (item) => !(isBeatriz && restrictedPages.includes(item.href))
  );

  function renderNavItem(item: { href: string; label: string; icon: React.ComponentType<{ className?: string }> }) {
    const isActive = pathname === item.href;
    return (
      <Link
        key={item.href}
        href={item.href}
        className={cn(
          "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
          isActive
            ? "bg-primary text-primary-foreground shadow-sm"
            : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        )}
      >
        <item.icon className="h-4 w-4" />
        {item.label}
      </Link>
    );
  }

  function renderMobileNavItem(item: { href: string; label: string; icon: React.ComponentType<{ className?: string }> }) {
    const isActive = pathname === item.href;
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setIsMobileMenuOpen(false)}
        className={cn(
          "flex items-center gap-3 px-4 py-3 rounded-md text-sm font-medium transition-colors border border-transparent",
          isActive
            ? "bg-primary text-primary-foreground shadow-sm"
            : "bg-secondary hover:bg-secondary/80"
        )}
      >
        <item.icon className="h-5 w-5" />
        {item.label}
      </Link>
    );
  }

  return (
    <div className="min-h-screen flex bg-background">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-64 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
        <div className="p-6 border-b border-sidebar-border flex justify-center">
          <img
            src="/logo-full.png"
            alt="NWC New Command"
            className="h-10 w-auto object-contain"
          />
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {/* Dashboard */}
          <Link
            href="/"
            className={cn(
              "flex items-center gap-3 px-4 py-2.5 rounded-md text-sm font-medium transition-colors",
              pathname === "/"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )}
          >
            <ClipboardList className="h-4 w-4" />
            Dashboard
          </Link>

          {/* Expedição section */}
          <div>
            <button
              onClick={() => setExpedicaoAberta((v) => !v)}
              className={cn(
                "w-full flex items-center justify-between px-4 py-2.5 rounded-md text-sm font-bold transition-colors",
                expedicaoHrefs.includes(pathname)
                  ? "bg-primary/10 text-primary"
                  : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground text-sidebar-foreground/80"
              )}
            >
              <div className="flex items-center gap-3">
                <Truck className="h-4 w-4" />
                Expedicao
              </div>
              {expedicaoAberta ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
            {expedicaoAberta && (
              <div className="mt-1 ml-3 pl-3 border-l-2 border-sidebar-border space-y-0.5">
                {filteredExpedicao.map(renderNavItem)}
              </div>
            )}
          </div>

          {/* Outros section */}
          <div>
            <button
              onClick={() => setOutrosAberta((v) => !v)}
              className={cn(
                "w-full flex items-center justify-between px-4 py-2.5 rounded-md text-sm font-bold transition-colors",
                outrosHrefs.includes(pathname)
                  ? "bg-primary/10 text-primary"
                  : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground text-sidebar-foreground/80"
              )}
            >
              <div className="flex items-center gap-3">
                <Boxes className="h-4 w-4" />
                Outros
              </div>
              {outrosAberta ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
            {outrosAberta && (
              <div className="mt-1 ml-3 pl-3 border-l-2 border-sidebar-border space-y-0.5">
                {filteredOutros.map(renderNavItem)}
              </div>
            )}
          </div>
        </nav>

        {/* Bottom section */}
        <div className="p-4 border-t border-sidebar-border">
          <div className="mb-3 pb-3 border-b border-sidebar-border">
            <p className="text-xs font-medium text-sidebar-foreground">
              {session.user.name}
            </p>
            <p className="text-xs text-sidebar-foreground/50">
              {(session.user as Record<string, unknown>).role === "admin"
                ? "Administrador"
                : "Funcionario"}
            </p>
          </div>

          <button
            onClick={toggleModoLivre}
            className={cn(
              "w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium transition-colors mb-2",
              modoLivre
                ? "bg-green-900/40 text-green-300 border border-green-700"
                : "bg-orange-900/40 text-orange-300 border border-orange-700"
            )}
          >
            {modoLivre ? (
              <>
                <MousePointerClick className="h-3.5 w-3.5 shrink-0" /> Modo
                Livre (Tab livre)
              </>
            ) : (
              <>
                <Lock className="h-3.5 w-3.5 shrink-0" /> Scanner ativo (Tab
                bloq.)
              </>
            )}
          </button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className="w-full justify-start text-xs text-sidebar-foreground/70 hover:text-sidebar-foreground"
          >
            <LogOut className="mr-2 h-3 w-3" />
            Sair
          </Button>

          <div className="mt-3 text-xs text-sidebar-foreground/50">
            <p>Sistema v1.0</p>
          </div>
        </div>
      </aside>

      {/* Mobile Header */}
      <MobileHeader
        isMobileMenuOpen={isMobileMenuOpen}
        onToggleMenu={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        modoLivre={modoLivre}
        onToggleModoLivre={toggleModoLivre}
      />

      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-40 bg-background pt-20 px-4 overflow-y-auto pb-8">
          <nav className="space-y-1">
            <Link
              href="/"
              onClick={() => setIsMobileMenuOpen(false)}
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-md text-sm font-medium transition-colors border border-transparent",
                pathname === "/"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-secondary hover:bg-secondary/80"
              )}
            >
              <ClipboardList className="h-5 w-5" /> Dashboard
            </Link>

            {/* Expedição mobile */}
            <div>
              <button
                onClick={() => setExpedicaoAberta((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-3 rounded-md text-sm font-bold bg-secondary hover:bg-secondary/80"
              >
                <div className="flex items-center gap-3">
                  <Truck className="h-5 w-5" /> Expedicao
                </div>
                {expedicaoAberta ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>
              {expedicaoAberta && (
                <div className="ml-4 pl-3 border-l-2 border-border mt-1 space-y-1">
                  {filteredExpedicao.map(renderMobileNavItem)}
                </div>
              )}
            </div>

            {/* Outros mobile */}
            <div>
              <button
                onClick={() => setOutrosAberta((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-3 rounded-md text-sm font-bold bg-secondary hover:bg-secondary/80"
              >
                <div className="flex items-center gap-3">
                  <Boxes className="h-5 w-5" /> Outros
                </div>
                {outrosAberta ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>
              {outrosAberta && (
                <div className="ml-4 pl-3 border-l-2 border-border mt-1 space-y-1">
                  {filteredOutros.map(renderMobileNavItem)}
                </div>
              )}
            </div>
          </nav>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 pt-20 md:pt-0 overflow-auto">
        <div className="container py-8 md:py-12 max-w-5xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
