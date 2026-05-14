"use client";

// Alertas do dashboard (RITM-20): Lalamove com tempo alto, oficinas
// em atraso, conferências divergentes.

import Link from "next/link";
import { AlertTriangle, Clock, FileWarning, Truck } from "lucide-react";

interface AlertasPanelProps {
  lalamoveTempoAlto: Array<{
    id: string;
    ordemProducaoNumero: string;
    conteudoDescricao: string | null;
    minutosAguardando: number;
  }>;
  oficinasEmAtraso: Array<{
    opNumero: string;
    prefixo: string;
    oficinaId: string;
    prazoProducao: string;
    diasAtraso: number;
  }>;
  conferenciasDivergentes: Array<{
    id: string;
    numero: string;
    opNumero: string;
    oficinaResponsavelNome: string | null;
  }>;
}

export function AlertasPanel(props: AlertasPanelProps) {
  const totais =
    props.lalamoveTempoAlto.length +
    props.oficinasEmAtraso.length +
    props.conferenciasDivergentes.length;

  return (
    <div className="space-y-3">
      <h2 className="text-base font-medium flex items-center gap-2">
        <AlertTriangle className="size-4 text-amber-500" />
        Alertas ({totais})
      </h2>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Bloco
          titulo="Lalamove com tempo alto"
          icon={<Truck className="size-4 text-amber-500" />}
          vazio="Nenhum Lalamove esperando há mais de 30min."
          items={props.lalamoveTempoAlto.map((l) => ({
            key: l.id,
            primary: l.ordemProducaoNumero,
            secondary:
              l.conteudoDescricao ?? "—",
            badge: `${l.minutosAguardando}min`,
            href: `/confeccao/ops/${encodeURIComponent(l.ordemProducaoNumero)}`,
          }))}
        />
        <Bloco
          titulo="Oficinas em atraso"
          icon={<Clock className="size-4 text-destructive" />}
          vazio="Nenhum prazo de oficina vencido."
          items={props.oficinasEmAtraso.map((o) => ({
            key: `${o.opNumero}-${o.oficinaId}`,
            primary: o.opNumero,
            secondary: `${o.prefixo} • prazo: ${new Date(o.prazoProducao).toLocaleString("pt-BR")}`,
            badge: `${o.diasAtraso}d`,
            href: `/confeccao/ops/${encodeURIComponent(o.opNumero)}`,
          }))}
        />
        <Bloco
          titulo="Conferências divergentes"
          icon={<FileWarning className="size-4 text-amber-500" />}
          vazio="Nenhuma divergência confirmada pendente."
          items={props.conferenciasDivergentes.map((c) => ({
            key: c.id,
            primary: c.numero,
            secondary: c.oficinaResponsavelNome
              ? `Responsável: ${c.oficinaResponsavelNome}`
              : `OP ${c.opNumero}`,
            badge: null,
            href: `/confeccao/ops/${encodeURIComponent(c.opNumero)}`,
          }))}
        />
      </div>
    </div>
  );
}

function Bloco({
  titulo,
  icon,
  vazio,
  items,
}: {
  titulo: string;
  icon: React.ReactNode;
  vazio: string;
  items: Array<{
    key: string;
    primary: string;
    secondary: string;
    badge: string | null;
    href: string;
  }>;
}) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        {icon}
        <span>{titulo}</span>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {items.length}
        </span>
      </div>
      <div className="mt-2 space-y-1">
        {items.length === 0 && (
          <div className="text-xs text-muted-foreground">{vazio}</div>
        )}
        {items.map((i) => (
          <Link
            key={i.key}
            href={i.href}
            className="block rounded px-2 py-1.5 hover:bg-muted/50"
          >
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="font-medium">{i.primary}</span>
              {i.badge && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs tabular-nums">
                  {i.badge}
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground truncate">
              {i.secondary}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
