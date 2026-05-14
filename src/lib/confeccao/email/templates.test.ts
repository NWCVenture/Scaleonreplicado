import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAtribuidoMudouAnteriorEmail,
  buildAtribuidoMudouNovoEmail,
  buildOpCanceladaEmail,
  buildOpConcluidaEmail,
  buildOpCriadaEmail,
  buildRetiradaParcialEmail,
  buildSubtaskConcluidaAnteriorEmail,
  buildSubtaskConcluidaProximoEmail,
} from "./templates";

test("buildOpCriadaEmail: subject inclui número e produto", () => {
  const r = buildOpCriadaEmail({
    destinatarioNome: "Ana",
    opNumero: "OP05260001",
    produtoNome: "Camiseta básica",
    temVies: false,
    criadorNome: "Carlos",
    opUrl: "http://localhost:3000/confeccao/ops/OP05260001",
  });
  assert.match(r.subject, /OP05260001/);
  assert.match(r.subject, /Camiseta básica/);
  assert.match(r.html, /Ana/);
  assert.match(r.html, /Carlos/);
  assert.match(r.html, /OPBUY → OPRIS → OPCOR → OPSEW → OPCONF/);
  assert.match(r.text, /OP05260001/);
  assert.match(r.text, /OPBUY → OPRIS → OPCOR → OPSEW → OPCONF/);
});

test("buildOpCriadaEmail: temVies muda a frase do fluxo", () => {
  const r = buildOpCriadaEmail({
    destinatarioNome: "Ana",
    opNumero: "OP05260001",
    produtoNome: "Vestido",
    temVies: true,
    criadorNome: "Carlos",
    opUrl: "http://x",
  });
  assert.match(r.html, /OPVIE/);
  assert.match(r.text, /OPVIE/);
});

test("buildOpCriadaEmail: escapa HTML do nome do produto", () => {
  const r = buildOpCriadaEmail({
    destinatarioNome: "Ana",
    opNumero: "OP05260001",
    produtoNome: "<script>alert(1)</script>",
    temVies: false,
    criadorNome: "Carlos",
    opUrl: "http://x",
  });
  assert.ok(!r.html.includes("<script>"));
  assert.match(r.html, /&lt;script&gt;/);
});

test("buildSubtaskConcluidaProximoEmail: lista anterior e próxima", () => {
  const r = buildSubtaskConcluidaProximoEmail({
    destinatarioNome: "Bia",
    opNumero: "OP05260002",
    produtoNome: "Calça",
    subtaskAnteriorNumero: "OPBUY0002",
    subtaskProximaNumero: "OPRIS0002",
    subtaskProximaPrefixo: "OPRIS",
    executorNome: "Daniel",
    opUrl: "http://x",
  });
  assert.match(r.subject, /OPRIS0002/);
  assert.match(r.subject, /OP05260002/);
  assert.match(r.html, /OPBUY0002/);
  assert.match(r.html, /OPRIS0002/);
  assert.match(r.html, /Daniel/);
});

test("buildSubtaskConcluidaAnteriorEmail: foco no fato de quem concluiu", () => {
  const r = buildSubtaskConcluidaAnteriorEmail({
    destinatarioNome: "Bia",
    opNumero: "OP05260002",
    produtoNome: "Calça",
    subtaskNumero: "OPBUY0002",
    executorNome: "Daniel",
    opUrl: "http://x",
  });
  assert.match(r.subject, /OPBUY0002/);
  assert.match(r.html, /Daniel/);
  assert.match(r.text, /OPBUY0002/);
});

test("buildOpConcluidaEmail: menciona Evidências de Pagamento", () => {
  const r = buildOpConcluidaEmail({
    destinatarioNome: "Carla",
    opNumero: "OP05260003",
    produtoNome: "Saia",
    executorNome: "Eva",
    opUrl: "http://x",
  });
  assert.match(r.subject, /OP05260003/);
  assert.match(r.html, /Evidências de Pagamento/);
  assert.match(r.text, /Evidências de Pagamento/);
});

test("buildAtribuidoMudouNovoEmail: alvoLabel aparece no subject e body", () => {
  const r = buildAtribuidoMudouNovoEmail({
    destinatarioNome: "Diego",
    alvoLabel: "subtask OPCOR0010 da OP OP05260010",
    produtoNome: "Bermuda",
    editorNome: "Felipe",
    url: "http://x",
  });
  assert.match(r.subject, /OPCOR0010/);
  assert.match(r.html, /Felipe/);
  assert.match(r.html, /subtask OPCOR0010 da OP OP05260010/);
});

test("buildAtribuidoMudouAnteriorEmail: informa novo responsável", () => {
  const r = buildAtribuidoMudouAnteriorEmail({
    destinatarioNome: "Diego",
    alvoLabel: "OP OP05260010",
    produtoNome: "Bermuda",
    novoAtribuidoNome: "Gabriela",
    editorNome: "Felipe",
    url: "http://x",
  });
  assert.match(r.html, /Gabriela/);
  assert.match(r.text, /Gabriela/);
  assert.match(r.subject, /OP05260010/);
});

test("buildRetiradaParcialEmail: mostra quantidade de peças", () => {
  const r = buildRetiradaParcialEmail({
    destinatarioNome: "Hugo",
    opNumero: "OP05260020",
    produtoNome: "Jaqueta",
    retiradaNumero: "OP05260020-RET-01",
    oficinaNome: "Oficina Vento Sul",
    subconferenciaNumero: "OP05260020-CONF-RET01",
    totalPecas: 123,
    executorNome: "Ivone",
    conferenciaUrl: "http://x",
  });
  assert.match(r.subject, /OP05260020/);
  assert.match(r.html, /123/);
  assert.match(r.html, /Oficina Vento Sul/);
  assert.match(r.html, /OP05260020-RET-01/);
  assert.match(r.text, /123/);
});

test("buildRetiradaParcialEmail: escapa nome da oficina", () => {
  const r = buildRetiradaParcialEmail({
    destinatarioNome: "Hugo",
    opNumero: "OP05260020",
    produtoNome: "Jaqueta",
    retiradaNumero: "OP05260020-RET-01",
    oficinaNome: "<b>oficina</b>",
    subconferenciaNumero: "x",
    totalPecas: 1,
    executorNome: "Ivone",
    conferenciaUrl: "http://x",
  });
  assert.ok(!r.html.includes("<b>oficina</b>"));
  assert.match(r.html, /&lt;b&gt;oficina&lt;\/b&gt;/);
});

test("buildOpCanceladaEmail: subject inclui número, mostra justificativa e quem cancelou", () => {
  const r = buildOpCanceladaEmail({
    destinatarioNome: "Joana",
    opNumero: "OP05260050",
    produtoNome: "Camisa polo",
    canceladaPorNome: "Karl",
    autorizadoPorNome: null,
    justificativa: "Cliente desistiu da produção.",
    opUrl: "http://x",
  });
  assert.match(r.subject, /OP05260050/);
  assert.match(r.html, /Karl/);
  assert.match(r.html, /Camisa polo/);
  assert.match(r.html, /Cliente desistiu da produção\./);
  assert.match(r.html, /definitiva/);
  assert.match(r.text, /Cliente desistiu/);
});

test("buildOpCanceladaEmail: inclui autorizador quando OP fechada", () => {
  const r = buildOpCanceladaEmail({
    destinatarioNome: "Joana",
    opNumero: "OP05260050",
    produtoNome: "Camisa polo",
    canceladaPorNome: "Karl",
    autorizadoPorNome: "Laura",
    justificativa: "Erro de cadastro.",
    opUrl: "http://x",
  });
  assert.match(r.html, /Laura/);
  assert.match(r.text, /Laura/);
});

test("buildOpCanceladaEmail: escapa justificativa", () => {
  const r = buildOpCanceladaEmail({
    destinatarioNome: "Joana",
    opNumero: "OP05260050",
    produtoNome: "x",
    canceladaPorNome: "Karl",
    autorizadoPorNome: null,
    justificativa: "<script>alert(1)</script>",
    opUrl: "http://x",
  });
  assert.ok(!r.html.includes("<script>alert"));
  assert.match(r.html, /&lt;script&gt;/);
});

test("todos os templates retornam HTML com botão CTA quando há URL", () => {
  const url = "https://app.scaleon.com/confeccao/ops/OP05260001";
  const cases = [
    buildOpCriadaEmail({
      destinatarioNome: "x",
      opNumero: "OP05260001",
      produtoNome: "p",
      temVies: false,
      criadorNome: "y",
      opUrl: url,
    }),
    buildSubtaskConcluidaProximoEmail({
      destinatarioNome: "x",
      opNumero: "OP05260001",
      produtoNome: "p",
      subtaskAnteriorNumero: "OPBUY0001",
      subtaskProximaNumero: "OPRIS0001",
      subtaskProximaPrefixo: "OPRIS",
      executorNome: "y",
      opUrl: url,
    }),
    buildOpConcluidaEmail({
      destinatarioNome: "x",
      opNumero: "OP05260001",
      produtoNome: "p",
      executorNome: "y",
      opUrl: url,
    }),
  ];
  for (const c of cases) {
    assert.ok(
      c.html.includes(`href="${url}"`),
      `template sem botão CTA: ${c.subject}`,
    );
  }
});
