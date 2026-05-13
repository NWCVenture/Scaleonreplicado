// Schema do payload JSONB da subtask OPVIE (Viés — RITM-11).
//
// Subtask CONDICIONAL — só existe se tem_vies=true na OP. Posicionada
// entre Corte e Costura.
//
// "Viés" no contexto têxtil = acabamento de gola/braço. Bandeira de
// tecido é cortada com sobra de mesa, enviada pra fábrica de viés que
// produz a tira de viés e devolve para a Costura.
//
// Dois Lalamoves nesta subtask:
//  1. Corte → Fábrica de viés
//  2. Fábrica de viés → Costura
// Ambos via BlocoLalamoveManual reutilizado.

import { z } from "zod";

export const SubtaskViesPayloadSchema = z.object({
  fornecedorViesId: z.string().min(1).optional(),
  tamanhoBandeiraCm: z.number().positive().finite().max(500).optional(),
  tipoTecidoId: z.string().min(1).optional(),
  corId: z.string().min(1).optional(),
  metragemProduzidaM: z.number().positive().finite().optional(),
  precoPorMetro: z.number().nonnegative().finite().optional(),
  observacoes: z.string().max(2000).optional(),
});
export type SubtaskViesPayload = z.infer<typeof SubtaskViesPayloadSchema>;

/**
 * Schema completo pra conclusão. Todos os campos do payload obrigatórios.
 */
export const ConcluirSubtaskViesSchema = z.object({
  fornecedorViesId: z.string().min(1),
  tamanhoBandeiraCm: z.number().positive().finite().max(500),
  tipoTecidoId: z.string().min(1),
  corId: z.string().min(1),
  metragemProduzidaM: z.number().positive().finite(),
  precoPorMetro: z.number().nonnegative().finite(),
  observacoes: z.string().max(2000).optional(),
});
export type ConcluirSubtaskViesInput = z.infer<typeof ConcluirSubtaskViesSchema>;

/** Custo total do viés = metragem × preço/metro. */
export function calcularCustoVies(p: {
  metragemProduzidaM: number;
  precoPorMetro: number;
}): number {
  return p.metragemProduzidaM * p.precoPorMetro;
}
