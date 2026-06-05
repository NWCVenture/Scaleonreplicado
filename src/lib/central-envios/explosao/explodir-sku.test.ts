// Testes do explodirSku. Fixtures sintéticas — sem hardcode tenant.

import { test } from "node:test";
import assert from "node:assert/strict";
import { explodirSku } from "./explodir-sku";
import { parsearSku } from "../normalizacao/parsear-sku";
import type {
  ContextoCadastro,
  ModeloSnapshot,
  SkuParsed,
} from "../normalizacao/types";
import type {
  ContextoExplosao,
  ExplosaoErro,
  LinhasExplodidas,
  KitRegraSnapshot,
} from "./types";

// ----- fixtures ----------------------------------------------------

type ModeloDef = {
  id: string;
  codigo: string;
  corPadrao?: string | null;
  exigeTamanho?: boolean;
  cores?: string[];
  tamanhos?: string[];
  corMixDefault?: Record<string, string[]> | null;
};

function criarCadastro(opts: {
  modelos: ModeloDef[];
  coresGlobais?: string[];
  tamanhosGlobais?: string[];
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
  return {
    modelos,
    modelosPorCodigo: new Map(modelos.map((m) => [m.codigo, m])),
    coresGlobais: new Set(opts.coresGlobais ?? []),
    tamanhosGlobais: new Set(opts.tamanhosGlobais ?? []),
    aliasesGlobais: { cor: new Map(), tamanho: new Map() },
    aliasesPorModelo: new Map(),
  };
}

const CADASTRO = criarCadastro({
  modelos: [
    {
      id: "m1",
      codigo: "MOD1",
      corPadrao: "CORP",
      cores: ["COR1", "COR2", "COR3", "COR4"],
      tamanhos: ["TAM1", "TAM2", "TAM3"],
      corMixDefault: { "4": ["COR1", "COR2", "COR3", "COR4"] },
    },
    {
      id: "m2",
      codigo: "MOD2",
      exigeTamanho: false,
      corPadrao: "CORU",
      cores: [],
    },
    {
      id: "m3",
      codigo: "MOD3",
      cores: ["COR1", "COR2"], // só 2 cores
      tamanhos: ["TAM1"],
      corPadrao: "COR1",
    },
    {
      id: "m4",
      codigo: "MOD4",
      cores: [], // sem cores
      tamanhos: ["TAM1"],
      corPadrao: "ZZ", // só pra ter algo
    },
  ],
  coresGlobais: ["COR1", "COR2", "COR3", "COR4", "CORP", "CORU", "ZZ"],
  tamanhosGlobais: ["TAM1", "TAM2", "TAM3"],
});

function ctxSemKitRegras(): ContextoExplosao {
  return {
    cadastro: CADASTRO,
    kitRegrasPorCanonical: new Map(),
    kitRegrasComProblema: [],
  };
}

function asLinhas(r: LinhasExplodidas | ExplosaoErro): LinhasExplodidas {
  if (r.kind !== "LINHAS") {
    throw new Error(
      `Esperado LINHAS; veio EXPLOSAO_ERRO (motivo=${r.motivo})`,
    );
  }
  return r;
}

function asErro(r: LinhasExplodidas | ExplosaoErro): ExplosaoErro {
  if (r.kind !== "EXPLOSAO_ERRO") throw new Error(`Esperado erro; veio LINHAS`);
  return r;
}

function p(sku: string): SkuParsed {
  const r = parsearSku(sku, CADASTRO);
  if (r.kind === "AMBIGUO") {
    throw new Error(
      `Fixture inválida: '${sku}' veio AMBIGUO(${r.motivo}) — ${r.detalhes}`,
    );
  }
  return r;
}

// ----- AVULSO ------------------------------------------------------

test("AVULSO → 1 linha qtd=1", () => {
  const r = asLinhas(explodirSku(p("MOD1 COR1 TAM1"), ctxSemKitRegras()));
  assert.equal(r.origem, "parametrico");
  assert.equal(r.linhas.length, 1);
  assert.deepEqual(r.linhas[0], {
    modeloCodigo: "MOD1",
    cor: "COR1",
    tamanho: "TAM1",
    qtd: 1,
  });
});

test("AVULSO modelo sem grade → tamanho=UNICO", () => {
  const r = asLinhas(explodirSku(p("MOD2"), ctxSemKitRegras()));
  assert.equal(r.linhas[0].tamanho, "UNICO");
});

// ----- KIT ---------------------------------------------------------

test("KIT_COR_UNICA N=2 → 1 linha qtd=2", () => {
  const r = asLinhas(
    explodirSku(p("KIT 2 MOD1 COR1 TAM1"), ctxSemKitRegras()),
  );
  assert.equal(r.linhas.length, 1);
  assert.equal(r.linhas[0].qtd, 2);
});

test("KIT_CORES_LISTADAS N=3 → 3 linhas qtd=1", () => {
  const r = asLinhas(
    explodirSku(p("KIT 3 MOD1 COR1 COR2 COR3 TAM1"), ctxSemKitRegras()),
  );
  assert.equal(r.linhas.length, 3);
  assert.deepEqual(
    r.linhas.map((l) => l.cor),
    ["COR1", "COR2", "COR3"],
  );
});

test("KIT_DISTRIBUICAO (2 COR1 + 1 COR2) → 2 linhas com qtds", () => {
  const r = asLinhas(
    explodirSku(p("KIT 3 MOD1 2 COR1 1 COR2 TAM1"), ctxSemKitRegras()),
  );
  assert.equal(r.linhas.length, 2);
  // sort por cor: COR1 vem antes
  assert.deepEqual(r.linhas, [
    { modeloCodigo: "MOD1", cor: "COR1", tamanho: "TAM1", qtd: 2 },
    { modeloCodigo: "MOD1", cor: "COR2", tamanho: "TAM1", qtd: 1 },
  ]);
});

// ----- MIX ---------------------------------------------------------

test("MIX com corMixDefault[4] → usa lista exata do cadastro", () => {
  const r = asLinhas(explodirSku(p("MIX 4 MOD1 TAM1"), ctxSemKitRegras()));
  assert.equal(r.linhas.length, 4);
  assert.deepEqual(
    r.linhas.map((l) => l.cor),
    ["COR1", "COR2", "COR3", "COR4"],
  );
  assert.ok(r.linhas.every((l) => l.qtd === 1));
});

test("MIX sem corMixDefault → top-N de modelo.cores (alfa)", () => {
  // MOD1 não tem corMixDefault[3]; modelo.cores=[COR1..COR4] sorted.
  const r = asLinhas(explodirSku(p("MIX 3 MOD1 TAM1"), ctxSemKitRegras()));
  assert.equal(r.linhas.length, 3);
  assert.deepEqual(
    r.linhas.map((l) => l.cor),
    ["COR1", "COR2", "COR3"],
  );
});

test("MIX cores insuficientes → ExplosaoErro(mix_cores_insuficientes)", () => {
  // MOD3 só tem 2 cores
  const e = asErro(explodirSku(p("MIX 3 MOD3 TAM1"), ctxSemKitRegras()));
  assert.equal(e.motivo, "mix_cores_insuficientes");
});

test("MIX modelo sem cores e sem corMixDefault → mix_modelo_sem_cores", () => {
  // MOD4 cores=[] e corMixDefault=null
  const e = asErro(explodirSku(p("MIX 2 MOD4 TAM1"), ctxSemKitRegras()));
  assert.equal(e.motivo, "mix_modelo_sem_cores");
});

// ----- Lookup nominal ----------------------------------------------

function ctxComKitNominal(): ContextoExplosao {
  // Cadastra kit "KIT 2 MOD1 COR1 TAM1" como composto de 1× MOD1 COR1
  // TAM1 + 1× MOD2 (modelo sem grade — vira tamanho UNICO).
  const componentes = [
    {
      componenteSku: "MOD1 COR1 TAM1",
      componenteCanonical: "MOD1 COR1 TAM1",
      quantidade: 1,
      modeloCodigo: "MOD1",
      cor: "COR1",
      tamanho: "TAM1",
    },
    {
      componenteSku: "MOD2",
      componenteCanonical: "MOD2 CORU UNICO",
      quantidade: 1,
      modeloCodigo: "MOD2",
      cor: "CORU",
      tamanho: "UNICO",
    },
  ];
  const regra: KitRegraSnapshot = {
    id: "regra1",
    kitSku: "KIT 2 MOD1 COR1 TAM1",
    canonical: "KIT 2 MOD1 COR1 TAM1",
    componentes,
  };
  return {
    cadastro: CADASTRO,
    kitRegrasPorCanonical: new Map([[regra.canonical, regra]]),
    kitRegrasComProblema: [],
  };
}

test("Lookup nominal: canonical bate → usa componentes (origem='nominal')", () => {
  const r = asLinhas(
    explodirSku(p("KIT 2 MOD1 COR1 TAM1"), ctxComKitNominal()),
  );
  assert.equal(r.origem, "nominal");
  // 2 componentes, 2 linhas (modelos diferentes)
  assert.equal(r.linhas.length, 2);
});

test("Lookup nominal multiplica quantidade pelo qtdKit do parsed", () => {
  // parsedKit.qtdKit=2; componente.quantidade=1 → linha qtd=2.
  const r = asLinhas(
    explodirSku(p("KIT 2 MOD1 COR1 TAM1"), ctxComKitNominal()),
  );
  assert.ok(r.linhas.every((l) => l.qtd === 2));
});

test("Sem match nominal → fallback paramétrico", () => {
  // Mesmo contexto com kit nominal cadastrado, mas pedido DIFERENTE.
  const r = asLinhas(
    explodirSku(p("MOD1 COR2 TAM2"), ctxComKitNominal()),
  );
  assert.equal(r.origem, "parametrico");
});

// ----- Agregação + sort --------------------------------------------

test("Sort estável: KIT_CORES_LISTADAS embaralhado vem sorted por cor", () => {
  // Parser já sorted, mas explodirSku tem que manter
  const r = asLinhas(
    explodirSku(p("KIT 3 MOD1 COR3 COR1 COR2 TAM1"), ctxSemKitRegras()),
  );
  assert.deepEqual(
    r.linhas.map((l) => l.cor),
    ["COR1", "COR2", "COR3"],
  );
});

test("Idempotência: 2 chamadas com mesmo input → deepEqual", () => {
  const r1 = explodirSku(p("KIT 3 MOD1 2 COR1 1 COR2 TAM1"), ctxSemKitRegras());
  const r2 = explodirSku(p("KIT 3 MOD1 2 COR1 1 COR2 TAM1"), ctxSemKitRegras());
  assert.deepEqual(r1, r2);
});

test("MIX com corMixDefault contendo cores duplicadas → agrega qtds", () => {
  const cadastroDup = criarCadastro({
    modelos: [
      {
        id: "md",
        codigo: "MODD",
        cores: ["COR1", "COR2"],
        tamanhos: ["TAM1"],
        corPadrao: "COR1",
        // Lista intencionalmente com COR1 repetida (UI deveria validar
        // em RITM-10; aqui testamos que a agregação funciona).
        corMixDefault: { "3": ["COR1", "COR1", "COR2"] },
      },
    ],
    coresGlobais: ["COR1", "COR2"],
    tamanhosGlobais: ["TAM1"],
  });
  const ctxD: ContextoExplosao = {
    cadastro: cadastroDup,
    kitRegrasPorCanonical: new Map(),
    kitRegrasComProblema: [],
  };
  const parsed = parsearSku("MIX 3 MODD TAM1", cadastroDup);
  if (parsed.kind !== "MIX") throw new Error("fixture invalida");
  const r = asLinhas(explodirSku(parsed, ctxD));
  // 2 linhas únicas; COR1 com qtd=2, COR2 com qtd=1
  assert.equal(r.linhas.length, 2);
  const corMap = new Map(r.linhas.map((l) => [l.cor, l.qtd]));
  assert.equal(corMap.get("COR1"), 2);
  assert.equal(corMap.get("COR2"), 1);
});

// Total: 16 testes do parser
