import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  conta,
  confeccaoOrdemProducao,
  confeccaoProduto,
  confeccaoSubtask,
  user,
  usuarioConta,
} from "@/lib/db/schema";
import { criarOP } from "./criar-op";
import {
  concluirSubtask,
  iniciarSubtask,
  TransicaoSubtaskError,
} from "./transicao-subtask";

const CONTA = "transicao-test-conta";
const ADMIN = "transicao-test-admin";

let produtoId: string;

before(async () => {
  await db
    .insert(conta)
    .values({
      id: CONTA,
      nome: "Transicao Test",
      emailPrincipal: "transicao@test.com",
      plano: "enterprise",
      status: "ativa",
    })
    .onConflictDoNothing();
  await db
    .insert(user)
    .values({
      id: ADMIN,
      name: "Admin Transicao",
      email: "admin-transicao@test.com",
      role: "admin",
    })
    .onConflictDoNothing();
  await db
    .insert(usuarioConta)
    .values({
      id: `uc-${ADMIN}-${CONTA}`,
      usuarioId: ADMIN,
      contaId: CONTA,
      papel: "admin",
      ativo: true,
    })
    .onConflictDoNothing();
  const [prod] = await db
    .insert(confeccaoProduto)
    .values({
      id: `prod-trans-${Date.now()}`,
      contaId: CONTA,
      nome: "Produto Transicao Test",
    })
    .returning();
  produtoId = prod.id;
});

after(async () => {
  await db.delete(conta).where(eq(conta.id, CONTA));
  await db.delete(user).where(eq(user.id, ADMIN));
});

test("iniciarSubtask: pendente → em_andamento + iniciada_em + nota", async () => {
  const { subtasks } = await db.transaction(async (tx) =>
    criarOP(tx, {
      contaId: CONTA,
      criadaPorId: ADMIN,
      data: { produtoId, temVies: false, atribuidoAId: ADMIN },
    }),
  );
  const primeira = subtasks[0]; // OPBUY

  const result = await db.transaction(async (tx) =>
    iniciarSubtask(tx, {
      contaId: CONTA,
      subtaskId: primeira.id,
      usuarioId: ADMIN,
    }),
  );

  assert.equal(result.status, "em_andamento");
  assert.ok(result.iniciadaEm instanceof Date);

  // DB consistente
  const [st] = await db
    .select()
    .from(confeccaoSubtask)
    .where(eq(confeccaoSubtask.id, primeira.id));
  assert.equal(st.status, "em_andamento");
  assert.ok(st.iniciadaEm);
});

test("iniciarSubtask: subtask bloqueada → erro status_invalido", async () => {
  const { subtasks } = await db.transaction(async (tx) =>
    criarOP(tx, {
      contaId: CONTA,
      criadaPorId: ADMIN,
      data: { produtoId, temVies: false, atribuidoAId: ADMIN },
    }),
  );
  const segunda = subtasks[1]; // OPRIS — bloqueada

  await assert.rejects(
    () =>
      db.transaction(async (tx) =>
        iniciarSubtask(tx, {
          contaId: CONTA,
          subtaskId: segunda.id,
          usuarioId: ADMIN,
        }),
      ),
    (err) =>
      err instanceof TransicaoSubtaskError && err.code === "status_invalido",
  );
});

test("concluirSubtask: em_andamento → concluida + desbloqueia próxima", async () => {
  const { subtasks } = await db.transaction(async (tx) =>
    criarOP(tx, {
      contaId: CONTA,
      criadaPorId: ADMIN,
      data: { produtoId, temVies: false, atribuidoAId: ADMIN },
    }),
  );
  const primeira = subtasks[0]; // OPBUY
  const segunda = subtasks[1]; // OPRIS

  // Iniciar primeira
  await db.transaction(async (tx) =>
    iniciarSubtask(tx, {
      contaId: CONTA,
      subtaskId: primeira.id,
      usuarioId: ADMIN,
    }),
  );

  // Concluir primeira
  const result = await db.transaction(async (tx) =>
    concluirSubtask(tx, {
      contaId: CONTA,
      subtaskId: primeira.id,
      usuarioId: ADMIN,
    }),
  );

  assert.equal(result.status, "concluida");
  assert.ok(result.proximaDesbloqueada);
  assert.equal(result.proximaDesbloqueada!.id, segunda.id);

  // Segunda deve estar pendente agora
  const [seg] = await db
    .select()
    .from(confeccaoSubtask)
    .where(eq(confeccaoSubtask.id, segunda.id));
  assert.equal(seg.status, "pendente");
});

test("concluirSubtask: última subtask → OP marcada como concluída", async () => {
  const { op, subtasks } = await db.transaction(async (tx) =>
    criarOP(tx, {
      contaId: CONTA,
      criadaPorId: ADMIN,
      data: { produtoId, temVies: false, atribuidoAId: ADMIN },
    }),
  );

  // Avança todas as subtasks até a última (pelo helper iniciar+concluir)
  for (const st of subtasks) {
    await db.transaction(async (tx) =>
      iniciarSubtask(tx, {
        contaId: CONTA,
        subtaskId: st.id,
        usuarioId: ADMIN,
      }),
    );
    await db.transaction(async (tx) =>
      concluirSubtask(tx, {
        contaId: CONTA,
        subtaskId: st.id,
        usuarioId: ADMIN,
      }),
    );
  }

  // OP deve estar concluida
  const [opDb] = await db
    .select({
      status: confeccaoOrdemProducao.status,
      concluidaEm: confeccaoOrdemProducao.concluidaEm,
    })
    .from(confeccaoOrdemProducao)
    .where(eq(confeccaoOrdemProducao.id, op.id));
  assert.equal(opDb.status, "concluida");
  assert.ok(opDb.concluidaEm);
});

test("concluirSubtask: subtask pendente (não em_andamento) → erro", async () => {
  const { subtasks } = await db.transaction(async (tx) =>
    criarOP(tx, {
      contaId: CONTA,
      criadaPorId: ADMIN,
      data: { produtoId, temVies: false, atribuidoAId: ADMIN },
    }),
  );
  // Tenta concluir uma subtask pendente sem iniciar
  await assert.rejects(
    () =>
      db.transaction(async (tx) =>
        concluirSubtask(tx, {
          contaId: CONTA,
          subtaskId: subtasks[0].id, // OPBUY pendente
          usuarioId: ADMIN,
        }),
      ),
    (err) =>
      err instanceof TransicaoSubtaskError && err.code === "status_invalido",
  );
});
