import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import {
  _resetGeocodingRateLimit,
  geocodificarEndereco,
} from "./geocoding";

// Mock global fetch — testa lógica do helper sem chamar Nominatim real
type FetchFn = typeof globalThis.fetch;
let originalFetch: FetchFn;
let mockResponses: Array<{
  status?: number;
  body?: unknown;
  throwError?: boolean;
}> = [];
let chamadasFetch: Array<{ url: string; userAgent: string | null }> = [];

before(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const ua = (init?.headers as Record<string, string>)?.["User-Agent"] ?? null;
    chamadasFetch.push({ url, userAgent: ua });
    const next = mockResponses.shift() ?? { status: 404, body: [] };
    if (next.throwError) throw new Error("network down");
    return new Response(JSON.stringify(next.body ?? []), {
      status: next.status ?? 200,
    });
  }) as FetchFn;
});

after(() => {
  globalThis.fetch = originalFetch;
});

function resetMock() {
  mockResponses = [];
  chamadasFetch = [];
  _resetGeocodingRateLimit();
}

const ENDERECO = {
  rua: "Av. Paulista",
  numero: "1578",
  bairro: "Bela Vista",
  cidade: "São Paulo",
  estado: "SP",
  cep: "01310-100",
};

test("geocodificarEndereco: retorna lat/lng quando Nominatim responde OK", async () => {
  resetMock();
  mockResponses = [
    {
      status: 200,
      body: [
        {
          lat: "-23.5614",
          lon: "-46.6559",
          addresstype: "house",
        },
      ],
    },
  ];

  const out = await geocodificarEndereco(ENDERECO);
  assert.ok(out, "esperava resultado não-nulo");
  assert.equal(out!.latitude, "-23.5614");
  assert.equal(out!.longitude, "-46.6559");
  assert.equal(out!.precisao, "exato");
  assert.equal(out!.fonte, "nominatim");

  // User-Agent obrigatório
  assert.match(chamadasFetch[0].userAgent ?? "", /NWC-ERP-Confeccao/);
});

test("geocodificarEndereco: retorna null se Nominatim devolve array vazio", async () => {
  resetMock();
  mockResponses = [{ status: 200, body: [] }];

  const out = await geocodificarEndereco({
    ...ENDERECO,
    rua: "Rua Inexistente Q1W2E3",
  });
  assert.equal(out, null);
});

test("geocodificarEndereco: retorna null em erro de rede (não propaga)", async () => {
  resetMock();
  mockResponses = [{ throwError: true }];

  const out = await geocodificarEndereco(ENDERECO);
  assert.equal(out, null);
});

test("geocodificarEndereco: rate limit serializa 2 chamadas com ≥1s entre elas", async () => {
  resetMock();
  mockResponses = [
    { status: 200, body: [{ lat: "1", lon: "2", addresstype: "road" }] },
    { status: 200, body: [{ lat: "3", lon: "4", addresstype: "road" }] },
  ];

  const inicio = Date.now();
  await geocodificarEndereco(ENDERECO);
  await geocodificarEndereco(ENDERECO);
  const decorrido = Date.now() - inicio;

  // Margem de 50ms pra setTimeout do Node
  assert.ok(
    decorrido >= 950,
    `Esperava ≥950ms entre chamadas, decorrido=${decorrido}ms`,
  );
});

test("geocodificarEndereco: classifica precisão", async () => {
  resetMock();
  mockResponses = [
    { status: 200, body: [{ lat: "1", lon: "2", addresstype: "road" }] },
  ];
  const out = await geocodificarEndereco(ENDERECO);
  assert.equal(out!.precisao, "aproximado");

  resetMock();
  mockResponses = [
    { status: 200, body: [{ lat: "1", lon: "2", addresstype: "city" }] },
  ];
  const out2 = await geocodificarEndereco(ENDERECO);
  assert.equal(out2!.precisao, "cidade");
});
