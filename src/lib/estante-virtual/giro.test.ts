import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adicionarDiasUteis,
  calcularMediaPorDiaSemana,
  calcularMediaVendas,
  coberturaDias,
  gerarOrdemDow,
  PLATAFORMA_TIKTOK,
  simularEstoqueSemanal,
} from "./giro";
import type { LinhaPedido } from "@/lib/analise-pedidos/parser";

function linha(partial: Partial<LinhaPedido>): LinhaPedido {
  return {
    numeroPedido: "P1",
    plataforma: "TikTok Shop",
    loja: "L1",
    estado: "Enviado",
    dataPedido: new Date(2024, 0, 14),
    sku: "SKU-X",
    nomeAnuncio: "Anuncio X",
    variacaoOriginal: "",
    tamanho: "G",
    cores: [{ nome: "Preto", qtd: 1 }],
    qtdProduto: 1,
    precoProduto: null,
    ...partial,
  };
}

test("calcularMediaVendas: período 14d ancorado em periodoMax, kits expandidos", () => {
  // periodoMax = 14/jan/2024 (dom). 14d → de 1/jan a 14/jan inclusive.
  const ate = new Date(2024, 0, 14);
  const min = new Date(2024, 0, 1);
  const linhas: LinhaPedido[] = [
    // Dentro do período — 3 peças (1×3 cores).
    linha({
      dataPedido: new Date(2024, 0, 5),
      cores: [
        { nome: "Preto", qtd: 1 },
        { nome: "Azul", qtd: 2 },
      ],
    }),
    // Kit: qtdProduto=2 × (1+1) cores = 4 peças.
    linha({
      dataPedido: new Date(2024, 0, 10),
      qtdProduto: 2,
      cores: [
        { nome: "Preto", qtd: 1 },
        { nome: "Branco", qtd: 1 },
      ],
    }),
    // Fora do período (antes de 1/jan) — não conta.
    linha({
      dataPedido: new Date(2023, 11, 25),
      cores: [{ nome: "Preto", qtd: 100 }],
    }),
  ];
  const r = calcularMediaVendas(linhas, {
    periodoMin: min,
    periodoMax: ate,
    preset: 14,
    estados: new Set(),
  });
  assert.equal(r.periodo.dias, 14);
  assert.equal(r.totalItens, 7); // 3 + 4
  assert.equal(r.mediaPorDia, 7 / 14);
});

test("calcularMediaVendas: respeita filtro de estado", () => {
  const ate = new Date(2024, 0, 14);
  const min = new Date(2024, 0, 1);
  const linhas: LinhaPedido[] = [
    linha({
      dataPedido: new Date(2024, 0, 5),
      estado: "Enviado",
      cores: [{ nome: "Preto", qtd: 1 }],
    }),
    linha({
      dataPedido: new Date(2024, 0, 5),
      estado: "Cancelado",
      cores: [{ nome: "Azul", qtd: 5 }],
    }),
  ];
  const r = calcularMediaVendas(linhas, {
    periodoMin: min,
    periodoMax: ate,
    preset: 14,
    estados: new Set(["Enviado"]),
  });
  assert.equal(r.totalItens, 1);
});

test("calcularMediaVendas: preset > período disponível clampa pelo CSV", () => {
  // CSV cobre 10 dias (1..10). Pediu 30 → vira 10.
  const min = new Date(2024, 0, 1);
  const ate = new Date(2024, 0, 10);
  const linhas: LinhaPedido[] = [
    linha({ dataPedido: new Date(2024, 0, 1), cores: [{ nome: "P", qtd: 20 }] }),
  ];
  const r = calcularMediaVendas(linhas, {
    periodoMin: min,
    periodoMax: ate,
    preset: 30,
    estados: new Set(),
  });
  assert.equal(r.periodo.dias, 10);
  assert.equal(r.totalItens, 20);
  assert.equal(r.mediaPorDia, 2);
});

test('calcularMediaVendas: preset "tudo" usa periodoMin completo', () => {
  const min = new Date(2024, 0, 1);
  const ate = new Date(2024, 0, 20);
  const linhas: LinhaPedido[] = [
    linha({ dataPedido: new Date(2024, 0, 1), cores: [{ nome: "P", qtd: 4 }] }),
    linha({ dataPedido: new Date(2024, 0, 19), cores: [{ nome: "A", qtd: 6 }] }),
  ];
  const r = calcularMediaVendas(linhas, {
    periodoMin: min,
    periodoMax: ate,
    preset: "tudo",
    estados: new Set(),
  });
  assert.equal(r.periodo.dias, 20);
  assert.equal(r.totalItens, 10);
  assert.equal(r.mediaPorDia, 0.5);
});

test("coberturaDias: estoque ÷ média; Infinity quando média 0", () => {
  assert.equal(coberturaDias(140, 8), 17.5);
  assert.equal(coberturaDias(0, 5), 0);
  assert.equal(coberturaDias(100, 0), Infinity);
  assert.equal(coberturaDias(100, -1), Infinity);
});

test("adicionarDiasUteis: pula sáb/dom", () => {
  // Seg 2024-01-01 + 2 úteis = Qua 2024-01-03
  const seg = new Date(2024, 0, 1);
  assert.deepEqual(adicionarDiasUteis(seg, 2), new Date(2024, 0, 3));
  // Sex 2024-01-05 + 2 úteis = Ter 2024-01-09
  const sex = new Date(2024, 0, 5);
  assert.deepEqual(adicionarDiasUteis(sex, 2), new Date(2024, 0, 9));
  // Sáb 2024-01-06 + 2 úteis = Ter 2024-01-09 (pula dom, conta seg+ter)
  const sab = new Date(2024, 0, 6);
  assert.deepEqual(adicionarDiasUteis(sab, 2), new Date(2024, 0, 9));
  // Dom 2024-01-07 + 2 úteis = Ter 2024-01-09
  const dom = new Date(2024, 0, 7);
  assert.deepEqual(adicionarDiasUteis(dom, 2), new Date(2024, 0, 9));
});

test("calcularMediaPorDiaSemana: filtro plataforma e prazo +2 úteis", () => {
  const min = new Date(2024, 0, 1); // seg
  const ate = new Date(2024, 0, 14); // dom — 14 dias = 2 de cada DOW.
  const linhas: LinhaPedido[] = [
    // TikTok Shop, pedido seg 1/jan → entrega qua 3/jan (DOW=3). 3 peças.
    linha({
      dataPedido: new Date(2024, 0, 1),
      plataforma: PLATAFORMA_TIKTOK,
      cores: [{ nome: "Preto", qtd: 3 }],
    }),
    // TikTok Shop, pedido sex 5/jan → entrega ter 9/jan (DOW=2). 2 peças.
    linha({
      dataPedido: new Date(2024, 0, 5),
      plataforma: PLATAFORMA_TIKTOK,
      cores: [{ nome: "Azul", qtd: 2 }],
    }),
    // Mercado Livre — descartado pelo filtro.
    linha({
      dataPedido: new Date(2024, 0, 1),
      plataforma: "Mercado Livre",
      cores: [{ nome: "Preto", qtd: 100 }],
    }),
  ];
  const r = calcularMediaPorDiaSemana(linhas, {
    periodoMin: min,
    periodoMax: ate,
    preset: 14,
    estados: new Set(),
    plataforma: PLATAFORMA_TIKTOK,
  });
  assert.equal(r.length, 7);
  const porDow = Object.fromEntries(r.map((d) => [d.diaSemana, d]));
  // Qua: 3 peças, 2 ocorrências → 1,5
  assert.equal(porDow[3].totalItens, 3);
  assert.equal(porDow[3].ocorrencias, 2);
  assert.equal(porDow[3].media, 1.5);
  // Ter: 2 peças, 2 ocorrências → 1
  assert.equal(porDow[2].totalItens, 2);
  assert.equal(porDow[2].media, 1);
  // Seg: nada
  assert.equal(porDow[1].totalItens, 0);
  assert.equal(porDow[1].media, 0);
});

test("gerarOrdemDow: 7 entradas em ciclo a partir do dow inicial", () => {
  // Sex (5) → sex, sáb, dom, seg, ter, qua, qui
  assert.deepEqual(gerarOrdemDow(5), [5, 6, 0, 1, 2, 3, 4]);
  // Dom (0) → dom..sáb
  assert.deepEqual(gerarOrdemDow(0), [0, 1, 2, 3, 4, 5, 6]);
  // Seg (1) → seg..dom
  assert.deepEqual(gerarOrdemDow(1), [1, 2, 3, 4, 5, 6, 0]);
});

test("simularEstoqueSemanal: começa em dowInicial, subtrai dia a dia", () => {
  // Médias: seg=10, ter=5, demais=0
  const medias = [
    { diaSemana: 0, totalItens: 0, ocorrencias: 1, media: 0 },
    { diaSemana: 1, totalItens: 0, ocorrencias: 1, media: 10 },
    { diaSemana: 2, totalItens: 0, ocorrencias: 1, media: 5 },
    { diaSemana: 3, totalItens: 0, ocorrencias: 1, media: 0 },
    { diaSemana: 4, totalItens: 0, ocorrencias: 1, media: 0 },
    { diaSemana: 5, totalItens: 0, ocorrencias: 1, media: 0 },
    { diaSemana: 6, totalItens: 0, ocorrencias: 1, media: 0 },
  ];
  // Começa na seg (1): seg, ter, qua, qui, sex, sáb, dom
  const segOrigem = simularEstoqueSemanal(100, medias, 1);
  assert.deepEqual(
    segOrigem.map((d) => d.estoqueInicial),
    [100, 90, 85, 85, 85, 85, 85],
  );
  // Começa na sex (5): sex, sáb, dom, seg, ter, qua, qui
  // Sex consome 0, sáb consome 0, dom consome 0, seg consome 10, ter consome 5
  const sexOrigem = simularEstoqueSemanal(100, medias, 5);
  assert.deepEqual(
    sexOrigem.map((d) => d.diaSemana),
    [5, 6, 0, 1, 2, 3, 4],
  );
  assert.deepEqual(
    sexOrigem.map((d) => d.estoqueInicial),
    [100, 100, 100, 100, 90, 85, 85],
  );
});

test("simularEstoqueSemanal: clampa em 0 quando consumo passa do estoque", () => {
  const medias = [
    { diaSemana: 0, totalItens: 0, ocorrencias: 1, media: 0 },
    { diaSemana: 1, totalItens: 0, ocorrencias: 1, media: 80 },
    { diaSemana: 2, totalItens: 0, ocorrencias: 1, media: 50 },
    { diaSemana: 3, totalItens: 0, ocorrencias: 1, media: 0 },
    { diaSemana: 4, totalItens: 0, ocorrencias: 1, media: 0 },
    { diaSemana: 5, totalItens: 0, ocorrencias: 1, media: 0 },
    { diaSemana: 6, totalItens: 0, ocorrencias: 1, media: 0 },
  ];
  // Começa na seg (1): seg, ter, qua, ...
  const sim = simularEstoqueSemanal(100, medias, 1);
  // Seg: 100, Ter: 20 (100-80), Qua: 0 (20-50 → clampa em 0)
  assert.equal(sim[0].estoqueInicial, 100);
  assert.equal(sim[1].estoqueInicial, 20);
  assert.equal(sim[2].estoqueInicial, 0);
});
