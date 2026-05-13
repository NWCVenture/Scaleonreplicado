// Schema do payload JSONB da subtask OPBUY (Compra de Tecido — RITM-08).
//
// Divisão lógica:
//  - pre: campos preenchidos ANTES da compra (fornecedor, tipo, cores, KGs solicitados)
//  - pos: campos preenchidos APÓS receber o tecido (rolos, pesos, preço efetivo, etc)
//
// `pos` é obrigatório para concluir a subtask. `pre` é obrigatório para
// passar de `pendente` para `em_andamento`.

import { z } from "zod";

export const SubtaskCompraCorSolicitadaSchema = z.object({
  corId: z.string().min(1),
  kgsSolicitados: z.number().positive().finite(),
});

export const SubtaskCompraRoloRecebidoSchema = z.object({
  corId: z.string().min(1),
  // Lista de pesos individuais (kg) — um item por rolo daquela cor.
  // O total de rolos pra cor = pesos.length.
  pesos: z.array(z.number().positive().finite()).min(1),
});

export const SubtaskCompraPreSchema = z.object({
  fornecedorId: z.string().min(1),
  tipoTecidoId: z.string().min(1),
  destinatarioCorteId: z.string().min(1),
  cores: z.array(SubtaskCompraCorSolicitadaSchema).min(1),
  observacoesPedido: z.string().max(2000).optional(),
});
export type SubtaskCompraPre = z.infer<typeof SubtaskCompraPreSchema>;

export const SubtaskCompraPosSchema = z.object({
  rolosRecebidos: z.array(SubtaskCompraRoloRecebidoSchema).min(1),
  precoKgEfetivo: z.number().positive().finite(),
  gramaturaGM2: z.number().positive().finite(),
  larguraRoloCm: z.number().positive().finite().max(500),
  observacoesPos: z.string().max(2000).optional(),
});
export type SubtaskCompraPos = z.infer<typeof SubtaskCompraPosSchema>;

// Payload completo — pre é sempre presente; pos só é preenchido após a chegada
export const SubtaskCompraPayloadSchema = z.object({
  pre: SubtaskCompraPreSchema.optional(),
  pos: SubtaskCompraPosSchema.optional(),
});
export type SubtaskCompraPayload = z.infer<typeof SubtaskCompraPayloadSchema>;

/**
 * Calcula peso total recebido (soma de todos os pesos de rolos de todas as cores).
 */
export function calcularPesoTotal(pos: SubtaskCompraPos): number {
  return pos.rolosRecebidos.reduce(
    (total, r) => total + r.pesos.reduce((s, p) => s + p, 0),
    0,
  );
}

/**
 * Calcula custo total da compra (peso × preço).
 */
export function calcularCustoTotal(pos: SubtaskCompraPos): number {
  return calcularPesoTotal(pos) * pos.precoKgEfetivo;
}

/**
 * Schema completo para conclusão da subtask — ambos pre e pos obrigatórios,
 * com validação cruzada de que toda cor de `pos` aparece em `pre`.
 */
export const ConcluirSubtaskCompraSchema = z
  .object({
    pre: SubtaskCompraPreSchema,
    pos: SubtaskCompraPosSchema,
  })
  .refine(
    ({ pre, pos }) => {
      const coresPre = new Set(pre.cores.map((c) => c.corId));
      return pos.rolosRecebidos.every((r) => coresPre.has(r.corId));
    },
    {
      message:
        "Cada cor em rolosRecebidos deve estar em pre.cores (não receba uma cor que não foi solicitada)",
    },
  );
