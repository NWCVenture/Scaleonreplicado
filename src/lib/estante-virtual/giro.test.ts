import { test } from "node:test";
import assert from "node:assert/strict";
import { calcularMediaVendas, coberturaDias } from "./giro";
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
