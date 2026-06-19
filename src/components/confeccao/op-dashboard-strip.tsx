"use client";

// Strip de KPIs ao vivo abaixo do OPHeader (RITM-28).
//
// Equivalente da "Página inicial" do OP TEMPLATE.xlsm — status das 6
// subtasks + quantidades + rendimento + financeiro derivados em tempo
// real dos payloads carregados pela página da OP. Sem fetch extra, sem
// cálculo no banco.
//
// Cada célula renderiza "—" (cinza) quando a subtask de origem ainda não
// foi preenchida — feedback visual imediato do que falta sem expandir o
// stepper.

import { Check, Circle, CircleDashed, Loader2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  KpisFinanceiro,
  KpisOp,
  KpisQuantidades,
  KpisRendimento,
  KpisStatus,
  StatusSubtaskKpi,
} from "@/lib/confeccao/dashboard-kpis";

interface Props {
  kpis: KpisOp;
  temVies: boolean;
}

// ──────────────────────────────────────────────────────────────────────
// Formatters
// ──────────────────────────────────────────────────────────────────────

const fmtBR = new Intl.NumberFormat("pt-BR");
const fmtBRdec = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const fmtBRdec2 = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const fmtBRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const fmtPct = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const fmtPctInt = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

function nbr(v: number | null, formatter: Intl.NumberFormat = fmtBR) {
  if (v === null || !Number.isFinite(v)) return "—";
  return formatter.format(v);
}

function nbrl(v: number | null) {
  if (v === null || !Number.isFinite(v)) return "—";
  return fmtBRL.format(v);
}

// ──────────────────────────────────────────────────────────────────────
// Status chips
// ──────────────────────────────────────────────────────────────────────

const STATUS_ICONS: Record<
  StatusSubtaskKpi | "ausente",
  { Icon: typeof Check; classNameIcon: string; classNameChip: string; label: string }
> = {
  concluida: {
    Icon: Check,
    classNameIcon: "text-emerald-600",
    classNameChip: "border-emerald-300 bg-emerald-50 text-emerald-900",
    label: "Concluída",
  },
  em_andamento: {
    Icon: Loader2,
    classNameIcon: "text-blue-600",
    classNameChip: "border-blue-300 bg-blue-50 text-blue-900",
    label: "Em andamento",
  },
  pendente: {
    Icon: Circle,
    classNameIcon: "text-muted-foreground",
    classNameChip: "border-border bg-muted/30 text-muted-foreground",
    label: "Pendente",
  },
  bloqueada: {
    Icon: CircleDashed,
    classNameIcon: "text-muted-foreground/60",
    classNameChip: "border-dashed border-border bg-muted/10 text-muted-foreground/60",
    label: "Bloqueada",
  },
  cancelada: {
    Icon: XCircle,
    classNameIcon: "text-destructive",
    classNameChip: "border-destructive/40 bg-destructive/5 text-destructive",
    label: "Cancelada",
  },
  ausente: {
    Icon: CircleDashed,
    classNameIcon: "text-muted-foreground/40",
    classNameChip: "border-dashed border-border bg-transparent text-muted-foreground/60 opacity-60",
    label: "N/A",
  },
};

function StatusChip({
  rotulo,
  status,
}: {
  rotulo: string;
  status: StatusSubtaskKpi | "ausente";
}) {
  const cfg = STATUS_ICONS[status];
  const isLoader = status === "em_andamento";
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs",
        cfg.classNameChip,
      )}
      title={`${rotulo}: ${cfg.label}`}
    >
      <cfg.Icon
        className={cn(
          "h-3 w-3",
          cfg.classNameIcon,
          isLoader && "animate-spin",
        )}
      />
      <span className="font-medium">{rotulo}</span>
    </div>
  );
}

function StatusRow({
  status,
  temVies,
}: {
  status: KpisStatus;
  temVies: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <StatusChip rotulo="Compra" status={status.compra} />
      <StatusChip rotulo="Risco" status={status.risco} />
      <StatusChip rotulo="Corte" status={status.corte} />
      {temVies && <StatusChip rotulo="Viés" status={status.vies} />}
      <StatusChip rotulo="Costura" status={status.costura} />
      <StatusChip rotulo="Conferência" status={status.conferencia} />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// KPI cells
// ──────────────────────────────────────────────────────────────────────

function KpiCell({
  label,
  value,
  hint,
  tone = "default",
  emphasis = false,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "warn" | "danger" | "ok";
  emphasis?: boolean;
}) {
  const isPlaceholder = value === "—";
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "text-sm tabular-nums",
          isPlaceholder && "text-muted-foreground/60",
          emphasis && "font-semibold bg-amber-50 px-1.5 rounded text-amber-950 border border-amber-200",
          !emphasis && tone === "warn" && "text-amber-700 font-medium",
          !emphasis && tone === "danger" && "text-destructive font-medium",
          !emphasis && tone === "ok" && "text-emerald-700",
        )}
        title={hint}
      >
        {value}
      </span>
    </div>
  );
}

function diffTone(
  diffPercentual: number | null,
): "default" | "warn" | "danger" {
  if (diffPercentual === null) return "default";
  if (diffPercentual < -0.05) return "danger"; // recebeu >5% a menos que contratou
  if (Math.abs(diffPercentual) > 0.05) return "warn";
  return "default";
}

function QuantidadesCol({ q }: { q: KpisQuantidades }) {
  return (
    <div className="space-y-0">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/80 font-semibold mb-1">
        Quantidades
      </div>
      <KpiCell label="Kg contratado" value={`${nbr(q.kgContratado, fmtBRdec)} kg`} />
      <KpiCell label="Kg recebido" value={`${nbr(q.kgRecebido, fmtBRdec)} kg`} />
      <KpiCell
        label="Diferença"
        value={
          q.diffKg === null
            ? "—"
            : `${q.diffKg > 0 ? "+" : ""}${fmtBRdec.format(q.diffKg)} kg${
                q.diffPercentual === null
                  ? ""
                  : ` (${q.diffPercentual >= 0 ? "+" : ""}${fmtPct.format(q.diffPercentual)})`
              }`
        }
        tone={diffTone(q.diffPercentual)}
      />
      <KpiCell label="Rolos" value={nbr(q.rolosTotal)} />
      <KpiCell label="Folhas" value={nbr(q.folhasTotal)} />
      <KpiCell label="Peças cortadas" value={nbr(q.pecasCortadas)} />
      <KpiCell
        label="Peças → costura"
        value={nbr(q.pecasEnviadasCostura)}
      />
    </div>
  );
}

function RendimentoCol({ r }: { r: KpisRendimento }) {
  const divergenciaCorte =
    r.rendimentoEsperadoCorte !== null &&
    r.rendimentoInformadoCorte !== null &&
    r.rendimentoEsperadoCorte > 0
      ? r.rendimentoInformadoCorte / r.rendimentoEsperadoCorte - 1
      : null;
  const divergenciaTone =
    divergenciaCorte === null
      ? "default"
      : Math.abs(divergenciaCorte) > 0.05
        ? "warn"
        : "ok";
  return (
    <div className="space-y-0">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/80 font-semibold mb-1">
        Rendimento
      </div>
      <KpiCell
        label="Aprov. risco"
        value={
          r.aproveitamentoRiscoPercentual === null
            ? "—"
            : fmtPctInt.format(r.aproveitamentoRiscoPercentual / 100)
        }
      />
      <KpiCell
        label="Consumo / peça"
        value={
          r.consumoPorPecaM2 === null
            ? "—"
            : `${fmtBRdec2.format(r.consumoPorPecaM2)} m²`
        }
      />
      <KpiCell label="Peças / folha" value={nbr(r.pecasPorFolha)} />
      <KpiCell label="Rend. esperado" value={nbr(r.rendimentoEsperadoCorte)} />
      <KpiCell
        label="Rend. informado"
        value={nbr(r.rendimentoInformadoCorte)}
        tone={divergenciaTone}
        hint={
          divergenciaCorte === null
            ? undefined
            : `Divergência vs esperado: ${divergenciaCorte > 0 ? "+" : ""}${fmtPct.format(divergenciaCorte)}`
        }
      />
    </div>
  );
}

function FinanceiroCol({ f }: { f: KpisFinanceiro }) {
  return (
    <div className="space-y-0">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/80 font-semibold mb-1">
        Financeiro
      </div>
      <KpiCell label="Tecido" value={nbrl(f.custoTecido)} />
      <KpiCell label="Risco" value={nbrl(f.custoRisco)} />
      <KpiCell label="Corte" value={nbrl(f.custoCorte)} />
      <KpiCell label="Viés" value={nbrl(f.custoVies)} />
      <KpiCell label="Costura" value={nbrl(f.custoCostura)} />
      <KpiCell label="Custo total" value={nbrl(f.custoTotal)} emphasis />
      <KpiCell label="Custo / peça" value={nbrl(f.custoPorPeca)} />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Componente principal
// ──────────────────────────────────────────────────────────────────────

export function OpDashboardStrip({ kpis, temVies }: Props) {
  return (
    <div className="rounded border bg-card">
      <div className="px-4 py-3 border-b">
        <StatusRow status={kpis.status} temVies={temVies} />
        <p className="text-[10px] text-muted-foreground/70 mt-1.5">
          Indicadores derivados ao vivo dos payloads das subtasks. Lalamoves
          e peças aprovadas não somam ainda (próxima entrega).
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-2 px-4 py-3">
        <QuantidadesCol q={kpis.quantidades} />
        <RendimentoCol r={kpis.rendimento} />
        <FinanceiroCol f={kpis.financeiro} />
      </div>
    </div>
  );
}
