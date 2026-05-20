import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verificarAssinaturaWebhook } from "./webhook-signature";

const SECRET = "test_webhook_secret";
const BODY = '{"event":"ORDER_STATUS_CHANGED","data":{"orderId":"12345"}}';
const SIG_HEX = createHmac("sha256", SECRET).update(BODY).digest("hex");

test("assinatura hex válida → true", () => {
  assert.equal(
    verificarAssinaturaWebhook({ bodyRaw: BODY, assinatura: SIG_HEX, secret: SECRET }),
    true,
  );
});

test("formato 'sha256=<hex>' aceito", () => {
  assert.equal(
    verificarAssinaturaWebhook({
      bodyRaw: BODY,
      assinatura: `sha256=${SIG_HEX}`,
      secret: SECRET,
    }),
    true,
  );
});

test("formato 'hmac-sha256 <hex>' aceito", () => {
  assert.equal(
    verificarAssinaturaWebhook({
      bodyRaw: BODY,
      assinatura: `hmac-sha256 ${SIG_HEX}`,
      secret: SECRET,
    }),
    true,
  );
});

test("body alterado → false", () => {
  assert.equal(
    verificarAssinaturaWebhook({
      bodyRaw: BODY + " ", // espaço extra
      assinatura: SIG_HEX,
      secret: SECRET,
    }),
    false,
  );
});

test("assinatura modificada (último char trocado) → false", () => {
  const alterada = SIG_HEX.slice(0, -1) + (SIG_HEX.endsWith("0") ? "1" : "0");
  assert.equal(
    verificarAssinaturaWebhook({
      bodyRaw: BODY,
      assinatura: alterada,
      secret: SECRET,
    }),
    false,
  );
});

test("secret errado → false", () => {
  assert.equal(
    verificarAssinaturaWebhook({
      bodyRaw: BODY,
      assinatura: SIG_HEX,
      secret: "outro_secret",
    }),
    false,
  );
});

test("assinatura ausente → false", () => {
  assert.equal(
    verificarAssinaturaWebhook({
      bodyRaw: BODY,
      assinatura: null,
      secret: SECRET,
    }),
    false,
  );
});

test("assinatura malformada (não-hex) → false", () => {
  assert.equal(
    verificarAssinaturaWebhook({
      bodyRaw: BODY,
      assinatura: "not-a-hex-signature-zzz",
      secret: SECRET,
    }),
    false,
  );
});

test("assinatura com comprimento errado → false", () => {
  assert.equal(
    verificarAssinaturaWebhook({
      bodyRaw: BODY,
      assinatura: SIG_HEX.slice(0, 60), // 60 chars em vez de 64
      secret: SECRET,
    }),
    false,
  );
});

test("case-insensitive (LALAMOVE manda upper às vezes)", () => {
  assert.equal(
    verificarAssinaturaWebhook({
      bodyRaw: BODY,
      assinatura: SIG_HEX.toUpperCase(),
      secret: SECRET,
    }),
    true,
  );
});
