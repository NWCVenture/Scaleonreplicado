// Testes do derivador de KPIs do dashboard da OP (RITM-28).
// Sem banco, sem fixture de schema — só dados sintéticos em memória.

import { test } from "node:test";
import assert from "node:assert/strict";
import { derivarKpisOp, type SubtaskComPayload } from "./dashboard-kpis";
import type { SubtaskCompraPayload } from "./schemas/payloads/compra";
import type { SubtaskRiscoPayload } from "./schemas/payloads/risco";
import type { SubtaskCortePayload } from "./schemas/payloads/corte";
import type { SubtaskViesPayload } from "./schemas/payloads/vies";
import type { SubtaskCosturaPayload } from "./schemas/payloads/costura";

// ──────────────────────────────────────────────────────────────
// fixtures
// ──────────────────────────────────────────────────────────────

function st(
  prefixo: string,
  status: SubtaskComPayload["status"],
  payload: unknown = {},
): SubtaskComPayload {
  return { prefixo, status, payload };
}

const COMPRA_OK: SubtaskCompraPayload = {
  fornecedores: [
    {
      fornecedorId: "f1",
      cores: [
        {
          corId: "cor-az",
          kgsContratados: 10,
          qtdRolosContratados: 3,
          precoPorKg: 20,
          pesosRolos: [3.2, 3.1, 3.5], // 9.8 kg
        },
        {
          corId: "cor-pt",
          kgsContratados: 20,
          qtdRolosContratados: 4,
          precoPorKg: 20,
          pesosRolos: [5.0, 5.0, 5.0, 5.0], // 20.0 kg
        },
      ],
    },
  ],
  tipoTecidoId: "t1",
  destinatarioCorteId: "fo-corte",
  gramaturaGM2: 220,
  larguraRoloCm: 180,
};

const RISCO_OK: SubtaskRiscoPayload = {
  fornecedorRiscoId: "f-risc",
  tamanhos: [
    { tamanho: "M", proporcao: 4 },
    { tamanho: "G", proporcao: 5 },
    { tamanho: "GG", proporcao: 3 },
  ], // 12 peças/folha
  rendimentoPercentual: 88,
  comprimentoM: 2,
  larguraCm: 150,
  valorServico: 100,
};

const CORTE_OK: SubtaskCortePayload = {
  oficinas: [
    {
      oficinaId: "of-corte-1",
      modoSeparacao: "por_cor",
      rolosEnviadosPorCor: { "cor-az": 3, "cor-pt": 4 },
      folhasEnfesto: 32,
      rendimentoTotal: 384, // 32 × 12
      rendimentoPorTamanhoCor: [
        { tamanho: "M", corId: "cor-az", quantidade: 50 },
        { tamanho: "G", corId: "cor-az", quantidade: 70 },
        { tamanho: "M", corId: "cor-pt", quantidade: 80 },
        { tamanho: "G", corId: "cor-pt", quantidade: 100 },
        { tamanho: "GG", corId: "cor-pt", quantidade: 84 },
      ],
      precoPorPeca: 1.5,
    },
  ],
};

const COSTURA_OK: SubtaskCosturaPayload = {
  oficinas: [
    {
      oficinaId: "of-cost-1",
      pecasEnviadasPorTamanhoCor: [
        { tamanho: "M", corId: "cor-az", quantidade: 50 },
        { tamanho: "G", corId: "cor-az", quantidade: 70 },
        { tamanho: "M", corId: "cor-pt", quantidade: 80 },
        { tamanho: "G", corId: "cor-pt", quantidade: 100 },
        { tamanho: "GG", corId: "cor-pt", quantidade: 84 },
      ],
      precoPorPeca: 4,
      statusInterno: "enviado",
    },
  ],
};

const VIES_OK: SubtaskViesPayload = {
  fornecedorViesId: "f-vies",
  tamanhoBandeiraCm: 5,
  tipoTecidoId: "t1",
  corId: "cor-pt",
  metragemProduzidaM: 100,
  precoPorMetro: 2,
};

// ──────────────────────────────────────────────────────────────
// OP vazia (todos os payloads vazios) — KPIs devem ser nulos
// ──────────────────────────────────────────────────────────────

test("OP recém-criada (sem viés): todos os KPIs numéricos = null; status = pendente; viés = ausente", () => {
  const kpis = derivarKpisOp([
    st("OPBUY", "em_andamento", {}),
    st("OPRIS", "pendente", {}),
    st("OPCOR", "pendente", {}),
    st("OPSEW", "pendente", {}),
    st("OPCONF", "pendente", {}),
  ]);
  // Status
  assert.equal(kpis.status.compra, "em_andamento");
  assert.equal(kpis.status.risco, "pendente");
  assert.equal(kpis.status.vies, "ausente");
  assert.equal(kpis.status.conferencia, "pendente");
  // Quantidades
  assert.equal(kpis.quantidades.kgContratado, null);
  assert.equal(kpis.quantidades.kgRecebido, null);
  assert.equal(kpis.quantidades.diffKg, null);
  assert.equal(kpis.quantidades.diffPercentual, null);
  assert.equal(kpis.quantidades.rolosTotal, null);
  assert.equal(kpis.quantidades.folhasTotal, null);
  assert.equal(kpis.quantidades.pecasCortadas, null);
  assert.equal(kpis.quantidades.pecasEnviadasCostura, null);
  // Rendimento
  assert.equal(kpis.rendimento.aproveitamentoRiscoPercentual, null);
  assert.equal(kpis.rendimento.consumoPorPecaM2, null);
  assert.equal(kpis.rendimento.rendimentoEsperadoCorte, null);
  assert.equal(kpis.rendimento.pecasPorFolha, null);
  // Financeiro
  assert.equal(kpis.financeiro.custoTecido, null);
  assert.equal(kpis.financeiro.custoTotal, null);
  assert.equal(kpis.financeiro.custoPorPeca, null);
});

// ──────────────────────────────────────────────────────────────
// Compra preenchida
// ──────────────────────────────────────────────────────────────

test("Compra preenchida: kg contratado/recebido/diff/rolos/custoTecido corretos", () => {
  const kpis = derivarKpisOp([st("OPBUY", "concluida", COMPRA_OK)]);
  assert.equal(kpis.quantidades.kgContratado, 30); // 10 + 20
  // 3.2+3.1+3.5=9.8 + 5*4=20 = 29.8
  assert.ok(Math.abs(kpis.quantidades.kgRecebido! - 29.8) < 1e-9);
  assert.ok(Math.abs(kpis.quantidades.diffKg! - -0.2) < 1e-9);
  // diff%: -0.2/30 ≈ -0.00667
  assert.ok(Math.abs(kpis.quantidades.diffPercentual! - -0.2 / 30) < 1e-9);
  assert.equal(kpis.quantidades.rolosTotal, 7); // 3 + 4 (contratados)
  // custoTecido: 9.8*20 (az) + 20*20 (pt) = 196 + 400 = 596
  assert.ok(Math.abs(kpis.financeiro.custoTecido! - 596) < 1e-9);
});

test("Compra contratada sem pesos: kgContratado/rolos preenchidos; recebido/diff/custo = null", () => {
  // Operador definiu fornecedor + cores + qtdRolos mas ainda não pesou nada.
  const payloadSemPesos: SubtaskCompraPayload = {
    fornecedores: [
      {
        fornecedorId: "f1",
        cores: [
          {
            corId: "cor-az",
            kgsContratados: 10,
            qtdRolosContratados: 3,
            precoPorKg: 20,
            pesosRolos: [], // sem pesos ainda
          },
          {
            corId: "cor-pt",
            kgsContratados: 20,
            qtdRolosContratados: 4,
            precoPorKg: 20,
            pesosRolos: [],
          },
        ],
      },
    ],
  };
  const kpis = derivarKpisOp([
    st("OPBUY", "em_andamento", payloadSemPesos),
  ]);
  assert.equal(kpis.quantidades.kgContratado, 30);
  assert.equal(kpis.quantidades.rolosTotal, 7); // contratados
  assert.equal(kpis.quantidades.kgRecebido, null); // nenhum peso informado
  assert.equal(kpis.quantidades.diffKg, null);
  assert.equal(kpis.financeiro.custoTecido, null);
});

test("Compra com 2 fornecedores: kgs e custo agregam cross-fornecedor", () => {
  const payload: SubtaskCompraPayload = {
    fornecedores: [
      {
        fornecedorId: "f1",
        cores: [
          {
            corId: "cor-az",
            kgsContratados: 100,
            qtdRolosContratados: 3,
            precoPorKg: 25,
            pesosRolos: [33, 34, 33], // 100 kg
          },
        ],
      },
      {
        fornecedorId: "f2",
        cores: [
          {
            corId: "cor-az",
            kgsContratados: 50,
            qtdRolosContratados: 2,
            precoPorKg: 22,
            pesosRolos: [25, 25], // 50 kg
          },
        ],
      },
    ],
  };
  const kpis = derivarKpisOp([st("OPBUY", "em_andamento", payload)]);
  assert.equal(kpis.quantidades.kgContratado, 150); // 100 + 50
  assert.equal(kpis.quantidades.kgRecebido, 150); // 100 + 50
  assert.equal(kpis.quantidades.rolosTotal, 5); // 3 + 2
  // Custo: 100*25 + 50*22 = 2500 + 1100 = 3600
  assert.equal(kpis.financeiro.custoTecido, 3600);
});

// ──────────────────────────────────────────────────────────────
// Risco preenchido
// ──────────────────────────────────────────────────────────────

test("Risco preenchido: aproveitamento, pecas/folha, consumo/peça calculados", () => {
  const kpis = derivarKpisOp([st("OPRIS", "concluida", RISCO_OK)]);
  assert.equal(kpis.rendimento.aproveitamentoRiscoPercentual, 88);
  assert.equal(kpis.rendimento.pecasPorFolha, 12); // 4+5+3
  // consumo: (150/100) * 2 * (88/100) / 12 = 1.5 * 2 * 0.88 / 12 = 0.22
  assert.ok(Math.abs(kpis.rendimento.consumoPorPecaM2! - 0.22) < 1e-9);
  // Sem corte preenchido, rendimentoEsperado fica null
  assert.equal(kpis.rendimento.rendimentoEsperadoCorte, null);
  assert.equal(kpis.financeiro.custoRisco, 100);
});

// ──────────────────────────────────────────────────────────────
// Corte 1 oficina
// ──────────────────────────────────────────────────────────────

test("Corte 1 oficina: folhasTotal, pecasCortadas, custoCorte, rendimentoEsperado vs risco", () => {
  const kpis = derivarKpisOp([
    st("OPRIS", "concluida", RISCO_OK),
    st("OPCOR", "concluida", CORTE_OK),
  ]);
  assert.equal(kpis.quantidades.folhasTotal, 32);
  assert.equal(kpis.quantidades.pecasCortadas, 384);
  // Custo: 1.5 × 384 = 576
  assert.equal(kpis.financeiro.custoCorte, 576);
  // Rendimento esperado: 32 × 12 (pecas/folha do risco) = 384 (bate certinho)
  assert.equal(kpis.rendimento.rendimentoEsperadoCorte, 384);
  assert.equal(kpis.rendimento.rendimentoInformadoCorte, 384);
});

// ──────────────────────────────────────────────────────────────
// Corte N oficinas — soma sem duplicar
// ──────────────────────────────────────────────────────────────

test("Corte 2 oficinas: folhas/peças/custo somam, sem duplicação", () => {
  const corte2: SubtaskCortePayload = {
    oficinas: [
      {
        oficinaId: "of-1",
        modoSeparacao: "por_cor",
        rolosEnviadosPorCor: { "cor-az": 3 },
        folhasEnfesto: 10,
        rendimentoTotal: 120,
        rendimentoPorTamanhoCor: [
          { tamanho: "M", corId: "cor-az", quantidade: 120 },
        ],
        precoPorPeca: 1,
      },
      {
        oficinaId: "of-2",
        modoSeparacao: "por_cor",
        rolosEnviadosPorCor: { "cor-pt": 4 },
        folhasEnfesto: 22,
        rendimentoTotal: 264,
        rendimentoPorTamanhoCor: [
          { tamanho: "M", corId: "cor-pt", quantidade: 264 },
        ],
        precoPorPeca: 2,
      },
    ],
  };
  const kpis = derivarKpisOp([st("OPCOR", "concluida", corte2)]);
  assert.equal(kpis.quantidades.folhasTotal, 32); // 10 + 22
  assert.equal(kpis.quantidades.pecasCortadas, 384); // 120 + 264
  // Custo: 1×120 + 2×264 = 120 + 528 = 648
  assert.equal(kpis.financeiro.custoCorte, 648);
});

test("Corte só com config (sem folhas/rendimento): retorna null em folhas/peças/custo", () => {
  const corteSemPos: SubtaskCortePayload = {
    oficinas: [
      {
        oficinaId: "of-1",
        modoSeparacao: "por_cor",
        rolosEnviadosPorCor: { "cor-az": 3 },
      },
    ],
  };
  const kpis = derivarKpisOp([st("OPCOR", "em_andamento", corteSemPos)]);
  assert.equal(kpis.quantidades.folhasTotal, null);
  assert.equal(kpis.quantidades.pecasCortadas, null);
  assert.equal(kpis.financeiro.custoCorte, null);
});

// ──────────────────────────────────────────────────────────────
// Costura N oficinas
// ──────────────────────────────────────────────────────────────

test("Costura 2 oficinas: pecasEnviadasCostura é soma das matrizes; custoCostura agrega", () => {
  const costura2: SubtaskCosturaPayload = {
    oficinas: [
      {
        oficinaId: "of-1",
        pecasEnviadasPorTamanhoCor: [
          { tamanho: "M", corId: "cor-az", quantidade: 50 },
          { tamanho: "G", corId: "cor-az", quantidade: 70 },
        ],
        precoPorPeca: 3,
        statusInterno: "enviado",
      },
      {
        oficinaId: "of-2",
        pecasEnviadasPorTamanhoCor: [
          { tamanho: "M", corId: "cor-pt", quantidade: 80 },
        ],
        precoPorPeca: 5,
        statusInterno: "enviado",
      },
    ],
  };
  const kpis = derivarKpisOp([st("OPSEW", "em_andamento", costura2)]);
  assert.equal(kpis.quantidades.pecasEnviadasCostura, 200); // 50+70+80
  // Custo: of-1 = 3 × (50+70) = 360 ; of-2 = 5 × 80 = 400 ; total 760
  assert.equal(kpis.financeiro.custoCostura, 760);
});

// ──────────────────────────────────────────────────────────────
// Viés: ausente vs presente
// ──────────────────────────────────────────────────────────────

test("OP sem viés: status.vies = 'ausente', custoVies = null", () => {
  const kpis = derivarKpisOp([
    st("OPBUY", "concluida", COMPRA_OK),
    st("OPRIS", "concluida", RISCO_OK),
    st("OPCOR", "concluida", CORTE_OK),
    st("OPSEW", "em_andamento", COSTURA_OK),
    st("OPCONF", "pendente", {}),
  ]);
  assert.equal(kpis.status.vies, "ausente");
  assert.equal(kpis.financeiro.custoVies, null);
});

test("OP com viés preenchido: status copiado; custoVies = metragem × preço", () => {
  const kpis = derivarKpisOp([
    st("OPVIE", "concluida", VIES_OK),
  ]);
  assert.equal(kpis.status.vies, "concluida");
  // 100 × 2 = 200
  assert.equal(kpis.financeiro.custoVies, 200);
});

// ──────────────────────────────────────────────────────────────
// Custo total e custo por peça
// ──────────────────────────────────────────────────────────────

test("Custo total e custo/peça agregam parciais; null tratado como 0 mas só se algum não-null", () => {
  const kpis = derivarKpisOp([
    st("OPBUY", "concluida", COMPRA_OK),
    st("OPRIS", "concluida", RISCO_OK),
    st("OPCOR", "concluida", CORTE_OK),
    st("OPSEW", "em_andamento", COSTURA_OK),
  ]);
  // Tecido 596 + Risco 100 + Corte 576 + Costura 4×(50+70+80+100+84)=4×384=1536 = 2808
  assert.ok(Math.abs(kpis.financeiro.custoTotal! - 2808) < 1e-6);
  // /peça: 2808 / 384 = 7.3125
  assert.ok(Math.abs(kpis.financeiro.custoPorPeca! - 2808 / 384) < 1e-9);
});

test("Custo/peça é null quando pecasCortadas é null ou 0", () => {
  const kpis = derivarKpisOp([st("OPBUY", "concluida", COMPRA_OK)]);
  // Tecido só, sem corte
  assert.ok(kpis.financeiro.custoTecido! > 0);
  assert.equal(kpis.financeiro.custoPorPeca, null);
});

test("Custo total é null quando NADA está preenchido", () => {
  const kpis = derivarKpisOp([
    st("OPBUY", "em_andamento", {}),
    st("OPRIS", "pendente", {}),
  ]);
  assert.equal(kpis.financeiro.custoTotal, null);
});

// ──────────────────────────────────────────────────────────────
// Determinismo
// ──────────────────────────────────────────────────────────────

test("Determinismo: mesma entrada produz mesma saída", () => {
  const entrada: SubtaskComPayload[] = [
    st("OPBUY", "concluida", COMPRA_OK),
    st("OPRIS", "concluida", RISCO_OK),
    st("OPCOR", "concluida", CORTE_OK),
  ];
  const a = derivarKpisOp(entrada);
  const b = derivarKpisOp(entrada);
  assert.deepEqual(a, b);
});
