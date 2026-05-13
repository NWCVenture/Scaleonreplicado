import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { sql, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./index";
import {
  conta,
  confeccaoProduto,
  confeccaoFornecedor,
  confeccaoTipoTecido,
  confeccaoCor,
  confeccaoFornecedorTecidoPreco,
} from "./schema";

function matchDbError(pattern: RegExp) {
  return (err: unknown): true => {
    const e = err as { message?: string; cause?: { message?: string } };
    const combined = `${e?.message ?? ""} ${e?.cause?.message ?? ""}`;
    assert.match(combined, pattern);
    return true;
  };
}

const CONTA_A = "confeccao-test-A";
const CONTA_B = "confeccao-test-B";
const TEST_ROLE = "tenant_test";

const CONFECCAO_TABLES = [
  "confeccao_produto",
  "confeccao_fornecedor",
  "confeccao_tipo_tecido",
  "confeccao_cor",
  "confeccao_fornecedor_tecido_preco",
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
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ${CONFECCAO_TABLES.join(", ")} TO ${TEST_ROLE}`,
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

before(async () => {
  await ensureTestRole();

  await db
    .insert(conta)
    .values([
      {
        id: CONTA_A,
        nome: "Confecção Test A",
        emailPrincipal: "confeccao-a@test.com",
        plano: "enterprise",
        status: "ativa",
      },
      {
        id: CONTA_B,
        nome: "Confecção Test B",
        emailPrincipal: "confeccao-b@test.com",
        plano: "enterprise",
        status: "ativa",
      },
    ])
    .onConflictDoNothing();

  // FORCE temporariamente pra RLS valer mesmo pro postgres superuser local.
  // Em prod (Neon) o runtime role não tem BYPASSRLS, então FORCE não é necessário.
  for (const t of CONFECCAO_TABLES) {
    await db.execute(sql.raw(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY`));
  }
});

after(async () => {
  for (const t of CONFECCAO_TABLES) {
    await db.execute(sql.raw(`ALTER TABLE ${t} NO FORCE ROW LEVEL SECURITY`));
  }
  // Cleanup — cascade deleta tudo (FKs ON DELETE CASCADE)
  await db.delete(conta).where(eq(conta.id, CONTA_A));
  await db.delete(conta).where(eq(conta.id, CONTA_B));
});

test("RLS: produto inserido em A não é visível em B", async () => {
  const produtoId = nanoid();
  await runAsTenant(CONTA_A, async (tx) => {
    await tx.insert(confeccaoProduto).values({
      id: produtoId,
      contaId: CONTA_A,
      nome: "Camiseta Polo Test",
    });
  });

  const visiveisB = await runAsTenant(CONTA_B, (tx) =>
    tx.select().from(confeccaoProduto),
  );
  assert.equal(
    visiveisB.filter((p) => p.id === produtoId).length,
    0,
    "Produto de A vazou para B",
  );

  const visiveisA = await runAsTenant(CONTA_A, (tx) =>
    tx.select().from(confeccaoProduto),
  );
  assert.equal(
    visiveisA.filter((p) => p.id === produtoId).length,
    1,
    "Produto de A não aparece em A",
  );
});

test("Unique: (conta_id, nome) bloqueia produto duplicado", async () => {
  await db.insert(confeccaoProduto).values({
    id: nanoid(),
    contaId: CONTA_A,
    nome: "Produto Dup Test",
  });

  await assert.rejects(
    () =>
      db.insert(confeccaoProduto).values({
        id: nanoid(),
        contaId: CONTA_A,
        nome: "Produto Dup Test",
      }),
    matchDbError(/uq_confeccao_produto_nome_conta/),
  );
});

test("Cascade: deletar conta remove produtos, fornecedores, tecidos, cores", async () => {
  const tempContaId = "confeccao-test-CASCADE";
  await db.insert(conta).values({
    id: tempContaId,
    nome: "Cascade Test",
    emailPrincipal: "cascade@test.com",
    plano: "enterprise",
    status: "ativa",
  });

  await db.insert(confeccaoProduto).values({
    id: nanoid(),
    contaId: tempContaId,
    nome: "Produto Cascade",
  });
  await db.insert(confeccaoTipoTecido).values({
    id: nanoid(),
    contaId: tempContaId,
    nome: "Tipo Cascade",
  });
  await db.insert(confeccaoCor).values({
    id: nanoid(),
    contaId: tempContaId,
    nome: "Cor Cascade",
  });
  await db.insert(confeccaoFornecedor).values({
    id: nanoid(),
    contaId: tempContaId,
    nome: "Fornecedor Cascade",
    categorias: ["tecido"],
    whatsapp: "+55 11 99999-9999",
    enderecoRua: "Rua X",
    enderecoNumero: "123",
    enderecoBairro: "Centro",
    enderecoCep: "01234-567",
    enderecoCidade: "São Paulo",
    enderecoEstado: "SP",
  });

  await db.delete(conta).where(eq(conta.id, tempContaId));

  const restantes = await Promise.all([
    db
      .select()
      .from(confeccaoProduto)
      .where(eq(confeccaoProduto.contaId, tempContaId)),
    db
      .select()
      .from(confeccaoFornecedor)
      .where(eq(confeccaoFornecedor.contaId, tempContaId)),
    db
      .select()
      .from(confeccaoTipoTecido)
      .where(eq(confeccaoTipoTecido.contaId, tempContaId)),
    db
      .select()
      .from(confeccaoCor)
      .where(eq(confeccaoCor.contaId, tempContaId)),
  ]);
  for (const linhas of restantes) {
    assert.equal(linhas.length, 0, "Cascade não removeu");
  }
});

test("Cascade: deletar fornecedor remove fornecedor_tecido_preco vinculado", async () => {
  const fornecedorId = nanoid();
  const tipoTecidoId = nanoid();

  await db.insert(confeccaoFornecedor).values({
    id: fornecedorId,
    contaId: CONTA_A,
    nome: "Fornecedor Preço Test",
    categorias: ["tecido"],
    whatsapp: "+55 11 88888-8888",
    enderecoRua: "Rua Y",
    enderecoNumero: "456",
    enderecoBairro: "Vila",
    enderecoCep: "04567-890",
    enderecoCidade: "São Paulo",
    enderecoEstado: "SP",
  });

  await db.insert(confeccaoTipoTecido).values({
    id: tipoTecidoId,
    contaId: CONTA_A,
    nome: "Tecido Preço Test",
  });

  const precoId = nanoid();
  await db.insert(confeccaoFornecedorTecidoPreco).values({
    id: precoId,
    contaId: CONTA_A,
    fornecedorId,
    tipoTecidoId,
    precoKgSugerido: 25.5,
  });

  const before = await db
    .select()
    .from(confeccaoFornecedorTecidoPreco)
    .where(eq(confeccaoFornecedorTecidoPreco.id, precoId));
  assert.equal(before.length, 1);

  await db
    .delete(confeccaoFornecedor)
    .where(eq(confeccaoFornecedor.id, fornecedorId));

  const after = await db
    .select()
    .from(confeccaoFornecedorTecidoPreco)
    .where(eq(confeccaoFornecedorTecidoPreco.id, precoId));
  assert.equal(after.length, 0, "preço não cascadeou ao deletar fornecedor");
});

test("Array de enum: categorias = ['tecido', 'corte'] grava e recupera", async () => {
  const id = nanoid();
  await db.insert(confeccaoFornecedor).values({
    id,
    contaId: CONTA_A,
    nome: "Fornecedor Multi Categoria",
    categorias: ["tecido", "corte"],
    whatsapp: "+55 11 77777-7777",
    enderecoRua: "Rua Z",
    enderecoNumero: "789",
    enderecoBairro: "Bairro",
    enderecoCep: "12345-678",
    enderecoCidade: "São Paulo",
    enderecoEstado: "SP",
  });

  const [linha] = await db
    .select()
    .from(confeccaoFornecedor)
    .where(eq(confeccaoFornecedor.id, id));
  assert.deepEqual(linha.categorias, ["tecido", "corte"]);
});
