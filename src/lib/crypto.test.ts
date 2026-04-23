import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { encrypt, decrypt } from "./crypto";

// Chave de teste isolada — não depende de .env.local.
// Setada antes do primeiro encrypt/decrypt (getKey só é chamado nas funções, não no load).
process.env.ENCRYPTION_MASTER_KEY = randomBytes(32).toString("base64");

test("round-trip: string simples", () => {
  assert.equal(decrypt(encrypt("hello")), "hello");
});

test("round-trip: string vazia", () => {
  assert.equal(decrypt(encrypt("")), "");
});

test("round-trip: unicode", () => {
  const input = "café 🎉 日本";
  assert.equal(decrypt(encrypt(input)), input);
});

test("round-trip: string longa (10k chars)", () => {
  const input = "a".repeat(10_000);
  assert.equal(decrypt(encrypt(input)), input);
});

test("IV aleatório: mesmo input gera envelopes diferentes", () => {
  const a = encrypt("hello");
  const b = encrypt("hello");
  assert.notEqual(a, b);
  assert.equal(decrypt(a), "hello");
  assert.equal(decrypt(b), "hello");
});

test("decrypt lança erro se ciphertext adulterado", () => {
  const envelope = encrypt("hello");
  const [iv, ct, tag] = envelope.split(".");
  const adulterado = ct.startsWith("A") ? "B" + ct.slice(1) : "A" + ct.slice(1);
  assert.throws(() => decrypt([iv, adulterado, tag].join(".")));
});

test("decrypt lança erro com formato inválido", () => {
  assert.throws(() => decrypt("abc"), /Envelope inválido/);
});

test("decrypt lança erro se authTag adulterado", () => {
  const envelope = encrypt("hello");
  const [iv, ct, tag] = envelope.split(".");
  const tagBuf = Buffer.from(tag, "base64");
  tagBuf[0] = tagBuf[0] ^ 0xff;
  const adulterado = tagBuf.toString("base64");
  assert.throws(() => decrypt([iv, ct, adulterado].join(".")));
});
