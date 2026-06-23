// Schema do payload JSONB da subtask OPBUY (Compra de Tecido — RITM-08 + RITM-29 + RITM-32).
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
// v3 (RITM-32): substitui `destinatarioCorteId` (single oficina) por
//   `distribuicaoOficinas: [{oficinaId, rolosPorCor}]` — plano multi-oficina
//   decidido na Compra. O campo legacy permanece optional pra leitura
//   durante o ciclo de migração (`src/lib/db/migrate-compra-payload-v3.ts`).
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

// Cada entry: 1 oficina recebe N rolos de M cores. Plano definido na
// Compra e consumido pelo Corte (RITM-33).
export const DistribuicaoOficinaSchema = z.object({
  oficinaId: z.string().min(1),
  // Mapa corId → qtd de rolos atribuídos a esta oficina.
  // Schema permissivo (rascunho/parcial). Validação rígida (saldo zerado,
  // sem oficina-fantasma) só na conclusão.
  rolosPorCor: z.record(z.string(), z.number().int().nonnegative()),
});
export type DistribuicaoOficina = z.infer<typeof DistribuicaoOficinaSchema>;

export const SubtaskCompraPayloadSchema = z.object({
  fornecedores: z.array(FornecedorCompraSchema).optional(),
  // v3 (RITM-32) — plano de distribuição multi-oficina decidido na Compra
  distribuicaoOficinas: z.array(DistribuicaoOficinaSchema).optional(),
  // legacy v2 — mantido optional pra leitura durante migration
  destinatarioCorteId: z.string().min(1).optional(),
  tipoTecidoId: z.string().min(1).optional(),
  gramaturaGM2: z.number().positive().finite().optional(),
  larguraRoloCm: z.number().positive().finite().max(500).optional(),
  observacoes: z.string().max(2000).optional(),
  // RITM-34: tolerância (em %) pra view de matching fornecedor↔cortador.
  // Pares com |diff%| > tolerancia ficam destacados como alerta.
  // Default tratado no consumidor (TOLERANCIA_MATCHING_PADRAO).
  toleranciaMatchingPct: z.number().nonnegative().finite().max(100).optional(),
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
// Helpers de distribuição (RITM-32)
// ──────────────────────────────────────────────────────────────────────

/**
 * Soma rolos atribuídos por cor cross-oficinas. Espelha do lado da
 * distribuição o que `agruparRolosContratadosPorCor` faz do lado da Compra.
 */
export function agruparRolosAtribuidosPorCor(
  payload: SubtaskCompraPayload | null | undefined,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const o of payload?.distribuicaoOficinas ?? []) {
    for (const [corId, qtd] of Object.entries(o.rolosPorCor)) {
      out.set(corId, (out.get(corId) ?? 0) + qtd);
    }
  }
  return out;
}

export interface SaldoDistribuicaoCor {
  contratado: number;
  atribuido: number;
  /** Positivo = falta atribuir; negativo = atribuído além do contratado. */
  saldo: number;
}

/**
 * Por cor (união contratadas ∪ atribuídas), devolve quanto foi contratado,
 * quanto está atribuído a oficinas e o saldo. Saldo zerado em todas as
 * cores é pré-condição pra conclusão da Compra.
 */
export function calcularSaldoDistribuicao(
  payload: SubtaskCompraPayload | null | undefined,
): Map<string, SaldoDistribuicaoCor> {
  const contratados = agruparRolosContratadosPorCor(payload);
  const atribuidos = agruparRolosAtribuidosPorCor(payload);
  const cores = new Set<string>([
    ...contratados.keys(),
    ...atribuidos.keys(),
  ]);
  const out = new Map<string, SaldoDistribuicaoCor>();
  for (const corId of cores) {
    const c = contratados.get(corId) ?? 0;
    const a = atribuidos.get(corId) ?? 0;
    out.set(corId, { contratado: c, atribuido: a, saldo: c - a });
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
    // v3 (RITM-32): plano de distribuição é obrigatório na conclusão
    distribuicaoOficinas: z.array(DistribuicaoOficinaSchema).min(1),
    // legacy v2 — manter optional pra payloads em migração
    destinatarioCorteId: z.string().min(1).optional(),
    tipoTecidoId: z.string().min(1),
    gramaturaGM2: z.number().positive().finite(),
    larguraRoloCm: z.number().positive().finite().max(500),
    observacoes: z.string().max(2000).optional(),
    toleranciaMatchingPct: z
      .number()
      .nonnegative()
      .finite()
      .max(100)
      .optional(),
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

    // ── Distribuição (RITM-32) ─────────────────────────────────────
    // Oficinas duplicadas.
    const idsOficina = new Set<string>();
    for (let i = 0; i < data.distribuicaoOficinas.length; i++) {
      const id = data.distribuicaoOficinas[i].oficinaId;
      if (idsOficina.has(id)) {
        ctx.addIssue({
          code: "custom",
          path: ["distribuicaoOficinas", i, "oficinaId"],
          message:
            "Oficina duplicada — uma oficina só pode receber rolos uma vez por plano de distribuição",
        });
      }
      idsOficina.add(id);
    }
    // Cada oficina precisa receber ao menos 1 rolo (de qualquer cor).
    for (let i = 0; i < data.distribuicaoOficinas.length; i++) {
      const o = data.distribuicaoOficinas[i];
      const total = Object.values(o.rolosPorCor).reduce((s, n) => s + n, 0);
      if (total === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["distribuicaoOficinas", i, "rolosPorCor"],
          message:
            "Oficina precisa receber ao menos 1 rolo — remova a oficina ou atribua rolos",
        });
      }
    }
    // Saldo zerado por cor: contratado === atribuído em cada cor contratada.
    const contratado = agruparRolosContratadosPorCor({
      fornecedores: data.fornecedores,
    });
    const atribuido = agruparRolosAtribuidosPorCor({
      distribuicaoOficinas: data.distribuicaoOficinas,
    });
    const corIds = new Set<string>([
      ...contratado.keys(),
      ...atribuido.keys(),
    ]);
    for (const corId of corIds) {
      const c = contratado.get(corId) ?? 0;
      const a = atribuido.get(corId) ?? 0;
      if (c !== a) {
        const idxOficina = data.distribuicaoOficinas.findIndex(
          (o) => o.rolosPorCor[corId] !== undefined,
        );
        ctx.addIssue({
          code: "custom",
          path:
            idxOficina >= 0
              ? ["distribuicaoOficinas", idxOficina, "rolosPorCor", corId]
              : ["distribuicaoOficinas"],
          message:
            c > a
              ? `Cor ${corId}: ${c - a} rolo(s) sem destino (contratado ${c}, distribuído ${a})`
              : `Cor ${corId}: ${a - c} rolo(s) atribuído(s) além do contratado (contratado ${c}, distribuído ${a})`,
        });
      }
    }
  });
export type ConcluirSubtaskCompraInput = z.infer<
  typeof ConcluirSubtaskCompraSchema
>;
