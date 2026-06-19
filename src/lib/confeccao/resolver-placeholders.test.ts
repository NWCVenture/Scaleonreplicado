import { test } from "node:test";
import assert from "node:assert/strict";
import {
  listarPlaceholdersDisponiveis,
  resolverPlaceholders,
  type ContextoPlaceholders,
} from "./resolver-placeholders";

const contextoBase: ContextoPlaceholders = {
  opNumero: "OP05260001",
  produtoNome: "Camiseta básica",
};

test("resolverPlaceholders: substitui op_numero e produto", () => {
  const out = resolverPlaceholders("OP {op_numero} — {produto}", contextoBase);
  assert.equal(out, "OP OP05260001 — Camiseta básica");
});

test("resolverPlaceholders: placeholder sem dado vira string vazia (não literal)", () => {
  const out = resolverPlaceholders(
    "Peso: {kg_total} kg / Largura: {largura_rolo}",
    contextoBase,
  );
  assert.equal(out, "Peso:  kg / Largura: ");
  assert.ok(!out.includes("{kg_total}"));
});

test("resolverPlaceholders: fornecedor_nome quando passado", () => {
  const out = resolverPlaceholders(
    "Olá, {fornecedor_nome}",
    { ...contextoBase, fornecedorNome: "Tecidos Acme" },
  );
  assert.equal(out, "Olá, Tecidos Acme");
});

test("resolverPlaceholders: tipo_tecido resolve via Map de catálogo (RITM-29: top-level)", () => {
  const out = resolverPlaceholders(
    "Tipo: {tipo_tecido}",
    {
      ...contextoBase,
      compra: {
        tipoTecidoId: "tt1",
        destinatarioCorteId: "c1",
        fornecedores: [
          {
            fornecedorId: "f1",
            cores: [
              {
                corId: "cor1",
                kgsContratados: 10,
                qtdRolosContratados: 1,
                precoPorKg: 25,
                pesosRolos: [],
              },
            ],
          },
        ],
      },
      tipoTecidoNomes: new Map([["tt1", "Malha PV"]]),
    },
  );
  assert.equal(out, "Tipo: Malha PV");
});

test("resolverPlaceholders: cor lista todas cross-fornecedor sem duplicar", () => {
  const out = resolverPlaceholders(
    "Cores: {cor}",
    {
      ...contextoBase,
      compra: {
        fornecedores: [
          {
            fornecedorId: "f1",
            cores: [
              {
                corId: "cor1",
                kgsContratados: 10,
                qtdRolosContratados: 1,
                precoPorKg: 25,
                pesosRolos: [],
              },
              {
                corId: "cor2",
                kgsContratados: 5,
                qtdRolosContratados: 1,
                precoPorKg: 25,
                pesosRolos: [],
              },
            ],
          },
          {
            fornecedorId: "f2",
            cores: [
              {
                corId: "cor1", // dup vai colapsar
                kgsContratados: 3,
                qtdRolosContratados: 1,
                precoPorKg: 28,
                pesosRolos: [],
              },
            ],
          },
        ],
      },
      corNomes: new Map([
        ["cor1", "Preto"],
        ["cor2", "Branco"],
      ]),
    },
  );
  assert.equal(out, "Cores: Preto, Branco");
});

test("resolverPlaceholders: cor cai pra cor do viés se compra não tem cores", () => {
  const out = resolverPlaceholders("Cor: {cor}", {
    ...contextoBase,
    vies: { corId: "vcor1" },
    corNomes: new Map([["vcor1", "Marinho"]]),
  });
  assert.equal(out, "Cor: Marinho");
});

test("resolverPlaceholders: kg_total e qtd_rolos agregam pesos cross-fornecedor", () => {
  const out = resolverPlaceholders(
    "{qtd_rolos} rolos / {kg_total} kg",
    {
      ...contextoBase,
      compra: {
        fornecedores: [
          {
            fornecedorId: "f1",
            cores: [
              {
                corId: "c1",
                kgsContratados: 22,
                qtdRolosContratados: 2,
                precoPorKg: 1,
                pesosRolos: [10.5, 11.25],
              },
              {
                corId: "c2",
                kgsContratados: 9,
                qtdRolosContratados: 1,
                precoPorKg: 1,
                pesosRolos: [9],
              },
            ],
          },
        ],
      },
    },
  );
  assert.equal(out, "3 rolos / 30.75 kg");
});

test("resolverPlaceholders: largura_rolo inclui sufixo cm (top-level)", () => {
  const out = resolverPlaceholders("L: {largura_rolo}", {
    ...contextoBase,
    compra: {
      larguraRoloCm: 175,
      fornecedores: [
        {
          fornecedorId: "f1",
          cores: [
            {
              corId: "c1",
              kgsContratados: 10,
              qtdRolosContratados: 1,
              precoPorKg: 1,
              pesosRolos: [10],
            },
          ],
        },
      ],
    },
  });
  assert.equal(out, "L: 175cm");
});

test("resolverPlaceholders: tamanhos e proporcao do Risco", () => {
  const out = resolverPlaceholders(
    "Tam: {tamanhos} | Prop: {proporcao}",
    {
      ...contextoBase,
      risco: {
        tamanhos: [
          { tamanho: "M", proporcao: 4 },
          { tamanho: "G", proporcao: 5 },
          { tamanho: "GG", proporcao: 3 },
        ],
      },
    },
  );
  assert.equal(out, "Tam: M, G, GG | Prop: 4M+5G+3GG");
});

test("resolverPlaceholders: tamanho_bandeira do Viés inclui sufixo cm", () => {
  const out = resolverPlaceholders("Bandeira: {tamanho_bandeira}", {
    ...contextoBase,
    vies: { tamanhoBandeiraCm: 50 },
  });
  assert.equal(out, "Bandeira: 50cm");
});

test("resolverPlaceholders: prazo formata em pt-BR", () => {
  const iso = "2026-06-15T14:30:00.000Z";
  const out = resolverPlaceholders("Prazo: {prazo}", {
    ...contextoBase,
    costura: {
      oficinas: [
        {
          oficinaId: "of1",
          prazoProducao: iso,
          statusInterno: "enviado",
        },
      ],
    },
  });
  assert.match(out, /^Prazo: \d{2}\/\d{2}\/\d{4}.*$/);
});

test("resolverPlaceholders: prazo pega o primeiro prazo definido entre múltiplas oficinas", () => {
  const out = resolverPlaceholders("Prazo: {prazo}", {
    ...contextoBase,
    costura: {
      oficinas: [
        { oficinaId: "of0", statusInterno: "enviado" },
        {
          oficinaId: "of1",
          prazoProducao: "2026-08-20T10:00:00.000Z",
          statusInterno: "enviado",
        },
      ],
    },
  });
  assert.match(out, /^Prazo: \d{2}\/\d{2}\/\d{4}.*$/);
});

test("resolverPlaceholders: etiquetagem concatena linhas com ;", () => {
  const out = resolverPlaceholders("Etq: {etiquetagem}", {
    ...contextoBase,
    costura: {
      oficinas: [
        {
          oficinaId: "of1",
          statusInterno: "enviado",
          etiquetagem: [
            { tamanhoEtiqueta: "P", quantidade: 100, fonteGradeCorte: "M" },
            { tamanhoEtiqueta: "EGG", quantidade: 30, fonteGradeCorte: "GG" },
          ],
        },
      ],
    },
  });
  assert.equal(out, "Etq: 100× P (de M); 30× EGG (de GG)");
});

test("resolverPlaceholders: substitui placeholder repetido (todas as ocorrências)", () => {
  const out = resolverPlaceholders(
    "{op_numero} - {op_numero} - {op_numero}",
    contextoBase,
  );
  assert.equal(out, "OP05260001 - OP05260001 - OP05260001");
});

test("resolverPlaceholders: chave inexistente permanece literal", () => {
  const out = resolverPlaceholders(
    "{op_numero} {nao_existe}",
    contextoBase,
  );
  assert.equal(out, "OP05260001 {nao_existe}");
});

test("resolverPlaceholders: corpo sem placeholder retorna inalterado", () => {
  const out = resolverPlaceholders("Mensagem sem variáveis.", contextoBase);
  assert.equal(out, "Mensagem sem variáveis.");
});

test("listarPlaceholdersDisponiveis: retorna todos os placeholders com descrição", () => {
  const lista = listarPlaceholdersDisponiveis();
  assert.ok(lista.length >= 10);
  const chaves = new Set(lista.map((p) => p.key));
  for (const esperado of [
    "op_numero",
    "produto",
    "fornecedor_nome",
    "tipo_tecido",
    "cor",
    "kg_total",
    "qtd_rolos",
    "largura_rolo",
    "tamanhos",
    "proporcao",
    "prazo",
    "tamanho_bandeira",
    "etiquetagem",
  ]) {
    assert.ok(chaves.has(esperado), `placeholder ${esperado} ausente da lista`);
  }
  for (const item of lista) {
    assert.ok(item.descricao && item.descricao.length > 0);
  }
});
