// Testes do sincronizador Compra → Corte (RITM-33).

import { test } from "node:test";
import assert from "node:assert/strict";
import type { SubtaskCompraPayload } from "./schemas/payloads/compra";
import type { SubtaskCortePayload } from "./schemas/payloads/corte";
import { sincronizarCorteComCompra } from "./sincronizar-corte";

const COMPRA_BASE: SubtaskCompraPayload = {
  fornecedores: [
    {
      fornecedorId: "f1",
      cores: [
        {
          corId: "c-az",
          kgsContratados: 100,
          qtdRolosContratados: 5,
          precoPorKg: 25,
          pesosRolos: [20, 20, 20, 20, 20],
        },
      ],
    },
  ],
  distribuicaoOficinas: [
    { oficinaId: "of-A", rolosPorCor: { "c-az": 3 } },
    { oficinaId: "of-B", rolosPorCor: { "c-az": 2 } },
  ],
};

test("sincronizar: corte vazio + 2 oficinas na Compra → cria as 2 oficinas", () => {
  const r = sincronizarCorteComCompra(COMPRA_BASE, null);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const oficinas = r.payload.oficinas ?? [];
  assert.equal(oficinas.length, 2);
  assert.equal(oficinas[0].oficinaId, "of-A");
  assert.deepEqual(oficinas[0].rolosEnviadosPorCor, { "c-az": 3 });
  assert.equal(oficinas[0].modoSeparacao, "por_cor");
  assert.equal(oficinas[0].folhasEnfesto, undefined);
});

test("sincronizar: preserva pós-corte por oficinaId quando rolos da Compra mudam", () => {
  const corteAtual: SubtaskCortePayload = {
    oficinas: [
      {
        oficinaId: "of-A",
        modoSeparacao: "sem_separacao",
        rolosEnviadosPorCor: { "c-az": 2 }, // valor antigo
        folhasEnfesto: 12,
        rendimentoTotal: 480,
        precoPorPeca: 3.5,
        observacoes: "tudo certo",
      },
      {
        oficinaId: "of-B",
        modoSeparacao: "por_cor",
        rolosEnviadosPorCor: { "c-az": 3 }, // antigo: 3, novo: 2
      },
    ],
  };
  const r = sincronizarCorteComCompra(COMPRA_BASE, corteAtual);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const ofA = r.payload.oficinas!.find((o) => o.oficinaId === "of-A")!;
  // rolos vêm da Compra (nova distribuição)
  assert.deepEqual(ofA.rolosEnviadosPorCor, { "c-az": 3 });
  // pós-corte preservado
  assert.equal(ofA.folhasEnfesto, 12);
  assert.equal(ofA.rendimentoTotal, 480);
  assert.equal(ofA.precoPorPeca, 3.5);
  assert.equal(ofA.observacoes, "tudo certo");
  // modoSeparacao preservado (era sem_separacao)
  assert.equal(ofA.modoSeparacao, "sem_separacao");
});

test("sincronizar: oficina adicionada na Compra aparece com pós-corte vazio", () => {
  const corteAtual: SubtaskCortePayload = {
    oficinas: [
      {
        oficinaId: "of-A",
        modoSeparacao: "por_cor",
        rolosEnviadosPorCor: { "c-az": 3 },
        folhasEnfesto: 12,
      },
    ],
  };
  // Compra agora tem of-A E of-B
  const r = sincronizarCorteComCompra(COMPRA_BASE, corteAtual);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.payload.oficinas!.length, 2);
  const ofB = r.payload.oficinas!.find((o) => o.oficinaId === "of-B")!;
  assert.equal(ofB.folhasEnfesto, undefined);
  assert.deepEqual(ofB.rolosEnviadosPorCor, { "c-az": 2 });
});

test("sincronizar: oficina removida SEM pós-corte → ok, sai silenciosamente", () => {
  const corteAtual: SubtaskCortePayload = {
    oficinas: [
      {
        oficinaId: "of-A",
        modoSeparacao: "por_cor",
        rolosEnviadosPorCor: { "c-az": 3 },
      },
      {
        oficinaId: "of-B",
        modoSeparacao: "por_cor",
        rolosEnviadosPorCor: { "c-az": 2 },
      },
      {
        oficinaId: "of-C",
        modoSeparacao: "por_cor",
        rolosEnviadosPorCor: { "c-az": 1 }, // não tem pós-corte
      },
    ],
  };
  const r = sincronizarCorteComCompra(COMPRA_BASE, corteAtual);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.payload.oficinas!.length, 2);
  assert.equal(
    r.payload.oficinas!.find((o) => o.oficinaId === "of-C"),
    undefined,
  );
});

test("sincronizar: oficina removida COM pós-corte → perdas reportadas", () => {
  const corteAtual: SubtaskCortePayload = {
    oficinas: [
      {
        oficinaId: "of-A",
        modoSeparacao: "por_cor",
        rolosEnviadosPorCor: { "c-az": 3 },
      },
      {
        oficinaId: "of-C", // removida da Compra
        modoSeparacao: "por_cor",
        rolosEnviadosPorCor: { "c-az": 2 },
        folhasEnfesto: 8,
        precoPorPeca: 4,
      },
    ],
  };
  const r = sincronizarCorteComCompra(COMPRA_BASE, corteAtual);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.perdas.length, 1);
  assert.equal(r.perdas[0].oficinaId, "of-C");
  assert.deepEqual(r.perdas[0].campos.sort(), [
    "folhasEnfesto",
    "precoPorPeca",
  ]);
});

test("sincronizar: várias oficinas removidas com pós-corte → todas listadas", () => {
  const corteAtual: SubtaskCortePayload = {
    oficinas: [
      {
        oficinaId: "of-C",
        modoSeparacao: "por_cor",
        rolosEnviadosPorCor: { "c-az": 2 },
        folhasEnfesto: 5,
      },
      {
        oficinaId: "of-D",
        modoSeparacao: "por_cor",
        rolosEnviadosPorCor: { "c-az": 1 },
        rendimentoTotal: 40,
      },
    ],
  };
  const r = sincronizarCorteComCompra(COMPRA_BASE, corteAtual);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.perdas.length, 2);
});

test("sincronizar: Compra sem distribuicaoOficinas → preserva Corte atual (legacy)", () => {
  const compraLegacy: SubtaskCompraPayload = {
    fornecedores: [
      {
        fornecedorId: "f1",
        cores: [
          {
            corId: "c-az",
            kgsContratados: 100,
            qtdRolosContratados: 3,
            precoPorKg: 25,
            pesosRolos: [],
          },
        ],
      },
    ],
    destinatarioCorteId: "of-X",
  };
  const corteAtual: SubtaskCortePayload = {
    oficinas: [
      {
        oficinaId: "of-X",
        modoSeparacao: "por_cor",
        rolosEnviadosPorCor: { "c-az": 3 },
        folhasEnfesto: 10,
      },
    ],
  };
  const r = sincronizarCorteComCompra(compraLegacy, corteAtual);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  // Preserva intacto
  assert.equal(r.payload.oficinas!.length, 1);
  assert.equal(r.payload.oficinas![0].folhasEnfesto, 10);
});

test("sincronizar: Compra sem distribuicao + Corte vazio → oficinas vazias", () => {
  const r = sincronizarCorteComCompra({}, null);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.payload.oficinas ?? [], []);
});

test("sincronizar: rolosPorCor com várias cores propaga inteiro", () => {
  const compra: SubtaskCompraPayload = {
    fornecedores: [
      {
        fornecedorId: "f1",
        cores: [
          {
            corId: "c-az",
            kgsContratados: 100,
            qtdRolosContratados: 5,
            precoPorKg: 25,
            pesosRolos: [],
          },
          {
            corId: "c-pt",
            kgsContratados: 60,
            qtdRolosContratados: 3,
            precoPorKg: 28,
            pesosRolos: [],
          },
        ],
      },
    ],
    distribuicaoOficinas: [
      { oficinaId: "of-A", rolosPorCor: { "c-az": 3, "c-pt": 1 } },
      { oficinaId: "of-B", rolosPorCor: { "c-az": 2, "c-pt": 2 } },
    ],
  };
  const r = sincronizarCorteComCompra(compra, null);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const ofA = r.payload.oficinas!.find((o) => o.oficinaId === "of-A")!;
  assert.deepEqual(ofA.rolosEnviadosPorCor, { "c-az": 3, "c-pt": 1 });
});
