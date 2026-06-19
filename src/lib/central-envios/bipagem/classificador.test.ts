// Testes do classificador puro (RITM-16). Sem banco, sem fixture
// de schema — só dados sintéticos em memória.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { CarrierPattern } from "@/types/coletas";
import type { PedidoEnriquecido } from "@/lib/central-envios/sessao/types";
import {
  classificarBipe,
  classificarBipeRastreador,
} from "./classificador";
import type { ContextoClassificacao } from "./types";

// ──────────────────────────────────────────────────────────────
// fixtures
// ──────────────────────────────────────────────────────────────

function pedidoFake(
  trackingId: string | null,
  orderId: string,
): PedidoEnriquecido {
  return {
    origemRunId: "run-1",
    canal: "tiktok_shop",
    orderId,
    trackingId,
    skuRaw: "MOD1 COR1 TAM1",
    quantidadeRaw: 1,
    criadoEmIso: "2026-06-03T13:00:00.000Z",
    comprador: "fulano",
    camposExtras: { orderStatus: "A ser enviado", orderSubstatus: null },
    parsed: {
      kind: "OK",
      modeloCodigo: "MOD1",
      tamanho: "TAM1",
      qtdKit: 1,
      canonical: "MOD1 COR1 TAM1",
      cores: [{ cor: "COR1", qtd: 1 }],
      skuKind: "AVULSO",
    },
    linhasExplodidas: [
      { modeloCodigo: "MOD1", cor: "COR1", tamanho: "TAM1", qtd: 1 },
    ],
    explosaoErro: null,
    prazo: {
      status: "CALCULADO",
      prazoIso: "2026-06-05",
      origem: "dias_uteis_pos_venda",
      detalhes: "",
    },
  };
}

const CARRIER_PATTERNS: CarrierPattern[] = [
  { id: "p1", transportadora: "TTK_JDLOG", prefixos: ["999881"] },
  { id: "p2", transportadora: "TTK_IMILE", prefixos: ["888"] },
];

// IDs sintéticos válidos pra cada regex:
//   ML:     4\d{10}            → "4" + 10 dígitos = 11 chars
//   Shopee: BR\d{12,13}[A-Z]?  → "BR" + 12-13 dígitos
//   TikTok: \d{13,14}          → 13-14 dígitos
const TK_JDLOG = "9998812222220";        // 13 dígitos, prefixo "999881" → TTK_JDLOG
const TK_OUTRO = "1234567890123";        // 13 dígitos, sem prefixo → DESCONHECIDA (carrier)
const ML_ID = "40000000000";             // 11 dígitos com "4" → ML
const SHP_ID = "BR123456789012";         // BR + 12 dígitos → SHP

function ctxFake(args: {
  pedidos: PedidoEnriquecido[];
  cancelados?: string[];
  jaBipados?: string[];
}): ContextoClassificacao {
  const indexPorTracking = new Map<string, PedidoEnriquecido>();
  for (const p of args.pedidos) {
    if (p.trackingId) indexPorTracking.set(p.trackingId, p);
  }
  return {
    indexPorTracking,
    trackingsCancelados: new Set(args.cancelados ?? []),
    jaBipadosNaSessao: new Set(args.jaBipados ?? []),
    patternsCarrier: CARRIER_PATTERNS,
  };
}

// ──────────────────────────────────────────────────────────────
// Modo normal
// ──────────────────────────────────────────────────────────────

test("DESCONHECIDA quando texto não tem ID extraível", () => {
  const ctx = ctxFake({ pedidos: [] });
  const r = classificarBipe("xpto qualquer coisa", ctx);
  assert.equal(r.length, 1);
  assert.equal(r[0].categoria, "DESCONHECIDA");
  assert.equal(r[0].trackingId, null);
  assert.equal(r[0].bloqueante, false);
  assert.equal(r[0].transportadora, "DESCONHECIDA");
});

test("OK quando tracking no índice, não cancelado, não bipado", () => {
  const p = pedidoFake(TK_JDLOG, "ORD-1");
  const ctx = ctxFake({ pedidos: [p] });
  const r = classificarBipe(TK_JDLOG, ctx);
  assert.equal(r.length, 1);
  assert.equal(r[0].categoria, "OK");
  assert.equal(r[0].trackingId, TK_JDLOG);
  assert.equal(r[0].orderId, "ORD-1");
  assert.equal(r[0].pedido?.orderId, "ORD-1");
  assert.equal(r[0].transportadora, "TTK_JDLOG");
  assert.equal(r[0].bloqueante, false);
});

test("DUPLICADO ganha precedência sobre CANCELADO", () => {
  const p = pedidoFake(TK_JDLOG, "ORD-1");
  const ctx = ctxFake({
    pedidos: [p],
    cancelados: [TK_JDLOG],
    jaBipados: [TK_JDLOG],
  });
  const r = classificarBipe(TK_JDLOG, ctx);
  assert.equal(r[0].categoria, "DUPLICADO");
  assert.equal(r[0].bloqueante, false);
});

test("CANCELADO bloqueante quando tracking está em cancelados e não bipado", () => {
  const p = pedidoFake(TK_JDLOG, "ORD-1");
  const ctx = ctxFake({ pedidos: [p], cancelados: [TK_JDLOG] });
  const r = classificarBipe(TK_JDLOG, ctx);
  assert.equal(r[0].categoria, "CANCELADO");
  assert.equal(r[0].bloqueante, true);
  assert.equal(r[0].pedido?.orderId, "ORD-1");
});

test("FORA_LOTE quando tracking não está no índice", () => {
  const ctx = ctxFake({ pedidos: [] }); // índice vazio
  const r = classificarBipe(TK_JDLOG, ctx);
  assert.equal(r[0].categoria, "FORA_LOTE");
  assert.equal(r[0].pedido, null);
  assert.equal(r[0].orderId, null);
  assert.equal(r[0].bloqueante, false);
});

test("DUPLICADO ganha precedência sobre FORA_LOTE", () => {
  // Cenário: bipei no início da sessão, depois re-uploadei e o pedido
  // sumiu do CSV (provavelmente foi expedido). O snapshot considera
  // DUPLICADO porque o operador já lidou com ele.
  const ctx = ctxFake({ pedidos: [], jaBipados: [TK_JDLOG] });
  const r = classificarBipe(TK_JDLOG, ctx);
  assert.equal(r[0].categoria, "DUPLICADO");
  assert.equal(r[0].pedido, null);
  assert.equal(r[0].orderId, null);
});

test("Múltiplos IDs no mesmo texto: classifica individualmente", () => {
  const pTk = pedidoFake(TK_JDLOG, "ORD-TK");
  const ctx = ctxFake({ pedidos: [pTk] });
  // Texto contém um TT (no índice) + um ML (não está)
  const r = classificarBipe(`${TK_JDLOG} ${ML_ID}`, ctx);
  assert.equal(r.length, 2);

  const tkResult = r.find((x) => x.trackingId === TK_JDLOG);
  const mlResult = r.find((x) => x.trackingId === ML_ID);
  assert.ok(tkResult);
  assert.ok(mlResult);
  assert.equal(tkResult.categoria, "OK");
  assert.equal(tkResult.transportadora, "TTK_JDLOG");
  assert.equal(mlResult.categoria, "FORA_LOTE");
  assert.equal(mlResult.transportadora, "ML");
});

test("Detecção carrier ML", () => {
  const ctx = ctxFake({ pedidos: [] });
  const r = classificarBipe(ML_ID, ctx);
  assert.equal(r[0].transportadora, "ML");
});

test("Detecção carrier Shopee", () => {
  const ctx = ctxFake({ pedidos: [] });
  const r = classificarBipe(SHP_ID, ctx);
  assert.equal(r[0].transportadora, "SHP");
});

test("Detecção carrier TikTok sem prefixo → DESCONHECIDA mas categoria OK", () => {
  // Tracking de 13 dígitos sem prefixo configurado: regra de extração
  // valida (entra na lista de IDs), e se está no índice é OK; carrier
  // fica DESCONHECIDA (campos independentes).
  const p = pedidoFake(TK_OUTRO, "ORD-X");
  const ctx = ctxFake({ pedidos: [p] });
  const r = classificarBipe(TK_OUTRO, ctx);
  assert.equal(r[0].categoria, "OK");
  assert.equal(r[0].transportadora, "DESCONHECIDA");
});

// ──────────────────────────────────────────────────────────────
// Modo rastreador
// ──────────────────────────────────────────────────────────────

test("LOCALIZADOR_ACHADO quando tracking está em pendentesLocalizar", () => {
  const p = pedidoFake(TK_JDLOG, "ORD-1");
  const ctx = ctxFake({ pedidos: [p], cancelados: [TK_JDLOG] });
  const r = classificarBipeRastreador(TK_JDLOG, ctx, new Set([TK_JDLOG]));
  assert.equal(r[0].categoria, "LOCALIZADOR_ACHADO");
  assert.equal(r[0].pedido?.orderId, "ORD-1");
  assert.equal(r[0].transportadora, "TTK_JDLOG");
});

test("LOCALIZADOR_LIVRE quando tracking NÃO está em pendentesLocalizar", () => {
  const p = pedidoFake(TK_JDLOG, "ORD-1");
  const ctx = ctxFake({ pedidos: [p] });
  const r = classificarBipeRastreador(TK_JDLOG, ctx, new Set());
  assert.equal(r[0].categoria, "LOCALIZADOR_LIVRE");
  assert.equal(r[0].pedido?.orderId, "ORD-1"); // pedido é preenchido
});

test("LOCALIZADOR_LIVRE quando texto sem ID em modo rastreador", () => {
  const ctx = ctxFake({ pedidos: [] });
  const r = classificarBipeRastreador("xpto sem id", ctx, new Set());
  assert.equal(r.length, 1);
  assert.equal(r[0].categoria, "LOCALIZADOR_LIVRE");
  assert.equal(r[0].trackingId, null);
});

// ──────────────────────────────────────────────────────────────
// Determinismo
// ──────────────────────────────────────────────────────────────

test("Determinismo: mesma entrada produz mesma saída", () => {
  const p = pedidoFake(TK_JDLOG, "ORD-1");
  const ctx = ctxFake({ pedidos: [p], cancelados: [TK_JDLOG] });
  const r1 = classificarBipe(TK_JDLOG, ctx);
  const r2 = classificarBipe(TK_JDLOG, ctx);
  assert.deepEqual(r1, r2);
});
