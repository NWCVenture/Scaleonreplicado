// Extrai data 'YYYY-MM-DD' de um texto livre via regex configurada.
// Foco: campo "Estado" do Mercado Livre, com formato 'coleta do dia X
// de Y' (X = dia, Y = mês em pt-BR).
//
// Anchored à regra `canal_regra_prazo.regexPrazo`. A regex DEVE ter
// 2 grupos de captura na ordem (dia, mês).

const MESES_PT: Record<string, number> = {
  // Completos
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  março: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
  // Abreviações comuns
  jan: 1,
  fev: 2,
  mar: 3,
  abr: 4,
  // mai = maio (mesmo abreviado)
  mai: 5,
  jun: 6,
  jul: 7,
  ago: 8,
  set: 9,
  out: 10,
  nov: 11,
  dez: 12,
};

function normalizarNomeMes(s: string): string {
  return s.toLowerCase().trim();
}

function diasNoMes(ano: number, mes: number): number {
  // Date com day=0 do mês seguinte = último dia do mês.
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/**
 * Extrai uma data civil 'YYYY-MM-DD' de um texto livre.
 *
 * @param texto  Texto a parsear (ex.: 'Pronto pra coleta do dia 7 de junho').
 * @param regex  Regex em string. Deve ter 2 grupos: dia e mês.
 * @param anoBase Ano-base (geralmente ano do criadoEm ou ano atual SP).
 *                Quando o mês resolvido está muito atrás do mês "agora",
 *                pula pro ano seguinte (compra em dezembro com prazo
 *                em janeiro).
 * @param mesAtualSp Mês civil SP de "hoje" (1-12). Usado pra decidir
 *                   ano-seguinte vs ano-base.
 * @returns YYYY-MM-DD ou null se não conseguiu interpretar.
 */
export function parsePrazoExplicito(
  texto: string,
  regex: string,
  anoBase: number,
  mesAtualSp: number,
): string | null {
  if (!texto) return null;

  let re: RegExp;
  try {
    re = new RegExp(regex, "i");
  } catch {
    return null;
  }

  const m = texto.match(re);
  if (!m || m.length < 3) return null;

  const dia = Number(m[1]);
  if (!Number.isFinite(dia) || dia < 1 || dia > 31) return null;

  const mesNum = MESES_PT[normalizarNomeMes(m[2])];
  if (mesNum == null) return null;

  // Decide ano. Se o mês resolvido é bem antes do mês atual, assume
  // ano seguinte (threshold -3). Casos cobertos:
  //   - mesAtual=09, mesResolvido=01 → diff=-8 → próximo ano (jan/27)
  //   - mesAtual=01, mesResolvido=12 → diff=11; também é "trás", mas
  //     positivo no módulo. Não tratamos isso (cliente raramente
  //     compra em jan com prazo em dez do ano anterior).
  let ano = anoBase;
  if (mesNum - mesAtualSp < -3) {
    ano = anoBase + 1;
  }

  // Valida que o dia existe no mês resolvido.
  if (dia > diasNoMes(ano, mesNum)) return null;

  return `${ano}-${String(mesNum).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}
