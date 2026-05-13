// Schema do payload JSONB da subtask OPSEW (Costura — RITM-12).
//
// Subtask mais complexa do módulo:
//  - Múltiplas oficinas em paralelo
//  - Cada oficina recebe peças (tamanho × cor) consumindo do saldo do Corte
//  - Etiquetagem cruzada: tamanho comercial pode vir de tamanho da grade
//    de corte diferente (ex: P sai de M, EGG sai de GG)
//  - Status interno por oficina: enviado → em_producao → retirada_parcial
//    (loop) → retirada_final → finalizada
//  - Retiradas (parciais e final) criam subconferências automaticamente
//    na subtask Conferência (lógica no service criarRetirada)

import { z } from "zod";
import { TamanhoGradeRiscoSchema } from "./risco";

export const StatusInternoOficinaSchema = z.enum([
  "enviado",
  "em_producao",
  "retirada_parcial",
  "retirada_final",
  "finalizada",
]);
export type StatusInternoOficina = z.infer<typeof StatusInternoOficinaSchema>;

// Matriz tamanho × cor (mesma estrutura do rendimento do Corte).
export const PecasPorTamanhoCorSchema = z.object({
  tamanho: TamanhoGradeRiscoSchema,
  corId: z.string().min(1),
  quantidade: z.number().int().nonnegative(),
});

// Linha de etiquetagem: tamanho comercial → fonte (tamanho da grade de corte)
// Exemplo: P, qtd 100, fonte M (peças cortadas como M vão receber etiqueta P)
export const EtiquetagemLinhaSchema = z.object({
  tamanhoEtiqueta: TamanhoGradeRiscoSchema,
  quantidade: z.number().int().positive(),
  fonteGradeCorte: TamanhoGradeRiscoSchema,
});
export type EtiquetagemLinha = z.infer<typeof EtiquetagemLinhaSchema>;

export const OficinaCosturaSchema = z.object({
  oficinaId: z.string().min(1),
  prazoProducao: z.string().datetime().optional(),
  pecasEnviadasPorTamanhoCor: z.array(PecasPorTamanhoCorSchema).optional(),
  etiquetagem: z.array(EtiquetagemLinhaSchema).optional(),
  precoPorPeca: z.number().nonnegative().finite().optional(),
  statusInterno: StatusInternoOficinaSchema.default("enviado"),
  observacoes: z.string().max(2000).optional(),
});
export type OficinaCostura = z.infer<typeof OficinaCosturaSchema>;

export const SubtaskCosturaPayloadSchema = z.object({
  oficinas: z.array(OficinaCosturaSchema).optional(),
});
export type SubtaskCosturaPayload = z.infer<typeof SubtaskCosturaPayloadSchema>;

/**
 * Conclusão: todas as oficinas precisam estar "finalizada" (retirada
 * final já feita), com prazo, peças, etiquetagem e preço/peça definidos.
 */
export const ConcluirSubtaskCosturaSchema = z
  .object({
    oficinas: z
      .array(
        OficinaCosturaSchema.extend({
          prazoProducao: z.string().datetime(),
          pecasEnviadasPorTamanhoCor: z
            .array(PecasPorTamanhoCorSchema)
            .min(1),
          etiquetagem: z.array(EtiquetagemLinhaSchema).min(1),
          precoPorPeca: z.number().nonnegative().finite(),
          statusInterno: z.literal("finalizada"),
        }),
      )
      .min(1),
  })
  .superRefine((data, ctx) => {
    const ids = data.oficinas.map((o) => o.oficinaId);
    const dup = ids.find((id, idx) => ids.indexOf(id) !== idx);
    if (dup) {
      ctx.addIssue({
        code: "custom",
        path: ["oficinas"],
        message: `Oficina "${dup}" duplicada — uma oficina só pode receber peças uma vez por subtask`,
      });
    }
    // Validação da etiquetagem por oficina (cross-row)
    for (let i = 0; i < data.oficinas.length; i++) {
      const r = validarEtiquetagem(data.oficinas[i]);
      if (!r.ok) {
        ctx.addIssue({
          code: "custom",
          path: ["oficinas", i, "etiquetagem"],
          message: r.mensagem,
        });
      }
    }
  });

/**
 * Valida etiquetagem cruzada DENTRO de uma oficina:
 * para cada tamanho da grade de corte (fonte), a soma das quantidades
 * etiquetadas a partir dele não pode exceder o número de peças daquela
 * fonte enviadas para a oficina.
 */
export function validarEtiquetagem(
  oficina: OficinaCostura,
): { ok: true } | { ok: false; mensagem: string } {
  if (!oficina.etiquetagem || !oficina.pecasEnviadasPorTamanhoCor) {
    return { ok: true };
  }
  // Soma de peças enviadas por tamanho (agregando todas as cores)
  const pecasPorTamanhoFonte = new Map<string, number>();
  for (const p of oficina.pecasEnviadasPorTamanhoCor) {
    pecasPorTamanhoFonte.set(
      p.tamanho,
      (pecasPorTamanhoFonte.get(p.tamanho) ?? 0) + p.quantidade,
    );
  }
  // Soma de etiquetadas por fonte
  const etiquetadasPorFonte = new Map<string, number>();
  for (const e of oficina.etiquetagem) {
    etiquetadasPorFonte.set(
      e.fonteGradeCorte,
      (etiquetadasPorFonte.get(e.fonteGradeCorte) ?? 0) + e.quantidade,
    );
  }
  for (const [fonte, etiquetadas] of etiquetadasPorFonte.entries()) {
    const disponivel = pecasPorTamanhoFonte.get(fonte) ?? 0;
    if (etiquetadas > disponivel) {
      return {
        ok: false,
        mensagem: `Etiquetagem: soma de etiquetas a partir de "${fonte}" (${etiquetadas}) excede peças daquele tamanho enviadas à oficina (${disponivel})`,
      };
    }
  }
  return { ok: true };
}

/**
 * Valida que a soma de peças enviadas (todas as oficinas) por (tamanho, cor)
 * não excede o rendimento do Corte para aquela combinação.
 *
 * `rendimentoCortePorTamCor`: chave "TAMANHO|corId" → quantidade
 */
export function validarSaldoPecasVsCorte(
  oficinas: OficinaCostura[],
  rendimentoCortePorTamCor: Map<string, number>,
): { ok: true } | { ok: false; mensagem: string } {
  const enviadoTotal = new Map<string, number>();
  for (const o of oficinas) {
    for (const p of o.pecasEnviadasPorTamanhoCor ?? []) {
      const k = `${p.tamanho}|${p.corId}`;
      enviadoTotal.set(k, (enviadoTotal.get(k) ?? 0) + p.quantidade);
    }
  }
  for (const [k, enviado] of enviadoTotal.entries()) {
    const disponivel = rendimentoCortePorTamCor.get(k) ?? 0;
    if (enviado > disponivel) {
      const [tam, cor] = k.split("|");
      return {
        ok: false,
        mensagem: `Peças (${tam}, ${cor}): enviadas ${enviado} mas só ${disponivel} foram cortadas`,
      };
    }
  }
  return { ok: true };
}

/**
 * Constrói o mapa de peças cortadas por (tamanho, corId) a partir do
 * payload do Corte (OPCOR). Soma todas as oficinas e cores.
 */
export function pecasCortadasPorTamCor(
  cortePayload: unknown,
): Map<string, number> {
  const mapa = new Map<string, number>();
  const p = cortePayload as
    | {
        oficinas?: Array<{
          rendimentoPorTamanhoCor?: Array<{
            tamanho: string;
            corId: string;
            quantidade: number;
          }>;
        }>;
      }
    | undefined
    | null;
  for (const o of p?.oficinas ?? []) {
    for (const r of o.rendimentoPorTamanhoCor ?? []) {
      const k = `${r.tamanho}|${r.corId}`;
      mapa.set(k, (mapa.get(k) ?? 0) + r.quantidade);
    }
  }
  return mapa;
}
