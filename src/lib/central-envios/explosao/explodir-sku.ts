// Função pura de explosão de SKU. Recebe um SkuParsed (do RITM-04) +
// ContextoExplosao e retorna LinhasExplodidas | ExplosaoErro.
//
// Pipeline:
//   1. Lookup nominal em ctx.kitRegrasPorCanonical (canonical match).
//   2. Fallback paramétrico (dispatch por parsed.kind).
//   3. Agrega linhas duplicadas (mesmo modelo, cor, tamanho) somando qtd.
//   4. Sort estável por (cor, tamanho) pra determinismo.

import type { SkuParsed } from "../normalizacao/types";
import type {
  ContextoExplosao,
  ExplosaoErro,
  LinhaExplodida,
  LinhasExplodidas,
  MotivoExplosaoErro,
  ResultadoExplosao,
} from "./types";

export function explodirSku(
  parsed: SkuParsed,
  ctx: ContextoExplosao,
): ResultadoExplosao {
  // ---- 1. Lookup nominal -------------------------------------------
  const regra = ctx.kitRegrasPorCanonical.get(parsed.canonical);
  if (regra) {
    const linhas: LinhaExplodida[] = regra.componentes.map((c) => ({
      modeloCodigo: c.modeloCodigo,
      cor: c.cor,
      tamanho: c.tamanho,
      // Multiplica pelo qtdKit do SKU original (KIT 2 cadastrado como 1
      // unidade → 2 unidades quando o pedido pede KIT 2).
      qtd: c.quantidade * parsed.qtdKit,
    }));
    return {
      kind: "LINHAS",
      linhas: agregarEOrdenar(linhas),
      origem: "nominal",
      canonical: parsed.canonical,
    };
  }

  // ---- 2. Paramétrico ----------------------------------------------
  switch (parsed.kind) {
    case "AVULSO":
    case "KIT_COR_UNICA":
    case "KIT_CORES_LISTADAS":
    case "KIT_DISTRIBUICAO": {
      const linhas = parsed.cores.map((c) => ({
        modeloCodigo: parsed.modeloCodigo,
        cor: c.cor,
        tamanho: parsed.tamanho,
        qtd: c.qtd,
      }));
      return {
        kind: "LINHAS",
        linhas: agregarEOrdenar(linhas),
        origem: "parametrico",
        canonical: parsed.canonical,
      };
    }
    case "MIX":
      return explodirMix(parsed, ctx);
    default: {
      // Defensivo — kind exhaustive.
      const k = parsed.kind as string;
      return erro(parsed, "sku_kind_nao_suportado", `kind=${k} não tratado`);
    }
  }
}

function explodirMix(
  parsed: SkuParsed,
  ctx: ContextoExplosao,
): ResultadoExplosao {
  const modelo = ctx.cadastro.modelosPorCodigo.get(parsed.modeloCodigo);
  if (!modelo) {
    // Não deveria acontecer — parsed já identificou o modelo. Defensivo.
    return erro(
      parsed,
      "mix_modelo_sem_cores",
      `Modelo ${parsed.modeloCodigo} sumiu do contexto (inconsistência)`,
    );
  }

  const n = parsed.qtdKit;
  // Override por corMixDefault[N]
  const override = modelo.corMixDefault?.[String(n)];
  let coresEscolhidas: string[];

  if (override && override.length > 0) {
    // Operador disse explicitamente quais cores compõem o MIX N.
    // Mesmo que tamanho da lista divirja de N, respeitamos o cadastro
    // (UI valida em RITM-10; aqui não escondemos inconsistência).
    coresEscolhidas = override;
  } else {
    if (modelo.cores.length === 0) {
      return erro(
        parsed,
        "mix_modelo_sem_cores",
        `Modelo ${parsed.modeloCodigo} não tem cores cadastradas e não tem corMixDefault[${n}]`,
      );
    }
    if (modelo.cores.length < n) {
      return erro(
        parsed,
        "mix_cores_insuficientes",
        `MIX N=${n} mas modelo ${parsed.modeloCodigo} só tem ${modelo.cores.length} cores cadastradas`,
      );
    }
    coresEscolhidas = modelo.cores.slice(0, n);
  }

  const linhas = coresEscolhidas.map((cor) => ({
    modeloCodigo: parsed.modeloCodigo,
    cor,
    tamanho: parsed.tamanho,
    qtd: 1,
  }));

  return {
    kind: "LINHAS",
    linhas: agregarEOrdenar(linhas),
    origem: "parametrico",
    canonical: parsed.canonical,
  };
}

function agregarEOrdenar(linhas: LinhaExplodida[]): LinhaExplodida[] {
  const mapa = new Map<string, LinhaExplodida>();
  for (const l of linhas) {
    const k = `${l.modeloCodigo}|${l.cor}|${l.tamanho}`;
    const existente = mapa.get(k);
    if (existente) {
      existente.qtd += l.qtd;
    } else {
      mapa.set(k, { ...l });
    }
  }
  return Array.from(mapa.values()).sort((a, b) => {
    if (a.modeloCodigo !== b.modeloCodigo) {
      return a.modeloCodigo.localeCompare(b.modeloCodigo);
    }
    if (a.cor !== b.cor) return a.cor.localeCompare(b.cor);
    return a.tamanho.localeCompare(b.tamanho);
  });
}

function erro(
  parsed: SkuParsed,
  motivo: MotivoExplosaoErro,
  detalhes: string,
): ExplosaoErro {
  return { kind: "EXPLOSAO_ERRO", motivo, detalhes, parsed };
}

// Tipo re-exportado pra ergonomia.
export type { LinhasExplodidas };
