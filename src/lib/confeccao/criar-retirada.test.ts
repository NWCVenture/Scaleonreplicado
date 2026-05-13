import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  conta,
  confeccaoFornecedor,
  confeccaoOrdemProducao,
  confeccaoProduto,
  confeccaoRetirada,
  confeccaoSubconferencia,
  confeccaoSubtask,
  user,
  usuarioConta,
} from "@/lib/db/schema";
import { criarOP } from "./criar-op";
import {
  cancelarRetirada,
  criarRetirada,
  RetiradaError,
} from "./criar-retirada";

const CONTA = "retirada-test-conta";
const USR = "retirada-test-user";

let produtoId: string;
let oficinaId: string;

before(async () => {
  await db
    .insert(conta)
    .values({
      id: CONTA,
      nome: "Retirada Test",
      emailPrincipal: "ret@test.com",
      plano: "enterprise",
      status: "ativa",
    })
    .onConflictDoNothing();
  await db
    .insert(user)
    .values({
      id: USR,
      name: "User Retirada",
      email: "user-ret@test.com",
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
      id: `prod-ret-${Date.now()}`,
      contaId: CONTA,
      nome: "Produto Retirada Test",
    })
    .returning();
  produtoId = prod.id;
  const [forn] = await db
    .insert(confeccaoFornecedor)
    .values({
      id: `forn-ret-${Date.now()}`,
      contaId: CONTA,
      nome: "Oficina Costura Test",
      categorias: ["costura"],
      whatsapp: "+5511999999999",
      enderecoRua: "Rua A",
      enderecoNumero: "1",
      enderecoBairro: "Centro",
      enderecoCep: "01000-000",
      enderecoCidade: "São Paulo",
      enderecoEstado: "SP",
    })
    .returning();
  oficinaId = forn.id;
});

after(async () => {
  await db.delete(conta).where(eq(conta.id, CONTA));
  await db.delete(user).where(eq(user.id, USR));
});

async function criarOPComOficinaCostura() {
  // Cria OP, popula payloads das subtasks com dados mínimos pra
  // validar saldo nas retiradas (Compra→rolos, Corte→peças, Costura→envio).
  const result = await db.transaction(async (tx) =>
    criarOP(tx, {
      contaId: CONTA,
      criadaPorId: USR,
      data: { produtoId, temVies: false, atribuidoAId: USR },
    }),
  );
  const subtaskCompra = result.subtasks.find((s) => s.prefixo === "OPBUY")!;
  const subtaskCorte = result.subtasks.find((s) => s.prefixo === "OPCOR")!;
  const subtaskCostura = result.subtasks.find((s) => s.prefixo === "OPSEW")!;
  const subtaskConf = result.subtasks.find((s) => s.prefixo === "OPCONF")!;
  // Compra: 5 rolos de co1
  await db
    .update(confeccaoSubtask)
    .set({
      payload: {
        pos: {
          rolosRecebidos: [
            { corId: "co1", pesos: [10, 10, 10, 10, 10] },
          ],
          precoKgEfetivo: 25,
          gramaturaGM2: 180,
          larguraRoloCm: 165,
        },
      },
    })
    .where(eq(confeccaoSubtask.id, subtaskCompra.id));
  // Corte: 1000 peças cortadas em M de co1
  await db
    .update(confeccaoSubtask)
    .set({
      payload: {
        oficinas: [
          {
            oficinaId: "of-corte",
            modoSeparacao: "por_cor",
            rolosEnviadosPorCor: { co1: 5 },
            folhasEnfesto: 10,
            rendimentoTotal: 1000,
            rendimentoPorTamanhoCor: [
              { tamanho: "M", corId: "co1", quantidade: 1000 },
            ],
            precoPorPeca: 1,
          },
        ],
      },
    })
    .where(eq(confeccaoSubtask.id, subtaskCorte.id));
  // Costura: oficina com 100 peças M co1 enviadas
  await db
    .update(confeccaoSubtask)
    .set({
      payload: {
        oficinas: [
          {
            oficinaId,
            statusInterno: "em_producao",
            pecasEnviadasPorTamanhoCor: [
              { tamanho: "M", corId: "co1", quantidade: 100 },
            ],
          },
        ],
      },
    })
    .where(eq(confeccaoSubtask.id, subtaskCostura.id));
  return { op: result.op, subtaskCostura, subtaskConf };
}

test("criarRetirada: cria retirada + subconferência + desbloqueia OPCONF", async () => {
  const { op, subtaskCostura, subtaskConf } = await criarOPComOficinaCostura();

  const result = await db.transaction(async (tx) =>
    criarRetirada(tx, {
      contaId: CONTA,
      subtaskCosturaId: subtaskCostura.id,
      oficinaId,
      tipo: "parcial",
      pecasPorTamanhoCor: { M: { co1: 50 } },
      dataRetirada: new Date(),
      usuarioId: USR,
    }),
  );

  assert.match(result.retirada.numero, /^OP\d+-RET-01$/);
  assert.equal(result.retirada.tipo, "parcial");
  assert.match(result.subconferencia.numero, /CONF-RET01$/);
  assert.equal(result.opConfDesbloqueada, true);

  // Confirma persistência
  const [r] = await db
    .select()
    .from(confeccaoRetirada)
    .where(eq(confeccaoRetirada.id, result.retirada.id));
  assert.ok(r);
  assert.equal(r.numero, result.retirada.numero);

  const [sc] = await db
    .select()
    .from(confeccaoSubconferencia)
    .where(eq(confeccaoSubconferencia.id, result.subconferencia.id));
  assert.ok(sc);
  assert.equal(sc.retiradaId, result.retirada.id);

  // OPCONF deve estar em_andamento
  const [stConf] = await db
    .select()
    .from(confeccaoSubtask)
    .where(eq(confeccaoSubtask.id, subtaskConf.id));
  assert.equal(stConf.status, "em_andamento");

  // OPSEW oficina statusInterno = retirada_parcial
  const [stSew] = await db
    .select()
    .from(confeccaoSubtask)
    .where(eq(confeccaoSubtask.id, subtaskCostura.id));
  const oficinas = (stSew.payload as { oficinas: Array<{ statusInterno: string }> })
    .oficinas;
  assert.equal(oficinas[0].statusInterno, "retirada_parcial");

  void op;
});

test("criarRetirada: tipo final → statusInterno = finalizada", async () => {
  const { subtaskCostura } = await criarOPComOficinaCostura();
  const result = await db.transaction(async (tx) =>
    criarRetirada(tx, {
      contaId: CONTA,
      subtaskCosturaId: subtaskCostura.id,
      oficinaId,
      tipo: "final",
      pecasPorTamanhoCor: { M: { co1: 100 } },
      dataRetirada: new Date(),
      usuarioId: USR,
    }),
  );

  const [stSew] = await db
    .select()
    .from(confeccaoSubtask)
    .where(eq(confeccaoSubtask.id, subtaskCostura.id));
  const oficinas = (stSew.payload as { oficinas: Array<{ statusInterno: string }> })
    .oficinas;
  assert.equal(oficinas[0].statusInterno, "finalizada");
  void result;
});

test("criarRetirada: numeração sequencial -RET-01, -RET-02, …", async () => {
  const { subtaskCostura } = await criarOPComOficinaCostura();
  const r1 = await db.transaction(async (tx) =>
    criarRetirada(tx, {
      contaId: CONTA,
      subtaskCosturaId: subtaskCostura.id,
      oficinaId,
      tipo: "parcial",
      pecasPorTamanhoCor: { M: { co1: 10 } },
      dataRetirada: new Date(),
      usuarioId: USR,
    }),
  );
  const r2 = await db.transaction(async (tx) =>
    criarRetirada(tx, {
      contaId: CONTA,
      subtaskCosturaId: subtaskCostura.id,
      oficinaId,
      tipo: "parcial",
      pecasPorTamanhoCor: { M: { co1: 10 } },
      dataRetirada: new Date(),
      usuarioId: USR,
    }),
  );
  assert.ok(r1.retirada.numero.endsWith("-RET-01"));
  assert.ok(r2.retirada.numero.endsWith("-RET-02"));
});

test("cancelarRetirada: subconferência sem contagem → cancela com sucesso", async () => {
  const { subtaskCostura } = await criarOPComOficinaCostura();
  const r = await db.transaction(async (tx) =>
    criarRetirada(tx, {
      contaId: CONTA,
      subtaskCosturaId: subtaskCostura.id,
      oficinaId,
      tipo: "parcial",
      pecasPorTamanhoCor: { M: { co1: 10 } },
      dataRetirada: new Date(),
      usuarioId: USR,
    }),
  );

  await db.transaction(async (tx) =>
    cancelarRetirada(tx, {
      contaId: CONTA,
      retiradaId: r.retirada.id,
      usuarioId: USR,
    }),
  );

  // Subconferência deve ter sido removida
  const subs = await db
    .select()
    .from(confeccaoSubconferencia)
    .where(eq(confeccaoSubconferencia.id, r.subconferencia.id));
  assert.equal(subs.length, 0);

  // Retirada deve estar marcada canceladaEm
  const [ret] = await db
    .select()
    .from(confeccaoRetirada)
    .where(eq(confeccaoRetirada.id, r.retirada.id));
  assert.ok(ret.canceladaEm);
});

test("cancelarRetirada: subconferência com contagem iniciada → erro", async () => {
  const { subtaskCostura } = await criarOPComOficinaCostura();
  const r = await db.transaction(async (tx) =>
    criarRetirada(tx, {
      contaId: CONTA,
      subtaskCosturaId: subtaskCostura.id,
      oficinaId,
      tipo: "parcial",
      pecasPorTamanhoCor: { M: { co1: 10 } },
      dataRetirada: new Date(),
      usuarioId: USR,
    }),
  );
  // Simula início da contagem (UPDATE pecasRecebidas)
  await db
    .update(confeccaoSubconferencia)
    .set({ pecasRecebidas: { M: { co1: 10 } } })
    .where(eq(confeccaoSubconferencia.id, r.subconferencia.id));

  await assert.rejects(
    () =>
      db.transaction(async (tx) =>
        cancelarRetirada(tx, {
          contaId: CONTA,
          retiradaId: r.retirada.id,
          usuarioId: USR,
        }),
      ),
    (err) =>
      err instanceof RetiradaError &&
      err.code === "subconferencia_em_andamento",
  );
});

test("criarRetirada: oficina não no payload → erro", async () => {
  const result = await db.transaction(async (tx) =>
    criarOP(tx, {
      contaId: CONTA,
      criadaPorId: USR,
      data: { produtoId, temVies: false, atribuidoAId: USR },
    }),
  );
  const subtaskCostura = result.subtasks.find((s) => s.prefixo === "OPSEW")!;
  // Sem popular oficinas no payload

  await assert.rejects(
    () =>
      db.transaction(async (tx) =>
        criarRetirada(tx, {
          contaId: CONTA,
          subtaskCosturaId: subtaskCostura.id,
          oficinaId,
          tipo: "parcial",
          pecasPorTamanhoCor: { M: { co1: 1 } },
          dataRetirada: new Date(),
          usuarioId: USR,
        }),
      ),
    (err) =>
      err instanceof RetiradaError && err.code === "oficina_nao_encontrada",
  );
});
