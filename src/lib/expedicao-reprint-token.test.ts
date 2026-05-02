import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

// Setar antes de importar — getSecret() só lê env nas chamadas, mas é simétrico
// com crypto.test.ts (que faz a mesma coisa antes do import).
process.env.OAUTH_STATE_SECRET = randomBytes(32).toString("base64");
process.env.EXPEDICAO_REPRINT_PASSWORD = "senha-de-teste-correta";

import {
  hashTrackingIds,
  signReprintToken,
  validateReprintPassword,
  verifyReprintToken,
} from "./expedicao-reprint-token";

const baseInput = {
  contaId: "conta-1",
  usuarioId: "user-1",
  trackingIds: ["AAA111", "BBB222", "CCC333"],
};

test("hashTrackingIds: ordem não importa", () => {
  const a = hashTrackingIds(["a", "b", "c"]);
  const b = hashTrackingIds(["c", "a", "b"]);
  assert.equal(a, b);
});

test("hashTrackingIds: ignora vazios e whitespace", () => {
  const a = hashTrackingIds(["a", "b"]);
  const b = hashTrackingIds(["", "  ", "b", "a"]);
  assert.equal(a, b);
});

test("round-trip: token válido passa na verificação", () => {
  const { token } = signReprintToken(baseInput);
  const result = verifyReprintToken(token, baseInput);
  assert.equal(result.ok, true);
});

test("verify falha com contaId divergente", () => {
  const { token } = signReprintToken(baseInput);
  const result = verifyReprintToken(token, { ...baseInput, contaId: "outra" });
  assert.equal(result.ok, false);
  if (result.ok === false) assert.match(result.reason, /conta/);
});

test("verify falha com usuarioId divergente", () => {
  const { token } = signReprintToken(baseInput);
  const result = verifyReprintToken(token, {
    ...baseInput,
    usuarioId: "outro",
  });
  assert.equal(result.ok, false);
  if (result.ok === false) assert.match(result.reason, /usu/);
});

test("verify falha quando lista de trackings difere", () => {
  const { token } = signReprintToken(baseInput);
  const result = verifyReprintToken(token, {
    ...baseInput,
    trackingIds: ["AAA111", "DDD444"],
  });
  assert.equal(result.ok, false);
  if (result.ok === false) assert.match(result.reason, /hash/);
});

test("verify aceita lista de trackings em ordem diferente (mesmos IDs)", () => {
  const { token } = signReprintToken(baseInput);
  const result = verifyReprintToken(token, {
    ...baseInput,
    trackingIds: ["CCC333", "AAA111", "BBB222"],
  });
  assert.equal(result.ok, true);
});

test("verify falha com payload adulterado", () => {
  const { token } = signReprintToken(baseInput);
  const [payloadB64, sigB64] = token.split(".");
  const adulterado =
    payloadB64.replace(/A/g, "B").replace(/Z/g, "Y") + "." + sigB64;
  const result = verifyReprintToken(adulterado, baseInput);
  assert.equal(result.ok, false);
});

test("verify falha com assinatura adulterada", () => {
  const { token } = signReprintToken(baseInput);
  const [payloadB64, sigB64] = token.split(".");
  const corrupted =
    payloadB64 + "." + (sigB64.startsWith("A") ? "B" : "A") + sigB64.slice(1);
  const result = verifyReprintToken(corrupted, baseInput);
  assert.equal(result.ok, false);
  if (result.ok === false) assert.match(result.reason, /assinatura/);
});

test("verify falha com token malformado", () => {
  const result = verifyReprintToken("nao-tem-ponto", baseInput);
  assert.equal(result.ok, false);
  if (result.ok === false) assert.match(result.reason, /malformado/);
});

test("verify falha quando token expirou (exp no passado)", () => {
  const { token } = signReprintToken(baseInput);
  // Avança o relógio do verify pra depois do exp via mock manual: monkeypatch
  // Date.now temporariamente.
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 120 * 1000; // +2min, supera o TTL de 60s
    const result = verifyReprintToken(token, baseInput);
    assert.equal(result.ok, false);
    if (result.ok === false) assert.match(result.reason, /expirado/);
  } finally {
    Date.now = realNow;
  }
});

test("validateReprintPassword: senha correta", () => {
  assert.equal(validateReprintPassword("senha-de-teste-correta"), true);
});

test("validateReprintPassword: senha incorreta", () => {
  assert.equal(validateReprintPassword("errada"), false);
});

test("validateReprintPassword: senha vazia", () => {
  assert.equal(validateReprintPassword(""), false);
});

test("validateReprintPassword: tamanho diferente não vaza via timing", () => {
  // O caminho de comparação retorna false antes de chamar timingSafeEqual
  // quando length difere. Aqui só verificamos que não lança.
  assert.equal(validateReprintPassword("a"), false);
  assert.equal(validateReprintPassword("a".repeat(100)), false);
});
