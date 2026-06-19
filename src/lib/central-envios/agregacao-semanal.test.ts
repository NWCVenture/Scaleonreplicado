import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dowFromYmd,
  fimDaSemanaIso,
  inicioDaSemanaIso,
  montarAgregacaoProximos7Dias,
  montarAgregacaoSemanal,
} from "./agregacao-semanal";
import type { PedidoEnriquecido } from "@/lib/central-envios/sessao/types";

function ped(
  prazoIso: string | null,
  linhas: Array<{ modeloCodigo: string; cor: string; tamanho: string; qtd: number }>,
  opts: { kind?: "OK" | "AMBIGUO" } = {},
): PedidoEnriquecido {
  return {
    origemRunId: "r1",
    canal: "tiktok_shop",
    orderId: "O-1",
    trackingId: null,
    skuRaw: "raw",
    quantidadeRaw: 1,
    criadoEmIso: null,
    comprador: null,
    camposExtras: {},
    parsed:
      opts.kind === "AMBIGUO"
        ? { kind: "AMBIGUO", motivo: "x", detalhes: "y" }
        : {
            kind: "OK",
            modeloCodigo: "SOL",
            tamanho: "M",
            qtdKit: 1,
            canonical: "SOL,AZ,M",
            cores: [{ cor: "AZ", qtd: 1 }],
            skuKind: "AVULSO",
          },
    linhasExplodidas: linhas,
    explosaoErro: null,
    prazo: {
      status: prazoIso ? "CALCULADO" : "SEM_DATA",
      prazoIso,
      origem: prazoIso ? "dias_uteis_pos_venda" : null,
      detalhes: "",
    },
  };
}

test("dowFromYmd: 2024-01-01 (seg) = 1, 2024-01-07 (dom) = 0", () => {
  assert.equal(dowFromYmd("2024-01-01"), 1);
  assert.equal(dowFromYmd("2024-01-07"), 0);
  assert.equal(dowFromYmd("2024-01-06"), 6);
  assert.equal(dowFromYmd("ruim"), -1);
});

test("inicioDaSemanaIso / fimDaSemanaIso: segunda e domingo da semana corrente", () => {
  // hoje = quarta 2024-01-03 → seg=01, dom=07
  assert.equal(inicioDaSemanaIso("2024-01-03"), "2024-01-01");
  assert.equal(fimDaSemanaIso("2024-01-03"), "2024-01-07");
  // hoje = dom 2024-01-07 → seg=01, dom=07
  assert.equal(inicioDaSemanaIso("2024-01-07"), "2024-01-01");
  assert.equal(fimDaSemanaIso("2024-01-07"), "2024-01-07");
  // hoje = seg 2024-01-08 → seg=08, dom=14
  assert.equal(inicioDaSemanaIso("2024-01-08"), "2024-01-08");
  assert.equal(fimDaSemanaIso("2024-01-08"), "2024-01-14");
});

test("montarAgregacaoSemanal: filtra por janela e agrega por DOW do prazo", () => {
  const hojeIso = "2024-01-03"; // qua. Semana 01..07.
  const dados: PedidoEnriquecido[] = [
    // Entrega seg 01 → 5 peças do SKU "SOL AZ M".
    ped("2024-01-01", [{ modeloCodigo: "SOL", cor: "AZ", tamanho: "M", qtd: 5 }]),
    // Entrega ter 02 → 3 peças do SKU "SOL AZ M".
    ped("2024-01-02", [{ modeloCodigo: "SOL", cor: "AZ", tamanho: "M", qtd: 3 }]),
    // Entrega qua 03 → 2 peças do SKU "SOL PT G" + 1 peça "SOL AZ M".
    ped("2024-01-03", [
      { modeloCodigo: "SOL", cor: "PT", tamanho: "G", qtd: 2 },
      { modeloCodigo: "SOL", cor: "AZ", tamanho: "M", qtd: 1 },
    ]),
    // FORA da janela (próxima semana) → ignorado.
    ped("2024-01-08", [{ modeloCodigo: "SOL", cor: "AZ", tamanho: "M", qtd: 100 }]),
    // Sem prazo → ignorado.
    ped(null, [{ modeloCodigo: "SOL", cor: "AZ", tamanho: "M", qtd: 100 }]),
    // Ambíguo → ignorado.
    ped(
      "2024-01-03",
      [{ modeloCodigo: "SOL", cor: "AZ", tamanho: "M", qtd: 100 }],
      { kind: "AMBIGUO" },
    ),
  ];

  const r = montarAgregacaoSemanal(dados, hojeIso, { maxSkus: 8 });

  assert.equal(r.inicioIso, "2024-01-01");
  assert.equal(r.fimIso, "2024-01-07");
  assert.equal(r.pedidosConsiderados, 3);
  // Seg(1)=5, Ter(2)=3, Qua(3)=3 (2+1). Demais 0.
  assert.deepEqual(r.totalPorDow, [0, 5, 3, 3, 0, 0, 0]);
  // Top SKUs: SOL AZ M = 9, SOL PT G = 2
  assert.equal(r.topSkus.length, 2);
  assert.equal(r.topSkus[0].sku, "SOL AZ M");
  assert.equal(r.topSkus[0].total, 9);
  assert.deepEqual(r.topSkus[0].porDow, [0, 5, 3, 1, 0, 0, 0]);
  assert.equal(r.topSkus[1].sku, "SOL PT G");
  assert.equal(r.topSkus[1].total, 2);
  assert.deepEqual(r.topSkus[1].porDow, [0, 0, 0, 2, 0, 0, 0]);
  assert.equal(r.outrosCount, 0);
  assert.deepEqual(r.outrosPorDow, [0, 0, 0, 0, 0, 0, 0]);
});

test("montarAgregacaoProximos7Dias: janela [hoje, hoje+6] independente de Seg/Dom", () => {
  // hoje = qua 2024-01-03. Próximos 7 dias = 03..09 (qua a ter).
  // 01 e 02 ficam fora; 09 entra.
  const hoje = "2024-01-03";
  const dados: PedidoEnriquecido[] = [
    ped("2024-01-02", [{ modeloCodigo: "A", cor: "X", tamanho: "M", qtd: 100 }]),
    ped("2024-01-03", [{ modeloCodigo: "A", cor: "X", tamanho: "M", qtd: 5 }]),
    ped("2024-01-09", [{ modeloCodigo: "A", cor: "X", tamanho: "M", qtd: 3 }]),
    ped("2024-01-10", [{ modeloCodigo: "A", cor: "X", tamanho: "M", qtd: 50 }]),
  ];
  const r = montarAgregacaoProximos7Dias(dados, hoje, { maxSkus: 8 });
  assert.equal(r.inicioIso, "2024-01-03");
  assert.equal(r.fimIso, "2024-01-09");
  // 03 (qua, DOW 3) = 5; 09 (ter, DOW 2) = 3
  assert.equal(r.totalPorDow[3], 5);
  assert.equal(r.totalPorDow[2], 3);
  assert.equal(r.pedidosConsiderados, 2);
});

test("montarAgregacaoSemanal: agrupa SKUs além do topN em 'Outros'", () => {
  const hojeIso = "2024-01-03";
  // 3 SKUs distintos com totais 10, 5, 2. maxSkus=2 → último vira "Outros".
  const dados: PedidoEnriquecido[] = [
    ped("2024-01-01", [{ modeloCodigo: "A", cor: "X", tamanho: "M", qtd: 10 }]),
    ped("2024-01-02", [{ modeloCodigo: "B", cor: "X", tamanho: "M", qtd: 5 }]),
    ped("2024-01-03", [{ modeloCodigo: "C", cor: "X", tamanho: "M", qtd: 2 }]),
  ];
  const r = montarAgregacaoSemanal(dados, hojeIso, { maxSkus: 2 });
  assert.equal(r.topSkus.length, 2);
  assert.equal(r.topSkus[0].sku, "A X M");
  assert.equal(r.topSkus[1].sku, "B X M");
  assert.equal(r.outrosCount, 1);
  // "Outros" = C X M com 2 peças entregues na qua (DOW=3).
  assert.deepEqual(r.outrosPorDow, [0, 0, 0, 2, 0, 0, 0]);
});
