// Cálculo de custos da OP (RITM-19).
//
// Função pura — recebe payloads + listas e retorna breakdown completo.
// Tolerante a payloads vazios/parciais (OP em andamento): retorna
// componente como 0 quando os dados ainda não foram preenchidos.

import type { SubtaskCompraPayload } from "./schemas/payloads/compra";
import type { SubtaskRiscoPayload } from "./schemas/payloads/risco";
import type { SubtaskCortePayload } from "./schemas/payloads/corte";
import type { SubtaskViesPayload } from "./schemas/payloads/vies";
import type { SubtaskCosturaPayload } from "./schemas/payloads/costura";

export interface LalamoveItemParaCusto {
  tipo: "principal" | "outros";
  valor: number | null;
  canceladaEm: Date | string | null;
}

export interface SubconferenciaItemParaCusto {
  status: "em_andamento" | "concluida";
  aprovadas: Record<string, Record<string, number>> | null;
}

export interface CalcularCustosInput {
  temVies: boolean;
  compra?: SubtaskCompraPayload | null;
  risco?: SubtaskRiscoPayload | null;
  corte?: SubtaskCortePayload | null;
  vies?: SubtaskViesPayload | null;
  costura?: SubtaskCosturaPayload | null;
  lalamoves: LalamoveItemParaCusto[];
  subconferencias: SubconferenciaItemParaCusto[];
}

export interface CustosResult {
  tecido: number;
  risco: number;
  corte: number;
  vies: number;
  costura: number;
  lalamovesPrincipais: number;
  lalamovesOutros: number;
  lalamovesTotal: number;
  custoTotal: number;
  pecasProduzidas: number;
  pecasAprovadas: number;
  custoPorPecaProduzida: number | null;
  custoPorPecaAprovada: number | null;
  perdas: number;
}

function arred(n: number): number {
  // Centavos — evita lixo de ponto flutuante
  return Math.round(n * 100) / 100;
}

function somaMatriz(
  matriz: Record<string, Record<string, number>> | null | undefined,
): number {
  if (!matriz) return 0;
  let total = 0;
  for (const linha of Object.values(matriz)) {
    for (const v of Object.values(linha)) total += v;
  }
  return total;
}

export function calcularCustosOP(input: CalcularCustosInput): CustosResult {
  // === Tecido ===
  let tecido = 0;
  const precoKg = input.compra?.pos?.precoKgEfetivo;
  if (precoKg !== undefined && precoKg !== null) {
    const pesoTotal = (input.compra?.pos?.rolosRecebidos ?? []).reduce(
      (s, r) => s + r.pesos.reduce((s2, p) => s2 + p, 0),
      0,
    );
    tecido = pesoTotal * precoKg;
  }

  // === Risco === (valor único do payload)
  const risco = input.risco?.valorServico ?? 0;

  // === Corte === (Σ oficina: preço × peças cortadas)
  let corte = 0;
  for (const o of input.corte?.oficinas ?? []) {
    const preco = o.precoPorPeca;
    if (preco === undefined || preco === null) continue;
    const pecas = (o.rendimentoPorTamanhoCor ?? []).reduce(
      (s, r) => s + r.quantidade,
      0,
    );
    corte += preco * pecas;
  }

  // === Viés === (somente se temVies)
  let vies = 0;
  if (input.temVies && input.vies) {
    const preco = input.vies.precoPorMetro;
    const metragem = input.vies.metragemProduzidaM;
    if (preco !== undefined && metragem !== undefined) {
      vies = preco * metragem;
    }
  }

  // === Costura === (Σ oficina: preço × peças enviadas)
  let costura = 0;
  let pecasProduzidas = 0;
  for (const o of input.costura?.oficinas ?? []) {
    const totalPecas = (o.pecasEnviadasPorTamanhoCor ?? []).reduce(
      (s, p) => s + p.quantidade,
      0,
    );
    pecasProduzidas += totalPecas;
    const preco = o.precoPorPeca;
    if (preco !== undefined && preco !== null) {
      costura += preco * totalPecas;
    }
  }

  // === Lalamoves === (separados por tipo, cancelados descartados)
  let lalamovesPrincipais = 0;
  let lalamovesOutros = 0;
  for (const l of input.lalamoves) {
    if (l.canceladaEm) continue;
    if (l.valor === null || l.valor === undefined) continue;
    if (l.tipo === "principal") lalamovesPrincipais += l.valor;
    else lalamovesOutros += l.valor;
  }
  const lalamovesTotal = lalamovesPrincipais + lalamovesOutros;

  // === Total e indicadores ===
  const custoTotal = tecido + risco + corte + vies + costura + lalamovesTotal;

  let pecasAprovadas = 0;
  for (const sc of input.subconferencias) {
    if (sc.status !== "concluida") continue;
    pecasAprovadas += somaMatriz(sc.aprovadas);
  }

  const custoPorPecaProduzida =
    pecasProduzidas > 0 ? custoTotal / pecasProduzidas : null;
  const custoPorPecaAprovada =
    pecasAprovadas > 0 ? custoTotal / pecasAprovadas : null;

  // === Perdas (rolos descartados em OPCOR) ===
  // Custo de cada rolo descartado = kgMedioPorRolo(daquela cor) × precoKg
  let perdas = 0;
  if (precoKg !== undefined && precoKg !== null && input.corte) {
    // kg médio por rolo por cor — baseado em OPBUY.pos.rolosRecebidos
    const kgMedioPorCor = new Map<string, number>();
    for (const r of input.compra?.pos?.rolosRecebidos ?? []) {
      if (r.pesos.length === 0) continue;
      const media = r.pesos.reduce((s, p) => s + p, 0) / r.pesos.length;
      // Se a cor já existir (caso de múltiplos blocos da mesma cor),
      // tira média ponderada simples
      const anterior = kgMedioPorCor.get(r.corId);
      kgMedioPorCor.set(
        r.corId,
        anterior === undefined ? media : (anterior + media) / 2,
      );
    }
    for (const o of input.corte.oficinas ?? []) {
      for (const d of o.rolosDescartados ?? []) {
        const kgMedio = kgMedioPorCor.get(d.corId) ?? 0;
        perdas += kgMedio * precoKg * d.qtdRolos;
      }
    }
  }

  return {
    tecido: arred(tecido),
    risco: arred(risco),
    corte: arred(corte),
    vies: arred(vies),
    costura: arred(costura),
    lalamovesPrincipais: arred(lalamovesPrincipais),
    lalamovesOutros: arred(lalamovesOutros),
    lalamovesTotal: arred(lalamovesTotal),
    custoTotal: arred(custoTotal),
    pecasProduzidas,
    pecasAprovadas,
    custoPorPecaProduzida:
      custoPorPecaProduzida === null ? null : arred(custoPorPecaProduzida),
    custoPorPecaAprovada:
      custoPorPecaAprovada === null ? null : arred(custoPorPecaAprovada),
    perdas: arred(perdas),
  };
}
