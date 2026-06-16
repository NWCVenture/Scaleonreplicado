// Zod schemas dos CRUDs de cadastros do módulo Confecção (RITM-05).
// Compartilhados entre routes API (validação de payload) e UI (formulários).

import { z } from "zod";

export const ConfeccaoFornecedorCategoriaSchema = z.enum([
  "risco",
  "tecido",
  "corte",
  "costura",
  "vies",
]);
export type ConfeccaoFornecedorCategoria = z.infer<
  typeof ConfeccaoFornecedorCategoriaSchema
>;

// CEP brasileiro: 5 dígitos + opcional "-" + 3 dígitos
const cepRegex = /^\d{5}-?\d{3}$/;
// E.164: +DD seguido de 7-15 dígitos
const e164Regex = /^\+[1-9]\d{6,14}$/;

// -------------------- Produto --------------------

export const CriarProdutoSchema = z.object({
  nome: z.string().min(2).max(120).trim(),
  descricao: z.string().max(500).trim().optional(),
});
export type CriarProdutoInput = z.infer<typeof CriarProdutoSchema>;

export const AtualizarProdutoSchema = CriarProdutoSchema.partial().extend({
  ativo: z.boolean().optional(),
});
export type AtualizarProdutoInput = z.infer<typeof AtualizarProdutoSchema>;

// -------------------- Fornecedor --------------------

// Endereço é opcional no cadastro inicial — o cadastro "rápido" inline da
// tela de OP só pede nome + WhatsApp, e o usuário completa o restante depois
// em Cadastros > Fornecedores. Geocoding e integração Lalamove só funcionam
// quando os campos estiverem preenchidos.
export const CriarFornecedorSchema = z.object({
  nome: z.string().min(2).max(120).trim(),
  categorias: z.array(ConfeccaoFornecedorCategoriaSchema).min(1),
  whatsapp: z.string().min(8).max(40).trim(),
  telefoneE164: z.string().regex(e164Regex).optional().nullable(),
  enderecoRua: z.string().max(200).trim().default(""),
  enderecoNumero: z.string().max(20).trim().default(""),
  enderecoComplemento: z.string().max(120).trim().optional().nullable(),
  enderecoBairro: z.string().max(120).trim().default(""),
  enderecoCep: z
    .string()
    .trim()
    .refine((v) => v === "" || cepRegex.test(v), "CEP inválido")
    .default(""),
  enderecoCidade: z.string().max(120).trim().default(""),
  enderecoEstado: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === "" || v.length === 2, "UF deve ter 2 letras")
    .default(""),
  contatoNome: z.string().max(120).trim().optional().nullable(),
  observacoes: z.string().max(1000).trim().optional().nullable(),
});
export type CriarFornecedorInput = z.infer<typeof CriarFornecedorSchema>;

export const AtualizarFornecedorSchema = CriarFornecedorSchema.partial().extend(
  {
    ativo: z.boolean().optional(),
  },
);
export type AtualizarFornecedorInput = z.infer<
  typeof AtualizarFornecedorSchema
>;

// -------------------- Tipo de Tecido --------------------

export const CriarTipoTecidoSchema = z.object({
  nome: z.string().min(2).max(60).trim(),
});
export type CriarTipoTecidoInput = z.infer<typeof CriarTipoTecidoSchema>;

export const AtualizarTipoTecidoSchema = CriarTipoTecidoSchema.partial().extend(
  {
    ativo: z.boolean().optional(),
  },
);
export type AtualizarTipoTecidoInput = z.infer<
  typeof AtualizarTipoTecidoSchema
>;

// -------------------- Cor --------------------

export const CriarCorSchema = z.object({
  nome: z.string().min(2).max(40).trim(),
});
export type CriarCorInput = z.infer<typeof CriarCorSchema>;

export const AtualizarCorSchema = CriarCorSchema.partial().extend({
  ativo: z.boolean().optional(),
});
export type AtualizarCorInput = z.infer<typeof AtualizarCorSchema>;

// -------------------- Preço Fornecedor × Tipo de Tecido --------------------

export const CriarFornecedorTecidoPrecoSchema = z.object({
  tipoTecidoId: z.string().min(1),
  precoKgSugerido: z.number().positive().finite(),
});
export type CriarFornecedorTecidoPrecoInput = z.infer<
  typeof CriarFornecedorTecidoPrecoSchema
>;

export const AtualizarFornecedorTecidoPrecoSchema = z.object({
  precoKgSugerido: z.number().positive().finite(),
});
export type AtualizarFornecedorTecidoPrecoInput = z.infer<
  typeof AtualizarFornecedorTecidoPrecoSchema
>;

// -------------------- Paginação --------------------

export const PaginacaoSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(120).trim().optional(),
  incluirInativos: z.coerce.boolean().default(false),
});
export type PaginacaoInput = z.infer<typeof PaginacaoSchema>;
