// Sincronizador one-way Compra → Corte (RITM-33).
//
// O plano de distribuição (oficinas + rolos por cor) vive na Compra; o
// Corte só executa. Esta função projeta o plano da Compra dentro do
// payload do Corte preservando os dados pós-corte por oficinaId.
//
// Quando a edição retroativa da Compra REMOVE uma oficina que já tinha
// resultado pós-corte preenchido, sinalizamos `perda` — caller decide
// se aceita (rejeitar 422 no PATCH /payload) ou força (override admin).

import type { SubtaskCompraPayload } from "./schemas/payloads/compra";
import type {
  OficinaCorte,
  SubtaskCortePayload,
} from "./schemas/payloads/corte";

export interface PerdaOficina {
  oficinaId: string;
  /** Lista de campos pós-corte que ficariam órfãos. */
  campos: string[];
}

export type SincronizarResult =
  | { ok: true; payload: SubtaskCortePayload }
  | { ok: false; perdas: PerdaOficina[] };

/** Campos pós-corte que disparam alerta de "perda de dado" quando a
 *  oficina é removida da distribuição da Compra. */
function camposPosCortePreenchidos(o: OficinaCorte): string[] {
  const out: string[] = [];
  if (o.folhasEnfesto !== undefined) out.push("folhasEnfesto");
  if (o.rendimentoTotal !== undefined) out.push("rendimentoTotal");
  if (
    o.rendimentoPorTamanhoCor !== undefined &&
    o.rendimentoPorTamanhoCor.length > 0
  )
    out.push("rendimentoPorTamanhoCor");
  if (o.rolosDescartados !== undefined && o.rolosDescartados.length > 0)
    out.push("rolosDescartados");
  if (o.precoPorPeca !== undefined) out.push("precoPorPeca");
  return out;
}

export function sincronizarCorteComCompra(
  compraPayload: SubtaskCompraPayload | null | undefined,
  cortePayloadAtual: SubtaskCortePayload | null | undefined,
): SincronizarResult {
  const distribuicao = compraPayload?.distribuicaoOficinas ?? [];
  const oficinasAtuais = cortePayloadAtual?.oficinas ?? [];

  // Sem plano na Compra → não sincroniza (Corte fica legado, editável manual).
  if (distribuicao.length === 0) {
    return { ok: true, payload: cortePayloadAtual ?? { oficinas: [] } };
  }

  const idsNovos = new Set(distribuicao.map((d) => d.oficinaId));
  const idsAtuais = new Map(oficinasAtuais.map((o) => [o.oficinaId, o]));

  // Perda: oficina presente no Corte mas removida da Compra, com pós-corte.
  const perdas: PerdaOficina[] = [];
  for (const o of oficinasAtuais) {
    if (!idsNovos.has(o.oficinaId)) {
      const campos = camposPosCortePreenchidos(o);
      if (campos.length > 0) {
        perdas.push({ oficinaId: o.oficinaId, campos });
      }
    }
  }
  if (perdas.length > 0) {
    return { ok: false, perdas };
  }

  // Monta novas oficinas: pega rolosEnviadosPorCor do plano da Compra,
  // preserva o resto do que já existia.
  const oficinas: OficinaCorte[] = distribuicao.map((d) => {
    const existente = idsAtuais.get(d.oficinaId);
    return {
      oficinaId: d.oficinaId,
      modoSeparacao: existente?.modoSeparacao ?? "por_cor",
      rolosEnviadosPorCor: { ...d.rolosPorCor },
      folhasEnfesto: existente?.folhasEnfesto,
      rendimentoTotal: existente?.rendimentoTotal,
      rendimentoPorTamanhoCor: existente?.rendimentoPorTamanhoCor,
      rolosDescartados: existente?.rolosDescartados,
      precoPorPeca: existente?.precoPorPeca,
      observacoes: existente?.observacoes,
    };
  });

  return { ok: true, payload: { oficinas } };
}
