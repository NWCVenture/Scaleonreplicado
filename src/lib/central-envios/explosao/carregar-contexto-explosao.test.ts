// Smoke test do loader de ContextoExplosao contra DB local.
// Cobre: kit canônico bem-formado, kit com kit_sku ambíguo, kit com
// componente ambíguo.

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
  skuKitRegra,
  skuKitComponente,
} from "@/lib/db/schema";
import { carregarContextoCadastro } from "../normalizacao/carregar-contexto";
import { carregarContextoExplosao } from "./carregar-contexto-explosao";

const CONTA_TEST = `ce-expl-${nanoid(6)}`;
const MODELO_A_ID = nanoid();
const KIT_OK_ID = nanoid();
const KIT_KITSKU_AMBIG_ID = nanoid();
const KIT_COMP_AMBIG_ID = nanoid();

async function runInConta<T>(
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.conta_atual', ${CONTA_TEST}, true)`,
    );
    return fn(tx);
  });
}

before(async () => {
  await db
    .insert(conta)
    .values({
      id: CONTA_TEST,
      nome: "Explosao Test",
      emailPrincipal: `expl-${nanoid(4)}@test.com`,
      plano: "enterprise",
      status: "ativa",
    })
    .onConflictDoNothing();

  await db.insert(modeloPrincipal).values({
    id: MODELO_A_ID,
    codigo: "modA",
    contaId: CONTA_TEST,
    corPadrao: "corA1",
    exigeTamanho: true,
  });

  await db.insert(modeloCor).values({
    id: nanoid(),
    modeloId: MODELO_A_ID,
    codigo: "corA1",
    contaId: CONTA_TEST,
  });

  await db.insert(modeloTamanho).values({
    id: nanoid(),
    modeloId: MODELO_A_ID,
    codigo: "tamA1",
    contaId: CONTA_TEST,
    ordem: 1,
  });

  // Kit OK
  await db.insert(skuKitRegra).values({
    id: KIT_OK_ID,
    kitSku: "KIT 2 modA corA1 tamA1",
    contaId: CONTA_TEST,
  });
  await db.insert(skuKitComponente).values([
    {
      id: nanoid(),
      kitRegraId: KIT_OK_ID,
      sku: "modA corA1 tamA1",
      quantidade: 1,
      contaId: CONTA_TEST,
    },
    {
      id: nanoid(),
      kitRegraId: KIT_OK_ID,
      sku: "modA corA1 tamA1",
      quantidade: 1,
      contaId: CONTA_TEST,
    },
  ]);

  // Kit com kitSku ambíguo (modelo desconhecido)
  await db.insert(skuKitRegra).values({
    id: KIT_KITSKU_AMBIG_ID,
    kitSku: "KIT 2 XXX corA1 tamA1",
    contaId: CONTA_TEST,
  });

  // Kit com componente ambíguo
  await db.insert(skuKitRegra).values({
    id: KIT_COMP_AMBIG_ID,
    kitSku: "KIT 2 modA corA1 tamA1",
    contaId: CONTA_TEST,
  });
  await db.insert(skuKitComponente).values({
    id: nanoid(),
    kitRegraId: KIT_COMP_AMBIG_ID,
    sku: "ZZZ corA1 tamA1",
    quantidade: 1,
    contaId: CONTA_TEST,
  });
});

after(async () => {
  await db.delete(conta).where(eq(conta.id, CONTA_TEST));
});

test("Kit OK entra no Map com canonical correto", async () => {
  const ctx = await runInConta(async (tx) => {
    const cad = await carregarContextoCadastro(tx);
    return carregarContextoExplosao(tx, cad);
  });

  const canonicalEsperada = "KIT 2 MODA CORA1 TAMA1";
  const regra = ctx.kitRegrasPorCanonical.get(canonicalEsperada);
  assert.ok(
    regra,
    `Esperava regra em canonical ${canonicalEsperada}, mas Map tem: ${[...ctx.kitRegrasPorCanonical.keys()].join(", ")}`,
  );
  assert.equal(regra.componentes.length, 2);
  assert.equal(regra.componentes[0].cor, "CORA1");
});

test("Kit com kit_sku ambíguo vai pra kitRegrasComProblema", async () => {
  const ctx = await runInConta(async (tx) => {
    const cad = await carregarContextoCadastro(tx);
    return carregarContextoExplosao(tx, cad);
  });

  const problema = ctx.kitRegrasComProblema.find(
    (p) => p.kitRegraId === KIT_KITSKU_AMBIG_ID,
  );
  assert.ok(problema);
  assert.equal(problema.motivo, "kit_sku_ambiguo");
});

test("Kit com componente ambíguo vai pra kitRegrasComProblema", async () => {
  const ctx = await runInConta(async (tx) => {
    const cad = await carregarContextoCadastro(tx);
    return carregarContextoExplosao(tx, cad);
  });

  const problema = ctx.kitRegrasComProblema.find(
    (p) => p.kitRegraId === KIT_COMP_AMBIG_ID,
  );
  assert.ok(problema);
  assert.equal(problema.motivo, "componente_ambiguo");
});
