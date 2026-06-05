// Testes do pré-processamento (uppercase, trim, alias global).

import { test } from "node:test";
import assert from "node:assert/strict";
import { preprocessar, aplicarAliasesGlobais } from "./aplicar-aliases";
import type { ContextoCadastro } from "./types";

function ctxFixture(opts?: {
  aliasesCor?: Array<[string, string]>;
  aliasesTam?: Array<[string, string]>;
}): ContextoCadastro {
  return {
    modelos: [],
    modelosPorCodigo: new Map(),
    coresGlobais: new Set(),
    tamanhosGlobais: new Set(),
    aliasesGlobais: {
      cor: new Map(opts?.aliasesCor ?? []),
      tamanho: new Map(opts?.aliasesTam ?? []),
    },
    aliasesPorModelo: new Map(),
  };
}

test("Uppercase + trim", () => {
  assert.equal(preprocessar("  mod1 cor1 tam1  ", ctxFixture()), "MOD1 COR1 TAM1");
});

test("Alias global cor aplicado", () => {
  const ctx = ctxFixture({ aliasesCor: [["ALIASCOR1", "COR1"]] });
  assert.equal(preprocessar("MOD1 ALIASCOR1 TAM1", ctx), "MOD1 COR1 TAM1");
});

test("Alias global aplica com word-boundary (não pega substring)", () => {
  const ctx = ctxFixture({ aliasesCor: [["XY", "XYLONG"]] });
  // 'XYTEC' (substring começando com XY) não deve virar 'XYLONGTEC'
  assert.equal(
    aplicarAliasesGlobais("MOD1 XYTEC TAM1", ctx),
    "MOD1 XYTEC TAM1",
  );
  // 'XY' isolado vira 'XYLONG'
  assert.equal(
    aplicarAliasesGlobais("MOD1 XY TAM1", ctx),
    "MOD1 XYLONG TAM1",
  );
});

test("Múltiplos aliases na mesma string", () => {
  const ctx = ctxFixture({
    aliasesCor: [["AAA", "COR1"]],
    aliasesTam: [["BBB", "TAM1"]],
  });
  assert.equal(preprocessar("MOD1 AAA BBB", ctx), "MOD1 COR1 TAM1");
});

test("Sem aliases — passthrough", () => {
  assert.equal(preprocessar("MOD1 COR1 TAM1", ctxFixture()), "MOD1 COR1 TAM1");
});
