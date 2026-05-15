// Função pura de classificação de blobs de backup para retenção.
//
// Regra (spec RITM-23):
//   - Manter os 4 backups mais recentes (janela "mês corrente / últimas
//     semanas").
//   - Adicionalmente, manter o backup mais recente de cada mês nos 12
//     meses anteriores ao mês corrente.
//   - Demais entram em `remover`.
//
// O `agora` é injetado pra testabilidade. A função não toca filesystem
// nem rede.

export type BlobBackup = {
  pathname: string;
  uploadedAt: Date;
};

export type ClassificacaoRetencao = {
  manter: string[];
  remover: string[];
};

const SEMANAIS_A_MANTER = 4;
const MESES_HISTORICOS_A_MANTER = 12;

export function classificarParaRetencao(
  blobs: BlobBackup[],
  agora: Date,
): ClassificacaoRetencao {
  if (blobs.length === 0) {
    return { manter: [], remover: [] };
  }

  // Ordenado do mais recente pro mais antigo.
  const ordenados = [...blobs].sort(
    (a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime(),
  );

  const manter = new Set<string>();

  // 1) Os N mais recentes (independente de mês).
  for (const blob of ordenados.slice(0, SEMANAIS_A_MANTER)) {
    manter.add(blob.pathname);
  }

  // 2) O mais recente de cada mês nos 12 meses anteriores ao mês de `agora`.
  //    Chave do mês: "YYYY-MM" em UTC.
  const mesAgora = chaveMesUTC(agora);
  const mesesAlvo = new Set<string>();
  for (let i = 1; i <= MESES_HISTORICOS_A_MANTER; i++) {
    mesesAlvo.add(deslocarMes(mesAgora, -i));
  }

  const maisRecentePorMes = new Map<string, BlobBackup>();
  for (const blob of ordenados) {
    const chave = chaveMesUTC(blob.uploadedAt);
    if (!mesesAlvo.has(chave)) continue;
    // `ordenados` já está em ordem decrescente — o primeiro de cada mês
    // que aparece é o mais recente do mês.
    if (!maisRecentePorMes.has(chave)) {
      maisRecentePorMes.set(chave, blob);
    }
  }
  for (const blob of maisRecentePorMes.values()) {
    manter.add(blob.pathname);
  }

  const remover: string[] = [];
  for (const blob of ordenados) {
    if (!manter.has(blob.pathname)) {
      remover.push(blob.pathname);
    }
  }

  return { manter: [...manter], remover };
}

function chaveMesUTC(d: Date): string {
  const ano = d.getUTCFullYear();
  const mes = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${ano}-${mes}`;
}

// Recebe "YYYY-MM" e retorna a chave deslocada em N meses (pode ser negativo).
function deslocarMes(chave: string, offset: number): string {
  const [anoStr, mesStr] = chave.split("-");
  const ano = Number(anoStr);
  const mes = Number(mesStr) - 1 + offset;
  const novoAno = ano + Math.floor(mes / 12);
  const novoMes = ((mes % 12) + 12) % 12;
  return `${novoAno}-${String(novoMes + 1).padStart(2, "0")}`;
}
