// Auto-sincroniza modelo_principal / modelo_cor / modelo_tamanho com base
// nos SKUs unitários cadastrados em sku_catalogo. Idempotente: só insere o
// que está faltando, não sobrescreve status ativo/inativo existente.

import { and, eq } from "drizzle-orm";
import {
  modeloPrincipal,
  modeloCor,
  modeloTamanho,
  skuCatalogo,
} from "@/lib/db/schema";
import { parseSKUParts } from "@/lib/estante-utils";
import { generateId } from "@/lib/utils";
import type { db as dbType } from "@/lib/db";

type Tx = Parameters<Parameters<typeof dbType.transaction>[0]>[0];

const TAMANHO_ORDER_DEFAULT = ["PP", "P", "M", "G", "GG", "EGG", "XG", "XXG"];

function isKitOrMix(codigo: string): boolean {
  return /^\s*(KIT|MIX)\b/i.test(codigo);
}

export async function syncModelosFromSkus(
  tx: Tx,
  contaId: string,
): Promise<void> {
  // 1. Lê SKUs unitários cadastrados
  const skus = await tx
    .select({ codigo: skuCatalogo.codigo })
    .from(skuCatalogo)
    .where(eq(skuCatalogo.contaId, contaId));

  const triplos = new Set<string>(); // "MODELO|COR|TAM"
  for (const { codigo } of skus) {
    if (!codigo || isKitOrMix(codigo)) continue;
    const { produto, cor, tam } = parseSKUParts(codigo);
    if (!produto) continue;
    triplos.add(`${produto}|${cor}|${tam}`);
  }

  if (triplos.size === 0) return;

  // 2. Lê estado atual
  const [modelosExistentes, coresExistentes, tamanhosExistentes] =
    await Promise.all([
      tx
        .select({ id: modeloPrincipal.id, codigo: modeloPrincipal.codigo })
        .from(modeloPrincipal)
        .where(eq(modeloPrincipal.contaId, contaId)),
      tx
        .select({
          modeloId: modeloCor.modeloId,
          codigo: modeloCor.codigo,
        })
        .from(modeloCor)
        .where(eq(modeloCor.contaId, contaId)),
      tx
        .select({
          modeloId: modeloTamanho.modeloId,
          codigo: modeloTamanho.codigo,
        })
        .from(modeloTamanho)
        .where(eq(modeloTamanho.contaId, contaId)),
    ]);

  const modelosByCodigo = new Map<string, string>(); // codigo -> id
  modelosExistentes.forEach((m) => modelosByCodigo.set(m.codigo, m.id));

  const coresByModelo = new Map<string, Set<string>>();
  coresExistentes.forEach((c) => {
    if (!coresByModelo.has(c.modeloId)) coresByModelo.set(c.modeloId, new Set());
    coresByModelo.get(c.modeloId)!.add(c.codigo);
  });

  const tamanhosByModelo = new Map<string, Set<string>>();
  tamanhosExistentes.forEach((t) => {
    if (!tamanhosByModelo.has(t.modeloId))
      tamanhosByModelo.set(t.modeloId, new Set());
    tamanhosByModelo.get(t.modeloId)!.add(t.codigo);
  });

  // 3. Upsert modelos faltantes
  const modelosPendentes = new Set<string>();
  for (const triplo of triplos) {
    const [produto] = triplo.split("|");
    if (!modelosByCodigo.has(produto)) modelosPendentes.add(produto);
  }
  for (const produto of modelosPendentes) {
    const id = generateId();
    await tx
      .insert(modeloPrincipal)
      .values({ id, codigo: produto, contaId })
      .onConflictDoNothing();
    // Re-lê id (em caso de race / default do generateId)
    const [row] = await tx
      .select({ id: modeloPrincipal.id })
      .from(modeloPrincipal)
      .where(
        and(
          eq(modeloPrincipal.codigo, produto),
          eq(modeloPrincipal.contaId, contaId),
        ),
      );
    if (row) modelosByCodigo.set(produto, row.id);
  }

  // 4. Upsert cores e tamanhos faltantes por modelo
  const novasCores: Array<{
    id: string;
    modeloId: string;
    codigo: string;
    contaId: string;
  }> = [];
  const novosTamanhos: Array<{
    id: string;
    modeloId: string;
    codigo: string;
    ordem: number;
    contaId: string;
  }> = [];

  for (const triplo of triplos) {
    const [produto, cor, tam] = triplo.split("|");
    const modeloId = modelosByCodigo.get(produto);
    if (!modeloId) continue;

    if (cor) {
      const coresSet = coresByModelo.get(modeloId) ?? new Set<string>();
      if (!coresSet.has(cor)) {
        novasCores.push({
          id: generateId(),
          modeloId,
          codigo: cor,
          contaId,
        });
        coresSet.add(cor);
        coresByModelo.set(modeloId, coresSet);
      }
    }
    if (tam) {
      const tamanhosSet = tamanhosByModelo.get(modeloId) ?? new Set<string>();
      if (!tamanhosSet.has(tam)) {
        const ordemIdx = TAMANHO_ORDER_DEFAULT.indexOf(tam);
        novosTamanhos.push({
          id: generateId(),
          modeloId,
          codigo: tam,
          ordem: ordemIdx >= 0 ? ordemIdx : 99,
          contaId,
        });
        tamanhosSet.add(tam);
        tamanhosByModelo.set(modeloId, tamanhosSet);
      }
    }
  }

  if (novasCores.length > 0) {
    await tx.insert(modeloCor).values(novasCores).onConflictDoNothing();
  }
  if (novosTamanhos.length > 0) {
    await tx
      .insert(modeloTamanho)
      .values(novosTamanhos)
      .onConflictDoNothing();
  }
}
