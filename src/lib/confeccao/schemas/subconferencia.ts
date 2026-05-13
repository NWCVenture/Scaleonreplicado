// Schemas Zod da subconferência (RITM-13).
//
// Cada subconferência é vinculada 1:1 com uma retirada. 3 blocos:
//  1. Conferência quantitativa (papagaio) — contagem oculta inicial
//  2. Inspeção visual — aprovadas/reprovadas + defeitos + fotos
//  3. Destinação — localização armazém + destino das reprovadas
//
// Subconferência só pode ser concluída quando todos os 3 blocos estão
// preenchidos. OPCONF só pode ser concluída quando todas as
// subconferências dela estão concluidas E todas as oficinas da Costura
// estão "finalizada".

import { z } from "zod";
import { TamanhoGradeRiscoSchema } from "./payloads/risco";

// Matriz tamanho × cor → quantidade. Estrutura: { "M": { "co1": 100 }, ... }
export const MatrizPecasSchema = z.record(
  z.string(),
  z.record(z.string(), z.number().int().nonnegative()),
);
export type MatrizPecas = z.infer<typeof MatrizPecasSchema>;

export const TIPOS_DEFEITO = [
  "rebarba",
  "costura_desalinhada",
  "costura_incompleta",
  "gola",
  "mancha",
  "tecido",
  "furo",
  "outros",
] as const;
export const TipoDefeitoSchema = z.enum(TIPOS_DEFEITO);
export type TipoDefeito = z.infer<typeof TipoDefeitoSchema>;

export const DESTINOS_REPROVADAS = ["doacao", "descarte", "retrabalho"] as const;
export const DestinoReprovadasSchema = z.enum(DESTINOS_REPROVADAS);
export type DestinoReprovadas = z.infer<typeof DestinoReprovadasSchema>;

// PATCH genérico — qualquer campo opcional.
export const AtualizarSubconferenciaSchema = z.object({
  pecasRecebidas: MatrizPecasSchema.optional(),
  divergenciaConfirmada: z.boolean().optional(),
  oficinaResponsavelDivergenciaId: z.string().min(1).nullable().optional(),
  quantidadeRevelada: z.boolean().optional(),
  responsavelInspecaoId: z.string().min(1).nullable().optional(),
  aprovadas: MatrizPecasSchema.optional(),
  reprovadas: MatrizPecasSchema.optional(),
  tiposDefeito: z.array(TipoDefeitoSchema).optional(),
  dataInspecao: z.string().datetime().nullable().optional(),
  destinoReprovadas: DestinoReprovadasSchema.nullable().optional(),
  localizacaoArmazem: z.string().max(500).nullable().optional(),
  justificativaEdicao: z.string().min(1).max(2000).optional(),
});
export type AtualizarSubconferenciaInput = z.infer<
  typeof AtualizarSubconferenciaSchema
>;

/**
 * Subconferência só pode ser concluída se todos os 3 blocos estão completos:
 *  Bloco 1: pecasRecebidas preenchido
 *  Bloco 2: responsavelInspecaoId + aprovadas + reprovadas + dataInspecao
 *  Bloco 3: localizacaoArmazem (se há aprovadas)
 *           + destinoReprovadas (se há reprovadas)
 */
export function validarPodeConcluirSubconferencia(input: {
  pecasRecebidas: MatrizPecas | null;
  responsavelInspecaoId: string | null;
  aprovadas: MatrizPecas | null;
  reprovadas: MatrizPecas | null;
  dataInspecao: Date | null;
  localizacaoArmazem: string | null;
  destinoReprovadas: DestinoReprovadas | null;
}): { ok: true } | { ok: false; mensagem: string } {
  if (!input.pecasRecebidas || somarMatriz(input.pecasRecebidas) === 0) {
    return {
      ok: false,
      mensagem:
        "Bloco 1 (contagem): preencha a quantidade recebida antes de concluir",
    };
  }
  if (!input.responsavelInspecaoId) {
    return {
      ok: false,
      mensagem: "Bloco 2 (inspeção): selecione o responsável pela inspeção",
    };
  }
  if (!input.aprovadas || somarMatriz(input.aprovadas) === 0) {
    return {
      ok: false,
      mensagem:
        "Bloco 2 (inspeção): preencha as peças aprovadas (ou marque 0 se nenhuma)",
    };
  }
  if (!input.dataInspecao) {
    return {
      ok: false,
      mensagem: "Bloco 2 (inspeção): registre a data da inspeção",
    };
  }
  const totalReprovadas = somarMatriz(input.reprovadas ?? {});
  if (totalReprovadas > 0 && !input.destinoReprovadas) {
    return {
      ok: false,
      mensagem:
        "Bloco 3 (destinação): defina o destino das peças reprovadas (doação/descarte/retrabalho)",
    };
  }
  const totalAprovadas = somarMatriz(input.aprovadas);
  if (totalAprovadas > 0 && !input.localizacaoArmazem?.trim()) {
    return {
      ok: false,
      mensagem:
        "Bloco 3 (destinação): informe a localização das peças aprovadas no armazém",
    };
  }
  return { ok: true };
}

export function somarMatriz(m: MatrizPecas): number {
  return Object.values(m).reduce(
    (s, t) => s + Object.values(t).reduce((s2, n) => s2 + n, 0),
    0,
  );
}

/**
 * Compara duas matrizes e retorna lista de divergências.
 * Divergência: célula com valor diferente OU presente em uma e ausente na outra.
 */
export function compararMatrizes(
  recebidas: MatrizPecas,
  esperadas: MatrizPecas,
): Array<{
  tamanho: string;
  corId: string;
  recebido: number;
  esperado: number;
  diferenca: number;
}> {
  const divergencias: Array<{
    tamanho: string;
    corId: string;
    recebido: number;
    esperado: number;
    diferenca: number;
  }> = [];
  // União de chaves
  const tamanhos = new Set([
    ...Object.keys(recebidas),
    ...Object.keys(esperadas),
  ]);
  for (const t of tamanhos) {
    const cores = new Set([
      ...Object.keys(recebidas[t] ?? {}),
      ...Object.keys(esperadas[t] ?? {}),
    ]);
    for (const c of cores) {
      const rec = recebidas[t]?.[c] ?? 0;
      const esp = esperadas[t]?.[c] ?? 0;
      if (rec !== esp) {
        divergencias.push({
          tamanho: t,
          corId: c,
          recebido: rec,
          esperado: esp,
          diferenca: rec - esp,
        });
      }
    }
  }
  return divergencias;
}

// Re-export TamanhoGradeRisco pra conveniência
export { TamanhoGradeRiscoSchema };
