import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  conta,
  confeccaoOrdemProducao,
  confeccaoProduto,
  loteCadastrado,
  user,
  usuarioConta,
} from "@/lib/db/schema";
import { vincularLoteAOP } from "./lote-op";

const CONTA = "lote-op-test-conta";
const USR = "lote-op-test-user";

let opId1: string;
let opId2: string;
const op1Numero = "OP05260901"; // sufixos -09xx pra evitar conflito com seeds
const op2Numero = "OP05260902";

before(async () => {
  await db
    .insert(conta)
    .values({
      id: CONTA,
      nome: "Lote-OP Test",
      emailPrincipal: "lote-op@test.com",
      plano: "enterprise",
      status: "ativa",
    })
    .onConflictDoNothing();
  await db
    .insert(user)
    .values({
      id: USR,
      name: "User Lote OP",
      email: "user-lote-op@test.com",
      role: "admin",
    })
    .onConflictDoNothing();
  await db
    .insert(usuarioConta)
    .values({
      id: `uc-${USR}-${CONTA}`,
      usuarioId: USR,
      contaId: CONTA,
      papel: "admin",
      ativo: true,
    })
    .onConflictDoNothing();
  const [prod] = await db
    .insert(confeccaoProduto)
    .values({
      id: `prod-lote-op-${Date.now()}`,
      contaId: CONTA,
      nome: "Produto Lote OP",
    })
    .onConflictDoNothing()
    .returning();

  // Garante produto disponível (caso onConflictDoNothing tenha pulado).
  const produtoId =
    prod?.id ??
    (
      await db
        .select({ id: confeccaoProduto.id })
        .from(confeccaoProduto)
        .where(eq(confeccaoProduto.contaId, CONTA))
        .limit(1)
    )[0].id;

  // Cria duas OPs pra exercitar o caminho de FK pra OP nova.
  const [op1] = await db
    .insert(confeccaoOrdemProducao)
    .values({
      id: `op-lote-op-1-${Date.now()}`,
      contaId: CONTA,
      numero: op1Numero,
      sequencialGlobal: 901,
      produtoId,
      criadaPorId: USR,
      atribuidoAId: USR,
    })
    .onConflictDoNothing()
    .returning();
  opId1 =
    op1?.id ??
    (
      await db
        .select({ id: confeccaoOrdemProducao.id })
        .from(confeccaoOrdemProducao)
        .where(eq(confeccaoOrdemProducao.numero, op1Numero))
        .limit(1)
    )[0].id;

  const [op2] = await db
    .insert(confeccaoOrdemProducao)
    .values({
      id: `op-lote-op-2-${Date.now()}`,
      contaId: CONTA,
      numero: op2Numero,
      sequencialGlobal: 902,
      produtoId,
      criadaPorId: USR,
      atribuidoAId: USR,
    })
    .onConflictDoNothing()
    .returning();
  opId2 =
    op2?.id ??
    (
      await db
        .select({ id: confeccaoOrdemProducao.id })
        .from(confeccaoOrdemProducao)
        .where(eq(confeccaoOrdemProducao.numero, op2Numero))
        .limit(1)
    )[0].id;

  // Limpa lotes residuais de runs anteriores que casariam com os nomes
  // exercitados nos testes.
  await db
    .delete(loteCadastrado)
    .where(eq(loteCadastrado.contaId, CONTA));
});

after(async () => {
  await db
    .delete(loteCadastrado)
    .where(eq(loteCadastrado.contaId, CONTA));
  await db
    .delete(confeccaoOrdemProducao)
    .where(eq(confeccaoOrdemProducao.contaId, CONTA));
  await db
    .delete(confeccaoProduto)
    .where(eq(confeccaoProduto.contaId, CONTA));
});

test("lote inexistente → INSERT com FK preenchida", async () => {
  const result = await db.transaction((tx) =>
    vincularLoteAOP(tx, {
      contaId: CONTA,
      opId: opId1,
      opNumero: op1Numero,
    }),
  );
  assert.equal(result.criado, true);

  const rows = await db
    .select()
    .from(loteCadastrado)
    .where(eq(loteCadastrado.id, result.loteId));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].nome, op1Numero);
  assert.equal(rows[0].ordemProducaoId, opId1);
});

test("lote já existe sem FK → UPDATE da FK, retorna criado=false", async () => {
  // Reseta: limpa lote anterior e cria um "legado" sem FK.
  await db
    .delete(loteCadastrado)
    .where(eq(loteCadastrado.contaId, CONTA));
  const legadoId = `lote-legado-${Date.now()}`;
  await db.insert(loteCadastrado).values({
    id: legadoId,
    contaId: CONTA,
    nome: op1Numero,
    // ordemProducaoId omitido → NULL
  });

  const result = await db.transaction((tx) =>
    vincularLoteAOP(tx, {
      contaId: CONTA,
      opId: opId1,
      opNumero: op1Numero,
    }),
  );
  assert.equal(result.criado, false);
  assert.equal(result.loteId, legadoId);

  const [updated] = await db
    .select()
    .from(loteCadastrado)
    .where(eq(loteCadastrado.id, legadoId));
  assert.equal(updated.ordemProducaoId, opId1);
});

test("lote já vinculado à mesma OP → noop, retorna criado=false", async () => {
  // Estado deixado pelo teste anterior: legado com FK = opId1.
  const antes = await db
    .select()
    .from(loteCadastrado)
    .where(eq(loteCadastrado.contaId, CONTA));

  const result = await db.transaction((tx) =>
    vincularLoteAOP(tx, {
      contaId: CONTA,
      opId: opId1,
      opNumero: op1Numero,
    }),
  );
  assert.equal(result.criado, false);

  const depois = await db
    .select()
    .from(loteCadastrado)
    .where(eq(loteCadastrado.contaId, CONTA));
  assert.equal(depois.length, antes.length);
  assert.equal(depois[0].ordemProducaoId, opId1);
});

test("lote vinculado a outra OP → UPDATE pra OP nova (caso edge correção)", async () => {
  // Estado anterior: lote com FK = opId1. Reaponta pra opId2.
  const result = await db.transaction((tx) =>
    vincularLoteAOP(tx, {
      contaId: CONTA,
      opId: opId2,
      opNumero: op1Numero, // mesmo nome — só a FK muda
    }),
  );
  assert.equal(result.criado, false);

  const [updated] = await db
    .select()
    .from(loteCadastrado)
    .where(eq(loteCadastrado.id, result.loteId));
  assert.equal(updated.ordemProducaoId, opId2);
});
