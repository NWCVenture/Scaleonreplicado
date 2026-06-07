// Agregação pura de fardos de uma estante em uma visão consumível por humano:
// matriz cor×tamanho, resumo por SKU, caixas a consolidar, KPIs e avisos.
//
// Entrada: array de fardos já carregado em memória pela página de detalhe.
// Saída: objeto EstanteAgregada (sem efeitos colaterais, sem DOM, sem fetch).
//
// Reusa parseSKUParts, compareSKU, COR_ORDER, TAMANHO_ORDER de estante-utils
// pra manter ordenação canônica consistente com o resto do módulo.

import {
  COR_ORDER,
  TAMANHO_ORDER,
  compareSKU,
  parseSKUParts,
} from "@/lib/estante-utils";

export const CAIXA_PADRAO = 60;

export interface EstanteFardoItem {
  id: string;
  qrCode: string;
  sku: string;
  lote: string;
  quantidade: number;
  adicionadoPor: string;
  createdAt: string;
}

export type TipoAviso =
  | "caixa_acima_padrao"
  | "sku_invalido"
  | "cor_desconhecida"
  | "tamanho_desconhecido";

export interface Aviso {
  tipo: TipoAviso;
  mensagem: string;
  fardoId?: string;
}

export interface ResumoSku {
  sku: string;
  produto: string;
  cor: string;
  tamanho: string;
  pecas: number;
  numFardos: number;
  fardosCheios: number;
  fardosParciais: number;
}

export interface CaixaParcial {
  fardoId: string;
  sku: string;
  cor: string;
  tamanho: string;
  lote: string;
  quantidade: number;
  faltaParaCheia: number;
}

export interface EstanteAgregada {
  totalPecas: number;
  totalFardos: number;
  fardosCheios: number;
  fardosParciais: number;
  ocupacaoPct: number;
  lotes: string[];
  porSku: ResumoSku[];
  matriz: Record<string, Record<string, number>>;
  totaisPorCor: Record<string, number>;
  totaisPorTamanho: Record<string, number>;
  coresOrdenadas: string[];
  tamanhosOrdenados: string[];
  caixasParciais: CaixaParcial[];
  avisos: Aviso[];
}

interface AgregarOpts {
  caixaPadrao?: number;
}

// Ordena valores conforme uma lista canônica: primeiro os conhecidos na ordem
// dada, depois os desconhecidos em ordem alfanumérica (locale "en" + numeric
// pra que "10" venha depois de "2", suportando tamanhos numéricos futuros).
function ordenarPorCanonica(valores: string[], canonica: readonly string[]): string[] {
  const conhecidos: string[] = [];
  const desconhecidos: string[] = [];
  for (const v of valores) {
    if (canonica.includes(v)) conhecidos.push(v);
    else desconhecidos.push(v);
  }
  conhecidos.sort((a, b) => canonica.indexOf(a) - canonica.indexOf(b));
  desconhecidos.sort((a, b) =>
    a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }),
  );
  return [...conhecidos, ...desconhecidos];
}

export function agregarFardos(
  fardos: EstanteFardoItem[],
  opts: AgregarOpts = {},
): EstanteAgregada {
  const caixaPadrao = opts.caixaPadrao ?? CAIXA_PADRAO;
  const avisos: Aviso[] = [];

  // Avisos de cor/tamanho são emitidos uma vez por valor, não por fardo.
  const coresAvisadas = new Set<string>();
  const tamanhosAvisados = new Set<string>();

  let totalPecas = 0;
  let fardosCheios = 0;
  let fardosParciais = 0;
  const lotesSet = new Set<string>();
  const coresVistas = new Set<string>();
  const tamanhosVistos = new Set<string>();

  // Agrupamento por SKU
  const porSkuMap = new Map<string, ResumoSku>();
  // Matriz: cor → tamanho → peças
  const matriz: Record<string, Record<string, number>> = {};
  const caixasParciais: CaixaParcial[] = [];

  for (const fardo of fardos) {
    const { produto, cor: corRaw, tam: tamRaw } = parseSKUParts(fardo.sku);
    const cor = corRaw || "?";
    const tamanho = tamRaw || "?";

    if (!produto || !corRaw || !tamRaw) {
      avisos.push({
        tipo: "sku_invalido",
        mensagem: `SKU fora do padrão "PRODUTO COR TAMANHO": "${fardo.sku}"`,
        fardoId: fardo.id,
      });
    }
    if (corRaw && !COR_ORDER.includes(corRaw) && !coresAvisadas.has(corRaw)) {
      avisos.push({
        tipo: "cor_desconhecida",
        mensagem: `Cor "${corRaw}" não está na lista canônica de cores.`,
      });
      coresAvisadas.add(corRaw);
    }
    if (
      tamRaw &&
      !TAMANHO_ORDER.includes(tamRaw) &&
      !tamanhosAvisados.has(tamRaw)
    ) {
      avisos.push({
        tipo: "tamanho_desconhecido",
        mensagem: `Tamanho "${tamRaw}" não está na lista canônica de tamanhos.`,
      });
      tamanhosAvisados.add(tamRaw);
    }

    // Classificação de cheio/parcial. Quantidade acima do padrão conta como
    // cheia (preserva totais) mas gera aviso pra investigação.
    if (fardo.quantidade > caixaPadrao) {
      avisos.push({
        tipo: "caixa_acima_padrao",
        mensagem: `Fardo ${fardo.sku} (lote ${fardo.lote}) com ${fardo.quantidade} peças (padrão ${caixaPadrao}).`,
        fardoId: fardo.id,
      });
      fardosCheios++;
    } else if (fardo.quantidade === caixaPadrao) {
      fardosCheios++;
    } else {
      fardosParciais++;
      caixasParciais.push({
        fardoId: fardo.id,
        sku: fardo.sku,
        cor,
        tamanho,
        lote: fardo.lote,
        quantidade: fardo.quantidade,
        faltaParaCheia: caixaPadrao - fardo.quantidade,
      });
    }

    totalPecas += fardo.quantidade;
    if (fardo.lote) lotesSet.add(fardo.lote);
    coresVistas.add(cor);
    tamanhosVistos.add(tamanho);

    // Acumular matriz
    if (!matriz[cor]) matriz[cor] = {};
    matriz[cor][tamanho] = (matriz[cor][tamanho] ?? 0) + fardo.quantidade;

    // Acumular porSku
    const existente = porSkuMap.get(fardo.sku);
    const ehCheio = fardo.quantidade >= caixaPadrao;
    if (existente) {
      existente.pecas += fardo.quantidade;
      existente.numFardos++;
      if (ehCheio) existente.fardosCheios++;
      else existente.fardosParciais++;
    } else {
      porSkuMap.set(fardo.sku, {
        sku: fardo.sku,
        produto: produto || "?",
        cor,
        tamanho,
        pecas: fardo.quantidade,
        numFardos: 1,
        fardosCheios: ehCheio ? 1 : 0,
        fardosParciais: ehCheio ? 0 : 1,
      });
    }
  }

  const totalFardos = fardos.length;
  const ocupacaoBruta =
    totalFardos === 0 ? 0 : (totalPecas / (totalFardos * caixaPadrao)) * 100;
  const ocupacaoPct = Math.min(100, Math.round(ocupacaoBruta));

  const coresOrdenadas = ordenarPorCanonica([...coresVistas], COR_ORDER);
  const tamanhosOrdenados = ordenarPorCanonica(
    [...tamanhosVistos],
    TAMANHO_ORDER,
  );

  // Garantir células zeradas pra toda combinação cor × tamanho vista.
  for (const cor of coresOrdenadas) {
    if (!matriz[cor]) matriz[cor] = {};
    for (const tam of tamanhosOrdenados) {
      if (matriz[cor][tam] == null) matriz[cor][tam] = 0;
    }
  }

  // Totais marginais
  const totaisPorCor: Record<string, number> = {};
  const totaisPorTamanho: Record<string, number> = {};
  for (const cor of coresOrdenadas) totaisPorCor[cor] = 0;
  for (const tam of tamanhosOrdenados) totaisPorTamanho[tam] = 0;
  for (const cor of coresOrdenadas) {
    for (const tam of tamanhosOrdenados) {
      const v = matriz[cor][tam] ?? 0;
      totaisPorCor[cor] += v;
      totaisPorTamanho[tam] += v;
    }
  }

  const porSku = [...porSkuMap.values()].sort((a, b) =>
    compareSKU(a.sku, b.sku),
  );

  caixasParciais.sort((a, b) => b.faltaParaCheia - a.faltaParaCheia);

  const lotes = [...lotesSet].sort((a, b) => a.localeCompare(b, "en"));

  return {
    totalPecas,
    totalFardos,
    fardosCheios,
    fardosParciais,
    ocupacaoPct,
    lotes,
    porSku,
    matriz,
    totaisPorCor,
    totaisPorTamanho,
    coresOrdenadas,
    tamanhosOrdenados,
    caixasParciais,
    avisos,
  };
}
