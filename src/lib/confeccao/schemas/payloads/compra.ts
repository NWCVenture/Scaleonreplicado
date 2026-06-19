// Schema do payload JSONB da subtask OPBUY (Compra de Tecido — RITM-08 + RITM-29).
//
// v2: estrutura plana "compra como planilha":
//   - Lista de fornecedores (1..N) — uma OP pode comprar de múltiplos
//   - Cada fornecedor tem suas cores; cada cor tem kgs contratados,
//     qtd de rolos contratada, preço/kg (cobrado por esse fornecedor
//     pra essa cor — pode variar mesmo entre cores do mesmo fornecedor)
//     e o array de pesos reais dos rolos (sized idealmente = qtdRolos).
//   - Top-level: tipo de tecido (único pra OP), destinatário do corte,
//     gramatura, largura do rolo.
//
// O formato antigo (`pre`/`pos`) foi descontinuado. Migration de payloads
// existentes em `src/lib/db/migrate-compra-payload-v2.ts`.

import { z } from "zod";

export const CorContratadaSchema = z.object({
  corId: z.string().min(1),
  kgsContratados: z.number().nonnegative().finite(),
  qtdRolosContratados: z.number().int().nonnegative(),
  precoPorKg: z.number().nonnegative().finite(),
  // UI sincroniza com qtdRolosContratados; aqui aceita qualquer length
  // (operador no meio do preenchimento). Validação estrita só na conclusão.
  pesosRolos: z.array(z.number().nonnegative().finite()),
});
export type CorContratada = z.infer<typeof CorContratadaSchema>;

export const FornecedorCompraSchema = z.object({
  fornecedorId: z.string().min(1),
  observacoes: z.string().max(2000).optional(),
  cores: z.array(CorContratadaSchema),
});
export type FornecedorCompra = z.infer<typeof FornecedorCompraSchema>;

export const SubtaskCompraPayloadSchema = z.object({
  fornecedores: z.array(FornecedorCompraSchema).optional(),
  destinatarioCorteId: z.string().min(1).optional(),
  tipoTecidoId: z.string().min(1).optional(),
  gramaturaGM2: z.number().positive().finite().optional(),
  larguraRoloCm: z.number().positive().finite().max(500).optional(),
  observacoes: z.string().max(2000).optional(),
});
export type SubtaskCompraPayload = z.infer<typeof SubtaskCompraPayloadSchema>;

// ──────────────────────────────────────────────────────────────────────
// Helpers de cálculo
// ──────────────────────────────────────────────────────────────────────

export function calcularPesoRealCor(cor: CorContratada): number {
  return cor.pesosRolos.reduce((s, p) => s + p, 0);
}

export function calcularPesoRealFornecedor(f: FornecedorCompra): number {
  return f.cores.reduce((s, c) => s + calcularPesoRealCor(c), 0);
}

export function calcularPesoRealTotal(
  payload: SubtaskCompraPayload | null | undefined,
): number {
  return (payload?.fornecedores ?? []).reduce(
    (s, f) => s + calcularPesoRealFornecedor(f),
    0,
  );
}

export function calcularPesoContratadoTotal(
  payload: SubtaskCompraPayload | null | undefined,
): number {
  return (payload?.fornecedores ?? []).reduce(
    (s, f) => s + f.cores.reduce((sc, c) => sc + c.kgsContratados, 0),
    0,
  );
}

export function calcularCustoCor(cor: CorContratada): number {
  return calcularPesoRealCor(cor) * cor.precoPorKg;
}

export function calcularCustoFornecedor(f: FornecedorCompra): number {
  return f.cores.reduce((s, c) => s + calcularCustoCor(c), 0);
}

export function calcularCustoTotal(
  payload: SubtaskCompraPayload | null | undefined,
): number {
  return (payload?.fornecedores ?? []).reduce(
    (s, f) => s + calcularCustoFornecedor(f),
    0,
  );
}

/**
 * Soma o peso real recebido por cor (agregando cross-fornecedor). Útil
 * pra summary "real vs contratado" e pro dashboard.
 */
export function agruparPesoRecebidoPorCor(
  payload: SubtaskCompraPayload | null | undefined,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const f of payload?.fornecedores ?? []) {
    for (const c of f.cores) {
      out.set(c.corId, (out.get(c.corId) ?? 0) + calcularPesoRealCor(c));
    }
  }
  return out;
}

/**
 * Soma quantidade de rolos contratados por cor (agregando cross-fornecedor).
 * Usado pelo Corte pra validar saldo de rolos enviados.
 */
export function agruparRolosContratadosPorCor(
  payload: SubtaskCompraPayload | null | undefined,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const f of payload?.fornecedores ?? []) {
    for (const c of f.cores) {
      out.set(c.corId, (out.get(c.corId) ?? 0) + c.qtdRolosContratados);
    }
  }
  return out;
}

/**
 * Soma kg contratado por cor (agregando cross-fornecedor).
 */
export function agruparKgContratadoPorCor(
  payload: SubtaskCompraPayload | null | undefined,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const f of payload?.fornecedores ?? []) {
    for (const c of f.cores) {
      out.set(c.corId, (out.get(c.corId) ?? 0) + c.kgsContratados);
    }
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────
// Schema de conclusão — tudo obrigatório + refinements
// ──────────────────────────────────────────────────────────────────────

const CorContratadaConcluirSchema = CorContratadaSchema.extend({
  kgsContratados: z.number().positive().finite(),
  qtdRolosContratados: z.number().int().positive(),
  precoPorKg: z.number().positive().finite(),
  pesosRolos: z.array(z.number().positive().finite()).min(1),
});

const FornecedorConcluirSchema = FornecedorCompraSchema.extend({
  cores: z.array(CorContratadaConcluirSchema).min(1),
});

export const ConcluirSubtaskCompraSchema = z
  .object({
    fornecedores: z.array(FornecedorConcluirSchema).min(1),
    destinatarioCorteId: z.string().min(1),
    tipoTecidoId: z.string().min(1),
    gramaturaGM2: z.number().positive().finite(),
    larguraRoloCm: z.number().positive().finite().max(500),
    observacoes: z.string().max(2000).optional(),
  })
  .superRefine((data, ctx) => {
    // Cores duplicadas DENTRO de um fornecedor.
    for (let i = 0; i < data.fornecedores.length; i++) {
      const f = data.fornecedores[i];
      const seen = new Set<string>();
      for (let j = 0; j < f.cores.length; j++) {
        if (seen.has(f.cores[j].corId)) {
          ctx.addIssue({
            code: "custom",
            path: ["fornecedores", i, "cores", j, "corId"],
            message:
              "Cor duplicada dentro do mesmo fornecedor — agregue as quantidades em uma única linha",
          });
        }
        seen.add(f.cores[j].corId);
      }
    }
    // Fornecedores duplicados.
    const idsFornecedor = new Set<string>();
    for (let i = 0; i < data.fornecedores.length; i++) {
      const id = data.fornecedores[i].fornecedorId;
      if (idsFornecedor.has(id)) {
        ctx.addIssue({
          code: "custom",
          path: ["fornecedores", i, "fornecedorId"],
          message:
            "Fornecedor duplicado — agregue as cores num único card de fornecedor",
        });
      }
      idsFornecedor.add(id);
    }
    // pesosRolos.length === qtdRolosContratados em cada cor (na conclusão).
    for (let i = 0; i < data.fornecedores.length; i++) {
      for (let j = 0; j < data.fornecedores[i].cores.length; j++) {
        const c = data.fornecedores[i].cores[j];
        if (c.pesosRolos.length !== c.qtdRolosContratados) {
          ctx.addIssue({
            code: "custom",
            path: ["fornecedores", i, "cores", j, "pesosRolos"],
            message: `Quantidade de pesos (${c.pesosRolos.length}) não bate com qtd. de rolos contratada (${c.qtdRolosContratados})`,
          });
        }
      }
    }
  });
export type ConcluirSubtaskCompraInput = z.infer<
  typeof ConcluirSubtaskCompraSchema
>;
