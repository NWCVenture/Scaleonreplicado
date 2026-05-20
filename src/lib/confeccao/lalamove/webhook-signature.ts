// RITM-27 — verificação HMAC-SHA256 do header de assinatura do webhook
// Lalamove.
//
// A Lalamove envia X-Lalamove-Signature (formato: hex lowercase do HMAC do
// body cru usando o secret cadastrado no Partner Portal).
//
// ⚠️ Comparação SEMPRE com timingSafeEqual — nunca `===` em comparação de
// assinatura criptográfica (timing attack).

import { createHmac, timingSafeEqual } from "node:crypto";

export interface VerificarAssinaturaArgs {
  bodyRaw: string;
  assinatura: string | null | undefined;
  secret: string;
}

export function verificarAssinaturaWebhook(
  args: VerificarAssinaturaArgs,
): boolean {
  const { bodyRaw, assinatura, secret } = args;
  if (!assinatura || !secret) return false;

  // Normaliza: Lalamove pode mandar "hmac-sha256 <hex>", "sha256=<hex>",
  // ou só "<hex>". Aceitamos formato simples (hex puro). Se vier prefixado,
  // extrai a parte hex.
  const hex = extrairHexAssinatura(assinatura);
  if (!hex) return false;

  const esperado = createHmac("sha256", secret).update(bodyRaw).digest("hex");

  if (hex.length !== esperado.length) return false;
  try {
    return timingSafeEqual(Buffer.from(hex, "hex"), Buffer.from(esperado, "hex"));
  } catch {
    // Buffer.from com hex inválido pode jogar; tratamos como assinatura inválida
    return false;
  }
}

function extrairHexAssinatura(raw: string): string | null {
  const trimmed = raw.trim();
  // Formatos possíveis: "<hex>", "sha256=<hex>", "hmac-sha256 <hex>"
  const m1 = trimmed.match(/^[0-9a-f]{64}$/i);
  if (m1) return trimmed.toLowerCase();
  const m2 = trimmed.match(/^sha256=([0-9a-f]{64})$/i);
  if (m2) return m2[1].toLowerCase();
  const m3 = trimmed.match(/^hmac-sha256\s+([0-9a-f]{64})$/i);
  if (m3) return m3[1].toLowerCase();
  return null;
}
