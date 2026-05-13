// Zod schema da criação de OP (RITM-06).
// Compartilhado entre endpoint e UI.

import { z } from "zod";

export const CriarOPSchema = z.object({
  produtoId: z.string().min(1),
  temVies: z.boolean().default(false),
  atribuidoAId: z.string().min(1),
  observacoes: z.string().max(2000).trim().optional().nullable(),
});
export type CriarOPInput = z.infer<typeof CriarOPSchema>;

export const ListarOPsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(120).trim().optional(),
  status: z
    .enum(["em_andamento", "concluida", "cancelada"])
    .array()
    .optional(),
  atribuidoA: z.string().optional(),
});
export type ListarOPsQuery = z.infer<typeof ListarOPsQuerySchema>;
