"use client";

import Link from "next/link";
import { useSession } from "@/lib/auth-client";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Package,
  Barcode,
  Truck,
  ArrowLeftRight,
  AlertTriangle,
  Tag,
  QrCode,
  Boxes,
  FileSpreadsheet,
  TrendingUp,
  Box,
  Loader2,
} from "lucide-react";

const ALL_NAV_ITEMS = [
  {
    href: "/cadastro",
    label: "Cadastrar Estoque QR",
    icon: Package,
    description: "Gerar etiquetas e QR Codes para novos fardos.",
  },
  {
    href: "/contagem",
    label: "Contagem de Estoque",
    icon: Barcode,
    description: "Realizar balanco e contagem de itens bipados.",
  },
  {
    href: "/coletas",
    label: "Bipagem de Pacotes",
    icon: Truck,
    description: "Automatizar a captura e processamento de pacotes.",
  },
  {
    href: "/alteracao-estoque",
    label: "Alteracao de Estoque",
    icon: ArrowLeftRight,
    description: "Registrar transferencias de estoque entre SKUs.",
  },
  {
    href: "/produtos-avariados",
    label: "Produtos com Avarias",
    icon: AlertTriangle,
    description: "Registrar e gerenciar produtos danificados.",
  },
  {
    href: "/associar-etiquetas",
    label: "Associar Etiquetas com SKU",
    icon: Tag,
    description: "Bipe etiquetas e associe com SKUs da planilha.",
  },
  {
    href: "/criar-qr-code",
    label: "QR Code Personalizado",
    icon: QrCode,
    description: "Gerar e imprimir QR Codes customizados.",
  },
  {
    href: "/kit-organizer",
    label: "Organizador de Etiquetas",
    icon: Boxes,
    description: "Reorganizar e otimizar PDFs de etiquetas.",
  },
  {
    href: "/processador-anuncios",
    label: "Editar Estoque ML",
    icon: FileSpreadsheet,
    description: "Processar planilhas para atualizacao de estoque.",
  },
  {
    href: "/gerenciar-skus",
    label: "Gerenciar SKUs",
    icon: Tag,
    description: "Catalogo de SKUs da conta. Cadastrar, desativar, reativar.",
  },
];

const restrictedPages = [
  "/criar-qr-code",
  "/kit-organizer",
  "/processador-anuncios",
];

export default function DashboardPage() {
  const { data: session, isPending } = useSession();

  if (isPending) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isBeatriz = session?.user.email === "beatriz@nwc.com";
  const navItems = ALL_NAV_ITEMS.filter(
    (item) => !(isBeatriz && restrictedPages.includes(item.href))
  );

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
        <p className="text-muted-foreground mt-2">
          Visao geral do sistema de gestao de estoque.
        </p>
      </div>

      {/* Menu de Paginas */}
      <Card>
        <CardHeader>
          <CardTitle>Menu de Paginas</CardTitle>
          <CardDescription>
            Acesse todas as funcionalidades do sistema
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href}>
                <Card className="hover:border-primary/50 transition-colors cursor-pointer group h-full">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <item.icon className="h-6 w-6 text-primary" />
                      <div>
                        <p className="font-semibold">{item.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.description}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Status do Sistema */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            Status do Sistema
          </CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-green-500">Operacional</div>
          <p className="text-xs text-muted-foreground mt-1">Pronto para uso</p>
        </CardContent>
      </Card>

      {/* Atividade Recente */}
      <Card>
        <CardHeader>
          <CardTitle>Atividade Recente</CardTitle>
          <CardDescription>
            Historico das ultimas operacoes realizadas no sistema.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
            <Box className="h-12 w-12 mb-4 opacity-20" />
            <p>Nenhuma atividade registrada hoje.</p>
            <p className="text-sm">
              Comece cadastrando fardos ou realizando uma contagem.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
