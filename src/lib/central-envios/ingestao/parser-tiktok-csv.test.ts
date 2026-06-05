// Testes do parser TikTok CSV.
//
// Cobertura: shape do resultado, filtro Order Status, BOM, trailing \t,
// colunas ausentes, timezone (PM/AM), validação de quantidade e data,
// idempotência, limite de tamanho.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parsearTikTokCsv,
  ParserError,
  MAX_INPUT_BYTES,
  DEFAULT_FILTRO_ORDER_STATUS,
} from "./parser-tiktok-csv";

const FIXTURES_DIR = join(__dirname, "__fixtures__");

function lerFixture(nome: string): Buffer {
  return readFileSync(join(FIXTURES_DIR, nome));
}

test("CSV básico — 2 linhas A ser enviado → 2 pedidos válidos", () => {
  const r = parsearTikTokCsv(lerFixture("tiktok-basico.csv"));
  assert.equal(r.totalLinhas, 2);
  assert.equal(r.linhasValidas, 2);
  assert.equal(r.linhasDescartadas, 0);
  assert.equal(r.pedidos.length, 2);

  const p0 = r.pedidos[0];
  assert.equal(p0.canal, "tiktok_shop");
  assert.equal(p0.orderId, "577123456789012345");
  assert.equal(p0.trackingId, "TTK0001ABC123");
  assert.equal(p0.sellerSku, "SKU-A");
  assert.equal(p0.quantidade, 1);
  assert.equal(p0.buyerUsername, "buyer1");
  assert.equal(p0.orderStatus, "A ser enviado");
  assert.equal(p0.orderSubstatus, null);
});

test("CSV com mix de status — só 1 válido (filtro default A ser enviado)", () => {
  const r = parsearTikTokCsv(lerFixture("tiktok-mix-status.csv"));
  assert.equal(r.totalLinhas, 3);
  assert.equal(r.linhasValidas, 1);
  assert.equal(r.linhasDescartadas, 2);
  assert.equal(r.descartesResumo.status_diferente_filtro, 2);
  assert.equal(r.pedidos[0].orderStatus, "A ser enviado");
});

test("CSV com \\t no fim de cada campo — parser strip-a", () => {
  const r = parsearTikTokCsv(lerFixture("tiktok-trailing-tab.csv"));
  assert.equal(r.linhasValidas, 1);
  assert.equal(r.pedidos[0].orderId, "577200000000000001");
  assert.equal(r.pedidos[0].sellerSku, "SKU-A");
});

test("CSV com BOM no início — header reconhecido", () => {
  const conteudo = "﻿" + lerFixture("tiktok-basico.csv").toString("utf8");
  const r = parsearTikTokCsv(conteudo);
  assert.equal(r.linhasValidas, 2);
});

test("Coluna Tracking ID vazia → trackingId === null", () => {
  const csv = [
    "Order ID,Tracking ID,Seller SKU,Quantity,Buyer Username,Created Time,Order Status,Order Substatus",
    "577300000000000001,,SKU-A,1,buyer,06/05/2026 02:42:00 PM,A ser enviado,",
  ].join("\n");
  const r = parsearTikTokCsv(csv);
  assert.equal(r.linhasValidas, 1);
  assert.equal(r.pedidos[0].trackingId, null);
});

test("Coluna obrigatória ausente (Order ID removida) → ParserError colunas_ausentes", () => {
  assert.throws(
    () => parsearTikTokCsv(lerFixture("tiktok-coluna-ausente.csv")),
    (err: unknown) => {
      assert.ok(err instanceof ParserError);
      assert.equal((err as ParserError).codigo, "colunas_ausentes");
      assert.match((err as ParserError).message, /Order ID/);
      return true;
    },
  );
});

test("Created Time 02:42:00 PM em SP (UTC-3) → 17:42:00 UTC", () => {
  // 14:42 local + 3h = 17:42 UTC
  const r = parsearTikTokCsv(lerFixture("tiktok-basico.csv"));
  assert.equal(r.pedidos[0].criadoEm, "2026-06-05T17:42:00.000Z");
});

test("Created Time 12:00:00 AM (meia-noite) em SP → 03:00:00 UTC mesmo dia", () => {
  // 12 AM = 00:00 local; 00:00 + 3h = 03:00 UTC do MESMO dia (não vira dia anterior)
  const csv = [
    "Order ID,Tracking ID,Seller SKU,Quantity,Buyer Username,Created Time,Order Status",
    "1,T1,SKU,1,b,06/05/2026 12:00:00 AM,A ser enviado",
  ].join("\n");
  const r = parsearTikTokCsv(csv);
  assert.equal(r.linhasValidas, 1);
  assert.equal(r.pedidos[0].criadoEm, "2026-06-05T03:00:00.000Z");
});

test("Created Time 12:00:00 PM (meio-dia) em SP → 15:00:00 UTC", () => {
  // 12 PM = 12:00 local; 12:00 + 3h = 15:00 UTC
  const csv = [
    "Order ID,Tracking ID,Seller SKU,Quantity,Buyer Username,Created Time,Order Status",
    "1,T1,SKU,1,b,06/05/2026 12:00:00 PM,A ser enviado",
  ].join("\n");
  const r = parsearTikTokCsv(csv);
  assert.equal(r.pedidos[0].criadoEm, "2026-06-05T15:00:00.000Z");
});

test("Created Time malformado → descarte data_invalida", () => {
  const csv = [
    "Order ID,Tracking ID,Seller SKU,Quantity,Buyer Username,Created Time,Order Status",
    "1,T1,SKU,1,b,2026-06-05 14:42:00,A ser enviado",
  ].join("\n");
  const r = parsearTikTokCsv(csv);
  assert.equal(r.linhasValidas, 0);
  assert.equal(r.descartesResumo.data_invalida, 1);
});

test("Quantity 0 / negativa / NaN → descarte quantidade_invalida", () => {
  const csv = [
    "Order ID,Tracking ID,Seller SKU,Quantity,Buyer Username,Created Time,Order Status",
    "1,T1,SKU,0,b,06/05/2026 02:42:00 PM,A ser enviado",
    "2,T2,SKU,-1,b,06/05/2026 02:42:00 PM,A ser enviado",
    "3,T3,SKU,abc,b,06/05/2026 02:42:00 PM,A ser enviado",
  ].join("\n");
  const r = parsearTikTokCsv(csv);
  assert.equal(r.linhasValidas, 0);
  assert.equal(r.descartesResumo.quantidade_invalida, 3);
});

test("1000 linhas — parse rápido e contagem correta", () => {
  const header =
    "Order ID,Tracking ID,Seller SKU,Quantity,Buyer Username,Created Time,Order Status";
  const linhas = [header];
  for (let i = 0; i < 1000; i++) {
    linhas.push(
      `5773000000000${String(i).padStart(5, "0")},TTK${String(i).padStart(8, "0")},SKU-${i % 10},1,buyer${i},06/05/2026 02:42:00 PM,A ser enviado`,
    );
  }
  const inicio = Date.now();
  const r = parsearTikTokCsv(linhas.join("\n"));
  const duracao = Date.now() - inicio;
  assert.equal(r.linhasValidas, 1000);
  assert.equal(r.linhasDescartadas, 0);
  assert.ok(duracao < 1000, `parse de 1000 linhas levou ${duracao}ms (esperado < 1000)`);
});

test("Filtro custom: filtrarOrderStatus='Em separação'", () => {
  const r = parsearTikTokCsv(lerFixture("tiktok-mix-status.csv"), {
    filtrarOrderStatus: "Em separação",
  });
  assert.equal(r.linhasValidas, 1);
  assert.equal(r.pedidos[0].orderStatus, "Em separação");
  assert.equal(r.descartesResumo.status_diferente_filtro, 2);
});

test("Idempotência: 2 chamadas com mesmo Buffer → deepStrictEqual", () => {
  const buf = lerFixture("tiktok-basico.csv");
  const r1 = parsearTikTokCsv(buf);
  const r2 = parsearTikTokCsv(buf);
  assert.deepStrictEqual(r1, r2);
});

test("Input > MAX_INPUT_BYTES → ParserError arquivo_muito_grande", () => {
  // Constrói um Buffer dummy do tamanho exato MAX+1 sem alocar conteúdo
  // pesado (Buffer.alloc é zero-init e rápido).
  const buf = Buffer.alloc(MAX_INPUT_BYTES + 1, 0x61); // 0x61 = 'a'
  assert.throws(
    () => parsearTikTokCsv(buf),
    (err: unknown) => {
      assert.ok(err instanceof ParserError);
      assert.equal((err as ParserError).codigo, "arquivo_muito_grande");
      return true;
    },
  );
});

test("DEFAULT_FILTRO_ORDER_STATUS exposto pra reuso", () => {
  // Cliente do parser pode querer mostrar o status padrão na UI.
  assert.equal(DEFAULT_FILTRO_ORDER_STATUS, "A ser enviado");
});
