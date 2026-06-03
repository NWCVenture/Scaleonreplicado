import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { sql, and, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./index";
import {
  conta,
  modeloPrincipal,
  canaisVenda,
  tamanhoAlias,
  corAlias,
  feriado,
  canalRegraPrazo,
  categoriaSku,
} from "./schema";
import { aplicarRegrasPrazoDefault } from "./seed-central-envios-defaults";

function matchDbError(pattern: RegExp) {
  return (err: unknown): true => {
    const e = err as { message?: string; cause?: { message?: string } };
    const combined = `${e?.message ?? ""} ${e?.cause?.message ?? ""}`;
    assert.match(combined, pattern);
    return true;
  };
}

const CONTA_A = "ce-test-A";
const CONTA_B = "ce-test-B";
const CONTA_SEED = "ce-test-SEED";
const TEST_ROLE = "tenant_test";

// Tabelas com RLS a forçar (superuser local tem BYPASSRLS — sem FORCE
// as policies não disparam mesmo com SET ROLE).
const CE_TABLES = [
  "tamanho_alias",
  "cor_alias",
  "feriado",
  "canal_regra_prazo",
  "categoria_sku",
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
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ${CE_TABLES.join(", ")} TO ${TEST_ROLE}`,
    ),
  );
  // Pra teste de cascade, precisamos inserir em modelo_principal sob o role
  await db.execute(
    sql.raw(`GRANT SELECT, INSERT, UPDATE, DELETE ON modelo_principal TO ${TEST_ROLE}`),
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
        nome: "CE Test A",
        emailPrincipal: "ce-a@test.com",
        plano: "enterprise",
        status: "ativa",
      },
      {
        id: CONTA_B,
        nome: "CE Test B",
        emailPrincipal: "ce-b@test.com",
        plano: "enterprise",
        status: "ativa",
      },
      {
        id: CONTA_SEED,
        nome: "CE Test SEED",
        emailPrincipal: "ce-seed@test.com",
        plano: "enterprise",
        status: "ativa",
      },
    ])
    .onConflictDoNothing();

  for (const t of CE_TABLES) {
    await db.execute(sql.raw(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY`));
  }
});

after(async () => {
  for (const t of CE_TABLES) {
    await db.execute(sql.raw(`ALTER TABLE ${t} NO FORCE ROW LEVEL SECURITY`));
  }
  // Cleanup — cascade deleta tudo
  await db.delete(conta).where(eq(conta.id, CONTA_A));
  await db.delete(conta).where(eq(conta.id, CONTA_B));
  await db.delete(conta).where(eq(conta.id, CONTA_SEED));
});

// 1 — RLS
test("RLS: tamanho_alias inserido em A não é visível em B", async () => {
  const aliasId = nanoid();
  await runAsTenant(CONTA_A, async (tx) => {
    await tx.insert(tamanhoAlias).values({
      id: aliasId,
      contaId: CONTA_A,
      modeloId: null,
      codigoAlias: "EXG-A",
      codigoReal: "EGG",
    });
  });

  const visiveisB = await runAsTenant(CONTA_B, (tx) =>
    tx.select().from(tamanhoAlias),
  );
  assert.equal(
    visiveisB.filter((a) => a.id === aliasId).length,
    0,
    "Alias de A vazou para B",
  );

  const visiveisA = await runAsTenant(CONTA_A, (tx) =>
    tx.select().from(tamanhoAlias),
  );
  assert.equal(
    visiveisA.filter((a) => a.id === aliasId).length,
    1,
    "Alias de A não aparece em A",
  );
});

// 2 — NULLS NOT DISTINCT
test("Unique NULLS NOT DISTINCT: dois aliases globais com mesmo codigoAlias falham", async () => {
  await db.insert(tamanhoAlias).values({
    id: nanoid(),
    contaId: CONTA_A,
    modeloId: null,
    codigoAlias: "DUP-GLOBAL",
    codigoReal: "GG",
  });

  await assert.rejects(
    () =>
      db.insert(tamanhoAlias).values({
        id: nanoid(),
        contaId: CONTA_A,
        modeloId: null,
        codigoAlias: "DUP-GLOBAL",
        codigoReal: "EGG",
      }),
    matchDbError(/uq_tamanho_alias_codigo/),
  );
});

// 3 — escopo diferente: modelo + global passam
test("Escopo: alias por modelo + alias global com mesmo codigoAlias coexistem", async () => {
  // Modelo de teste em CONTA_A
  const modeloId = nanoid();
  await db.insert(modeloPrincipal).values({
    id: modeloId,
    codigo: `M-${nanoid(6)}`,
    contaId: CONTA_A,
  });

  // Global
  await db.insert(tamanhoAlias).values({
    id: nanoid(),
    contaId: CONTA_A,
    modeloId: null,
    codigoAlias: "ESCOPO",
    codigoReal: "EGG",
  });

  // Por modelo — mesmo codigoAlias, escopo diferente
  await db.insert(tamanhoAlias).values({
    id: nanoid(),
    contaId: CONTA_A,
    modeloId,
    codigoAlias: "ESCOPO",
    codigoReal: "GG",
  });

  const linhas = await db
    .select()
    .from(tamanhoAlias)
    .where(
      and(
        eq(tamanhoAlias.contaId, CONTA_A),
        eq(tamanhoAlias.codigoAlias, "ESCOPO"),
      ),
    );
  assert.equal(linhas.length, 2);
});

// 4 — cascade
test("Cascade: deletar modelo_principal remove tamanho_alias e cor_alias vinculados", async () => {
  const modeloId = nanoid();
  await db.insert(modeloPrincipal).values({
    id: modeloId,
    codigo: `MC-${nanoid(6)}`,
    contaId: CONTA_A,
  });

  const tamId = nanoid();
  const corId = nanoid();
  await db.insert(tamanhoAlias).values({
    id: tamId,
    contaId: CONTA_A,
    modeloId,
    codigoAlias: "CASC-T",
    codigoReal: "EGG",
  });
  await db.insert(corAlias).values({
    id: corId,
    contaId: CONTA_A,
    modeloId,
    codigoAlias: "CASC-C",
    codigoReal: "PT",
  });

  await db.delete(modeloPrincipal).where(eq(modeloPrincipal.id, modeloId));

  const tamApos = await db
    .select()
    .from(tamanhoAlias)
    .where(eq(tamanhoAlias.id, tamId));
  const corApos = await db
    .select()
    .from(corAlias)
    .where(eq(corAlias.id, corId));
  assert.equal(tamApos.length, 0, "tamanho_alias não cascadeou");
  assert.equal(corApos.length, 0, "cor_alias não cascadeou");
});

// 5 — unique parcial canal_venda_id IS NULL
test("Unique parcial: 2 regras default mesma (conta, plataforma) → 2ª falha", async () => {
  await db.insert(canalRegraPrazo).values({
    id: nanoid(),
    contaId: CONTA_A,
    canalVendaId: null,
    plataforma: "tiktok_shop",
    estrategia: "DIAS_UTEIS_POS_VENDA",
    diasUteis: 2,
    fallbackHoje: false,
  });

  await assert.rejects(
    () =>
      db.insert(canalRegraPrazo).values({
        id: nanoid(),
        contaId: CONTA_A,
        canalVendaId: null,
        plataforma: "tiktok_shop",
        estrategia: "DIAS_UTEIS_POS_VENDA",
        diasUteis: 3,
        fallbackHoje: false,
      }),
    matchDbError(/uq_canal_regra_prazo_default_plataforma/),
  );
});

// 6 — default + canal específico coexistem
test("Unique parcial: default + canal específico (mesma plataforma) coexistem", async () => {
  // Canal de venda (cnpjId é nullable, sem FK — não precisa)
  const canalId = nanoid();
  await db.insert(canaisVenda).values({
    id: canalId,
    contaId: CONTA_B,
    plataforma: "shopee",
    identificadorLoja: `loja-${nanoid(6)}`,
    nomeExibicao: "Loja Test",
  });

  // Default por plataforma
  await db.insert(canalRegraPrazo).values({
    id: nanoid(),
    contaId: CONTA_B,
    canalVendaId: null,
    plataforma: "shopee",
    estrategia: "DIAS_UTEIS_POS_VENDA",
    diasUteis: 1,
    fallbackHoje: false,
  });

  // Específica do canal — mesma plataforma, deve passar
  await db.insert(canalRegraPrazo).values({
    id: nanoid(),
    contaId: CONTA_B,
    canalVendaId: canalId,
    plataforma: "shopee",
    estrategia: "DIAS_UTEIS_POS_VENDA",
    diasUteis: 2,
    fallbackHoje: false,
  });

  const linhas = await db
    .select()
    .from(canalRegraPrazo)
    .where(
      and(
        eq(canalRegraPrazo.contaId, CONTA_B),
        eq(canalRegraPrazo.plataforma, "shopee"),
      ),
    );
  assert.equal(linhas.length, 2);
});

// 7 — categoria_sku.regras aceita jsonb arbitrário (validação é no endpoint)
test("categoria_sku.regras: aceita array vazio e shape arbitrário (sem validação no banco)", async () => {
  const idVazio = nanoid();
  await db.insert(categoriaSku).values({
    id: idVazio,
    contaId: CONTA_A,
    nome: "Vazia",
    ordem: 0,
    regras: [],
  });

  const idValido = nanoid();
  await db.insert(categoriaSku).values({
    id: idValido,
    contaId: CONTA_A,
    nome: "Com regex",
    ordem: 1,
    regras: [{ tipo: "regex", pattern: "^X" }],
  });

  // Shape "inválido" (semanticamente) — banco não valida, só guarda
  const idInvalido = nanoid();
  await db.insert(categoriaSku).values({
    id: idInvalido,
    contaId: CONTA_A,
    nome: "Shape estranho",
    ordem: 2,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    regras: [{ tipo: "inexistente", foo: "bar" } as any],
  });

  const todas = await db
    .select()
    .from(categoriaSku)
    .where(eq(categoriaSku.contaId, CONTA_A));
  assert.equal(todas.filter((c) => c.id === idVazio)[0]?.regras.length, 0);
  assert.equal(todas.filter((c) => c.id === idValido)[0]?.regras.length, 1);
  assert.equal(todas.filter((c) => c.id === idInvalido)[0]?.regras.length, 1);
});

// 8 — feriado.data como date puro (sem timezone)
test("feriado.data: lê de volta como 'YYYY-MM-DD' (date puro, sem hora)", async () => {
  const id = nanoid();
  await db.insert(feriado).values({
    id,
    contaId: CONTA_A,
    data: "2026-09-07",
    descricao: "Independência",
    fonte: "manual",
  });

  const [linha] = await db.select().from(feriado).where(eq(feriado.id, id));
  assert.equal(linha.data, "2026-09-07");
  // Garantido pelo tipo: vem como string, não Date.
  assert.equal(typeof linha.data, "string");
});

// 9 — unique feriado (conta, data)
test("Unique: feriado duplicado mesma (conta, data) falha", async () => {
  await db.insert(feriado).values({
    id: nanoid(),
    contaId: CONTA_B,
    data: "2026-12-25",
    descricao: "Natal",
  });

  await assert.rejects(
    () =>
      db.insert(feriado).values({
        id: nanoid(),
        contaId: CONTA_B,
        data: "2026-12-25",
        descricao: "Natal duplicado",
      }),
    matchDbError(/uq_feriado_conta_data/),
  );
});

// 10 — seed idempotente + preserva UPDATE manual
test("Seed: idempotente e não sobrescreve UPDATE manual entre execuções", async () => {
  // 1ª execução — insere 3
  const r1 = await aplicarRegrasPrazoDefault(db, CONTA_SEED);
  assert.equal(r1.inseridos, 3);
  assert.equal(r1.pulados, 0);

  // 2ª execução — no-op
  const r2 = await aplicarRegrasPrazoDefault(db, CONTA_SEED);
  assert.equal(r2.inseridos, 0);
  assert.equal(r2.pulados, 3);

  // UPDATE manual: muda TikTok de 2 → 5
  await db
    .update(canalRegraPrazo)
    .set({ diasUteis: 5 })
    .where(
      and(
        eq(canalRegraPrazo.contaId, CONTA_SEED),
        eq(canalRegraPrazo.plataforma, "tiktok_shop"),
        isNull(canalRegraPrazo.canalVendaId),
      ),
    );

  // 3ª execução — segue no-op, preserva UPDATE
  const r3 = await aplicarRegrasPrazoDefault(db, CONTA_SEED);
  assert.equal(r3.inseridos, 0);
  assert.equal(r3.pulados, 3);

  const [tiktok] = await db
    .select()
    .from(canalRegraPrazo)
    .where(
      and(
        eq(canalRegraPrazo.contaId, CONTA_SEED),
        eq(canalRegraPrazo.plataforma, "tiktok_shop"),
        isNull(canalRegraPrazo.canalVendaId),
      ),
    );
  assert.equal(
    tiktok.diasUteis,
    5,
    "Seed sobrescreveu config manual — falha de idempotência",
  );
});

// 11 — Pós-seed: 3 regras default existem com os valores corretos
test("Seed: insere 3 defaults com valores corretos (TikTok=2, Shopee=1, ML=campo explícito)", async () => {
  const defaults = await db
    .select()
    .from(canalRegraPrazo)
    .where(
      and(
        eq(canalRegraPrazo.contaId, CONTA_SEED),
        isNull(canalRegraPrazo.canalVendaId),
      ),
    );

  assert.equal(defaults.length, 3);

  const tt = defaults.find((d) => d.plataforma === "tiktok_shop");
  const sp = defaults.find((d) => d.plataforma === "shopee");
  const ml = defaults.find((d) => d.plataforma === "mercado_livre");

  assert.ok(tt, "TikTok default ausente");
  assert.ok(sp, "Shopee default ausente");
  assert.ok(ml, "ML default ausente");

  // O teste 10 pode ter trocado o tiktok pra 5 — ambos valores são OK aqui
  assert.equal(tt!.estrategia, "DIAS_UTEIS_POS_VENDA");
  assert.ok(tt!.diasUteis === 2 || tt!.diasUteis === 5);

  assert.equal(sp!.estrategia, "DIAS_UTEIS_POS_VENDA");
  assert.equal(sp!.diasUteis, 1);

  assert.equal(ml!.estrategia, "CAMPO_EXPLICITO");
  assert.equal(ml!.campoPrazo, "Estado");
  assert.equal(ml!.fallbackHoje, true);
  assert.match(ml!.regexPrazo ?? "", /coleta do dia/);
});

// 12 — Seed NÃO popula cadastros de SKU/cor/tamanho/etc.
test("Seed: NÃO cria modelo, alias, categoria ou feriado", async () => {
  const [modelos, tams, cors, cats, fers] = await Promise.all([
    db
      .select()
      .from(modeloPrincipal)
      .where(eq(modeloPrincipal.contaId, CONTA_SEED)),
    db
      .select()
      .from(tamanhoAlias)
      .where(eq(tamanhoAlias.contaId, CONTA_SEED)),
    db.select().from(corAlias).where(eq(corAlias.contaId, CONTA_SEED)),
    db
      .select()
      .from(categoriaSku)
      .where(eq(categoriaSku.contaId, CONTA_SEED)),
    db.select().from(feriado).where(eq(feriado.contaId, CONTA_SEED)),
  ]);

  assert.equal(modelos.length, 0, "Seed criou modelo_principal");
  assert.equal(tams.length, 0, "Seed criou tamanho_alias");
  assert.equal(cors.length, 0, "Seed criou cor_alias");
  assert.equal(cats.length, 0, "Seed criou categoria_sku");
  assert.equal(fers.length, 0, "Seed criou feriado");
});
