import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ClientUploadPayloadSchema,
  ConfirmAnexoSchema,
  MAX_UPLOAD_BYTES,
} from "./anexo";

test("ClientUploadPayload: aceita payload com subtaskId", () => {
  const r = ClientUploadPayloadSchema.safeParse({
    subtaskId: "st_123",
    categoria: "nf_compra",
    opNumero: "OP05260001",
    subtaskNumero: "OPBUY0001",
  });
  assert.equal(r.success, true);
});

test("ClientUploadPayload: rejeita sem nenhuma FK", () => {
  const r = ClientUploadPayloadSchema.safeParse({
    categoria: "outros",
    opNumero: "OP05260001",
  });
  assert.equal(r.success, false);
});

test("ClientUploadPayload: rejeita categoria inválida", () => {
  const r = ClientUploadPayloadSchema.safeParse({
    subtaskId: "st_123",
    categoria: "categoria_invalida",
    opNumero: "OP05260001",
  });
  assert.equal(r.success, false);
});

test("ConfirmAnexo: aceita payload completo válido", () => {
  const r = ConfirmAnexoSchema.safeParse({
    subtaskId: "st_123",
    categoria: "foto_defeito",
    nomeArquivo: "defeito.jpg",
    tipoMime: "image/jpeg",
    tamanhoBytes: 1024,
    blobUrl: "https://store.public.blob.vercel-storage.com/abc.jpg",
    blobPathname: "confeccao/nwc-root/op-OP05260001/foto.jpg",
  });
  assert.equal(r.success, true);
});

test("ConfirmAnexo: rejeita tamanho > 50MB", () => {
  const r = ConfirmAnexoSchema.safeParse({
    subtaskId: "st_123",
    categoria: "outros",
    nomeArquivo: "grande.pdf",
    tipoMime: "application/pdf",
    tamanhoBytes: MAX_UPLOAD_BYTES + 1,
    blobUrl: "https://x.blob.vercel-storage.com/y.pdf",
    blobPathname: "x/y.pdf",
  });
  assert.equal(r.success, false);
});

test("ConfirmAnexo: rejeita MIME fora da allowlist", () => {
  const r = ConfirmAnexoSchema.safeParse({
    subtaskId: "st_123",
    categoria: "outros",
    nomeArquivo: "evil.exe",
    tipoMime: "application/x-msdownload",
    tamanhoBytes: 1024,
    blobUrl: "https://x.blob.vercel-storage.com/y",
    blobPathname: "x/y",
  });
  assert.equal(r.success, false);
});

test("ConfirmAnexo: aceita lalamoveId como única FK", () => {
  const r = ConfirmAnexoSchema.safeParse({
    lalamoveId: "ll_123",
    categoria: "comprovante_lalamove",
    nomeArquivo: "comprovante.pdf",
    tipoMime: "application/pdf",
    tamanhoBytes: 1024,
    blobUrl: "https://x.blob.vercel-storage.com/y.pdf",
    blobPathname: "x/y.pdf",
  });
  assert.equal(r.success, true);
});

test("ConfirmAnexo: rejeita URL malformada", () => {
  const r = ConfirmAnexoSchema.safeParse({
    subtaskId: "st_123",
    categoria: "outros",
    nomeArquivo: "x.pdf",
    tipoMime: "application/pdf",
    tamanhoBytes: 1024,
    blobUrl: "not-a-url",
    blobPathname: "x/y.pdf",
  });
  assert.equal(r.success, false);
});
