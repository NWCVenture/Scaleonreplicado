// Schema do payload JSONB da subtask OPRIS (Risco — RITM-09).
//
// "Risco" no contexto têxtil = enfesto/plano de corte. Define como os
// moldes são distribuídos no rolo de tecido. Inclui:
// - fornecedor de risco (categoria "risco")
// - tamanhos comerciais e suas proporções (ex: 4 M, 5 G, 3 GG por folha)
// - dados técnicos: rendimento %, comprimento, largura
// - arquivo do risco digital (PDF/imagem — upload via UploadAnexo)
//
// Validação bloqueante: larguraCm <= larguraRoloCm da subtask OPBUY
// (verificada no endpoint /concluir).

import { z } from "zod";

export const TAMANHOS_GRADE_RISCO = ["P", "M", "G", "GG", "EGG"] as const;
export const TamanhoGradeRiscoSchema = z.enum(TAMANHOS_GRADE_RISCO);
export type TamanhoGradeRisco = z.infer<typeof TamanhoGradeRiscoSchema>;

export const TamanhoProporcaoSchema = z.object({
  tamanho: TamanhoGradeRiscoSchema,
  // Quantidade por folha do enfesto (ex: 4 = quatro peças desse tamanho por folha)
  proporcao: z.number().int().positive().max(99),
});

export const SubtaskRiscoPayloadSchema = z.object({
  fornecedorRiscoId: z.string().min(1).optional(),
  tamanhos: z.array(TamanhoProporcaoSchema).optional(),
  rendimentoPercentual: z.number().positive().max(100).optional(),
  comprimentoM: z.number().positive().finite().optional(),
  larguraCm: z.number().positive().finite().max(500).optional(),
  valorServico: z.number().nonnegative().finite().optional(),
  observacoes: z.string().max(2000).optional(),
});
export type SubtaskRiscoPayload = z.infer<typeof SubtaskRiscoPayloadSchema>;

/**
 * Schema completo para conclusão da subtask — todos os campos obrigatórios,
 * mais a regra de tamanhos únicos (sem duplicatas).
 */
export const ConcluirSubtaskRiscoSchema = z
  .object({
    fornecedorRiscoId: z.string().min(1),
    tamanhos: z.array(TamanhoProporcaoSchema).min(1),
    rendimentoPercentual: z.number().positive().max(100),
    comprimentoM: z.number().positive().finite(),
    larguraCm: z.number().positive().finite().max(500),
    valorServico: z.number().nonnegative().finite(),
    observacoes: z.string().max(2000).optional(),
  })
  .refine(
    (d) => {
      const set = new Set(d.tamanhos.map((t) => t.tamanho));
      return set.size === d.tamanhos.length;
    },
    { message: "Não pode haver tamanho duplicado na grade do risco" },
  );

/**
 * Valida cross-subtask: largura do risco não pode exceder a largura do
 * rolo (gravada em OPBUY.pos.larguraRoloCm). Caller passa o larguraRoloCm
 * lido do banco; helper retorna ok/erro.
 */
export function validarLarguraVsRolo(
  larguraRiscoCm: number,
  larguraRoloCm: number | null | undefined,
): { ok: true } | { ok: false; mensagem: string } {
  if (larguraRoloCm === null || larguraRoloCm === undefined) {
    return {
      ok: false,
      mensagem:
        "Largura do rolo não está definida na subtask Compra — conclua-a antes de concluir o Risco",
    };
  }
  if (larguraRiscoCm > larguraRoloCm) {
    return {
      ok: false,
      mensagem: `Largura do risco (${larguraRiscoCm}cm) excede a largura do rolo (${larguraRoloCm}cm) — risco não cabe`,
    };
  }
  return { ok: true };
}
