// Schemas Zod da subconferência (RITM-13).
//
// Cada subconferência é vinculada 1:1 com uma retirada. 3 blocos:
//  1. Conferência quantitativa (papagaio) — contagem oculta inicial
//  2. Defeitos — registro INFORMATIVO de peças com defeito + tipos +
//     fotos. Não é obrigatório pra concluir; "aprovadas" não é mais
//     digitado — é DERIVADO na conclusão (recebidas − defeitos), pra
//     manter custos e dashboard de qualidade funcionando.
//  3. Destinação — localização armazém + destino das reprovadas
//
// Conclusão exige bloco 1 + destinação coerente. OPCONF só pode ser
// concluída quando todas as subconferências dela estão concluidas E
// todas as oficinas da Costura estão "finalizada".

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
 * Deriva a matriz de aprovadas a partir da contagem e dos defeitos:
 * aprovadas[t][c] = max(0, recebidas[t][c] − defeitos[t][c]).
 * Células de defeito sem contagem correspondente não geram aprovadas.
 */
export function derivarAprovadas(
  recebidas: MatrizPecas,
  defeitos: MatrizPecas | null,
): MatrizPecas {
  const out: MatrizPecas = {};
  for (const [t, porCor] of Object.entries(recebidas)) {
    for (const [c, n] of Object.entries(porCor)) {
      const aprovadas = Math.max(0, n - (defeitos?.[t]?.[c] ?? 0));
      out[t] = out[t] ?? {};
      out[t][c] = aprovadas;
    }
  }
  return out;
}

/**
 * Regras de conclusão da subconferência:
 *  Bloco 1: pecasRecebidas preenchido (obrigatório)
 *  Bloco 2 (Defeitos): informativo — nada obrigatório, mas defeitos não
 *    podem exceder o recebido
 *  Bloco 3: localizacaoArmazem (se há aprovadas derivadas)
 *           + destinoReprovadas (se há defeitos)
 */
export function validarPodeConcluirSubconferencia(input: {
  pecasRecebidas: MatrizPecas | null;
  reprovadas: MatrizPecas | null;
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
  const totalReprovadas = somarMatriz(input.reprovadas ?? {});
  if (totalReprovadas > somarMatriz(input.pecasRecebidas)) {
    return {
      ok: false,
      mensagem:
        "Bloco 2 (defeitos): peças com defeito excedem o total recebido",
    };
  }
  if (totalReprovadas > 0 && !input.destinoReprovadas) {
    return {
      ok: false,
      mensagem:
        "Bloco 3 (destinação): defina o destino das peças com defeito (doação/descarte/retrabalho)",
    };
  }
  const totalAprovadas = somarMatriz(
    derivarAprovadas(input.pecasRecebidas, input.reprovadas),
  );
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
