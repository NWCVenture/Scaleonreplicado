import { z } from "zod";
import { ConfeccaoFornecedorCategoriaSchema } from "./cadastros";

export const CriarTemplateWhatsappSchema = z.object({
  nome: z.string().min(2).max(120).trim(),
  categoria: ConfeccaoFornecedorCategoriaSchema,
  corpo: z.string().min(1).max(5000),
});
export type CriarTemplateWhatsappInput = z.infer<
  typeof CriarTemplateWhatsappSchema
>;

export const AtualizarTemplateWhatsappSchema =
  CriarTemplateWhatsappSchema.partial().extend({
    ativo: z.boolean().optional(),
  });
export type AtualizarTemplateWhatsappInput = z.infer<
  typeof AtualizarTemplateWhatsappSchema
>;
