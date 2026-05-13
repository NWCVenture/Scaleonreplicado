import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  conta,
  confeccaoNota,
  confeccaoOrdemProducao,
  confeccaoProduto,
  confeccaoSubtask,
  user,
  usuarioConta,
} from "@/lib/db/schema";
import { criarOP, CriarOPError } from "./criar-op";

const CONTA = "criar-op-test-conta";
const ADMIN = "criar-op-test-admin";
const FUNC = "criar-op-test-func";

let produtoId: string;

before(async () => {
  await db
    .insert(conta)
    .values({
      id: CONTA,
      nome: "CriarOP Test",
      emailPrincipal: "criar-op@test.com",
      plano: "enterprise",
      status: "ativa",
    })
    .onConflictDoNothing();

  await db
    .insert(user)
    .values([
      {
        id: ADMIN,
        name: "Admin Test",
        email: "admin-criar-op@test.com",
        role: "admin",
      },
      {
        id: FUNC,
        name: "Funcionario Test",
        email: "func-criar-op@test.com",
        role: "funcionario",
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(usuarioConta)
    .values([
      {
        id: `uc-${ADMIN}-${CONTA}`,
        usuarioId: ADMIN,
        contaId: CONTA,
        papel: "admin",
        ativo: true,
      },
      {
        id: `uc-${FUNC}-${CONTA}`,
        usuarioId: FUNC,
        contaId: CONTA,
        papel: "operador",
        ativo: true,
      },
    ])
    .onConflictDoNothing();

  // Cria produto pra OPs de teste
  const [prod] = await db
    .insert(confeccaoProduto)
    .values({
      id: `prod-${Date.now()}`,
      contaId: CONTA,
      nome: "Camiseta Polo Test",
    })
    .returning();
  produtoId = prod.id;
});

after(async () => {
  // Cascade limpa OPs/subtasks/notas via FKs
  await db.delete(conta).where(eq(conta.id, CONTA));
  await db.delete(user).where(eq(user.id, ADMIN));
  await db.delete(user).where(eq(user.id, FUNC));
});

test("criarOP: temVies=false gera 5 subtasks na ordem correta", async () => {
  const result = await db.transaction(async (tx) =>
    criarOP(tx, {
      contaId: CONTA,
      criadaPorId: ADMIN,
      data: { produtoId, temVies: false, atribuidoAId: FUNC },
    }),
  );

  assert.equal(result.subtasks.length, 5);
  const prefixos = result.subtasks.map((s) => s.prefixo);
  assert.deepEqual(prefixos, ["OPBUY", "OPRIS", "OPCOR", "OPSEW", "OPCONF"]);
});

test("criarOP: temVies=true gera 6 subtasks com Viés entre Corte e Costura", async () => {
  const result = await db.transaction(async (tx) =>
    criarOP(tx, {
      contaId: CONTA,
      criadaPorId: ADMIN,
      data: { produtoId, temVies: true, atribuidoAId: FUNC },
    }),
  );

  assert.equal(result.subtasks.length, 6);
  const prefixos = result.subtasks.map((s) => s.prefixo);
  assert.deepEqual(prefixos, [
    "OPBUY",
    "OPRIS",
    "OPCOR",
    "OPVIE",
    "OPSEW",
    "OPCONF",
  ]);
});

test("criarOP: primeira subtask OPBUY entra pendente, demais bloqueada", async () => {
  const result = await db.transaction(async (tx) =>
    criarOP(tx, {
      contaId: CONTA,
      criadaPorId: ADMIN,
      data: { produtoId, temVies: false, atribuidoAId: FUNC },
    }),
  );

  assert.equal(result.subtasks[0].status, "pendente");
  for (let i = 1; i < result.subtasks.length; i++) {
    assert.equal(result.subtasks[i].status, "bloqueada");
  }
});

test("criarOP: número da OP segue formato OPMMAANNNN", async () => {
  const result = await db.transaction(async (tx) =>
    criarOP(tx, {
      contaId: CONTA,
      criadaPorId: ADMIN,
      data: { produtoId, temVies: false, atribuidoAId: FUNC },
    }),
  );
  assert.match(result.op.numero, /^OP\d{8}$/);
  assert.equal(result.op.numero.length, 10);
});

test("criarOP: subtasks compartilham o sequencial da OP-mãe", async () => {
  const result = await db.transaction(async (tx) =>
    criarOP(tx, {
      contaId: CONTA,
      criadaPorId: ADMIN,
      data: { produtoId, temVies: false, atribuidoAId: FUNC },
    }),
  );

  const seqStr = String(result.op.sequencial).padStart(4, "0");
  for (const st of result.subtasks) {
    // numero visível: [PREFIXO]NNNN
    assert.ok(
      st.numero.endsWith(seqStr),
      `Esperava ${st.numero} terminar com ${seqStr}`,
    );
    // idInterno: [PREFIXO]-MMAA-NNNN
    assert.ok(
      st.idInterno.endsWith(`-${seqStr}`),
      `Esperava ${st.idInterno} terminar com -${seqStr}`,
    );
  }
});

test("criarOP: cria nota de auditoria com metadata", async () => {
  const result = await db.transaction(async (tx) =>
    criarOP(tx, {
      contaId: CONTA,
      criadaPorId: ADMIN,
      data: {
        produtoId,
        temVies: true,
        atribuidoAId: FUNC,
        observacoes: "Teste de nota",
      },
    }),
  );

  const notas = await db
    .select()
    .from(confeccaoNota)
    .where(
      and(
        eq(confeccaoNota.ordemProducaoId, result.op.id),
        eq(confeccaoNota.isAuditoria, true),
      ),
    );
  assert.equal(notas.length, 1);
  const nota = notas[0];
  assert.equal(nota.autorId, null); // sistema (auditoria automática)
  assert.match(nota.conteudo, /Admin Test/);
  assert.match(nota.conteudo, /Funcionario Test/);
  assert.match(nota.conteudo, /Com Viés/);
  const md = nota.metadata as { temVies?: boolean };
  assert.equal(md.temVies, true);
});

test("criarOP: rollback se erro → nenhuma OP, subtask ou nota criadas", async () => {
  // Quantas OPs existiam antes
  const antes = await db
    .select({ id: confeccaoOrdemProducao.id })
    .from(confeccaoOrdemProducao)
    .where(eq(confeccaoOrdemProducao.contaId, CONTA));

  await assert.rejects(
    () =>
      db.transaction(async (tx) =>
        criarOP(tx, {
          contaId: CONTA,
          criadaPorId: ADMIN,
          data: {
            produtoId: "PRODUTO_QUE_NAO_EXISTE",
            temVies: false,
            atribuidoAId: FUNC,
          },
        }),
      ),
    (err) => err instanceof CriarOPError && err.code === "produto_nao_encontrado",
  );

  const depois = await db
    .select({ id: confeccaoOrdemProducao.id })
    .from(confeccaoOrdemProducao)
    .where(eq(confeccaoOrdemProducao.contaId, CONTA));
  assert.equal(depois.length, antes.length, "Rollback não funcionou");
});

test("criarOP: atribuído fora da conta → erro atribuido_invalido", async () => {
  await assert.rejects(
    () =>
      db.transaction(async (tx) =>
        criarOP(tx, {
          contaId: CONTA,
          criadaPorId: ADMIN,
          data: {
            produtoId,
            temVies: false,
            atribuidoAId: "USUARIO_INEXISTENTE",
          },
        }),
      ),
    (err) => err instanceof CriarOPError && err.code === "atribuido_invalido",
  );
});

test("criarOP: subtasks persistidas no banco (read-back)", async () => {
  const result = await db.transaction(async (tx) =>
    criarOP(tx, {
      contaId: CONTA,
      criadaPorId: ADMIN,
      data: { produtoId, temVies: false, atribuidoAId: FUNC },
    }),
  );

  const subtasksDB = await db
    .select()
    .from(confeccaoSubtask)
    .where(eq(confeccaoSubtask.ordemProducaoId, result.op.id));
  assert.equal(subtasksDB.length, 5);
  // ordemSequencial 1..5 sem buracos
  const ordens = subtasksDB
    .map((s) => s.ordemSequencial)
    .sort((a, b) => a - b);
  assert.deepEqual(ordens, [1, 2, 3, 4, 5]);
});
