// Dispatcher principal: dada uma entrada + contexto, retorna
// ResultadoCalculoPrazo.
//
// Sem efeito colateral. Lookup das regras é O(1) via Map.

import type { PlataformaCanal } from "@/lib/db/schema";
import {
  adicionarDiasUteis,
  ajustarParaDiaUtil,
  dataCivilSP,
} from "./dias-uteis";
import { parsePrazoExplicito } from "./parse-prazo-explicito";
import {
  chaveRegraCanal,
  type ContextoPrazo,
  type EntradaCalculoPrazo,
  type RegraPrazoSnapshot,
  type ResultadoCalculoPrazo,
} from "./types";

export function calcularPrazo(
  entrada: EntradaCalculoPrazo,
  ctx: ContextoPrazo,
): ResultadoCalculoPrazo {
  const regra = resolverRegra(
    entrada.plataforma,
    entrada.canalVendaId,
    ctx,
  );
  if (!regra) {
    return semData(
      `regra de prazo não cadastrada para ${entrada.plataforma}` +
        (entrada.canalVendaId ? ` (canal ${entrada.canalVendaId})` : ""),
    );
  }
  if (!regra.ativo) {
    return semData(`regra inativa para ${entrada.plataforma}`);
  }

  switch (regra.estrategia) {
    case "DIAS_UTEIS_POS_VENDA":
      return aplicarDiasUteis(entrada, regra, ctx);
    case "CAMPO_EXPLICITO":
      return aplicarCampoExplicito(entrada, regra, ctx);
    case "HIBRIDO":
      return aplicarHibrido(entrada, regra, ctx);
  }
}

function resolverRegra(
  plataforma: PlataformaCanal,
  canalVendaId: string | null,
  ctx: ContextoPrazo,
): RegraPrazoSnapshot | null {
  if (canalVendaId) {
    const especifica = ctx.regrasPorCanal.get(
      chaveRegraCanal(plataforma, canalVendaId),
    );
    if (especifica) return especifica;
  }
  return ctx.regrasDefaultPorPlataforma.get(plataforma) ?? null;
}

function aplicarDiasUteis(
  entrada: EntradaCalculoPrazo,
  regra: RegraPrazoSnapshot,
  ctx: ContextoPrazo,
): ResultadoCalculoPrazo {
  if (regra.diasUteis == null) {
    return semData(
      `regra ${regra.id} (${regra.estrategia}) sem diasUteis configurado`,
    );
  }
  if (!entrada.criadoEmIso) {
    return talvezHoje(
      regra,
      ctx,
      "criadoEmIso ausente; DIAS_UTEIS_POS_VENDA exige base temporal",
    );
  }
  const base = dataCivilSP(entrada.criadoEmIso);
  const prazo = adicionarDiasUteis(base, regra.diasUteis, ctx.feriadosSet);
  return {
    status: "CALCULADO",
    prazoIso: prazo,
    origem: "dias_uteis_pos_venda",
    detalhes: `base=${base} + ${regra.diasUteis} dias úteis → ${prazo}`,
  };
}

function aplicarCampoExplicito(
  entrada: EntradaCalculoPrazo,
  regra: RegraPrazoSnapshot,
  ctx: ContextoPrazo,
): ResultadoCalculoPrazo {
  if (!regra.campoPrazo) {
    return semData(`regra ${regra.id} CAMPO_EXPLICITO sem campoPrazo`);
  }
  if (!regra.regexPrazo) {
    return semData(`regra ${regra.id} CAMPO_EXPLICITO sem regexPrazo`);
  }

  const texto = entrada.camposExtras[regra.campoPrazo];
  if (!texto) {
    return talvezHoje(
      regra,
      ctx,
      `campo '${regra.campoPrazo}' ausente do pedido`,
    );
  }

  const { ano, mes } = anoMesBase(entrada.criadoEmIso, ctx.hojeIso);
  const prazoBruto = parsePrazoExplicito(texto, regra.regexPrazo, ano, mes);
  if (!prazoBruto) {
    return talvezHoje(
      regra,
      ctx,
      `regex não casou ou mês inválido em '${texto}'`,
    );
  }
  const prazo = ajustarParaDiaUtil(prazoBruto, ctx.feriadosSet);
  return {
    status: "CALCULADO",
    prazoIso: prazo,
    origem: "campo_explicito",
    detalhes: `extraído '${prazoBruto}' → ${prazo} (após ajuste útil)`,
  };
}

function aplicarHibrido(
  entrada: EntradaCalculoPrazo,
  regra: RegraPrazoSnapshot,
  ctx: ContextoPrazo,
): ResultadoCalculoPrazo {
  // 1ª tentativa: CAMPO_EXPLICITO
  if (regra.campoPrazo && regra.regexPrazo) {
    const r = aplicarCampoExplicito(entrada, regra, ctx);
    if (r.status === "CALCULADO") return r;
  }
  // 2ª tentativa: DIAS_UTEIS_POS_VENDA
  if (regra.diasUteis != null && entrada.criadoEmIso) {
    const r = aplicarDiasUteis(entrada, regra, ctx);
    if (r.status === "CALCULADO") return r;
  }
  // Falha geral: fallbackHoje ou SEM_DATA.
  return talvezHoje(
    regra,
    ctx,
    "HIBRIDO falhou em CAMPO_EXPLICITO e DIAS_UTEIS_POS_VENDA",
  );
}

function talvezHoje(
  regra: RegraPrazoSnapshot,
  ctx: ContextoPrazo,
  motivo: string,
): ResultadoCalculoPrazo {
  if (regra.fallbackHoje) {
    return {
      status: "HOJE",
      prazoIso: ctx.hojeIso,
      origem: "fallback_hoje",
      detalhes: `${motivo}; fallback HOJE`,
    };
  }
  return semData(motivo);
}

function semData(detalhes: string): ResultadoCalculoPrazo {
  return { status: "SEM_DATA", prazoIso: null, origem: null, detalhes };
}

function anoMesBase(
  criadoEmIso: string | null,
  hojeIso: string,
): { ano: number; mes: number } {
  if (criadoEmIso) {
    try {
      const civ = dataCivilSP(criadoEmIso);
      const [y, m] = civ.split("-").map(Number);
      return { ano: y, mes: m };
    } catch {
      // cai pro hojeIso
    }
  }
  const [y, m] = hojeIso.split("-").map(Number);
  return { ano: y, mes: m };
}
