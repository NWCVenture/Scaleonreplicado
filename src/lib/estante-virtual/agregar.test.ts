// Testes da agregação pura. Cobre fixture base calibrada, casos de borda
// (caixa >60, SKU inválido, cor/tamanho desconhecidos) e fixture vazia.

import { test } from "node:test";
import assert from "node:assert/strict";
import { agregarFardos, type EstanteFardoItem } from "./agregar";

function fardo(
  id: string,
  sku: string,
  lote: string,
  quantidade: number,
): EstanteFardoItem {
  return {
    id,
    qrCode: `qr-${id}`,
    sku,
    lote,
    quantidade,
    adicionadoPor: "tester",
    createdAt: "2026-06-01T12:00:00.000Z",
  };
}

// Fixture base: 5 fardos, 245 peças
//   PT G  — 2 cheios (60+60) + 1 parcial(40)  → 160 peças
//   AZ M  — 1 cheio (60)                       →  60 peças
//   BR P  — 1 parcial (25)                     →  25 peças
const FIXTURE_BASE: EstanteFardoItem[] = [
  fardo("1", "LUA PT G", "OP100", 60),
  fardo("2", "LUA PT G", "OP100", 60),
  fardo("3", "LUA PT G", "OP100", 40),
  fardo("4", "LUA AZ M", "OP100", 60),
  fardo("5", "LUA BR P", "OP101", 25),
];

test("totais agregados batem com a fixture base", () => {
  const r = agregarFardos(FIXTURE_BASE);
  assert.equal(r.totalPecas, 245);
  assert.equal(r.totalFardos, 5);
  assert.equal(r.fardosCheios, 3);
  assert.equal(r.fardosParciais, 2);
});

test("matriz cor × tamanho bate", () => {
  const r = agregarFardos(FIXTURE_BASE);
  assert.equal(r.matriz.PT.G, 160);
  assert.equal(r.matriz.AZ.M, 60);
  assert.equal(r.matriz.BR.P, 25);
  // Células não preenchidas devem ser 0, não undefined
  assert.equal(r.matriz.PT.P, 0);
  assert.equal(r.matriz.AZ.G, 0);
});

test("totais marginais batem com somatórios da matriz", () => {
  const r = agregarFardos(FIXTURE_BASE);
  assert.equal(r.totaisPorCor.PT, 160);
  assert.equal(r.totaisPorCor.AZ, 60);
  assert.equal(r.totaisPorCor.BR, 25);
  assert.equal(r.totaisPorTamanho.G, 160);
  assert.equal(r.totaisPorTamanho.M, 60);
  assert.equal(r.totaisPorTamanho.P, 25);
  // Soma dos totais por cor = soma dos totais por tamanho = totalPecas
  const somaCor = Object.values(r.totaisPorCor).reduce((s, v) => s + v, 0);
  const somaTam = Object.values(r.totaisPorTamanho).reduce((s, v) => s + v, 0);
  assert.equal(somaCor, 245);
  assert.equal(somaTam, 245);
});

test("caixas parciais ordenadas por faltaParaCheia desc", () => {
  const r = agregarFardos(FIXTURE_BASE);
  assert.equal(r.caixasParciais.length, 2);
  // BR P (falta 35) antes de PT G (falta 20)
  assert.equal(r.caixasParciais[0].sku, "LUA BR P");
  assert.equal(r.caixasParciais[0].faltaParaCheia, 35);
  assert.equal(r.caixasParciais[1].sku, "LUA PT G");
  assert.equal(r.caixasParciais[1].faltaParaCheia, 20);
});

test("lotes únicos, ordenados", () => {
  const r = agregarFardos(FIXTURE_BASE);
  assert.deepEqual(r.lotes, ["OP100", "OP101"]);
});

test("cores ordenadas pela ordem canônica COR_ORDER", () => {
  const r = agregarFardos(FIXTURE_BASE);
  // COR_ORDER = ["AZ", "BR", "CZ", "PT", "VM", "VD", "AM", "RS"]
  // Vistas: PT, AZ, BR → esperado: AZ, BR, PT (não alfabética nem ordem de aparição)
  assert.deepEqual(r.coresOrdenadas, ["AZ", "BR", "PT"]);
});

test("tamanhos ordenados pela ordem canônica TAMANHO_ORDER", () => {
  const r = agregarFardos(FIXTURE_BASE);
  // TAMANHO_ORDER = ["P", "M", "G", "GG", "EGG"]
  // Vistos: G, M, P → esperado: P, M, G
  assert.deepEqual(r.tamanhosOrdenados, ["P", "M", "G"]);
});

test("ocupacaoPct = round(totalPecas / (totalFardos * 60) * 100)", () => {
  const r = agregarFardos(FIXTURE_BASE);
  // 245 / (5 * 60) * 100 = 81.666... → 82
  assert.equal(r.ocupacaoPct, 82);
});

test("porSku ordenado por compareSKU e contagens corretas", () => {
  const r = agregarFardos(FIXTURE_BASE);
  assert.equal(r.porSku.length, 3);
  // compareSKU usa PRODUTO_ORDER → todos LUA → empata; depois COR_ORDER
  // AZ(0) < BR(1) < PT(3). Então: AZ M, BR P, PT G.
  assert.equal(r.porSku[0].sku, "LUA AZ M");
  assert.equal(r.porSku[1].sku, "LUA BR P");
  assert.equal(r.porSku[2].sku, "LUA PT G");

  const pt = r.porSku[2];
  assert.equal(pt.pecas, 160);
  assert.equal(pt.numFardos, 3);
  assert.equal(pt.fardosCheios, 2);
  assert.equal(pt.fardosParciais, 1);
});

test("fixture base não gera avisos", () => {
  const r = agregarFardos(FIXTURE_BASE);
  assert.equal(r.avisos.length, 0);
});

test("caixa acima do padrão: conta como cheia + aviso, ocupação capada", () => {
  // 1 fardo com 80 peças → ocupação real seria 80/60 = 133%, deve capar em 100
  const r = agregarFardos([fardo("1", "LUA PT G", "OP100", 80)]);
  assert.equal(r.totalPecas, 80);
  assert.equal(r.fardosCheios, 1);
  assert.equal(r.fardosParciais, 0);
  assert.equal(r.ocupacaoPct, 100);
  const avisosAcima = r.avisos.filter((a) => a.tipo === "caixa_acima_padrao");
  assert.equal(avisosAcima.length, 1);
  assert.equal(avisosAcima[0].fardoId, "1");
});

test("SKU com 2 tokens: aviso sku_invalido, tamanho '?' na matriz", () => {
  const r = agregarFardos([fardo("1", "LUA AZ", "OP100", 60)]);
  const avisosInval = r.avisos.filter((a) => a.tipo === "sku_invalido");
  assert.equal(avisosInval.length, 1);
  assert.equal(avisosInval[0].fardoId, "1");
  // Tamanho vira "?"
  assert.ok(r.tamanhosOrdenados.includes("?"));
  assert.equal(r.matriz.AZ["?"], 60);
});

test("cor desconhecida: aviso uma vez por cor, mesmo com múltiplos fardos", () => {
  const r = agregarFardos([
    fardo("1", "LUA VR G", "OP100", 60),
    fardo("2", "LUA VR M", "OP100", 60),
    fardo("3", "LUA VR P", "OP100", 60),
  ]);
  const avisosCor = r.avisos.filter((a) => a.tipo === "cor_desconhecida");
  assert.equal(avisosCor.length, 1);
  // VR é desconhecida → vai pro fim de coresOrdenadas (após as canônicas)
  assert.equal(r.coresOrdenadas[r.coresOrdenadas.length - 1], "VR");
});

test("tamanho desconhecido: aviso uma vez por tamanho, ordem alfanumérica no fim", () => {
  const r = agregarFardos([
    fardo("1", "LUA PT 33", "OP100", 60),
    fardo("2", "LUA PT 10", "OP100", 60),
    fardo("3", "LUA PT G", "OP100", 60),
  ]);
  const avisosTam = r.avisos.filter((a) => a.tipo === "tamanho_desconhecido");
  // 2 desconhecidos: "33" e "10". Aviso 1× cada.
  assert.equal(avisosTam.length, 2);
  // Esperado: G (canônico) primeiro, depois 10 e 33 em ordem numérica.
  assert.deepEqual(r.tamanhosOrdenados, ["G", "10", "33"]);
});

test("fixture vazia: totais zerados, matriz vazia, sem avisos", () => {
  const r = agregarFardos([]);
  assert.equal(r.totalPecas, 0);
  assert.equal(r.totalFardos, 0);
  assert.equal(r.fardosCheios, 0);
  assert.equal(r.fardosParciais, 0);
  assert.equal(r.ocupacaoPct, 0);
  assert.deepEqual(r.lotes, []);
  assert.deepEqual(r.porSku, []);
  assert.deepEqual(r.coresOrdenadas, []);
  assert.deepEqual(r.tamanhosOrdenados, []);
  assert.deepEqual(r.caixasParciais, []);
  assert.equal(r.avisos.length, 0);
});

test("opts.caixaPadrao customizado afeta classificação e ocupação", () => {
  // Com caixaPadrao=40: o fardo de 40 vira cheio, e o de 25 continua parcial (falta 15)
  const r = agregarFardos(
    [
      fardo("1", "LUA PT G", "OP100", 40),
      fardo("2", "LUA BR P", "OP100", 25),
    ],
    { caixaPadrao: 40 },
  );
  assert.equal(r.fardosCheios, 1);
  assert.equal(r.fardosParciais, 1);
  assert.equal(r.caixasParciais[0].faltaParaCheia, 15);
  // Ocupação: 65 / (2*40) = 81.25 → 81
  assert.equal(r.ocupacaoPct, 81);
});
