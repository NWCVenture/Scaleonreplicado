// Cascatas entre modelo_principal/modelo_cor/modelo_tamanho e os catálogos
// globais (sku_catalogo, cor_catalogo, tamanho_catalogo).

import { and, eq, ilike } from "drizzle-orm";
import {
  skuCatalogo,
  corCatalogo,
  tamanhoCatalogo,
} from "@/lib/db/schema";
import { parseSKUParts } from "@/lib/estante-utils";
import { generateId } from "@/lib/utils";
import type { db as dbType } from "@/lib/db";

type Tx = Parameters<Parameters<typeof dbType.transaction>[0]>[0];

// ============================================================
// Cascata de desativação: modelo/cor/tamanho → sku_catalogo
// ============================================================

async function fetchSkusDoModelo(
  tx: Tx,
  contaId: string,
  modeloCodigo: string,
): Promise<Array<{ id: string; codigo: string }>> {
  return tx
    .select({ id: skuCatalogo.id, codigo: skuCatalogo.codigo })
    .from(skuCatalogo)
    .where(
      and(
        eq(skuCatalogo.contaId, contaId),
        eq(skuCatalogo.ativo, true),
        ilike(skuCatalogo.codigo, `${modeloCodigo} %`),
      ),
    );
}

async function desativarSkus(
  tx: Tx,
  contaId: string,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  // Drizzle não aceita IN com array vazio, protegido acima
  const { inArray } = await import("drizzle-orm");
  await tx
    .update(skuCatalogo)
    .set({ ativo: false })
    .where(
      and(eq(skuCatalogo.contaId, contaId), inArray(skuCatalogo.id, ids)),
    );
}

export async function deactivateSkusByModelo(
  tx: Tx,
  contaId: string,
  modeloCodigo: string,
): Promise<number> {
  const skus = await fetchSkusDoModelo(tx, contaId, modeloCodigo);
  const ids = skus
    .filter(
      (s) => parseSKUParts(s.codigo).produto.toUpperCase() === modeloCodigo,
    )
    .map((s) => s.id);
  await desativarSkus(tx, contaId, ids);
  return ids.length;
}

export async function deactivateSkusByModeloCor(
  tx: Tx,
  contaId: string,
  modeloCodigo: string,
  corCodigo: string,
): Promise<number> {
  const skus = await fetchSkusDoModelo(tx, contaId, modeloCodigo);
  const ids = skus
    .filter((s) => {
      const p = parseSKUParts(s.codigo);
      return (
        p.produto.toUpperCase() === modeloCodigo &&
        p.cor.toUpperCase() === corCodigo
      );
    })
    .map((s) => s.id);
  await desativarSkus(tx, contaId, ids);
  return ids.length;
}

export async function deactivateSkusByModeloTamanho(
  tx: Tx,
  contaId: string,
  modeloCodigo: string,
  tamanhoCodigo: string,
): Promise<number> {
  const skus = await fetchSkusDoModelo(tx, contaId, modeloCodigo);
  const ids = skus
    .filter((s) => {
      const p = parseSKUParts(s.codigo);
      return (
        p.produto.toUpperCase() === modeloCodigo &&
        p.tam.toUpperCase() === tamanhoCodigo
      );
    })
    .map((s) => s.id);
  await desativarSkus(tx, contaId, ids);
  return ids.length;
}

// ============================================================
// Sync inverso: modelo_cor → cor_catalogo, modelo_tamanho → tamanho_catalogo
// ============================================================

export async function upsertCorGlobal(
  tx: Tx,
  contaId: string,
  codigo: string,
): Promise<void> {
  await tx
    .insert(corCatalogo)
    .values({ id: generateId(), codigo, contaId })
    .onConflictDoNothing();
}

export async function upsertTamanhoGlobal(
  tx: Tx,
  contaId: string,
  codigo: string,
  ordem?: number,
): Promise<void> {
  await tx
    .insert(tamanhoCatalogo)
    .values({
      id: generateId(),
      codigo,
      contaId,
      ordem: ordem ?? 0,
    })
    .onConflictDoNothing();
}
