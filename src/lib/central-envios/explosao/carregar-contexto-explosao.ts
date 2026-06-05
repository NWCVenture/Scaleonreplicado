// Carrega snapshot de regras de kit (sku_kit_regra + componentes),
// canonicalizando via parsearSku no momento do load. Isso permite que
// o cadastro armazene o SKU "como o operador digitou" e o lookup em
// runtime aconteça contra a forma canônica.
//
// Regras com kit_sku ambíguo OU com componentes ambíguos/não-AVULSO
// vão pra `kitRegrasComProblema` (informativo) e NÃO entram no Map de
// lookup. Sem load failure — cadastro inconsistente não pode bloquear
// uploads.

import { db } from "@/lib/db";
import { skuKitRegra, skuKitComponente } from "@/lib/db/schema";
import { parsearSku } from "../normalizacao/parsear-sku";
import type { ContextoCadastro } from "../normalizacao/types";
import type {
  ContextoExplosao,
  KitRegraComponenteResolvido,
  KitRegraSnapshot,
  ProblemaKitRegra,
} from "./types";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function carregarContextoExplosao(
  tx: Tx,
  cadastro: ContextoCadastro,
): Promise<ContextoExplosao> {
  const [regrasRows, componentesRows] = await Promise.all([
    tx
      .select({
        id: skuKitRegra.id,
        kitSku: skuKitRegra.kitSku,
      })
      .from(skuKitRegra),
    tx
      .select({
        kitRegraId: skuKitComponente.kitRegraId,
        sku: skuKitComponente.sku,
        quantidade: skuKitComponente.quantidade,
      })
      .from(skuKitComponente),
  ]);

  const componentesPorRegra = new Map<
    string,
    Array<{ sku: string; quantidade: number }>
  >();
  for (const c of componentesRows) {
    const lista = componentesPorRegra.get(c.kitRegraId) ?? [];
    lista.push({ sku: c.sku, quantidade: c.quantidade });
    componentesPorRegra.set(c.kitRegraId, lista);
  }

  const kitRegrasPorCanonical = new Map<string, KitRegraSnapshot>();
  const kitRegrasComProblema: ProblemaKitRegra[] = [];

  for (const regra of regrasRows) {
    const parsedKit = parsearSku(regra.kitSku, cadastro);
    if (parsedKit.kind === "AMBIGUO") {
      kitRegrasComProblema.push({
        kitRegraId: regra.id,
        kitSku: regra.kitSku,
        motivo: "kit_sku_ambiguo",
        detalhes: `${parsedKit.motivo}: ${parsedKit.detalhes}`,
      });
      continue;
    }

    const componentes = componentesPorRegra.get(regra.id) ?? [];
    const resolvidos: KitRegraComponenteResolvido[] = [];
    let regraOk = true;

    for (const comp of componentes) {
      const parsedComp = parsearSku(comp.sku, cadastro);
      if (parsedComp.kind === "AMBIGUO") {
        kitRegrasComProblema.push({
          kitRegraId: regra.id,
          kitSku: regra.kitSku,
          motivo: "componente_ambiguo",
          detalhes: `Componente '${comp.sku}': ${parsedComp.motivo} — ${parsedComp.detalhes}`,
        });
        regraOk = false;
        break;
      }
      if (parsedComp.kind !== "AVULSO") {
        kitRegrasComProblema.push({
          kitRegraId: regra.id,
          kitSku: regra.kitSku,
          motivo: "componente_nao_avulso",
          detalhes: `Componente '${comp.sku}' parseado como ${parsedComp.kind} (esperado AVULSO; nested kits são V2)`,
        });
        regraOk = false;
        break;
      }
      resolvidos.push({
        componenteSku: comp.sku,
        componenteCanonical: parsedComp.canonical,
        quantidade: comp.quantidade,
        modeloCodigo: parsedComp.modeloCodigo,
        cor: parsedComp.cores[0].cor,
        tamanho: parsedComp.tamanho,
      });
    }

    if (!regraOk) continue;

    kitRegrasPorCanonical.set(parsedKit.canonical, {
      id: regra.id,
      kitSku: regra.kitSku,
      canonical: parsedKit.canonical,
      componentes: resolvidos,
    });
  }

  return {
    cadastro,
    kitRegrasPorCanonical,
    kitRegrasComProblema,
  };
}
