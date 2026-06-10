import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseVariacao,
  normalizeCor,
  normalizeTamanho,
  agrupar,
  type LinhaPedido,
} from "./parser";

test("parseVariacao: cor com multiplicador e tamanho", () => {
  const r = parseVariacao("Azul (2) / Preto, G");
  assert.equal(r.tamanho, "G");
  assert.deepEqual(r.cores, [
    { nome: "Azul", qtd: 2 },
    { nome: "Preto", qtd: 1 },
  ]);
});

test("parseVariacao: tres cores sem multiplicador", () => {
  const r = parseVariacao("Preto / Azul / Branco, M");
  assert.equal(r.tamanho, "M");
  assert.deepEqual(r.cores, [
    { nome: "Preto", qtd: 1 },
    { nome: "Azul", qtd: 1 },
    { nome: "Branco", qtd: 1 },
  ]);
});

test("parseVariacao: cor unica e tamanho GG", () => {
  const r = parseVariacao("Preto, GG");
  assert.equal(r.tamanho, "GG");
  assert.deepEqual(r.cores, [{ nome: "Preto", qtd: 1 }]);
});

test("parseVariacao: Branco (2) com tamanho EGG", () => {
  const r = parseVariacao("Branco (2) / Preto, EGG");
  assert.equal(r.tamanho, "EGG");
  assert.deepEqual(r.cores, [
    { nome: "Branco", qtd: 2 },
    { nome: "Preto", qtd: 1 },
  ]);
});

test("parseVariacao: string vazia retorna vazio", () => {
  const r = parseVariacao("");
  assert.equal(r.tamanho, null);
  assert.deepEqual(r.cores, []);
});

test("parseVariacao: null retorna vazio", () => {
  const r = parseVariacao(null);
  assert.equal(r.tamanho, null);
  assert.deepEqual(r.cores, []);
});

test("parseVariacao: formato unitario Cor,Tipo,Tamanho da Upseller", () => {
  const r = parseVariacao("Azul,Lisa,G");
  assert.equal(r.tamanho, "G");
  assert.deepEqual(r.cores, [{ nome: "Azul", qtd: 1 }]);
});

test("parseVariacao: Preto,Lisa,M descarta o Lisa", () => {
  const r = parseVariacao("Preto,Lisa,M");
  assert.equal(r.tamanho, "M");
  assert.deepEqual(r.cores, [{ nome: "Preto", qtd: 1 }]);
});

test("parseVariacao: Branco,Lisa,EGG descarta o Lisa", () => {
  const r = parseVariacao("Branco,Lisa,EGG");
  assert.equal(r.tamanho, "EGG");
  assert.deepEqual(r.cores, [{ nome: "Branco", qtd: 1 }]);
});

test("normalizeCor: aliases conhecidos", () => {
  assert.equal(normalizeCor("PT"), "Preto");
  assert.equal(normalizeCor("AZ"), "Azul");
  assert.equal(normalizeCor("br"), "Branco");
});

test("normalizeCor: title case generico", () => {
  assert.equal(normalizeCor("azul marinho"), "Azul Marinho");
  assert.equal(normalizeCor("VERDE"), "Verde");
});

test("normalizeTamanho: aliases", () => {
  assert.equal(normalizeTamanho("g"), "G");
  assert.equal(normalizeTamanho(" GG "), "GG");
  assert.equal(normalizeTamanho("XG"), "GG");
});

function linha(partial: Partial<LinhaPedido>): LinhaPedido {
  return {
    numeroPedido: "X",
    plataforma: "TikTok Shop",
    loja: "L1",
    estado: "Enviado",
    dataPedido: new Date(2026, 5, 1),
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

test("agrupar: matriz cor x tamanho com expansao de kit", () => {
  const linhas: LinhaPedido[] = [
    linha({
      numeroPedido: "P1",
      cores: [
        { nome: "Azul", qtd: 2 },
        { nome: "Preto", qtd: 1 },
      ],
      tamanho: "G",
      qtdProduto: 1,
    }),
    linha({
      numeroPedido: "P2",
      cores: [{ nome: "Preto", qtd: 1 }],
      tamanho: "M",
      qtdProduto: 2,
    }),
    linha({
      numeroPedido: "P3",
      cores: [{ nome: "Branco", qtd: 1 }],
      tamanho: "G",
      qtdProduto: 1,
    }),
  ];
  const r = agrupar(linhas, {
    de: new Date(2026, 5, 1),
    ate: new Date(2026, 5, 1),
    estados: new Set(["Enviado"]),
  });
  assert.equal(r.totalItens, 6);
  assert.equal(r.totalPedidos, 3);
  const linhaAzul = r.matriz.linhas.find((l) => l.cor === "Azul");
  assert.equal(linhaAzul?.porTamanho.G, 2);
  const linhaPreto = r.matriz.linhas.find((l) => l.cor === "Preto");
  assert.equal(linhaPreto?.porTamanho.G, 1);
  assert.equal(linhaPreto?.porTamanho.M, 2);
  assert.equal(r.matriz.totalPorTamanho.G, 4);
  assert.equal(r.matriz.totalPorTamanho.M, 2);
});

test("agrupar: filtro por estado descarta linhas fora", () => {
  const linhas: LinhaPedido[] = [
    linha({ estado: "Enviado", cores: [{ nome: "Preto", qtd: 1 }] }),
    linha({ estado: "Não Pago", cores: [{ nome: "Azul", qtd: 5 }] }),
  ];
  const r = agrupar(linhas, {
    de: new Date(2026, 5, 1),
    ate: new Date(2026, 5, 1),
    estados: new Set(["Enviado"]),
  });
  assert.equal(r.totalItens, 1);
  assert.equal(r.matriz.linhas.length, 1);
  assert.equal(r.matriz.linhas[0].cor, "Preto");
});

test("agrupar: filtro por data descarta linhas fora", () => {
  const linhas: LinhaPedido[] = [
    linha({ dataPedido: new Date(2026, 4, 30) }),
    linha({ dataPedido: new Date(2026, 5, 1) }),
    linha({ dataPedido: new Date(2026, 5, 2) }),
  ];
  const r = agrupar(linhas, {
    de: new Date(2026, 5, 1),
    ate: new Date(2026, 5, 1),
    estados: new Set(["Enviado"]),
  });
  assert.equal(r.totalItens, 1);
});

test("agrupar: ranking de cores e tamanhos ordenado desc", () => {
  const linhas: LinhaPedido[] = [
    linha({ cores: [{ nome: "Preto", qtd: 10 }] }),
    linha({ cores: [{ nome: "Azul", qtd: 3 }] }),
    linha({ cores: [{ nome: "Branco", qtd: 5 }] }),
  ];
  const r = agrupar(linhas, {
    de: new Date(2026, 5, 1),
    ate: new Date(2026, 5, 1),
    estados: new Set(["Enviado"]),
  });
  assert.equal(r.topCores[0].nome, "Preto");
  assert.equal(r.topCores[0].qtd, 10);
  assert.equal(r.topCores[1].nome, "Branco");
  assert.equal(r.topCores[2].nome, "Azul");
});

test("agrupar: porSku conta pedidos unicos e itens expandidos", () => {
  const linhas: LinhaPedido[] = [
    linha({
      numeroPedido: "P1",
      sku: "KIT 3 SOL 2 AZ 1 PT G",
      cores: [
        { nome: "Azul", qtd: 2 },
        { nome: "Preto", qtd: 1 },
      ],
      qtdProduto: 1,
    }),
    linha({
      numeroPedido: "P2",
      sku: "KIT 3 SOL 2 AZ 1 PT G",
      cores: [
        { nome: "Azul", qtd: 2 },
        { nome: "Preto", qtd: 1 },
      ],
      qtdProduto: 1,
    }),
  ];
  const r = agrupar(linhas, {
    de: new Date(2026, 5, 1),
    ate: new Date(2026, 5, 1),
    estados: new Set(["Enviado"]),
  });
  assert.equal(r.porSku.length, 1);
  assert.equal(r.porSku[0].qtdPedidos, 2);
  assert.equal(r.porSku[0].qtdItens, 6);
});

test("agrupar: estados vazio nao filtra (libera tudo)", () => {
  const linhas: LinhaPedido[] = [
    linha({ estado: "Enviado", cores: [{ nome: "Preto", qtd: 1 }] }),
    linha({ estado: "Não Pago", cores: [{ nome: "Azul", qtd: 1 }] }),
  ];
  const r = agrupar(linhas, {
    de: new Date(2026, 5, 1),
    ate: new Date(2026, 5, 1),
    estados: new Set(),
  });
  assert.equal(r.totalItens, 2);
});

test("agrupar: pedidosPorDiaSemana — dedup por pedido e ocorrencias do dow", () => {
  // 2024-01-01 cai numa segunda. Período de 14 dias → 2 ocorrências de cada DOW.
  const seg1 = new Date(2024, 0, 1);
  const ter1 = new Date(2024, 0, 2);
  const seg2 = new Date(2024, 0, 8);
  const dom2 = new Date(2024, 0, 14);
  const linhas: LinhaPedido[] = [
    linha({
      numeroPedido: "P1",
      dataPedido: seg1,
      cores: [{ nome: "Azul", qtd: 1 }],
    }),
    // Segunda linha do mesmo pedido — não pode contar 2× na segunda.
    linha({
      numeroPedido: "P1",
      dataPedido: seg1,
      cores: [{ nome: "Preto", qtd: 1 }],
    }),
    linha({
      numeroPedido: "P2",
      dataPedido: seg2,
      cores: [{ nome: "Azul", qtd: 1 }],
    }),
    linha({
      numeroPedido: "P3",
      dataPedido: ter1,
      cores: [{ nome: "Verde", qtd: 1 }],
    }),
    linha({
      numeroPedido: "P4",
      dataPedido: dom2,
      cores: [{ nome: "Branco", qtd: 1 }],
    }),
  ];
  const r = agrupar(linhas, {
    de: seg1,
    ate: dom2,
    estados: new Set(),
  });

  assert.equal(r.pedidosPorDiaSemana.length, 7);
  const porDow = Object.fromEntries(
    r.pedidosPorDiaSemana.map((d) => [d.diaSemana, d]),
  );
  // Segunda (1): P1 + P2 = 2 pedidos únicos, 2 ocorrências, média 1.
  assert.equal(porDow[1].total, 2);
  assert.equal(porDow[1].ocorrencias, 2);
  assert.equal(porDow[1].media, 1);
  // Terça (2): só P3, 2 ocorrências → média 0,5.
  assert.equal(porDow[2].total, 1);
  assert.equal(porDow[2].ocorrencias, 2);
  assert.equal(porDow[2].media, 0.5);
  // Domingo (0): só P4, 2 ocorrências → média 0,5.
  assert.equal(porDow[0].total, 1);
  assert.equal(porDow[0].ocorrencias, 2);
  assert.equal(porDow[0].media, 0.5);
  // Quarta (3) sem pedidos no período, mas ainda tem 2 ocorrências.
  assert.equal(porDow[3].total, 0);
  assert.equal(porDow[3].ocorrencias, 2);
  assert.equal(porDow[3].media, 0);
});

test("agrupar: pedidosPorDiaSemana respeita filtro de estado", () => {
  const seg = new Date(2024, 0, 1);
  const linhas: LinhaPedido[] = [
    linha({
      numeroPedido: "P1",
      dataPedido: seg,
      estado: "Enviado",
      cores: [{ nome: "Azul", qtd: 1 }],
    }),
    linha({
      numeroPedido: "P2",
      dataPedido: seg,
      estado: "Cancelado",
      cores: [{ nome: "Verde", qtd: 1 }],
    }),
  ];
  const r = agrupar(linhas, {
    de: seg,
    ate: seg,
    estados: new Set(["Enviado"]),
  });
  const porDow = Object.fromEntries(
    r.pedidosPorDiaSemana.map((d) => [d.diaSemana, d]),
  );
  // Só P1 (Enviado) entra. 1 ocorrência no período (1 dia).
  assert.equal(porDow[1].total, 1);
  assert.equal(porDow[1].ocorrencias, 1);
  assert.equal(porDow[1].media, 1);
});
