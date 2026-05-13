import { z } from "zod";

// Categorias semânticas de anexos do módulo Confecção.
// Cada subtask (RITMs 08-13) aceita um subset destas categorias.
export const AnexoCategoriaSchema = z.enum([
  "nf_compra",
  "risco_digital",
  "foto_papagaio",
  "foto_defeito",
  "comprovante_lalamove",
  "outros",
]);
export type AnexoCategoria = z.infer<typeof AnexoCategoriaSchema>;

// Tipos MIME aceitos. PDF + imagens comuns (incluindo HEIC pra mobile iOS).
// Sem vídeo, arquivo executável, archive — sai do escopo "evidência de fluxo".
export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
] as const;
export const AllowedMimeSchema = z.enum(ALLOWED_MIME_TYPES);
export type AllowedMime = z.infer<typeof AllowedMimeSchema>;

// 50 MB — alinhado com o CHECK constraint da tabela `confeccao_anexo`.
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

// Pelo menos uma das FKs (subtask, OP ou lalamove) tem que estar
// presente — espelha o CHECK constraint `confeccao_anexo_tem_pai`.
function pelosMenosUmaFK(d: {
  ordemProducaoId?: string | null;
  subtaskId?: string | null;
  lalamoveId?: string | null;
}): boolean {
  return Boolean(d.ordemProducaoId || d.subtaskId || d.lalamoveId);
}

// Payload que o cliente envia no `clientPayload` do upload() do Vercel
// Blob — usado no `onBeforeGenerateToken` pra validar FKs ANTES do upload.
export const ClientUploadPayloadSchema = z
  .object({
    ordemProducaoId: z.string().min(1).optional(),
    subtaskId: z.string().min(1).optional(),
    lalamoveId: z.string().min(1).optional(),
    categoria: AnexoCategoriaSchema,
    // Usados pra construir o pathname no Blob; não precisam ser validados
    // contra o banco — o backend apenas os usa pra montar a key.
    opNumero: z.string().min(1),
    subtaskNumero: z.string().min(1).optional(),
  })
  .refine(pelosMenosUmaFK, {
    message:
      "Pelo menos uma das FKs (ordemProducaoId, subtaskId, lalamoveId) é obrigatória",
  });
export type ClientUploadPayload = z.infer<typeof ClientUploadPayloadSchema>;

// Payload do endpoint /confirm — chamado pelo cliente após upload bem-sucedido.
export const ConfirmAnexoSchema = z
  .object({
    ordemProducaoId: z.string().min(1).nullable().optional(),
    subtaskId: z.string().min(1).nullable().optional(),
    lalamoveId: z.string().min(1).nullable().optional(),
    categoria: AnexoCategoriaSchema,
    nomeArquivo: z.string().min(1).max(500),
    tipoMime: AllowedMimeSchema,
    tamanhoBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
    blobUrl: z.string().url(),
    blobPathname: z.string().min(1),
  })
  .refine(pelosMenosUmaFK, {
    message: "Pelo menos uma das FKs é obrigatória",
  });
export type ConfirmAnexoInput = z.infer<typeof ConfirmAnexoSchema>;
