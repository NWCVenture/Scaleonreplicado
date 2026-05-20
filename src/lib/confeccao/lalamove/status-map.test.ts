import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mapearStatusApi,
  deveSetarDataColeta,
  deveSetarDataEntrega,
  statusAtivo,
} from "./status-map";

test("ASSIGNING_DRIVER → procurando_motorista", () => {
  assert.equal(mapearStatusApi("ASSIGNING_DRIVER"), "procurando_motorista");
});

test("ON_GOING → motorista_designado", () => {
  assert.equal(mapearStatusApi("ON_GOING"), "motorista_designado");
});

test("PICKED_UP → coletado", () => {
  assert.equal(mapearStatusApi("PICKED_UP"), "coletado");
});

test("COMPLETED → entregue", () => {
  assert.equal(mapearStatusApi("COMPLETED"), "entregue");
});

test("CANCELED → cancelado", () => {
  assert.equal(mapearStatusApi("CANCELED"), "cancelado");
});

test("REJECTED → rejeitado", () => {
  assert.equal(mapearStatusApi("REJECTED"), "rejeitado");
});

test("EXPIRED → expirado", () => {
  assert.equal(mapearStatusApi("EXPIRED"), "expirado");
});

test("status desconhecido → null (não bloqueia, processor trata como noop)", () => {
  assert.equal(mapearStatusApi("FOO_BAR_NEW_STATUS"), null);
});

test("deveSetarDataColeta apenas pra 'coletado'", () => {
  assert.equal(deveSetarDataColeta("coletado"), true);
  assert.equal(deveSetarDataColeta("procurando_motorista"), false);
  assert.equal(deveSetarDataColeta("entregue"), false);
});

test("deveSetarDataEntrega apenas pra 'entregue'", () => {
  assert.equal(deveSetarDataEntrega("entregue"), true);
  assert.equal(deveSetarDataEntrega("coletado"), false);
});

test("statusAtivo cobre estados em andamento", () => {
  assert.equal(statusAtivo("procurando_motorista"), true);
  assert.equal(statusAtivo("motorista_designado"), true);
  assert.equal(statusAtivo("a_caminho_coleta"), true);
  assert.equal(statusAtivo("coletado"), true);
  assert.equal(statusAtivo("entregue"), false);
  assert.equal(statusAtivo("cancelado"), false);
  assert.equal(statusAtivo("rascunho"), false);
  assert.equal(statusAtivo("cotado"), false);
});
