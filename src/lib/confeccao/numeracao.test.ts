import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db } from "../db";
import {
  gerarIdInternoSubtask,
  gerarNumeroOP,
  gerarNumeroSubtaskVisivel,
} from "./numeracao";

// =====================================================================
// Testes puros (sem banco)
// =====================================================================

test("gerarNumeroSubtaskVisivel: formato [PREFIXO]NNNN com padding", () => {
  assert.equal(gerarNumeroSubtaskVisivel("OPBUY", 1), "OPBUY0001");
  assert.equal(gerarNumeroSubtaskVisivel("OPCOR", 1234), "OPCOR1234");
  assert.equal(gerarNumeroSubtaskVisivel("OPCONF", 9999), "OPCONF9999");
  assert.equal(gerarNumeroSubtaskVisivel("OPVIE", 0), "OPVIE0000");
});

test("gerarIdInternoSubtask: formato [PREFIXO]-MMAA-NNNN", () => {
  assert.equal(
    gerarIdInternoSubtask("OPBUY", "05", "26", 42),
    "OPBUY-0526-0042",
  );
  assert.equal(
    gerarIdInternoSubtask("OPSEW", "12", "30", 1),
    "OPSEW-1230-0001",
  );
  assert.equal(
    gerarIdInternoSubtask("OPCONF", "01", "00", 9999),
    "OPCONF-0100-9999",
  );
});

// =====================================================================
// Testes com banco (sequence confeccao_op_sequencial)
// =====================================================================

// Salva o valor da sequence antes dos testes pra restaurar no final —
// não quero deixar a sequence em estado bizarro pra outras suites.
let seqInicial = 1;

before(async () => {
  const result = await db.execute<{ last_value: string; is_called: boolean }>(
    sql`SELECT last_value, is_called FROM confeccao_op_sequencial`,
  );
  const lastValue = Number(result[0]?.last_value ?? 1);
  const isCalled = result[0]?.is_called ?? false;
  // Se is_called=true, próximo nextval retorna last_value+1. Se false,
  // retorna last_value. Pra restaurar exato, salvo o estado completo.
  seqInicial = isCalled ? lastValue : lastValue - 1;
});

after(async () => {
  // Restaura sequence ao estado original (best-effort).
  if (seqInicial >= 1 && seqInicial <= 9999) {
    await db.execute(
      sql`SELECT setval('confeccao_op_sequencial', ${seqInicial}, true)`,
    );
  }
});

test("gerarNumeroOP: formato OPMMAANNNN com data atual", async () => {
  const out = await db.transaction(async (tx) => gerarNumeroOP(tx));

  // Formato: OP + 2 dígitos mês + 2 dígitos ano + 4 dígitos sequencial
  assert.match(out.numero, /^OP\d{2}\d{2}\d{4}$/);
  assert.equal(out.numero.length, 10);
  assert.equal(out.numero.slice(0, 2), "OP");

  // Mês e ano consistentes com a data atual
  const agora = new Date();
  const mesEsperado = String(agora.getUTCMonth() + 1).padStart(2, "0");
  const anoEsperado = String(agora.getUTCFullYear() % 100).padStart(2, "0");
  assert.equal(out.mes, mesEsperado);
  assert.equal(out.ano, anoEsperado);

  // Sequencial dentro do range
  assert.ok(out.sequencial >= 0 && out.sequencial <= 9999);

  // Componentes batem com o número final
  assert.equal(
    out.numero,
    `OP${out.mes}${out.ano}${String(out.sequencial).padStart(4, "0")}`,
  );
});

test("gerarNumeroOP: chamadas concorrentes retornam números diferentes", async () => {
  const resultados = await Promise.all([
    db.transaction(async (tx) => gerarNumeroOP(tx)),
    db.transaction(async (tx) => gerarNumeroOP(tx)),
    db.transaction(async (tx) => gerarNumeroOP(tx)),
    db.transaction(async (tx) => gerarNumeroOP(tx)),
    db.transaction(async (tx) => gerarNumeroOP(tx)),
  ]);

  const sequenciais = resultados.map((r) => r.sequencial);
  const numerosUnicos = new Set(sequenciais);
  assert.equal(
    numerosUnicos.size,
    sequenciais.length,
    `Colisão de sequencial em chamadas concorrentes: ${sequenciais.join(", ")}`,
  );
});

test("gerarNumeroOP: CYCLE — sequencial 9999 → 0000", async () => {
  // Posiciona a sequence em 9999 (is_called=true → próximo retorna 9999... espera,
  // nextval com CYCLE: depois de MAXVALUE, volta pra MINVALUE=0).
  // setval(seq, 9999, true) → próximo nextval = 9999+1, mas como bate MAXVALUE
  // com CYCLE, vai pra MINVALUE=0.
  // Garantia explícita: chamamos 2× pra ver a transição.
  await db.execute(
    sql`SELECT setval('confeccao_op_sequencial', 9999, false)`,
  );
  // is_called=false → próximo nextval retorna 9999 (o setval atual).
  const r1 = await db.transaction(async (tx) => gerarNumeroOP(tx));
  assert.equal(r1.sequencial, 9999, "Esperado 9999 antes do cycle");

  // Próxima chamada: estourou MAXVALUE com CYCLE → volta pra MINVALUE=0
  const r2 = await db.transaction(async (tx) => gerarNumeroOP(tx));
  assert.equal(r2.sequencial, 0, "Esperado 0 após cycle de 9999");
});
