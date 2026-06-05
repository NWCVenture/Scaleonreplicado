// Smoke test do loader contra DB local.
//
// Cria conta + modelo + cor + tamanho + alias, chama o loader e
// verifica o shape do snapshot. Sem RLS aqui (chama sob role
// superuser; teste de RLS já cobre nos cadastros-tests do RITM-01).

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import {
  conta,
  modeloPrincipal,
  modeloCor,
  modeloTamanho,
  corCatalogo,
  tamanhoCatalogo,
  corAlias,
  tamanhoAlias,
} from "@/lib/db/schema";
import { carregarContextoCadastro } from "./carregar-contexto";

const CONTA_TEST = `ce-loader-${nanoid(6)}`;

const MODELO_ID = nanoid();

before(async () => {
  await db
    .insert(conta)
    .values({
      id: CONTA_TEST,
      nome: "Loader Test",
      emailPrincipal: `loader-${nanoid(4)}@test.com`,
      plano: "enterprise",
      status: "ativa",
    })
    .onConflictDoNothing();

  await db.insert(modeloPrincipal).values({
    id: MODELO_ID,
    codigo: "MODL",
    contaId: CONTA_TEST,
    corPadrao: "corp",
    exigeTamanho: true,
    corMixDefault: { "4": ["cor1", "cor2", "cor3", "cor4"] },
  });

  // 1 cor ativa + 1 cor inativa (não deve aparecer)
  await db.insert(modeloCor).values([
    {
      id: nanoid(),
      modeloId: MODELO_ID,
      codigo: "cor1",
      contaId: CONTA_TEST,
      ativo: true,
    },
    {
      id: nanoid(),
      modeloId: MODELO_ID,
      codigo: "cor_inativa",
      contaId: CONTA_TEST,
      ativo: false,
    },
  ]);

  await db.insert(modeloTamanho).values({
    id: nanoid(),
    modeloId: MODELO_ID,
    codigo: "tam1",
    contaId: CONTA_TEST,
    ativo: true,
    ordem: 1,
  });

  await db.insert(corCatalogo).values({
    id: nanoid(),
    codigo: "cor_global",
    contaId: CONTA_TEST,
    ativo: true,
  });

  await db.insert(tamanhoCatalogo).values({
    id: nanoid(),
    codigo: "tam_global",
    contaId: CONTA_TEST,
    ativo: true,
  });

  await db.insert(corAlias).values([
    {
      id: nanoid(),
      contaId: CONTA_TEST,
      modeloId: null,
      codigoAlias: "alias_global_cor",
      codigoReal: "cor1",
    },
    {
      id: nanoid(),
      contaId: CONTA_TEST,
      modeloId: MODELO_ID,
      codigoAlias: "alias_modl_cor",
      codigoReal: "cor1",
    },
  ]);

  await db.insert(tamanhoAlias).values({
    id: nanoid(),
    contaId: CONTA_TEST,
    modeloId: null,
    codigoAlias: "alias_global_tam",
    codigoReal: "tam1",
  });
});

after(async () => {
  await db.delete(conta).where(eq(conta.id, CONTA_TEST));
});

test("carregarContextoCadastro retorna snapshot em UPPERCASE", async () => {
  const ctx = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.conta_atual', ${CONTA_TEST}, true)`,
    );
    return carregarContextoCadastro(tx);
  });

  // Modelo presente, codigo upper
  const m = ctx.modelosPorCodigo.get("MODL");
  assert.ok(m, "Modelo MODL não encontrado no snapshot");
  assert.equal(m.codigo, "MODL");
  assert.equal(m.corPadrao, "CORP");
  assert.equal(m.exigeTamanho, true);
  // Só cor1 ativa
  assert.deepEqual(m.cores, ["COR1"]);
  assert.deepEqual(m.tamanhos, ["TAM1"]);
  assert.deepEqual(m.corMixDefault, {
    "4": ["COR1", "COR2", "COR3", "COR4"],
  });

  // Globais
  assert.ok(ctx.coresGlobais.has("COR_GLOBAL"));
  assert.ok(ctx.tamanhosGlobais.has("TAM_GLOBAL"));

  // Aliases globais
  assert.equal(ctx.aliasesGlobais.cor.get("ALIAS_GLOBAL_COR"), "COR1");
  assert.equal(ctx.aliasesGlobais.tamanho.get("ALIAS_GLOBAL_TAM"), "TAM1");

  // Alias por modelo
  const aliasesMODL = ctx.aliasesPorModelo.get(MODELO_ID);
  assert.ok(aliasesMODL);
  assert.equal(aliasesMODL.cor.get("ALIAS_MODL_COR"), "COR1");
});

test("Modelo ativo=false não aparece no snapshot", async () => {
  const idInativo = nanoid();
  await db.insert(modeloPrincipal).values({
    id: idInativo,
    codigo: "MODX",
    contaId: CONTA_TEST,
    ativo: false,
  });

  const ctx = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.conta_atual', ${CONTA_TEST}, true)`,
    );
    return carregarContextoCadastro(tx);
  });

  assert.equal(ctx.modelosPorCodigo.has("MODX"), false);

  await db.delete(modeloPrincipal).where(eq(modeloPrincipal.id, idInativo));
});

test("Cor inativa do modelo não aparece no snapshot", async () => {
  // Já criada no before. Validar que COR_INATIVA não está.
  const ctx = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.conta_atual', ${CONTA_TEST}, true)`,
    );
    return carregarContextoCadastro(tx);
  });
  const m = ctx.modelosPorCodigo.get("MODL");
  assert.ok(m);
  assert.equal(m.cores.includes("COR_INATIVA"), false);
});
