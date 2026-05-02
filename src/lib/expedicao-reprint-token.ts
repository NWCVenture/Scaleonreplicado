import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// Token HMAC-SHA256 emitido por POST /tracking-ids/grant-reprint e consumido
// por POST /historico pra autorizar reimpressão de etiquetas dentro da janela
// de 30d. Formato: base64url(payload).base64url(hmac).
//
// O payload carrega um HASH (sha256) da lista ordenada de trackingIds em vez
// da lista inteira, evitando estourar o body do POST quando o lote tem
// centenas de etiquetas. O servidor recalcula o hash da lista de conflitos
// real antes de validar.

const TOKEN_TTL_MS = 60 * 1000;

export type ReprintTokenPayload = {
  contaId: string;
  usuarioId: string;
  trackingsHash: string;
  exp: number; // epoch ms
};

function getSecret(): Buffer {
  const b64 = process.env.OAUTH_STATE_SECRET;
  if (!b64) {
    throw new Error("OAUTH_STATE_SECRET não configurada no ambiente");
  }
  return Buffer.from(b64, "base64");
}

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64url(s: string): Buffer {
  const pad = s.length % 4;
  const normalized =
    s.replace(/-/g, "+").replace(/_/g, "/") + (pad ? "=".repeat(4 - pad) : "");
  return Buffer.from(normalized, "base64");
}

export function hashTrackingIds(trackingIds: readonly string[]): string {
  const ordered = [...trackingIds]
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .sort();
  return createHash("sha256").update(ordered.join(",")).digest("hex");
}

export function signReprintToken(input: {
  contaId: string;
  usuarioId: string;
  trackingIds: readonly string[];
}): { token: string; expiresAt: Date; payload: ReprintTokenPayload } {
  const payload: ReprintTokenPayload = {
    contaId: input.contaId,
    usuarioId: input.usuarioId,
    trackingsHash: hashTrackingIds(input.trackingIds),
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const payloadBuf = Buffer.from(JSON.stringify(payload), "utf8");
  const payloadB64 = base64url(payloadBuf);
  const sig = createHmac("sha256", getSecret()).update(payloadB64).digest();
  const token = `${payloadB64}.${base64url(sig)}`;
  return { token, expiresAt: new Date(payload.exp), payload };
}

export type VerifyResult =
  | { ok: true; payload: ReprintTokenPayload }
  | { ok: false; reason: string };

export function verifyReprintToken(
  token: string,
  expected: {
    contaId: string;
    usuarioId: string;
    trackingIds: readonly string[];
  },
): VerifyResult {
  if (typeof token !== "string" || !token.includes(".")) {
    return { ok: false, reason: "token malformado" };
  }
  const [payloadB64, sigB64] = token.split(".");
  if (!payloadB64 || !sigB64) {
    return { ok: false, reason: "token malformado" };
  }

  const expectedSig = createHmac("sha256", getSecret())
    .update(payloadB64)
    .digest();
  let actualSig: Buffer;
  try {
    actualSig = fromBase64url(sigB64);
  } catch {
    return { ok: false, reason: "assinatura inválida" };
  }
  if (
    actualSig.length !== expectedSig.length ||
    !timingSafeEqual(actualSig, expectedSig)
  ) {
    return { ok: false, reason: "assinatura inválida" };
  }

  let payload: ReprintTokenPayload;
  try {
    payload = JSON.parse(fromBase64url(payloadB64).toString("utf8"));
  } catch {
    return { ok: false, reason: "payload inválido" };
  }

  if (typeof payload.exp !== "number" || payload.exp < Date.now()) {
    return { ok: false, reason: "token expirado" };
  }
  if (payload.contaId !== expected.contaId) {
    return { ok: false, reason: "conta divergente" };
  }
  if (payload.usuarioId !== expected.usuarioId) {
    return { ok: false, reason: "usuário divergente" };
  }

  const expectedHash = hashTrackingIds(expected.trackingIds);
  const a = Buffer.from(payload.trackingsHash, "hex");
  const b = Buffer.from(expectedHash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "hash de trackings divergente" };
  }

  return { ok: true, payload };
}

export function validateReprintPassword(input: string): boolean {
  const expected = process.env.EXPEDICAO_REPRINT_PASSWORD;
  if (!expected) return false;
  const a = Buffer.from(input ?? "", "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
