import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  conta,
  confeccaoNota,
  confeccaoOrdemProducao,
  confeccaoProduto,
  user,
  usuarioConta,
} from "@/lib/db/schema";
import { criarOP } from "./criar-op";
import { cancelarOP, CancelarOPError } from "./cancelar-op";

const CONTA = "cancelar-op-test-conta";
const ADMIN_A = "cancelar-op-test-admin-a";
const ADMIN_B = "cancelar-op-test-admin-b";
const FUNC = "cancelar-op-test-func";

let produtoId: string;

before(async () => {
  await db
    .insert(conta)
    .values({
      id: CONTA,
      nome: "CancelarOP Test",
      emailPrincipal: "cancelar-op@test.com",
      plano: "enterprise",
      status: "ativa",
    })
    .onConflictDoNothing();

  await db
    .insert(user)
    .values([
      {
        id: ADMIN_A,
        name: "Admin A",
        email: "admin-a-cancelar@test.com",
        role: "admin",
      },
      {
        id: ADMIN_B,
        name: "Admin B",
        email: "admin-b-cancelar@test.com",
        role: "admin",
      },
      {
        id: FUNC,
        name: "Funcionario Cancel",
        email: "func-cancelar@test.com",
        role: "funcionario",
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(usuarioConta)
    .values([
      {
        id: `uc-${ADMIN_A}-${CONTA}`,
        usuarioId: ADMIN_A,
        contaId: CONTA,
        papel: "admin",
        ativo: true,
      },
      {
        id: `uc-${ADMIN_B}-${CONTA}`,
        usuarioId: ADMIN_B,
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

  const [prod] = await db
    .insert(confeccaoProduto)
    .values({
      id: `prod-cancel-${Date.now()}`,
      contaId: CONTA,
      nome: "Produto Cancelar Test",
    })
    .returning();
  produtoId = prod.id;
});

after(async () => {
  await db.delete(conta).where(eq(conta.id, CONTA));
  await db.delete(user).where(eq(user.id, ADMIN_A));
  await db.delete(user).where(eq(user.id, ADMIN_B));
  await db.delete(user).where(eq(user.id, FUNC));
});

async function novaOp() {
  return db.transaction(async (tx) =>
    criarOP(tx, {
      contaId: CONTA,
      criadaPorId: ADMIN_A,
      data: { produtoId, temVies: false, atribuidoAId: FUNC },
    }),
  );
}

test("cancelarOP: em_andamento sem autorizador — sucesso", async () => {
  const { op } = await novaOp();
  const result = await db.transaction(async (tx) =>
    cancelarOP(tx, {
      contaId: CONTA,
      opNumero: op.numero,
      canceladaPorId: ADMIN_A,
      justificativa: "Pedido suspenso pelo cliente.",
    }),
  );
  assert.equal(result.op.statusAnterior, "em_andamento");
  assert.equal(result.autorizadoPorNome, null);

  const [opPos] = await db
    .select({
      status: confeccaoOrdemProducao.status,
      canceladaPorId: confeccaoOrdemProducao.canceladaPorId,
      cancelamentoAutorizadoPorId:
        confeccaoOrdemProducao.cancelamentoAutorizadoPorId,
      cancelamentoJustificativa:
        confeccaoOrdemProducao.cancelamentoJustificativa,
    })
    .from(confeccaoOrdemProducao)
    .where(eq(confeccaoOrdemProducao.id, op.id));
  assert.equal(opPos.status, "cancelada");
  assert.equal(opPos.canceladaPorId, ADMIN_A);
  assert.equal(opPos.cancelamentoAutorizadoPorId, null);
  assert.equal(opPos.cancelamentoJustificativa, "Pedido suspenso pelo cliente.");
});

test("cancelarOP: cria nota de auditoria com acao=cancelar_op", async () => {
  const { op } = await novaOp();
  await db.transaction(async (tx) =>
    cancelarOP(tx, {
      contaId: CONTA,
      opNumero: op.numero,
      canceladaPorId: ADMIN_A,
      justificativa: "Erro grosseiro na criação.",
    }),
  );
  const notas = await db
    .select()
    .from(confeccaoNota)
    .where(eq(confeccaoNota.ordemProducaoId, op.id));
  const nota = notas.find(
    (n) =>
      n.isAuditoria &&
      (n.metadata as Record<string, unknown> | null)?.acao === "cancelar_op",
  );
  assert.ok(nota, "nota de auditoria de cancelamento ausente");
});

test("cancelarOP: tentar cancelar OP já cancelada → ja_cancelada", async () => {
  const { op } = await novaOp();
  await db.transaction(async (tx) =>
    cancelarOP(tx, {
      contaId: CONTA,
      opNumero: op.numero,
      canceladaPorId: ADMIN_A,
      justificativa: "Cancelado primeira vez.",
    }),
  );
  await assert.rejects(
    db.transaction(async (tx) =>
      cancelarOP(tx, {
        contaId: CONTA,
        opNumero: op.numero,
        canceladaPorId: ADMIN_A,
        justificativa: "Cancelado segunda vez.",
      }),
    ),
    (err) =>
      err instanceof CancelarOPError && err.code === "ja_cancelada",
  );
});

test("cancelarOP: opNumero não existente → op_nao_encontrada", async () => {
  await assert.rejects(
    db.transaction(async (tx) =>
      cancelarOP(tx, {
        contaId: CONTA,
        opNumero: "OP99999999",
        canceladaPorId: ADMIN_A,
        justificativa: "Nada existe.",
      }),
    ),
    (err) =>
      err instanceof CancelarOPError && err.code === "op_nao_encontrada",
  );
});

test("cancelarOP: OP concluida sem autorizadoPorId → requer_autorizacao_dupla", async () => {
  const { op } = await novaOp();
  // Marca como concluida manualmente
  await db
    .update(confeccaoOrdemProducao)
    .set({ status: "concluida", concluidaEm: new Date() })
    .where(eq(confeccaoOrdemProducao.id, op.id));

  await assert.rejects(
    db.transaction(async (tx) =>
      cancelarOP(tx, {
        contaId: CONTA,
        opNumero: op.numero,
        canceladaPorId: ADMIN_A,
        justificativa: "Mudou de ideia.",
      }),
    ),
    (err) =>
      err instanceof CancelarOPError &&
      err.code === "requer_autorizacao_dupla",
  );
});

test("cancelarOP: OP concluida com autorizadoPorId == canceladaPorId → autorizador_invalido", async () => {
  const { op } = await novaOp();
  await db
    .update(confeccaoOrdemProducao)
    .set({ status: "concluida", concluidaEm: new Date() })
    .where(eq(confeccaoOrdemProducao.id, op.id));

  await assert.rejects(
    db.transaction(async (tx) =>
      cancelarOP(tx, {
        contaId: CONTA,
        opNumero: op.numero,
        canceladaPorId: ADMIN_A,
        autorizadoPorId: ADMIN_A,
        justificativa: "Autoriza eu mesmo.",
      }),
    ),
    (err) =>
      err instanceof CancelarOPError && err.code === "autorizador_invalido",
  );
});

test("cancelarOP: OP concluida com autorizador não admin → autorizador_invalido", async () => {
  const { op } = await novaOp();
  await db
    .update(confeccaoOrdemProducao)
    .set({ status: "concluida", concluidaEm: new Date() })
    .where(eq(confeccaoOrdemProducao.id, op.id));

  await assert.rejects(
    db.transaction(async (tx) =>
      cancelarOP(tx, {
        contaId: CONTA,
        opNumero: op.numero,
        canceladaPorId: ADMIN_A,
        autorizadoPorId: FUNC, // operador, não admin
        justificativa: "Autoriza um operador.",
      }),
    ),
    (err) =>
      err instanceof CancelarOPError && err.code === "autorizador_invalido",
  );
});

test("cancelarOP: OP concluida com 2 admins distintos — sucesso, autorizador gravado", async () => {
  const { op } = await novaOp();
  await db
    .update(confeccaoOrdemProducao)
    .set({ status: "concluida", concluidaEm: new Date() })
    .where(eq(confeccaoOrdemProducao.id, op.id));

  const result = await db.transaction(async (tx) =>
    cancelarOP(tx, {
      contaId: CONTA,
      opNumero: op.numero,
      canceladaPorId: ADMIN_A,
      autorizadoPorId: ADMIN_B,
      justificativa: "Cancelamento autorizado.",
    }),
  );
  assert.equal(result.op.statusAnterior, "concluida");
  assert.equal(result.autorizadoPorNome, "Admin B");

  const [opPos] = await db
    .select({
      status: confeccaoOrdemProducao.status,
      cancelamentoAutorizadoPorId:
        confeccaoOrdemProducao.cancelamentoAutorizadoPorId,
    })
    .from(confeccaoOrdemProducao)
    .where(eq(confeccaoOrdemProducao.id, op.id));
  assert.equal(opPos.status, "cancelada");
  assert.equal(opPos.cancelamentoAutorizadoPorId, ADMIN_B);
});

test("cancelarOP: OP de outra conta → op_nao_encontrada (RLS implícito via filtro)", async () => {
  const { op } = await novaOp();
  await assert.rejects(
    db.transaction(async (tx) =>
      cancelarOP(tx, {
        contaId: "outra-conta-inexistente",
        opNumero: op.numero,
        canceladaPorId: ADMIN_A,
        justificativa: "Tenta cancelar de fora.",
      }),
    ),
    (err) =>
      err instanceof CancelarOPError && err.code === "op_nao_encontrada",
  );
});

// silence unused
void and;
