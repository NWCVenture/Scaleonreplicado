// Função pura de parsing de SKU. Recebe input + contexto, devolve
// SkuParsed ou SkuAmbiguo. Sem efeitos colaterais — testável só com
// fixtures.
//
// Pipeline (resumo):
//   1. Pré-processa (uppercase, trim, aliases globais)
//   2. Tokeniza
//   3. Detecta KIT/MIX prefix + opcional N
//   4. Identifica modelo (primeiro token que casa modelo.codigo)
//   5. Aplica aliases por modelo nos tokens restantes
//   6. Classifica tokens restantes: cor, tamanho, número, desconhecido
//   7. Determina kind e monta cores/tamanho/qtdKit
//   8. Valida (kit consistência, cor/tamanho ausentes, tokens extras)
//   9. Constrói canonical
//
// Convenção: tudo em UPPERCASE end-to-end. Sentinela 'UNICO' pra
// tamanho de modelo sem grade.

import type {
  ContextoCadastro,
  ModeloSnapshot,
  MotivoAmbiguidade,
  ParCorQtd,
  ResultadoParsearSku,
  SkuAmbiguo,
  SkuKind,
  SkuParsed,
  TokenInterpretado,
} from "./types";
import { preprocessar } from "./aplicar-aliases";
import { ehNumeroPositivo, tokenizar } from "./tokenizar";
import { construirCanonical } from "./canonical";

export const TAMANHO_UNICO = "UNICO";

export function parsearSku(
  input: string,
  ctx: ContextoCadastro,
): ResultadoParsearSku {
  const inputOriginal = input;
  const preprocessado = preprocessar(input, ctx);

  if (preprocessado === "") {
    return ambiguo({
      input: inputOriginal,
      preprocessado,
      motivo: "input_vazio",
      detalhes: "Input vazio ou só whitespace",
      tokens: [],
    });
  }

  const tokens = tokenizar(preprocessado);
  const interpretados: TokenInterpretado[] = [];

  // ---- Step 1: prefixo KIT/MIX + N ---------------------------------
  let i = 0;
  let prefixo: "KIT" | "MIX" | null = null;
  let nExplicito: number | null = null;

  if (tokens[i] === "KIT") {
    prefixo = "KIT";
    interpretados.push({
      token: tokens[i],
      resolvido: "KIT",
      categoria: "kit",
    });
    i++;
    if (i < tokens.length && ehNumeroPositivo(tokens[i])) {
      nExplicito = Number(tokens[i]);
      interpretados.push({
        token: tokens[i],
        resolvido: tokens[i],
        categoria: "qtd",
      });
      i++;
    }
  } else if (tokens[i] === "MIX") {
    prefixo = "MIX";
    interpretados.push({
      token: tokens[i],
      resolvido: "MIX",
      categoria: "mix",
    });
    i++;
    if (i < tokens.length && ehNumeroPositivo(tokens[i])) {
      nExplicito = Number(tokens[i]);
      interpretados.push({
        token: tokens[i],
        resolvido: tokens[i],
        categoria: "qtd",
      });
      i++;
    } else {
      return ambiguo({
        input: inputOriginal,
        preprocessado,
        motivo: "mix_invalido",
        detalhes: "MIX exige N (ex.: 'MIX 4 MODELO TAMANHO')",
        tokens: interpretados.concat(
          tokens.slice(i).map((t) => ({
            token: t,
            resolvido: null,
            categoria: "desconhecido" as const,
          })),
        ),
      });
    }
  }

  // ---- Step 2: identifica modelo no resto dos tokens ----------------
  let modelo: ModeloSnapshot | null = null;
  let idxModeloRel = -1; // índice DENTRO de tokens.slice(i)
  for (let j = i; j < tokens.length; j++) {
    const candidato = ctx.modelosPorCodigo.get(tokens[j]);
    if (candidato) {
      modelo = candidato;
      idxModeloRel = j;
      break;
    }
  }
  if (modelo == null) {
    // Marca tokens restantes como desconhecidos pra debug.
    for (let j = i; j < tokens.length; j++) {
      interpretados.push({
        token: tokens[j],
        resolvido: null,
        categoria: "desconhecido",
      });
    }
    return ambiguo({
      input: inputOriginal,
      preprocessado,
      motivo: "modelo_desconhecido",
      detalhes: `Nenhum token casou com modelo cadastrado (${tokens.slice(i).join(" ")})`,
      tokens: interpretados,
    });
  }

  // Marca o token modelo.
  interpretados.push({
    token: tokens[idxModeloRel],
    resolvido: modelo.codigo,
    categoria: "modelo",
  });

  // Coleta tokens "restantes" — tudo entre o início do range e o
  // modelo (não esperado em SKUs normais, mas conta como desconhecido)
  // + tudo depois do modelo.
  const tokensAntesModelo = tokens.slice(i, idxModeloRel);
  const tokensDepoisModelo = tokens.slice(idxModeloRel + 1);

  // Tokens antes do modelo (que não sejam KIT/MIX/N) são suspeitos.
  if (tokensAntesModelo.length > 0) {
    for (const t of tokensAntesModelo) {
      interpretados.push({
        token: t,
        resolvido: null,
        categoria: "desconhecido",
      });
    }
    return ambiguo({
      input: inputOriginal,
      preprocessado,
      motivo: "tokens_extras",
      detalhes: `Tokens antes do modelo ${modelo.codigo}: ${tokensAntesModelo.join(" ")}`,
      tokens: interpretados,
    });
  }

  // ---- Step 3: aplica aliases por modelo ----------------------------
  const aliasesModelo = ctx.aliasesPorModelo.get(modelo.id);
  const tokensResolvidos = tokensDepoisModelo.map((t) => {
    if (!aliasesModelo) return t;
    if (aliasesModelo.cor.has(t)) return aliasesModelo.cor.get(t)!;
    if (aliasesModelo.tamanho.has(t)) return aliasesModelo.tamanho.get(t)!;
    return t;
  });

  // ---- Step 4: classifica tokens restantes --------------------------
  const coresValidas = new Set([...ctx.coresGlobais, ...modelo.cores]);
  const tamanhosValidos = new Set([
    ...ctx.tamanhosGlobais,
    ...modelo.tamanhos,
  ]);

  type Slot =
    | { tipo: "num"; valor: number; idx: number }
    | { tipo: "cor"; cor: string; idx: number }
    | { tipo: "tam"; tam: string; idx: number }
    | { tipo: "desconhecido"; token: string; idx: number };

  const slots: Slot[] = [];
  for (let k = 0; k < tokensResolvidos.length; k++) {
    const t = tokensResolvidos[k];
    const original = tokensDepoisModelo[k];
    if (ehNumeroPositivo(t)) {
      slots.push({ tipo: "num", valor: Number(t), idx: k });
      interpretados.push({
        token: original,
        resolvido: t,
        categoria: "qtd",
      });
    } else if (coresValidas.has(t)) {
      slots.push({ tipo: "cor", cor: t, idx: k });
      interpretados.push({
        token: original,
        resolvido: t,
        categoria: "cor",
      });
    } else if (tamanhosValidos.has(t)) {
      slots.push({ tipo: "tam", tam: t, idx: k });
      interpretados.push({
        token: original,
        resolvido: t,
        categoria: "tamanho",
      });
    } else {
      slots.push({ tipo: "desconhecido", token: t, idx: k });
      interpretados.push({
        token: original,
        resolvido: null,
        categoria: "desconhecido",
      });
    }
  }

  const desconhecidos = slots.filter((s) => s.tipo === "desconhecido");
  if (desconhecidos.length > 0) {
    const tokensDesc = desconhecidos
      .map((s) => (s.tipo === "desconhecido" ? s.token : ""))
      .filter(Boolean);
    // Inferir o motivo mais útil: se modelo tem grade e o token bate
    // forma de tamanho (curta, ex.: 1-4 chars), provavelmente é
    // tamanho_desconhecido; senão cor_desconhecida.
    const motivo: MotivoAmbiguidade =
      tokensDesc.length === 1 && tokensDesc[0].length <= 4
        ? "tamanho_desconhecido"
        : "cor_desconhecida";
    return ambiguo({
      input: inputOriginal,
      preprocessado,
      motivo,
      detalhes: `Tokens não interpretáveis: ${tokensDesc.join(", ")}`,
      tokens: interpretados,
    });
  }

  const tams = slots.filter((s) => s.tipo === "tam");
  const cores = slots.filter((s) => s.tipo === "cor");
  const nums = slots.filter((s) => s.tipo === "num");

  // Múltiplos tamanhos → tokens_extras.
  if (tams.length > 1) {
    return ambiguo({
      input: inputOriginal,
      preprocessado,
      motivo: "tokens_extras",
      detalhes: `Mais de um tamanho identificado: ${tams.map((t) => (t.tipo === "tam" ? t.tam : "")).join(", ")}`,
      tokens: interpretados,
    });
  }

  const tamanhoToken = tams[0]?.tipo === "tam" ? tams[0].tam : null;

  // Resolução de tamanho considerando exigeTamanho.
  let tamanho: string;
  if (modelo.exigeTamanho) {
    if (!tamanhoToken) {
      return ambiguo({
        input: inputOriginal,
        preprocessado,
        motivo: "tamanho_ausente",
        detalhes: `Modelo ${modelo.codigo} exige tamanho`,
        tokens: interpretados,
      });
    }
    tamanho = tamanhoToken;
  } else {
    // Modelo sem grade — qualquer tamanho explícito é tokens_extras.
    if (tamanhoToken) {
      return ambiguo({
        input: inputOriginal,
        preprocessado,
        motivo: "tokens_extras",
        detalhes: `Modelo ${modelo.codigo} não tem grade de tamanho mas SKU traz '${tamanhoToken}'`,
        tokens: interpretados,
      });
    }
    tamanho = TAMANHO_UNICO;
  }

  // ---- Step 5: monta cores + qtdKit + kind --------------------------
  let kind: SkuKind;
  let coresOut: ParCorQtd[] = [];
  let qtdKit: number;

  if (prefixo === "MIX") {
    if (cores.length > 0) {
      return ambiguo({
        input: inputOriginal,
        preprocessado,
        motivo: "tokens_extras",
        detalhes: "MIX não aceita cores listadas (a lista vem do cadastro)",
        tokens: interpretados,
      });
    }
    // nExplicito já validado no Step 1.
    kind = "MIX";
    qtdKit = nExplicito!;
    coresOut = [];
  } else if (prefixo === "KIT") {
    // KIT: pode ter distribuição (numeros + cores intercalados) OU
    // cores listadas OU cor única.
    if (nums.length > 0) {
      // Distribuição: cada num deve ser imediatamente seguido por uma cor.
      const distribuicao: ParCorQtd[] = [];
      let restanteOk = true;
      // Walks por idx em slots, ignorando o tamanho.
      const slotsSemTam = slots.filter((s) => s.tipo !== "tam");
      for (let k = 0; k < slotsSemTam.length; k += 2) {
        const a = slotsSemTam[k];
        const b = slotsSemTam[k + 1];
        if (a?.tipo !== "num" || b?.tipo !== "cor") {
          restanteOk = false;
          break;
        }
        distribuicao.push({ cor: b.cor, qtd: a.valor });
      }
      if (!restanteOk || distribuicao.length === 0) {
        return ambiguo({
          input: inputOriginal,
          preprocessado,
          motivo: "kit_inconsistente",
          detalhes:
            "KIT com distribuição exige pares (qtd cor) consecutivos antes do tamanho",
          tokens: interpretados,
        });
      }
      const soma = distribuicao.reduce((acc, c) => acc + c.qtd, 0);
      if (nExplicito != null && nExplicito !== soma) {
        return ambiguo({
          input: inputOriginal,
          preprocessado,
          motivo: "kit_inconsistente",
          detalhes: `KIT N=${nExplicito} ≠ soma das quantidades (${soma})`,
          tokens: interpretados,
        });
      }
      kind = "KIT_DISTRIBUICAO";
      qtdKit = soma;
      coresOut = distribuicao;
    } else if (cores.length === 0) {
      // KIT sem cor e sem distribuição. Se modelo tem corPadrao,
      // assume.
      if (modelo.corPadrao == null) {
        return ambiguo({
          input: inputOriginal,
          preprocessado,
          motivo: "cor_ausente",
          detalhes: `KIT ${modelo.codigo} sem cor e modelo não tem corPadrao`,
          tokens: interpretados,
        });
      }
      const n = nExplicito ?? 1;
      kind = "KIT_COR_UNICA";
      qtdKit = n;
      coresOut = [{ cor: modelo.corPadrao, qtd: n }];
    } else if (cores.length === 1) {
      const n = nExplicito ?? 1;
      kind = "KIT_COR_UNICA";
      qtdKit = n;
      const corUnica =
        cores[0].tipo === "cor" ? cores[0].cor : modelo.corPadrao!;
      coresOut = [{ cor: corUnica, qtd: n }];
    } else {
      // Múltiplas cores, sem números → CORES_LISTADAS.
      const lista = cores
        .map((c) => (c.tipo === "cor" ? c.cor : ""))
        .filter(Boolean);
      const n = nExplicito ?? lista.length;
      if (nExplicito != null && lista.length !== nExplicito) {
        return ambiguo({
          input: inputOriginal,
          preprocessado,
          motivo: "kit_inconsistente",
          detalhes: `KIT N=${nExplicito} ≠ cores listadas (${lista.length})`,
          tokens: interpretados,
        });
      }
      kind = "KIT_CORES_LISTADAS";
      qtdKit = n;
      coresOut = lista.map((cor) => ({ cor, qtd: 1 }));
    }

    // Normalização: KIT N=1 vira AVULSO (vide spec).
    if (qtdKit === 1 && kind === "KIT_COR_UNICA") {
      kind = "AVULSO";
    }
  } else {
    // Sem prefixo: AVULSO.
    if (nums.length > 0) {
      return ambiguo({
        input: inputOriginal,
        preprocessado,
        motivo: "tokens_extras",
        detalhes: "Números fora de KIT/MIX não são suportados",
        tokens: interpretados,
      });
    }
    if (cores.length > 1) {
      return ambiguo({
        input: inputOriginal,
        preprocessado,
        motivo: "tokens_extras",
        detalhes: `Múltiplas cores sem prefixo KIT: ${cores
          .map((c) => (c.tipo === "cor" ? c.cor : ""))
          .join(" ")}`,
        tokens: interpretados,
      });
    }
    if (cores.length === 0) {
      if (modelo.corPadrao == null) {
        return ambiguo({
          input: inputOriginal,
          preprocessado,
          motivo: "cor_ausente",
          detalhes: `Modelo ${modelo.codigo} sem corPadrao e SKU não traz cor`,
          tokens: interpretados,
        });
      }
      kind = "AVULSO";
      qtdKit = 1;
      coresOut = [{ cor: modelo.corPadrao, qtd: 1 }];
    } else {
      kind = "AVULSO";
      qtdKit = 1;
      const corUnica = cores[0].tipo === "cor" ? cores[0].cor : "";
      coresOut = [{ cor: corUnica, qtd: 1 }];
    }
  }

  // ---- Step 6: canonical -------------------------------------------
  const canonical = construirCanonical(
    kind,
    modelo.codigo,
    coresOut,
    tamanho,
    qtdKit,
  );

  const parsed: SkuParsed = {
    kind,
    modeloCodigo: modelo.codigo,
    cores: coresOut,
    tamanho,
    qtdKit,
    canonical,
    input: inputOriginal,
    preprocessado,
  };
  return parsed;
}

// ----- helpers ----------------------------------------------------

function ambiguo(args: {
  input: string;
  preprocessado: string;
  motivo: MotivoAmbiguidade;
  detalhes: string;
  tokens: TokenInterpretado[];
}): SkuAmbiguo {
  return {
    kind: "AMBIGUO",
    input: args.input,
    preprocessado: args.preprocessado,
    motivo: args.motivo,
    detalhes: args.detalhes,
    tokensInterpretados: args.tokens,
  };
}
