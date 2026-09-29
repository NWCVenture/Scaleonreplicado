import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { nanoid } from "nanoid";
import { db } from "./db";
import { conta, skuCatalogo } from "./db/schema";
import { eq } from "drizzle-orm";
import { codigoPg, constraintPg, ehViolacaoDeUnico } from "./pg-erro";

const CONTA_TEST = "pg-erro-test-conta";

before(async () => {
  await db
    .insert(conta)
    .values({
      id: CONTA_TEST,
      nome: "PG Erro Test",
      emailPrincipal: "pg-erro@test.com",
      plano: "enterprise",
      status: "ativa",
    })
    .onConflictDoNothing();
});

after(async () => {
  await db.delete(skuCatalogo).where(eq(skuCatalogo.contaId, CONTA_TEST));
  await db.delete(conta).where(eq(conta.id, CONTA_TEST));
});

test("codigoPg lê o código no próprio erro", () => {
  assert.equal(codigoPg({ code: "23505" }), "23505");
});

test("codigoPg desce pela cadeia de cause", () => {
  const embrulhado = { message: "Failed query: ...", cause: { code: "23505" } };
  assert.equal(codigoPg(embrulhado), "23505");

  const duasCamadas = { cause: { cause: { code: "23503" } } };
  assert.equal(codigoPg(duasCamadas), "23503");
});

test("codigoPg devolve undefined quando não há código", () => {
  assert.equal(codigoPg(new Error("qualquer coisa")), undefined);
  assert.equal(codigoPg(null), undefined);
  assert.equal(codigoPg({ cause: { cause: {} } }), undefined);
});

test("codigoPg não entra em laço com cause circular", () => {
  const a: Record<string, unknown> = {};
  a.cause = a;
  assert.equal(codigoPg(a), undefined);
});

test("constraintPg aceita constraint_name e constraint", () => {
  assert.equal(
    constraintPg({ cause: { constraint_name: "uq_sku_catalogo_codigo_conta" } }),
    "uq_sku_catalogo_codigo_conta",
  );
  assert.equal(constraintPg({ cause: { constraint: "uq_outra" } }), "uq_outra");
});

test("ehViolacaoDeUnico só é verdade no 23505", () => {
  assert.equal(ehViolacaoDeUnico({ cause: { code: "23505" } }), true);
  assert.equal(ehViolacaoDeUnico({ cause: { code: "23503" } }), false);
  assert.equal(ehViolacaoDeUnico(new Error("Failed query: insert ...")), false);
});

// O que motivou o helper: o erro real do Drizzle não expõe `code` no primeiro
// nível, então `(err as {code}).code === "23505"` nunca casava e a rota caía no
// 500 genérico em vez do 409 "já cadastrado".
test("erro real de índice único é reconhecido", async () => {
  const codigo = `PG-ERRO-${nanoid(6)}`.toUpperCase();
  await db.insert(skuCatalogo).values({ id: nanoid(), codigo, contaId: CONTA_TEST });

  try {
    await db.insert(skuCatalogo).values({ id: nanoid(), codigo, contaId: CONTA_TEST });
    assert.fail("o segundo insert deveria violar o índice único");
  } catch (err) {
    assert.equal(
      (err as { code?: string }).code,
      undefined,
      "se o Drizzle passar a expor o código no primeiro nível, o helper continua válido, mas este aviso deixa de valer",
    );
    assert.equal(ehViolacaoDeUnico(err), true);
    assert.equal(constraintPg(err), "uq_sku_catalogo_codigo_conta");
  }
});
