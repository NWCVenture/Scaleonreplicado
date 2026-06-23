// Schema do payload JSONB da subtask OPCOR (Corte — RITM-10).
//
// Suporta múltiplas oficinas em paralelo (cada oficina recebe um subset
// dos rolos da Compra). Para cada oficina:
//  - Config (pré-corte): rolos enviados por cor, modo de separação
//  - Resultado (pós-corte): folhas do enfesto, rendimento por tamanho×cor,
//    rolos descartados, preço/peça
//
// Saldo bloqueante: a soma de rolos enviados (todas as oficinas) por cor
// não pode exceder o número de rolos comprados daquela cor (OPBUY.pos.rolosRecebidos).
//
// Imutabilidade: o rendimento informado é DADO SÓLIDO após conclusão —
// nunca alterado mesmo se a Conferência revelar divergência.

import { z } from "zod";
import { TamanhoGradeRiscoSchema } from "./risco";
import type { SubtaskCompraPayload } from "./compra";

export const ModoSeparacaoCorteSchema = z.enum(["por_cor", "sem_separacao"]);
export type ModoSeparacaoCorte = z.infer<typeof ModoSeparacaoCorteSchema>;

// Rendimento por tamanho × cor de uma oficina:
// [{ tamanho: "M", corId: "co1", quantidade: 100 }, ...]
export const RendimentoTamanhoCorSchema = z.object({
  tamanho: TamanhoGradeRiscoSchema,
  corId: z.string().min(1),
  quantidade: z.number().int().nonnegative(),
});

export const RoloDescartadoSchema = z.object({
  corId: z.string().min(1),
  qtdRolos: z.number().int().positive(),
  justificativa: z.string().min(1).max(500),
});

// RITM-34: rolo físico recebido pelo cortador. Sem ID — matching com o
// rolo do fornecedor é feito por rank de peso dentro de (cor, oficina).
export const RoloRecebidoSchema = z.object({
  corId: z.string().min(1),
  pesoCortador: z.number().positive().finite(),
  folhasRendidas: z.number().int().nonnegative(),
});
export type RoloRecebido = z.infer<typeof RoloRecebidoSchema>;

export const OficinaCorteSchema = z.object({
  oficinaId: z.string().min(1),
  modoSeparacao: ModoSeparacaoCorteSchema,
  // Mapa corId → qtd de rolos enviados a esta oficina.
  rolosEnviadosPorCor: z.record(
    z.string(),
    z.number().int().nonnegative(),
  ),
  // RITM-34: 1 entry por rolo físico recebido. Lista pode ser parcial
  // enquanto subtask está em andamento; na conclusão exige count match
  // por cor (refinement em ConcluirSubtaskCorteSchema).
  rolosRecebidos: z.array(RoloRecebidoSchema).optional(),
  // Pós-corte (opcional enquanto subtask está em andamento)
  folhasEnfesto: z.number().int().positive().optional(),
  rendimentoTotal: z.number().int().nonnegative().optional(),
  rendimentoPorTamanhoCor: z.array(RendimentoTamanhoCorSchema).optional(),
  rolosDescartados: z.array(RoloDescartadoSchema).optional(),
  precoPorPeca: z.number().nonnegative().finite().optional(),
  observacoes: z.string().max(2000).optional(),
});
export type OficinaCorte = z.infer<typeof OficinaCorteSchema>;

export const SubtaskCortePayloadSchema = z.object({
  oficinas: z.array(OficinaCorteSchema).optional(),
});
export type SubtaskCortePayload = z.infer<typeof SubtaskCortePayloadSchema>;

/**
 * Schema completo pra conclusão. Cada oficina precisa ter:
 *  - oficinaId, modoSeparacao, rolosEnviadosPorCor (≥ 1 entry > 0)
 *  - folhasEnfesto, rendimentoTotal, rendimentoPorTamanhoCor (≥ 1 entry),
 *    precoPorPeca
 *
 * Sem validação de duplicatas no array oficinas; o caller deve garantir
 * (em geral via UI). Saldo é validado separadamente via validarSaldoRolos.
 */
export const ConcluirSubtaskCorteSchema = z
  .object({
    oficinas: z
      .array(
        OficinaCorteSchema.extend({
          // Tudo obrigatório na conclusão
          folhasEnfesto: z.number().int().positive(),
          rendimentoTotal: z.number().int().nonnegative(),
          rendimentoPorTamanhoCor: z.array(RendimentoTamanhoCorSchema).min(1),
          precoPorPeca: z.number().nonnegative().finite(),
        }),
      )
      .min(1),
  })
  .superRefine((data, ctx) => {
    // Sem oficinas duplicadas
    const ids = data.oficinas.map((o) => o.oficinaId);
    const dup = ids.find((id, idx) => ids.indexOf(id) !== idx);
    if (dup) {
      ctx.addIssue({
        code: "custom",
        path: ["oficinas"],
        message: `Oficina "${dup}" aparece duplicada — uma oficina só pode receber rolos uma vez por subtask`,
      });
    }
    // Cada oficina: ao menos 1 cor com rolos enviados > 0
    for (let i = 0; i < data.oficinas.length; i++) {
      const o = data.oficinas[i];
      const totalRolos = Object.values(o.rolosEnviadosPorCor).reduce(
        (s, n) => s + n,
        0,
      );
      if (totalRolos === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["oficinas", i, "rolosEnviadosPorCor"],
          message:
            "Oficina precisa receber ao menos 1 rolo (de qualquer cor)",
        });
      }
    }
    // RITM-34: rolosRecebidos coerentes com rolosEnviadosPorCor por cor.
    for (let i = 0; i < data.oficinas.length; i++) {
      const o = data.oficinas[i];
      const recebidos = o.rolosRecebidos ?? [];
      // (a) Nenhum corId em recebidos fora das chaves de enviadosPorCor
      const coresEnviadas = new Set(
        Object.entries(o.rolosEnviadosPorCor)
          .filter(([, n]) => n > 0)
          .map(([cor]) => cor),
      );
      for (let r = 0; r < recebidos.length; r++) {
        if (!coresEnviadas.has(recebidos[r].corId)) {
          ctx.addIssue({
            code: "custom",
            path: ["oficinas", i, "rolosRecebidos", r, "corId"],
            message: `Oficina ${o.oficinaId} · cor "${recebidos[r].corId}": cortador informou rolo de cor que não foi enviada pra essa oficina`,
          });
        }
      }
      // (b) Count por cor: rolosRecebidos.filter(corId).length === enviados[cor]
      const recebidosPorCor = new Map<string, number>();
      for (const r of recebidos) {
        recebidosPorCor.set(
          r.corId,
          (recebidosPorCor.get(r.corId) ?? 0) + 1,
        );
      }
      for (const [corId, enviados] of Object.entries(o.rolosEnviadosPorCor)) {
        if (enviados <= 0) continue;
        const recebidos = recebidosPorCor.get(corId) ?? 0;
        if (recebidos !== enviados) {
          const diff = enviados - recebidos;
          ctx.addIssue({
            code: "custom",
            path: ["oficinas", i, "rolosRecebidos"],
            message:
              diff > 0
                ? `Oficina ${o.oficinaId} · ${corId}: faltam ${diff} rolo(s) no informe do cortador (esperado ${enviados}, informado ${recebidos})`
                : `Oficina ${o.oficinaId} · ${corId}: cortador informou ${-diff} rolo(s) a mais que o enviado (esperado ${enviados}, informado ${recebidos})`,
          });
        }
      }
    }
  });

/**
 * Valida saldo de rolos: soma de rolos enviados por cor (todas as
 * oficinas) ≤ rolos comprados daquela cor (OPBUY.pos.rolosRecebidos).
 *
 * Retorna ok ou erro com a primeira cor que excedeu.
 */
export function validarSaldoRolos(
  oficinas: OficinaCorte[],
  rolosCompradosPorCor: Map<string, number>,
): { ok: true } | { ok: false; mensagem: string } {
  const enviadosPorCor = new Map<string, number>();
  for (const o of oficinas) {
    for (const [corId, qtd] of Object.entries(o.rolosEnviadosPorCor)) {
      enviadosPorCor.set(corId, (enviadosPorCor.get(corId) ?? 0) + qtd);
    }
  }
  for (const [corId, enviados] of enviadosPorCor.entries()) {
    const disponivel = rolosCompradosPorCor.get(corId) ?? 0;
    if (enviados > disponivel) {
      return {
        ok: false,
        mensagem: `Cor ${corId}: enviados ${enviados} rolos, mas só ${disponivel} foram comprados na Compra`,
      };
    }
  }
  return { ok: true };
}

/**
 * Helper pra montar o Map de rolos comprados por cor a partir do payload
 * da subtask Compra (OPBUY). Multi-fornecedor: agrega cross-fornecedor.
 * Usa quantidade de pesos efetivamente informados (disponibilidade real).
 */
export function rolosCompradosPorCorDeCompra(
  compraPayload: SubtaskCompraPayload | null | undefined,
): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const f of compraPayload?.fornecedores ?? []) {
    for (const c of f.cores) {
      mapa.set(c.corId, (mapa.get(c.corId) ?? 0) + c.pesosRolos.length);
    }
  }
  return mapa;
}
