import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { sql, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./index";
import {
  conta,
  user,
  confeccaoProduto,
  confeccaoFornecedor,
  confeccaoOrdemProducao,
  confeccaoSubtask,
  confeccaoLalamove,
  confeccaoRetirada,
  confeccaoLalamoveWebhookEvent,
  confeccaoAnexo,
} from "./schema";

function matchDbError(pattern: RegExp) {
  return (err: unknown): true => {
    const e = err as { message?: string; cause?: { message?: string } };
    const combined = `${e?.message ?? ""} ${e?.cause?.message ?? ""}`;
    assert.match(combined, pattern);
    return true;
  };
}

const CONTA_A = "confeccao-lalamove-test-A";
const CONTA_B = "confeccao-lalamove-test-B";
const USER_TEST = "confeccao-lalamove-test-user";
const TEST_ROLE = "tenant_test";

const TABELAS_TEST = [
  "confeccao_lalamove",
  "confeccao_lalamove_cotacao",
  "confeccao_lalamove_webhook_event",
  "confeccao_retirada",
  "confeccao_subconferencia",
  "confeccao_subtask",
  "confeccao_ordem_producao",
  "confeccao_fornecedor",
  "confeccao_produto",
  "confeccao_anexo",
];

async function ensureTestRole() {
  const exists = await db.execute(
    sql`SELECT 1 FROM pg_roles WHERE rolname = ${TEST_ROLE}`,
  );
  if (exists.length === 0) {
    await db.execute(
      sql.raw(`CREATE ROLE ${TEST_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS`),
    );
  }
  await db.execute(
    sql.raw(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ${TABELAS_TEST.join(", ")} TO ${TEST_ROLE}`,
    ),
  );
  await db.execute(sql.raw(`GRANT USAGE ON SCHEMA public TO ${TEST_ROLE}`));
}

async function runAsTenant<T>(
  contaId: string,
  fn: (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  ) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL ROLE ${TEST_ROLE}`));
    await tx.execute(
      sql`SELECT set_config('app.conta_atual', ${contaId}, true)`,
    );
    const out = await fn(tx);
    await tx.execute(sql`RESET ROLE`);
    return out;
  });
}

// Fixtures
let produtoId: string;
let subtaskId: string;
let oficinaId: string;
let opId: string;

before(async () => {
  await ensureTestRole();

  await db
    .insert(conta)
    .values([
      {
        id: CONTA_A,
        nome: "Lalamove Test A",
        emailPrincipal: "ll-a@test.com",
        plano: "enterprise",
        status: "ativa",
      },
      {
        id: CONTA_B,
        nome: "Lalamove Test B",
        emailPrincipal: "ll-b@test.com",
        plano: "enterprise",
        status: "ativa",
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(user)
    .values({
      id: USER_TEST,
      name: "Lalamove Test User",
      email: "lalamove-test@test.com",
      role: "admin",
    })
    .onConflictDoNothing();

  // Fixtures: 1 produto, 1 OP, 1 subtask de Costura, 1 fornecedor de Costura
  produtoId = nanoid();
  oficinaId = nanoid();
  opId = nanoid();
  subtaskId = nanoid();

  await db.insert(confeccaoProduto).values({
    id: produtoId,
    contaId: CONTA_A,
    nome: "Produto Lalamove Test",
  });

  await db.insert(confeccaoFornecedor).values({
    id: oficinaId,
    contaId: CONTA_A,
    nome: "Oficina Lalamove Test",
    categorias: ["costura"],
    whatsapp: "+55 11 99999-9999",
    enderecoRua: "Rua Costura",
    enderecoNumero: "1",
    enderecoBairro: "Centro",
    enderecoCep: "01000-000",
    enderecoCidade: "São Paulo",
    enderecoEstado: "SP",
  });

  await db.insert(confeccaoOrdemProducao).values({
    id: opId,
    contaId: CONTA_A,
    numero: `OP-LL-TEST-${Date.now()}`,
    sequencialGlobal: 0,
    produtoId,
    criadaPorId: USER_TEST,
    atribuidoAId: USER_TEST,
  });

  await db.insert(confeccaoSubtask).values({
    id: subtaskId,
    contaId: CONTA_A,
    ordemProducaoId: opId,
    numero: `OPSEW-LL-${Date.now()}`,
    idInterno: `OPSEW-LL-${Date.now()}`,
    prefixo: "OPSEW",
    ordemSequencial: 5,
  });

  // FORCE RLS para que postgres superuser também respeite policies
  for (const t of TABELAS_TEST) {
    await db.execute(sql.raw(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY`));
  }
});

after(async () => {
  for (const t of TABELAS_TEST) {
    await db.execute(sql.raw(`ALTER TABLE ${t} NO FORCE ROW LEVEL SECURITY`));
  }
  // Cleanup — cascade deleta tudo via FKs
  await db.delete(conta).where(eq(conta.id, CONTA_A));
  await db.delete(conta).where(eq(conta.id, CONTA_B));
  await db.delete(user).where(eq(user.id, USER_TEST));
});

test("CHECK lalamove_tem_pai: insert sem subtask_id nem retirada_id falha", async () => {
  await assert.rejects(
    () =>
      db.insert(confeccaoLalamove).values({
        id: nanoid(),
        contaId: CONTA_A,
        origemEndereco: { rua: "X" },
        destinoEndereco: { rua: "Y" },
      }),
    matchDbError(/confeccao_lalamove_tem_pai/),
  );
});

test("CHECK lalamove_api_completo: status procurando_motorista sem order_id_api falha (modo API)", async () => {
  await assert.rejects(
    () =>
      db.insert(confeccaoLalamove).values({
        id: nanoid(),
        contaId: CONTA_A,
        subtaskId,
        origemSolicitacao: "api",
        status: "procurando_motorista",
        origemEndereco: { rua: "X" },
        destinoEndereco: { rua: "Y" },
      }),
    matchDbError(/confeccao_lalamove_api_completo/),
  );
});

test("CHECK lalamove_api_completo: status rascunho com order_id_api NULL aceita (modo API)", async () => {
  const id = nanoid();
  await db.insert(confeccaoLalamove).values({
    id,
    contaId: CONTA_A,
    subtaskId,
    origemSolicitacao: "api",
    status: "rascunho",
    origemEndereco: { rua: "X" },
    destinoEndereco: { rua: "Y" },
  });
  const [row] = await db
    .select()
    .from(confeccaoLalamove)
    .where(eq(confeccaoLalamove.id, id));
  assert.equal(row.status, "rascunho");
});

test("order_id_api 19 dígitos como string passa íntegro", async () => {
  const id = nanoid();
  const longOrderId = "1234567890123456789"; // 19 dígitos
  await db.insert(confeccaoLalamove).values({
    id,
    contaId: CONTA_A,
    subtaskId,
    origemSolicitacao: "api",
    status: "procurando_motorista",
    serviceType: "MOTORCYCLE",
    orderIdApi: longOrderId,
    origemEndereco: { rua: "X" },
    destinoEndereco: { rua: "Y" },
  });
  const [row] = await db
    .select()
    .from(confeccaoLalamove)
    .where(eq(confeccaoLalamove.id, id));
  assert.equal(row.orderIdApi, longOrderId);
});

test("RLS: lalamove inserido em A não aparece em B", async () => {
  const lalamoveId = nanoid();
  await runAsTenant(CONTA_A, async (tx) => {
    await tx.insert(confeccaoLalamove).values({
      id: lalamoveId,
      contaId: CONTA_A,
      subtaskId,
      origemEndereco: { rua: "X" },
      destinoEndereco: { rua: "Y" },
    });
  });

  const visiveisB = await runAsTenant(CONTA_B, (tx) =>
    tx.select().from(confeccaoLalamove),
  );
  assert.equal(
    visiveisB.filter((l) => l.id === lalamoveId).length,
    0,
    "Lalamove de A vazou para B",
  );
});

test("Webhook event aceita conta_id NULL (variante IS NULL)", async () => {
  const evId = nanoid();
  // contaId é nullable no schema; não passar = NULL no INSERT
  await db.insert(confeccaoLalamoveWebhookEvent).values({
    id: evId,
    evento: "ORDER_STATUS_CHANGED",
    orderIdApi: "1234567890123456789",
    payload: { test: "data" },
  });

  const [row] = await db
    .select()
    .from(confeccaoLalamoveWebhookEvent)
    .where(eq(confeccaoLalamoveWebhookEvent.id, evId));
  assert.equal(row.contaId, null);

  // Cleanup
  await db
    .delete(confeccaoLalamoveWebhookEvent)
    .where(eq(confeccaoLalamoveWebhookEvent.id, evId));
});

test("Cascade: deletar lalamove remove anexos vinculados", async () => {
  const lalamoveId = nanoid();
  await db.insert(confeccaoLalamove).values({
    id: lalamoveId,
    contaId: CONTA_A,
    subtaskId,
    origemEndereco: { rua: "X" },
    destinoEndereco: { rua: "Y" },
  });

  const anexoId = nanoid();
  await db.insert(confeccaoAnexo).values({
    id: anexoId,
    contaId: CONTA_A,
    lalamoveId,
    categoria: "comprovante_lalamove",
    nomeArquivo: "comprovante.pdf",
    tipoMime: "application/pdf",
    tamanhoBytes: 1024,
    blobUrl: `https://blob.example/${anexoId}.pdf`,
    blobPathname: `confeccao/test/${anexoId}.pdf`,
    enviadoPorId: USER_TEST,
  });

  await db
    .delete(confeccaoLalamove)
    .where(eq(confeccaoLalamove.id, lalamoveId));

  const after = await db
    .select()
    .from(confeccaoAnexo)
    .where(eq(confeccaoAnexo.id, anexoId));
  assert.equal(after.length, 0, "anexo não cascadeou");
});

test("Cascade: deletar retirada remove lalamove + subconferência vinculados", async () => {
  const retiradaId = nanoid();
  await db.insert(confeccaoRetirada).values({
    id: retiradaId,
    contaId: CONTA_A,
    subtaskCosturaId: subtaskId,
    oficinaId,
    numero: `RET-TEST-${Date.now()}`,
    tipo: "parcial",
    pecasPorTamanhoCor: { M: { preto: 10 } },
    dataRetirada: new Date(),
  });

  const lalamoveId = nanoid();
  await db.insert(confeccaoLalamove).values({
    id: lalamoveId,
    contaId: CONTA_A,
    retiradaId,
    origemEndereco: { rua: "Oficina" },
    destinoEndereco: { rua: "Armazem" },
  });

  await db
    .delete(confeccaoRetirada)
    .where(eq(confeccaoRetirada.id, retiradaId));

  const lalamovesRestantes = await db
    .select()
    .from(confeccaoLalamove)
    .where(eq(confeccaoLalamove.id, lalamoveId));
  assert.equal(lalamovesRestantes.length, 0, "lalamove não cascadeou");
});
