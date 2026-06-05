// Testes do parser de SKU. Tudo com fixtures sintéticas (MOD/COR/TAM
// genéricos) — zero hardcode tenant-specific.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parsearSku, TAMANHO_UNICO } from "./parsear-sku";
import type {
  ContextoCadastro,
  ModeloSnapshot,
  SkuParsed,
  SkuAmbiguo,
} from "./types";

// ----- fixture builder -------------------------------------------

type ModeloDef = {
  id: string;
  codigo: string;
  corPadrao?: string | null;
  exigeTamanho?: boolean;
  cores?: string[];
  tamanhos?: string[];
  corMixDefault?: Record<string, string[]> | null;
};

function criarContexto(opts: {
  modelos: ModeloDef[];
  coresGlobais?: string[];
  tamanhosGlobais?: string[];
  aliasesCorGlobal?: Array<[string, string]>;
  aliasesTamGlobal?: Array<[string, string]>;
  aliasesCorPorModelo?: Record<string, Array<[string, string]>>;
  aliasesTamPorModelo?: Record<string, Array<[string, string]>>;
}): ContextoCadastro {
  const modelos: ModeloSnapshot[] = opts.modelos.map((m) => ({
    id: m.id,
    codigo: m.codigo,
    corPadrao: m.corPadrao ?? null,
    exigeTamanho: m.exigeTamanho ?? true,
    corMixDefault: m.corMixDefault ?? null,
    cores: [...(m.cores ?? [])].sort(),
    tamanhos: m.tamanhos ?? [],
  }));
  const modelosPorCodigo = new Map(modelos.map((m) => [m.codigo, m]));

  const aliasesPorModelo = new Map<
    string,
    { cor: Map<string, string>; tamanho: Map<string, string> }
  >();
  for (const m of modelos) {
    aliasesPorModelo.set(m.id, {
      cor: new Map(opts.aliasesCorPorModelo?.[m.id] ?? []),
      tamanho: new Map(opts.aliasesTamPorModelo?.[m.id] ?? []),
    });
  }

  return {
    modelos,
    modelosPorCodigo,
    coresGlobais: new Set(opts.coresGlobais ?? []),
    tamanhosGlobais: new Set(opts.tamanhosGlobais ?? []),
    aliasesGlobais: {
      cor: new Map(opts.aliasesCorGlobal ?? []),
      tamanho: new Map(opts.aliasesTamGlobal ?? []),
    },
    aliasesPorModelo,
  };
}

// Contexto base usado pela maioria dos testes.
const CTX = criarContexto({
  modelos: [
    {
      id: "m1",
      codigo: "MOD1",
      corPadrao: "CORP",
      exigeTamanho: true,
      cores: ["COR1", "COR2", "COR3", "COR4"],
      tamanhos: ["TAM1", "TAM2", "TAM3"],
    },
    {
      id: "m2",
      codigo: "MOD2",
      corPadrao: null,
      exigeTamanho: false,
      cores: [],
      tamanhos: [],
    },
    {
      id: "m3",
      codigo: "MOD3",
      corPadrao: null,
      exigeTamanho: true,
      cores: ["COR1", "COR2"],
      tamanhos: ["TAM1"],
    },
  ],
  coresGlobais: ["COR1", "COR2", "COR3", "COR4", "CORP"],
  tamanhosGlobais: ["TAM1", "TAM2", "TAM3"],
  aliasesCorGlobal: [["ALIASCOR1", "COR1"]],
  aliasesTamGlobal: [["ALIASTAM1", "TAM1"]],
  aliasesCorPorModelo: { m1: [["ALIASMOD1", "COR2"]] },
});

function asParsed(r: SkuParsed | SkuAmbiguo): SkuParsed {
  if (r.kind === "AMBIGUO") {
    throw new Error(
      `Esperado SkuParsed; veio AMBIGUO (motivo=${r.motivo}, detalhes=${r.detalhes})`,
    );
  }
  return r;
}

function asAmbiguo(r: SkuParsed | SkuAmbiguo): SkuAmbiguo {
  if (r.kind !== "AMBIGUO") {
    throw new Error(`Esperado AMBIGUO; veio ${r.kind}`);
  }
  return r;
}

// ----- AVULSO -----------------------------------------------------

test("AVULSO: 'MOD1 COR1 TAM1'", () => {
  const r = asParsed(parsearSku("MOD1 COR1 TAM1", CTX));
  assert.equal(r.kind, "AVULSO");
  assert.equal(r.modeloCodigo, "MOD1");
  assert.deepEqual(r.cores, [{ cor: "COR1", qtd: 1 }]);
  assert.equal(r.tamanho, "TAM1");
  assert.equal(r.qtdKit, 1);
  assert.equal(r.canonical, "MOD1 COR1 TAM1");
});

test("AVULSO sem cor + modelo com corPadrao + exigeTamanho=true", () => {
  // MOD1.corPadrao=CORP; 'MOD1 TAM1' assume CORP.
  const r = asParsed(parsearSku("MOD1 TAM1", CTX));
  assert.equal(r.kind, "AVULSO");
  assert.deepEqual(r.cores, [{ cor: "CORP", qtd: 1 }]);
  assert.equal(r.tamanho, "TAM1");
});

test("AVULSO modelo sem grade (exigeTamanho=false) + sem cor explícita", () => {
  // MOD2 não exige tamanho e não tem corPadrao — só pra falhar
  // graciosamente. Pra dar verde, usar MOD que tenha exigeTamanho=false
  // E corPadrao. Adicionar inline:
  const ctx = criarContexto({
    modelos: [
      {
        id: "x",
        codigo: "MODX",
        corPadrao: "CORX",
        exigeTamanho: false,
      },
    ],
    coresGlobais: ["CORX"],
  });
  const r = asParsed(parsearSku("MODX", ctx));
  assert.equal(r.kind, "AVULSO");
  assert.deepEqual(r.cores, [{ cor: "CORX", qtd: 1 }]);
  assert.equal(r.tamanho, TAMANHO_UNICO);
  assert.equal(r.canonical, "MODX CORX UNICO");
});

test("Case-insensitive: 'mod1 cor1 tam1' → mesmo resultado", () => {
  const r = asParsed(parsearSku("mod1 cor1 tam1", CTX));
  assert.equal(r.modeloCodigo, "MOD1");
  assert.equal(r.cores[0].cor, "COR1");
  assert.equal(r.tamanho, "TAM1");
});

// ----- KIT --------------------------------------------------------

test("KIT_COR_UNICA: 'KIT 2 MOD1 COR1 TAM1'", () => {
  const r = asParsed(parsearSku("KIT 2 MOD1 COR1 TAM1", CTX));
  assert.equal(r.kind, "KIT_COR_UNICA");
  assert.equal(r.qtdKit, 2);
  assert.deepEqual(r.cores, [{ cor: "COR1", qtd: 2 }]);
  assert.equal(r.canonical, "KIT 2 MOD1 COR1 TAM1");
});

test("KIT_CORES_LISTADAS: 'KIT 3 MOD1 COR1 COR2 COR3 TAM1'", () => {
  const r = asParsed(parsearSku("KIT 3 MOD1 COR1 COR2 COR3 TAM1", CTX));
  assert.equal(r.kind, "KIT_CORES_LISTADAS");
  assert.equal(r.qtdKit, 3);
  assert.deepEqual(r.cores, [
    { cor: "COR1", qtd: 1 },
    { cor: "COR2", qtd: 1 },
    { cor: "COR3", qtd: 1 },
  ]);
  assert.equal(r.canonical, "KIT 3 MOD1 COR1 COR2 COR3 TAM1");
});

test("KIT_CORES_LISTADAS canonical ordena cores alfa", () => {
  const r = asParsed(parsearSku("KIT 2 MOD1 COR2 COR1 TAM1", CTX));
  assert.equal(r.canonical, "KIT 2 MOD1 COR1 COR2 TAM1");
});

test("KIT_DISTRIBUICAO: 'KIT 3 MOD1 2 COR1 1 COR2 TAM1'", () => {
  const r = asParsed(parsearSku("KIT 3 MOD1 2 COR1 1 COR2 TAM1", CTX));
  assert.equal(r.kind, "KIT_DISTRIBUICAO");
  assert.equal(r.qtdKit, 3);
  // Sort alfa por cor no canonical
  assert.equal(r.canonical, "KIT 3 MOD1 2 COR1 1 COR2 TAM1");
});

test("KIT N implícito (N=1) vira AVULSO", () => {
  const r = asParsed(parsearSku("KIT MOD1 COR1 TAM1", CTX));
  assert.equal(r.kind, "AVULSO");
  assert.equal(r.qtdKit, 1);
});

test("KIT N implícito a partir de qtd de cores", () => {
  const r = asParsed(parsearSku("KIT MOD1 COR1 COR2 TAM1", CTX));
  assert.equal(r.kind, "KIT_CORES_LISTADAS");
  assert.equal(r.qtdKit, 2);
});

// ----- MIX --------------------------------------------------------

test("MIX: 'MIX 4 MOD1 TAM1' → kind=MIX, cores=[]", () => {
  const r = asParsed(parsearSku("MIX 4 MOD1 TAM1", CTX));
  assert.equal(r.kind, "MIX");
  assert.equal(r.qtdKit, 4);
  assert.deepEqual(r.cores, []);
  assert.equal(r.canonical, "MIX 4 MOD1 TAM1");
});

test("MIX sem N → AMBIGUO(mix_invalido)", () => {
  const r = asAmbiguo(parsearSku("MIX MOD1 TAM1", CTX));
  assert.equal(r.motivo, "mix_invalido");
});

test("MIX sem modelo → AMBIGUO(modelo_desconhecido)", () => {
  const r = asAmbiguo(parsearSku("MIX 4 XYZ TAM1", CTX));
  assert.equal(r.motivo, "modelo_desconhecido");
});

test("MIX com cor explícita → AMBIGUO(tokens_extras)", () => {
  const r = asAmbiguo(parsearSku("MIX 4 MOD1 COR1 TAM1", CTX));
  assert.equal(r.motivo, "tokens_extras");
});

// ----- AMBIGUO ----------------------------------------------------

test("AMBIGUO(input_vazio)", () => {
  assert.equal(asAmbiguo(parsearSku("", CTX)).motivo, "input_vazio");
  assert.equal(asAmbiguo(parsearSku("   ", CTX)).motivo, "input_vazio");
});

test("AMBIGUO(modelo_desconhecido)", () => {
  const r = asAmbiguo(parsearSku("XYZ COR1 TAM1", CTX));
  assert.equal(r.motivo, "modelo_desconhecido");
});

test("AMBIGUO(cor_desconhecida): token longo não reconhecido", () => {
  const r = asAmbiguo(parsearSku("MOD1 CORESTRANHA TAM1", CTX));
  assert.equal(r.motivo, "cor_desconhecida");
});

test("AMBIGUO(tamanho_desconhecido): token curto não reconhecido", () => {
  const r = asAmbiguo(parsearSku("MOD1 COR1 TXY", CTX));
  assert.equal(r.motivo, "tamanho_desconhecido");
});

test("AMBIGUO(kit_inconsistente): KIT N com len(cores) ≠ N", () => {
  const r = asAmbiguo(parsearSku("KIT 3 MOD1 COR1 COR2 TAM1", CTX));
  assert.equal(r.motivo, "kit_inconsistente");
});

test("AMBIGUO(kit_inconsistente): KIT N com soma ≠ N", () => {
  const r = asAmbiguo(parsearSku("KIT 3 MOD1 2 COR1 2 COR2 TAM1", CTX));
  assert.equal(r.motivo, "kit_inconsistente");
});

test("AMBIGUO(cor_ausente): modelo sem corPadrao + sem cor", () => {
  // MOD3 não tem corPadrao
  const r = asAmbiguo(parsearSku("MOD3 TAM1", CTX));
  assert.equal(r.motivo, "cor_ausente");
});

test("AMBIGUO(tamanho_ausente): modelo exigeTamanho + sem tamanho", () => {
  const r = asAmbiguo(parsearSku("MOD1 COR1", CTX));
  assert.equal(r.motivo, "tamanho_ausente");
});

test("AMBIGUO(tokens_extras): modelo sem grade + tamanho fornecido", () => {
  // MOD2 não exige tamanho mas TAM1 está nos tamanhosGlobais — vira
  // tokens_extras porque MOD2 não tem grade.
  const r = asAmbiguo(parsearSku("MOD2 TAM1", CTX));
  assert.equal(r.motivo, "tokens_extras");
});

test("AMBIGUO(tokens_extras): múltiplas cores sem prefixo KIT", () => {
  const r = asAmbiguo(parsearSku("MOD1 COR1 COR2 TAM1", CTX));
  assert.equal(r.motivo, "tokens_extras");
});

// ----- Aliases ----------------------------------------------------

test("Alias global cor aplicado: 'MOD1 ALIASCOR1 TAM1' → COR1", () => {
  const r = asParsed(parsearSku("MOD1 ALIASCOR1 TAM1", CTX));
  assert.equal(r.cores[0].cor, "COR1");
});

test("Alias global tamanho aplicado: 'MOD1 COR1 ALIASTAM1' → TAM1", () => {
  const r = asParsed(parsearSku("MOD1 COR1 ALIASTAM1", CTX));
  assert.equal(r.tamanho, "TAM1");
});

test("Alias por modelo: 'MOD1 ALIASMOD1 TAM1' → COR2 (alias só de MOD1)", () => {
  const r = asParsed(parsearSku("MOD1 ALIASMOD1 TAM1", CTX));
  assert.equal(r.cores[0].cor, "COR2");
});

test("Alias por modelo NÃO vaza pra outro modelo", () => {
  // ALIASMOD1 só vale pra MOD1. Em MOD3, esse token é desconhecido.
  const r = asAmbiguo(parsearSku("MOD3 ALIASMOD1 TAM1", CTX));
  // Deve ser cor_desconhecida (token longo)
  assert.equal(r.motivo, "cor_desconhecida");
});

// ----- Misc -------------------------------------------------------

test("Idempotência: 2 chamadas com mesmo input → deepEqual", () => {
  const r1 = parsearSku("KIT 2 MOD1 COR1 TAM1", CTX);
  const r2 = parsearSku("KIT 2 MOD1 COR1 TAM1", CTX);
  assert.deepEqual(r1, r2);
});

test("Canonical para KIT_DISTRIBUICAO ordena cores alfa", () => {
  const r = asParsed(parsearSku("KIT 3 MOD1 1 COR2 2 COR1 TAM1", CTX));
  assert.equal(r.canonical, "KIT 3 MOD1 2 COR1 1 COR2 TAM1");
});
