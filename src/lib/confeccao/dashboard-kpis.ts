// Dashboard KPIs da OP (RITM-28). Derivação pura dos payloads das subtasks.
//
// Sem I/O, sem chamadas a banco/fetch. Todos os números vêm do que já está
// no `subtask.payload` retornado por `GET /api/confeccao/ops/[numero]`.
// Lalamoves, peças aprovadas, peças retiradas ficam pra RITM-29.

import type { SubtaskCompraPayload } from "./schemas/payloads/compra";
import type { SubtaskRiscoPayload } from "./schemas/payloads/risco";
import type { SubtaskCortePayload } from "./schemas/payloads/corte";
import type { SubtaskViesPayload } from "./schemas/payloads/vies";
import type { SubtaskCosturaPayload } from "./schemas/payloads/costura";

export type StatusSubtaskKpi =
  | "concluida"
  | "em_andamento"
  | "pendente"
  | "bloqueada"
  | "cancelada";

export interface KpisStatus {
  compra: StatusSubtaskKpi;
  risco: StatusSubtaskKpi;
  corte: StatusSubtaskKpi;
  vies: StatusSubtaskKpi | "ausente";
  costura: StatusSubtaskKpi;
  conferencia: StatusSubtaskKpi;
}

export interface KpisQuantidades {
  kgContratado: number | null;
  kgRecebido: number | null;
  diffKg: number | null;
  diffPercentual: number | null;
  rolosTotal: number | null;
  folhasTotal: number | null;
  pecasCortadas: number | null;
  pecasEnviadasCostura: number | null;
}

export interface KpisRendimento {
  aproveitamentoRiscoPercentual: number | null;
  consumoPorPecaM2: number | null;
  rendimentoEsperadoCorte: number | null;
  rendimentoInformadoCorte: number | null;
  pecasPorFolha: number | null;
}

export interface KpisFinanceiro {
  custoTecido: number | null;
  custoRisco: number | null;
  custoCorte: number | null;
  custoVies: number | null;
  custoCostura: number | null;
  custoTotal: number | null;
  custoPorPeca: number | null;
}

export interface KpisOp {
  status: KpisStatus;
  quantidades: KpisQuantidades;
  rendimento: KpisRendimento;
  financeiro: KpisFinanceiro;
}

export interface SubtaskComPayload {
  prefixo: string;
  status: StatusSubtaskKpi;
  payload: unknown;
}

const PREFIXO_COMPRA = "OPBUY";
const PREFIXO_RISCO = "OPRIS";
const PREFIXO_CORTE = "OPCOR";
const PREFIXO_VIES = "OPVIE";
const PREFIXO_COSTURA = "OPSEW";
const PREFIXO_CONFERENCIA = "OPCONF";

export function derivarKpisOp(subtasks: SubtaskComPayload[]): KpisOp {
  const compra = subtasks.find((s) => s.prefixo === PREFIXO_COMPRA);
  const risco = subtasks.find((s) => s.prefixo === PREFIXO_RISCO);
  const corte = subtasks.find((s) => s.prefixo === PREFIXO_CORTE);
  const vies = subtasks.find((s) => s.prefixo === PREFIXO_VIES);
  const costura = subtasks.find((s) => s.prefixo === PREFIXO_COSTURA);
  const conferencia = subtasks.find((s) => s.prefixo === PREFIXO_CONFERENCIA);

  const compraPayload = (compra?.payload ?? null) as SubtaskCompraPayload | null;
  const riscoPayload = (risco?.payload ?? null) as SubtaskRiscoPayload | null;
  const cortePayload = (corte?.payload ?? null) as SubtaskCortePayload | null;
  const viesPayload = (vies?.payload ?? null) as SubtaskViesPayload | null;
  const costuraPayload = (costura?.payload ?? null) as SubtaskCosturaPayload | null;

  const quantidades = derivarQuantidades(compraPayload, cortePayload, costuraPayload);
  const rendimento = derivarRendimento(riscoPayload, quantidades);
  const financeiro = derivarFinanceiro({
    compraPayload,
    riscoPayload,
    cortePayload,
    viesPayload,
    costuraPayload,
    pecasCortadas: quantidades.pecasCortadas,
  });

  return {
    status: {
      compra: compra?.status ?? "pendente",
      risco: risco?.status ?? "pendente",
      corte: corte?.status ?? "pendente",
      vies: vies ? vies.status : "ausente",
      costura: costura?.status ?? "pendente",
      conferencia: conferencia?.status ?? "pendente",
    },
    quantidades,
    rendimento,
    financeiro,
  };
}

function derivarQuantidades(
  compra: SubtaskCompraPayload | null,
  corte: SubtaskCortePayload | null,
  costura: SubtaskCosturaPayload | null,
): KpisQuantidades {
  // Compra (multi-fornecedor — agrega cross-fornecedor)
  const fornecedores = compra?.fornecedores ?? [];
  const cores = fornecedores.flatMap((f) => f.cores);
  const kgContratado = cores.length > 0
    ? cores.reduce((s, c) => s + c.kgsContratados, 0)
    : null;
  // "Recebido" = soma de pesosRolos (peso real informado pelo operador).
  // Se nenhum peso foi informado em nenhuma cor, fica null (— na UI).
  const algumPesoInformado = cores.some((c) => c.pesosRolos.length > 0);
  const kgRecebido = algumPesoInformado
    ? cores.reduce(
        (s, c) => s + c.pesosRolos.reduce((a, p) => a + p, 0),
        0,
      )
    : null;
  // "Rolos" no dashboard: total CONTRATADO (planejamento). O número real
  // recebido aparece implícito no peso (kgRecebido). Quando nada foi
  // contratado ainda, fica null.
  const temContratacao = cores.some((c) => c.qtdRolosContratados > 0);
  const rolosTotal = temContratacao
    ? cores.reduce((s, c) => s + c.qtdRolosContratados, 0)
    : null;

  const diffKg =
    kgContratado !== null && kgRecebido !== null
      ? kgRecebido - kgContratado
      : null;
  const diffPercentual =
    diffKg !== null && kgContratado !== null && kgContratado > 0
      ? diffKg / kgContratado
      : null;

  // Corte
  const oficinasCorte = corte?.oficinas ?? [];
  const folhasInformadas = oficinasCorte
    .map((o) => o.folhasEnfesto)
    .filter((f): f is number => typeof f === "number" && f > 0);
  const folhasTotal = folhasInformadas.length > 0
    ? folhasInformadas.reduce((s, f) => s + f, 0)
    : null;

  const pecasInformadas = oficinasCorte
    .map((o) => o.rendimentoTotal)
    .filter((p): p is number => typeof p === "number" && p >= 0);
  const pecasCortadas = pecasInformadas.length > 0
    ? pecasInformadas.reduce((s, p) => s + p, 0)
    : null;

  // Costura — soma das matrizes de peças enviadas
  const oficinasCostura = costura?.oficinas ?? [];
  let enviadasCostura = 0;
  let temAlgumEnvio = false;
  for (const o of oficinasCostura) {
    for (const p of o.pecasEnviadasPorTamanhoCor ?? []) {
      enviadasCostura += p.quantidade;
      temAlgumEnvio = true;
    }
  }
  const pecasEnviadasCostura = temAlgumEnvio ? enviadasCostura : null;

  return {
    kgContratado,
    kgRecebido,
    diffKg,
    diffPercentual,
    rolosTotal,
    folhasTotal,
    pecasCortadas,
    pecasEnviadasCostura,
  };
}

function derivarRendimento(
  risco: SubtaskRiscoPayload | null,
  quantidades: KpisQuantidades,
): KpisRendimento {
  const tamanhos = risco?.tamanhos ?? [];
  const pecasPorFolha = tamanhos.length > 0
    ? tamanhos.reduce((s, t) => s + t.proporcao, 0)
    : null;

  const aproveitamento = risco?.rendimentoPercentual ?? null;
  const largura = risco?.larguraCm ?? null;
  const comprimento = risco?.comprimentoM ?? null;

  // consumo (m²/peça) = (largura/100 × comprimento × aproveitamento%) / pecas/folha
  // — quando todos os 4 estão definidos.
  const consumoPorPecaM2 =
    largura !== null &&
    comprimento !== null &&
    aproveitamento !== null &&
    pecasPorFolha !== null &&
    pecasPorFolha > 0
      ? ((largura / 100) * comprimento * (aproveitamento / 100)) / pecasPorFolha
      : null;

  const rendimentoEsperadoCorte =
    quantidades.folhasTotal !== null && pecasPorFolha !== null
      ? quantidades.folhasTotal * pecasPorFolha
      : null;

  return {
    aproveitamentoRiscoPercentual: aproveitamento,
    consumoPorPecaM2,
    rendimentoEsperadoCorte,
    rendimentoInformadoCorte: quantidades.pecasCortadas,
    pecasPorFolha,
  };
}

function derivarFinanceiro(args: {
  compraPayload: SubtaskCompraPayload | null;
  riscoPayload: SubtaskRiscoPayload | null;
  cortePayload: SubtaskCortePayload | null;
  viesPayload: SubtaskViesPayload | null;
  costuraPayload: SubtaskCosturaPayload | null;
  pecasCortadas: number | null;
}): KpisFinanceiro {
  const {
    compraPayload,
    riscoPayload,
    cortePayload,
    viesPayload,
    costuraPayload,
    pecasCortadas,
  } = args;

  // Tecido: sum por cor por fornecedor de (pesos × precoPorKg).
  // Null quando nenhum peso foi informado ainda em nenhuma cor.
  const fornecedores = compraPayload?.fornecedores ?? [];
  let custoTecidoAcum = 0;
  let algumPeso = false;
  for (const f of fornecedores) {
    for (const c of f.cores) {
      const pesoCor = c.pesosRolos.reduce((s, p) => s + p, 0);
      if (pesoCor > 0) {
        custoTecidoAcum += pesoCor * c.precoPorKg;
        algumPeso = true;
      }
    }
  }
  const custoTecido = algumPeso ? custoTecidoAcum : null;

  // Risco: valor fixo do serviço
  const custoRisco = riscoPayload?.valorServico ?? null;

  // Corte: sum por oficina de (precoPorPeca × rendimentoTotal)
  const oficinasCorte = cortePayload?.oficinas ?? [];
  const linhasCorte = oficinasCorte
    .map((o) =>
      typeof o.precoPorPeca === "number" && typeof o.rendimentoTotal === "number"
        ? o.precoPorPeca * o.rendimentoTotal
        : null,
    )
    .filter((v): v is number => v !== null);
  const custoCorte = linhasCorte.length > 0
    ? linhasCorte.reduce((s, v) => s + v, 0)
    : null;

  // Viés: metragem × preço/metro
  const custoVies =
    viesPayload?.metragemProduzidaM !== undefined &&
    viesPayload?.precoPorMetro !== undefined
      ? viesPayload.metragemProduzidaM * viesPayload.precoPorMetro
      : null;

  // Costura: sum por oficina de (precoPorPeca × sum de pecasEnviadasPorTamanhoCor)
  const oficinasCostura = costuraPayload?.oficinas ?? [];
  const linhasCostura = oficinasCostura
    .map((o) => {
      if (typeof o.precoPorPeca !== "number") return null;
      const matriz = o.pecasEnviadasPorTamanhoCor ?? [];
      if (matriz.length === 0) return null;
      const totalOficina = matriz.reduce((s, m) => s + m.quantidade, 0);
      return o.precoPorPeca * totalOficina;
    })
    .filter((v): v is number => v !== null);
  const custoCostura = linhasCostura.length > 0
    ? linhasCostura.reduce((s, v) => s + v, 0)
    : null;

  const parciais = [custoTecido, custoRisco, custoCorte, custoVies, custoCostura];
  const algumNaoNulo = parciais.some((p) => p !== null);
  const custoTotal = algumNaoNulo
    ? parciais.reduce<number>((s, p) => s + (p ?? 0), 0)
    : null;

  const custoPorPeca =
    custoTotal !== null && pecasCortadas !== null && pecasCortadas > 0
      ? custoTotal / pecasCortadas
      : null;

  return {
    custoTecido,
    custoRisco,
    custoCorte,
    custoVies,
    custoCostura,
    custoTotal,
    custoPorPeca,
  };
}
