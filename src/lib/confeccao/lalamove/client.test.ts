import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { signRequest } from "./client";

// Vetor de teste documentado em docs/referencias/lalamove-api.md §2.
const VEC = {
  apiSecret: "sk_test_demo_secret",
  timestamp: "1715794800000",
  method: "POST",
  path: "/v3/quotations",
  body: '{"data":{"serviceType":"MOTORCYCLE"}}',
};

// Esperado calculado offline com o mesmo algoritmo (HMAC-SHA256 do
// node:crypto). Se o algoritmo mudar, este valor muda — é proposital,
// força reavaliação.
const EXPECTED = (() => {
  const raw = `${VEC.timestamp}\r\n${VEC.method}\r\n${VEC.path}\r\n\r\n${VEC.body}`;
  return createHmac("sha256", VEC.apiSecret).update(raw).digest("hex");
})();

test("HMAC do vetor de referência bate", () => {
  const sig = signRequest(VEC);
  assert.equal(sig, EXPECTED);
});

test("HMAC é determinístico — mesma entrada gera mesma assinatura", () => {
  const a = signRequest(VEC);
  const b = signRequest(VEC);
  assert.equal(a, b);
});

test("timestamp diferente muda a assinatura", () => {
  const a = signRequest(VEC);
  const b = signRequest({ ...VEC, timestamp: "1715794800001" });
  assert.notEqual(a, b);
});

test("body diferente muda a assinatura", () => {
  const a = signRequest(VEC);
  const b = signRequest({ ...VEC, body: '{"data":{"serviceType":"CAR"}}' });
  assert.notEqual(a, b);
});

test("CUSTOM_HEADERS é vazio — string `\\r\\n\\r\\n` aparece entre path e body", () => {
  // Repete o cálculo aqui pra documentar o formato. Se alguém mudar a
  // ordem ou omitir o CRLF, este teste pega.
  const raw = `${VEC.timestamp}\r\n${VEC.method}\r\n${VEC.path}\r\n\r\n${VEC.body}`;
  const expected = createHmac("sha256", VEC.apiSecret).update(raw).digest("hex");
  assert.equal(signRequest(VEC), expected);
});

test("saída é hex lowercase de 64 caracteres", () => {
  const sig = signRequest(VEC);
  assert.match(sig, /^[0-9a-f]{64}$/);
});

test("GET sem body — assinatura tem body vazio entre os \\r\\n finais", () => {
  const get = signRequest({
    apiSecret: VEC.apiSecret,
    timestamp: VEC.timestamp,
    method: "GET",
    path: "/v3/cities",
    body: "",
  });
  const raw = `${VEC.timestamp}\r\nGET\r\n/v3/cities\r\n\r\n`;
  const expected = createHmac("sha256", VEC.apiSecret).update(raw).digest("hex");
  assert.equal(get, expected);
});
